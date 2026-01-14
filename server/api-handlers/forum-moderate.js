import { createClient } from '@supabase/supabase-js';
import { translateForumTexts, localesForAllTargets, mergeTranslations } from '../lib/forum-translations.js';
import { loadLocalEnvIfNeeded } from '../lib/load-local-env.js';
import { getSupabaseUrlFromEnv } from '../lib/supabase-url.js';
import { DJT_QUEST_SUPABASE_HOST } from '../env-guard.js';
loadLocalEnvIfNeeded();
const SUPABASE_URL = getSupabaseUrlFromEnv(process.env, { expectedHostname: DJT_QUEST_SUPABASE_HOST, allowLocal: true });
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY);
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY);
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
    const handleNameHints = handles.map((h) => h.replace(/[._-]+/g, ' ').trim()).filter(Boolean).slice(0, 12);
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
        if (handleNameHints.length) {
            try {
                const or = handleNameHints.map((h) => `name.ilike.%${h.split(/\s+/).join('%')}%`).join(',');
                const { data } = await admin.from('profiles').select('id, name').or(or);
                for (const u of data || [])
                    if (u?.id)
                        out.add(String(u.id));
            }
            catch { }
        }

        // Team mentions by sigla_area (e.g., DJT, DJTB-CUB). Only consider tokens without dot.
        const teamCandidates = Array.from(new Set(handles.filter((h) => !h.includes('.')).map((h) => String(h).toUpperCase()))).slice(0, 20);
        if (teamCandidates.length) {
            const baseTeams = new Set(['DJT', 'DJTB', 'DJTV']);
            const baseRequested = teamCandidates.filter((t) => baseTeams.has(t));
            const exactTeams = teamCandidates.filter((t) => !baseTeams.has(t));
            if (exactTeams.length) {
                try {
                    const { data } = await admin.from('profiles').select('id, sigla_area').in('sigla_area', exactTeams);
                    for (const u of data || [])
                        if (u?.id)
                            out.add(String(u.id));
                }
                catch { }
            }
            for (const base of baseRequested) {
                try {
                    const { data } = await admin
                        .from('profiles')
                        .select('id, sigla_area')
                        .or(`sigla_area.eq.${base},sigla_area.ilike.${base}-%`);
                    for (const u of data || [])
                        if (u?.id)
                            out.add(String(u.id));
                }
                catch { }
            }
        }
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
        const authHeader = req.headers['authorization'];
        if (!authHeader?.startsWith('Bearer '))
            return res.status(401).json({ error: 'Unauthorized' });
        const token = authHeader.slice(7);
        const authed = createClient(SUPABASE_URL, ANON_KEY || SERVICE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
        });
        const admin = SERVICE_ROLE_KEY
            ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
            : authed;
        const { data: userData, error: authErr } = await authed.auth.getUser();
        if (authErr)
            return res.status(401).json({ error: 'Unauthorized' });
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
                .select('id, user_id, author_id, payload')
                .eq('id', post_id)
                .maybeSingle();
            if (postErr)
                return res.status(400).json({ error: postErr.message });
            if (!post)
                return res.status(404).json({ error: 'Post não encontrado' });
            const ownerId = post.user_id || post.author_id;
            if (!isAdmin && ownerId !== uid) {
                return res.status(403).json({ error: 'Sem permissão para excluir este post' });
            }

            // If the post has replies, keep the thread and soft-delete the content (SEPBook behavior).
            let hasReplies = false;
            try {
                const { data: replies } = await admin.from('forum_posts').select('id').eq('parent_post_id', post_id).limit(1);
                hasReplies = Boolean(replies && replies.length > 0);
            }
            catch { }

            if (hasReplies) {
                const now = new Date().toISOString();
                const currentPayload = post?.payload && typeof post.payload === 'object' ? post.payload : {};
                const nextPayload = { ...currentPayload, deleted: true, images: [] };
                const deletedLabel = 'Comentário removido';

                // Best-effort cleanup (may require service role to delete others' likes/mentions).
                try {
                    await admin.from('forum_likes').delete().eq('post_id', post_id);
                }
                catch { }
                try {
                    await admin.from('forum_mentions').delete().eq('post_id', post_id);
                }
                catch { }
                try {
                    await admin.from('forum_attachment_metadata').delete().eq('post_id', post_id);
                }
                catch { }

                let updErr = null;
                const fullUpdate = {
                    content_md: '',
                    content: deletedLabel,
                    payload: nextPayload,
                    attachment_urls: [],
                    tags: [],
                    translations: { 'pt-BR': '' },
                    is_edited: true,
                    edited_at: now,
                };
                const updateWithoutTranslations = { ...fullUpdate };
                delete updateWithoutTranslations.translations;

                const attemptUpdate = async (payload) => {
                    const { error } = await admin.from('forum_posts').update(payload).eq('id', post_id);
                    return error || null;
                };

                // Try in decreasing order of schema richness (avoid re-adding removed columns).
                const candidates = (() => {
                    const c1 = fullUpdate;
                    const c2 = updateWithoutTranslations;
                    const c3 = { ...c2 };
                    delete c3.attachment_urls;
                    const c4 = { ...c3 };
                    delete c4.payload;
                    const c5 = { ...c4 };
                    delete c5.is_edited;
                    delete c5.edited_at;
                    return [c1, c2, c3, c4, c5];
                })();

                for (const candidate of candidates) {
                    updErr = await attemptUpdate(candidate);
                    if (!updErr)
                        break;
                    // Stop early only on definitive permission errors; otherwise keep trying fallbacks.
                    const msg = String(updErr?.message || '');
                    if (/row level security|permission denied|not authorized/i.test(msg))
                        break;
                }
                if (updErr)
                    return res.status(400).json({ error: updErr.message || 'Falha ao excluir post' });
                return res.status(200).json({ success: true, deleted: 'soft' });
            }

            const { error } = await admin.from('forum_posts').delete().eq('id', post_id);
            if (error)
                return res.status(400).json({ error: error.message });
            return res.status(200).json({ success: true, deleted: 'hard' });
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
            const editMeta = { is_edited: true, edited_at: new Date().toISOString() };
            try {
                const { error } = await admin
                    .from('forum_posts')
                    .update({
                    content_md: text,
                    content: text,
                    tags: hashtags,
                    translations,
                    ...editMeta,
                })
                    .eq('id', post_id);
                updErr = error;
                if (updErr && (/column .*translations.* does not exist/i.test(updErr.message) ||
                    /column .*is_edited.* does not exist/i.test(updErr.message) ||
                    /column .*edited_at.* does not exist/i.test(updErr.message))) {
                    throw updErr;
                }
            }
            catch (_d) {
                try {
                    const { error } = await admin
                        .from('forum_posts')
                        .update({
                        content_md: text,
                        content: text,
                        tags: hashtags,
                        ...editMeta,
                    })
                        .eq('id', post_id);
                    updErr = error;
                    if (updErr && (/column .*is_edited.* does not exist/i.test(updErr.message) ||
                        /column .*edited_at.* does not exist/i.test(updErr.message))) {
                        throw updErr;
                    }
                }
                catch (_e) {
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
            }
            if (updErr)
                return res.status(400).json({ error: updErr.message });
            // Atualizar mentions best-effort
            try {
                let previous = [];
                try {
                    const { data: existingMentions } = await admin
                        .from('forum_mentions')
                        .select('mentioned_user_id')
                        .eq('post_id', post_id);
                    previous = (existingMentions || []).map((r) => String(r.mentioned_user_id));
                }
                catch { }
                const prevSet = new Set(previous);
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
                        const toNotify = ids.filter((id) => !prevSet.has(String(id)));
                        if (toNotify.length) {
                            try {
                                const { data: authorProfile } = await admin
                                    .from('profiles')
                                    .select('name')
                                    .eq('id', uid)
                                    .maybeSingle();
                                const authorName = String(authorProfile?.name || 'Alguém');
                                const message = `${authorName} mencionou você em um fórum`;
                                const metadata = { post_id, topic_id: post.topic_id };
                                try {
                                    for (let i = 0; i < toNotify.length; i += 200) {
                                        await admin.rpc('create_notifications_bulk', {
                                            _user_ids: toNotify.slice(i, i + 200),
                                            _type: 'forum_mention',
                                            _title: 'Você foi mencionado',
                                            _message: message,
                                            _metadata: metadata,
                                        });
                                    }
                                }
                                catch (_a) {
                                    await Promise.all(toNotify.map((id) => admin.rpc('create_notification', {
                                        _user_id: id,
                                        _type: 'forum_mention',
                                        _title: 'Você foi mencionado',
                                        _message: message,
                                        _metadata: metadata,
                                    })));
                                }
                            }
                            catch { }
                        }
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
