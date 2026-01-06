import { createClient } from '@supabase/supabase-js';
import { translateForumTexts, localesForAllTargets, mergeTranslations } from '../lib/forum-translations.js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
const EDIT_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx']);
const EDIT_ANY_POST_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx']);
const DELETE_TOPIC_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx']);
function extractMentionsAndTags(md) {
    const mentionMatches = Array.from(md.matchAll(/@([A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/g));
    const mentions = mentionMatches.map(m => m[1]);
    const hashtags = Array.from(md.matchAll(/#([A-Za-z0-9_.-]+)/g)).map(m => m[1].toLowerCase());
    return { mentions, hashtags };
}
const normalizeMentionToken = (raw) => String(raw || '').trim().replace(/^@+/, '').toLowerCase();
async function resolveMentionedUserIds(admin, rawMentions, opts) {
    const excludeUserId = opts?.excludeUserId ? String(opts.excludeUserId) : null;
    const list = Array.from(new Set((rawMentions || [])
        .map((m) => normalizeMentionToken(String(m || '')))
        .filter(Boolean))).slice(0, 40);
    if (!list.length)
        return [];
    const emails = list.filter((m) => m.includes('@'));
    const handles = list.filter((m) => !m.includes('@'));
    const out = new Set();
    try {
        if (emails.length) {
            const { data } = await admin.from('profiles').select('id, email').in('email', emails);
            for (const u of data || [])
                if (u?.id)
                    out.add(String(u.id));
        }
    }
    catch { }
    if (handles.length) {
        try {
            const { data } = await admin.from('profiles').select('id, mention_handle').in('mention_handle', handles);
            for (const u of data || [])
                if (u?.id)
                    out.add(String(u.id));
        }
        catch { }
        try {
            const or = handles.map((h) => `email.ilike.${h}@%`).join(',');
            const { data } = await admin.from('profiles').select('id, email').or(or);
            for (const u of data || [])
                if (u?.id)
                    out.add(String(u.id));
        }
        catch { }
    }
    if (excludeUserId)
        out.delete(excludeUserId);
    return Array.from(out);
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
        const isAdmin = roleNames.includes('admin');
        const canEdit = roleNames.some((r) => EDIT_ROLES.has(r));
        const canEditAnyPost = roleNames.some((r) => EDIT_ANY_POST_ROLES.has(r));
        const canDeleteTopic = roleNames.some((r) => DELETE_TOPIC_ROLES.has(r));
        const { action, topic_id, post_id, update, content_md } = req.body || {};
        const targetLocales = localesForAllTargets(req.body?.locales);
        if (!action)
            return res.status(400).json({ error: 'action required' });
        if (action === 'delete_post') {
            if (!post_id)
                return res.status(400).json({ error: 'post_id required' });
            const { data: post, error: postErr } = await admin
                .from('forum_posts')
                .select('id, user_id')
                .eq('id', post_id)
                .maybeSingle();
            if (postErr)
                return res.status(400).json({ error: postErr.message });
            if (!post)
                return res.status(404).json({ error: 'Post não encontrado' });
            if (!isAdmin && post.user_id !== uid) {
                return res.status(403).json({ error: 'Sem permissão para excluir este post' });
            }
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
            let titleTranslations = null;
            let descTranslations = null;
            if (safe.title || safe.description !== undefined) {
                const { data: existing } = await admin
                    .from('forum_topics')
                    .select('title, description, title_translations, description_translations')
                    .eq('id', topic_id)
                    .maybeSingle();
                if (safe.title) {
                    titleTranslations = mergeTranslations(existing?.title_translations, { 'pt-BR': safe.title });
                    try {
                        const [map] = await translateForumTexts({ texts: [safe.title], targetLocales });
                        titleTranslations = mergeTranslations(titleTranslations, map);
                    }
                    catch (_b) { }
                    safe.title_translations = titleTranslations;
                }
                if (safe.description !== undefined) {
                    const baseDesc = safe.description ?? (existing?.description ?? '');
                    descTranslations = mergeTranslations(existing?.description_translations, { 'pt-BR': baseDesc });
                    if (typeof baseDesc === 'string' && baseDesc.trim()) {
                        try {
                            const [map] = await translateForumTexts({ texts: [baseDesc], targetLocales });
                            descTranslations = mergeTranslations(descTranslations, map);
                        }
                        catch (_c) { }
                    }
                    safe.description_translations = descTranslations;
                }
            }
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
                .select('id, user_id, author_id, topic_id, translations')
                .eq('id', post_id)
                .maybeSingle();
            if (postErr)
                return res.status(400).json({ error: postErr.message });
            if (!post)
                return res.status(404).json({ error: 'Post não encontrado' });
            const ownerId = post.user_id || post.author_id;
            if (ownerId !== uid) {
                return res.status(403).json({ error: 'Sem permissão para editar este post' });
            }
            const { mentions, hashtags } = extractMentionsAndTags(text);
            let translations = mergeTranslations(post?.translations, { 'pt-BR': text });
            try {
                const [map] = await translateForumTexts({ texts: [text], targetLocales });
                translations = mergeTranslations(translations, map);
            }
            catch (_c) { }
            let updErr;
            try {
                const { error } = await admin
                    .from('forum_posts')
                    .update({
                    content_md: text,
                    content: text,
                    tags: hashtags,
                    translations,
                })
                    .eq('id', post_id);
                updErr = error;
                if (updErr && /column .*translations.* does not exist/i.test(updErr.message))
                    throw updErr;
            }
            catch (_d) {
                const { error } = await admin
                    .from('forum_posts')
                    .update({
                    content_md: text,
                    content: text,
                    tags: hashtags,
                })
                    .eq('id', post_id);
                updErr = error;
            }
            if (updErr)
                return res.status(400).json({ error: updErr.message });
            // Atualizar mentions best-effort
            try {
            await admin.from('forum_mentions').delete().eq('post_id', post_id);
            if (mentions.length) {
                const ids = await resolveMentionedUserIds(admin, mentions, { excludeUserId: uid });
                if (ids.length) {
                    const rows = ids.map((id) => ({
                        mentioned_user_id: id,
                        mentioned_by: uid,
                        post_id,
                        is_read: false,
                    }));
                    await admin.from('forum_mentions').upsert(rows, { onConflict: 'post_id,mentioned_user_id' });
                    try {
                        const { data: authorProfile } = await admin
                            .from('profiles')
                            .select('name')
                            .eq('id', uid)
                            .maybeSingle();
                        const authorName = String(authorProfile?.name || 'Alguém');
                        await Promise.all(ids.map((id) => admin.rpc('create_notification', {
                            _user_id: id,
                            _type: 'forum_mention',
                            _title: 'Você foi mencionado',
                            _message: `${authorName} mencionou você em um fórum`,
                            _metadata: { post_id, topic_id: post.topic_id },
                        })));
                    }
                    catch { }
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
