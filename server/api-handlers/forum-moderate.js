import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
const EDIT_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
const DELETE_TOPIC_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx']);
function extractMentionsAndTags(md) {
    const mentionMatches = Array.from(md.matchAll(/@([A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/g));
    const mentions = mentionMatches.map(m => m[1]);
    const hashtags = Array.from(md.matchAll(/#([A-Za-z0-9_.-]+)/g)).map(m => m[1].toLowerCase());
    return { mentions, hashtags };
}
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
        // Check leader permission
        const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid);
        const roleNames = (roles || []).map((r) => r.role);
        const canEdit = roleNames.some((r) => EDIT_ROLES.has(r));
        const canDeleteTopic = roleNames.some((r) => DELETE_TOPIC_ROLES.has(r));
        const { action, topic_id, post_id, update, content_md } = req.body || {};
        if (!action)
            return res.status(400).json({ error: 'action required' });
        if (action === 'delete_post') {
            if (!canEdit)
                return res.status(403).json({ error: 'Sem permissão para excluir posts' });
            if (!post_id)
                return res.status(400).json({ error: 'post_id required' });
            const { error } = await admin.from('forum_posts').delete().eq('id', post_id);
            if (error)
                return res.status(400).json({ error: error.message });
            return res.status(200).json({ success: true });
        }
        if (action === 'delete_topic') {
            if (!canDeleteTopic)
                return res.status(403).json({ error: 'Sem permissão para excluir tópicos' });
            if (!topic_id)
                return res.status(400).json({ error: 'topic_id required' });
            // cascade via FK will remove posts
            const { error } = await admin.from('forum_topics').delete().eq('id', topic_id);
            if (error)
                return res.status(400).json({ error: error.message });
            return res.status(200).json({ success: true });
        }
        if (action === 'clear_topic') {
            if (!canEdit)
                return res.status(403).json({ error: 'Sem permissão para limpar tópicos' });
            if (!topic_id)
                return res.status(400).json({ error: 'topic_id required' });
            const { error } = await admin.from('forum_posts').delete().eq('topic_id', topic_id);
            if (error)
                return res.status(400).json({ error: error.message });
            return res.status(200).json({ success: true });
        }
        if (action === 'update_topic') {
            if (!canEdit)
                return res.status(403).json({ error: 'Sem permissão para editar tópicos' });
            if (!topic_id || typeof update !== 'object')
                return res.status(400).json({ error: 'topic_id and update required' });
            const safe = {};
            if (typeof update.title === 'string' && update.title.trim())
                safe.title = update.title.trim();
            if (typeof update.description === 'string')
                safe.description = update.description;
            if (typeof update.status === 'string')
                safe.status = update.status;
            if (Array.isArray(update.tags))
                safe.tags = update.tags;
            if (Array.isArray(update.quiz_specialties))
                safe.quiz_specialties = update.quiz_specialties;
            if (typeof update.chas_dimension === 'string')
                safe.chas_dimension = update.chas_dimension;
            const { error } = await admin.from('forum_topics').update(safe).eq('id', topic_id);
            if (error)
                return res.status(400).json({ error: error.message });
            return res.status(200).json({ success: true });
        }
        if (action === 'update_post') {
            if (!post_id)
                return res.status(400).json({ error: 'post_id required' });
            const text = typeof content_md === 'string' ? content_md.trim() : '';
            if (text.length < 1)
                return res.status(400).json({ error: 'content_md obrigatório' });
            const { data: post, error: postErr } = await admin
                .from('forum_posts')
                .select('id, user_id, topic_id')
                .eq('id', post_id)
                .maybeSingle();
            if (postErr)
                return res.status(400).json({ error: postErr.message });
            if (!post)
                return res.status(404).json({ error: 'Post não encontrado' });
            if (!canEdit && post.user_id !== uid) {
                return res.status(403).json({ error: 'Sem permissão para editar este post' });
            }
            const { mentions, hashtags } = extractMentionsAndTags(text);
            const { error: updErr } = await admin
                .from('forum_posts')
                .update({
                content_md: text,
                content: text,
                tags: hashtags,
            })
                .eq('id', post_id);
            if (updErr)
                return res.status(400).json({ error: updErr.message });
            // Atualizar mentions best-effort
            try {
                await admin.from('forum_mentions').delete().eq('post_id', post_id);
                if (mentions.length) {
                    const { data: users } = await admin
                        .from('profiles')
                        .select('id, email')
                        .in('email', mentions);
                    const ids = (users || []).map((u) => u.id);
                    if (ids.length) {
                        const rows = ids.map((id) => ({
                            mentioned_user_id: id,
                            post_id,
                            topic_id: post.topic_id,
                        }));
                        await admin.from('forum_mentions').insert(rows);
                    }
                }
            }
            catch { }
            return res.status(200).json({ success: true });
        }
        return res.status(400).json({ error: 'unknown action' });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
