import { createClient } from '@supabase/supabase-js';
import { translateForumTexts, localesForAllTargets } from '../lib/forum-translations.js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        if (!SUPABASE_URL || !SERVICE_KEY)
            return res.status(500).json({ error: 'Missing Supabase config' });
        const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        const authHeader = req.headers['authorization'];
        if (!authHeader?.startsWith('Bearer '))
            return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.slice(7);
        const { data: userData } = await admin.auth.getUser(token);
        const uid = userData?.user?.id;
        if (!uid)
            return res.status(401).json({ error: 'Unauthorized' });
        const { title, description, chas_dimension = 'C', quiz_specialties = [], tags = [], category = null } = req.body || {};
        if (!title || typeof title !== 'string' || title.trim().length < 3)
            return res.status(400).json({ error: 'Invalid title' });
        const targetLocales = localesForAllTargets(req.body?.locales);
        let titleTranslations = { 'pt-BR': title.trim() };
        let descTranslations = { 'pt-BR': (description || '').trim() };
        try {
            const [titleMap] = await translateForumTexts({ texts: [title.trim()], targetLocales });
            if (titleMap && typeof titleMap === 'object')
                titleTranslations = titleMap;
            if (typeof description === 'string' && description.trim()) {
                const [descMap] = await translateForumTexts({ texts: [description.trim()], targetLocales });
                if (descMap && typeof descMap === 'object')
                    descTranslations = descMap;
            }
        }
        catch (_a) {
            // fallback keeps base locale only
        }
        let topic, error;
        try {
            const { data, error: err } = await admin
                .from('forum_topics')
                .insert({
                title: title.trim(),
                description: (description || '').trim(),
                created_by: uid,
                chas_dimension,
                quiz_specialties,
                tags,
                category,
                title_translations: titleTranslations,
                description_translations: descTranslations,
            })
                .select()
                .single();
            topic = data;
            error = err;
            if (error && /column .*translations.* does not exist/i.test(error.message))
                throw error;
        }
        catch (_) {
            const { data, error: err } = await admin
                .from('forum_topics')
                .insert({ title: title.trim(), description: (description || '').trim(), created_by: uid, chas_dimension, quiz_specialties, tags, category })
                .select()
                .single();
            topic = data;
            error = err;
        }
        if (error)
            return res.status(400).json({ error: error.message });
        return res.status(200).json({ success: true, topic });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
