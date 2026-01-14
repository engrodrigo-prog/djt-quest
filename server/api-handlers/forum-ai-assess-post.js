import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx', 'content_curator']);
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        if (!SUPABASE_URL || !SERVICE_KEY)
            return res.status(200).json({ success: false, skipped: true, reason: 'Missing Supabase config' });
        if (!OPENAI_API_KEY)
            return res.status(200).json({ success: false, skipped: true, reason: 'Missing OPENAI_API_KEY' });
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token)
            return res.status(200).json({ success: false, skipped: true, reason: 'Unauthenticated' });
        const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const authed = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
        });
        // Only allow staff to run AI assessments (prevents charge abuse and noise).
        let uid = null;
        try {
            if (SERVICE_ROLE_KEY) {
                const { data } = await admin.auth.getUser(token);
                uid = data?.user?.id || null;
            }
            else {
                const { data } = await authed.auth.getUser();
                uid = data?.user?.id || null;
            }
        }
        catch {
            uid = null;
        }
        if (!uid)
            return res.status(200).json({ success: false, skipped: true, reason: 'Unauthenticated' });
        let allowed = false;
        try {
            const { data: roles } = await (SERVICE_ROLE_KEY ? admin : authed).from('user_roles').select('role').eq('user_id', uid);
            allowed = (roles || []).some((r) => STAFF_ROLES.has(String(r?.role || '')));
        }
        catch {
            allowed = false;
        }
        if (!allowed)
            return res.status(200).json({ success: false, skipped: true, reason: 'Forbidden' });
        const { post_id } = req.body || {};
        if (!post_id)
            return res.status(200).json({ success: false, skipped: true, reason: 'post_id required' });
        const { data: post, error: pErr } = await admin.from('forum_posts').select('id, content_md').eq('id', post_id).single();
        if (pErr || !post)
            return res.status(200).json({ success: false, skipped: true, reason: 'post not found' });
        const system = 'Classifique posts de fórum (pt-BR): retorne JSON { helpfulness:0..1, clarity:0..1, novelty:0..1, toxicity:0..1, chas:"C|H|A|S", tags:[..], flags:[..] }.';
        const user = `POST:\n${post.content_md}`;
        // Prefer configured models; fall back to widely available chat-completions models.
        const override = process.env.OPENAI_MODEL_OVERRIDE || '';
        const fast = process.env.OPENAI_MODEL_FAST || '';
        const premium = process.env.OPENAI_MODEL_PREMIUM || '';
        const models = Array.from(new Set([
            override,
            fast,
            premium,
            // Stable fallbacks
            'gpt-4o-mini',
            'gpt-4.1-mini',
            'gpt-4o',
        ]
            .map((m) => String(m || '').trim())
            .filter(Boolean)));
        let content = '';
        let lastErr = '';
        for (const model of models) {
            const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
            body.max_tokens = 300;
            const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
                body: JSON.stringify(body)
            });
            if (!resp.ok) {
                lastErr = await resp.text().catch(() => `HTTP ${resp.status}`);
                continue;
            }
            const data = await resp.json().catch(() => null);
            content = data?.choices?.[0]?.message?.content || '';
            if (content)
                break;
        }
        if (!content)
            return res.status(200).json({ success: false, skipped: true, reason: `OpenAI error: ${lastErr || 'no output'}` });
        let json;
        try {
            json = JSON.parse(content);
        }
        catch {
            const m = content?.match?.(/\{[\s\S]*\}/);
            if (m)
                json = JSON.parse(m[0]);
        }
        if (!json)
            return res.status(200).json({ success: false, skipped: true, reason: 'Bad AI format', raw: content });
        await admin.from('forum_posts').update({ ai_assessment: json, tags: json.tags || null }).eq('id', post_id);
        return res.status(200).json({ success: true, assessment: json });
    }
    catch (e) {
        return res.status(200).json({ success: false, skipped: true, reason: e?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
