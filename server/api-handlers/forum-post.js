import { createClient } from '@supabase/supabase-js';
import { translateForumTexts, localesForAllTargets } from '../lib/forum-translations.js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
function extractMentionsAndTags(md) {
    // Captura @email completo ou identificadores simples (equipes/siglas)
    const mentionMatches = Array.from(md.matchAll(/@([A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+|[A-Za-z0-9_.-]+)/g));
    const mentions = mentionMatches.map(m => m[1]);
    const hashtags = Array.from(md.matchAll(/#([A-Za-z0-9_.-]+)/g)).map(m => m[1].toLowerCase());
    return { mentions, hashtags };
}
async function resolveMentionedUserIds(admin, rawMentions, opts) {
    const excludeUserId = opts?.excludeUserId ? String(opts.excludeUserId) : null;
    const list = Array.from(new Set((rawMentions || [])
        .map((m) => String(m || '').trim().replace(/^@+/, ''))
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
    try {
        if (handles.length) {
            const or = handles.map((h) => `email.ilike.${h}@%`).join(',');
            const { data } = await admin.from('profiles').select('id, email').or(or);
            for (const u of data || [])
                if (u?.id)
                    out.add(String(u.id));
        }
    }
    catch { }
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
        const { topic_id, content_md, payload = {}, parent_post_id = null, reply_to_user_id = null, attachment_urls = [] } = req.body || {};
        if (!topic_id || typeof content_md !== 'string' || content_md.trim().length < 1)
            return res.status(400).json({ error: 'Invalid payload' });
        const { mentions, hashtags } = extractMentionsAndTags(content_md);
        const targetLocales = localesForAllTargets(req.body?.locales);
        let translations = { 'pt-BR': content_md.trim() };
        try {
            const [map] = await translateForumTexts({ texts: [content_md.trim()], targetLocales });
            if (map && typeof map === 'object')
                translations = map;
        }
        catch (_a) {
            // fallback keeps base locale only
        }
        // Insert supporting both legacy (author_id, content) and new (user_id, content_md) schemas
        const insertPayload = {
            topic_id,
            user_id: uid,
            author_id: uid, // legacy column
            content_md: content_md.trim(),
            content: content_md.trim(), // legacy column with CHECK(LENGTH(content) >= 10)
            payload: { ...(payload || {}), images: Array.isArray(attachment_urls) ? attachment_urls : [] },
            parent_post_id,
            reply_to_user_id,
            tags: hashtags,
            translations,
        };
        // Try insert including legacy attachment_urls column; if it fails due to column missing, retry without it
        let post, error;
        try {
            const { data, error: err } = await admin
                .from('forum_posts')
                .insert({ ...insertPayload, attachment_urls: Array.isArray(attachment_urls) ? attachment_urls : null })
                .select()
                .single();
            post = data;
            error = err;
            if (error && /column .*attachment_urls.* does not exist/i.test(error.message))
                throw error;
            if (error && /column .*translations.* does not exist/i.test(error.message))
                throw error;
        }
        catch (_) {
            const { data, error: err } = await admin
                .from('forum_posts')
                .insert(insertPayload)
                .select()
                .single();
            post = data;
            error = err;
            if (error && /column .*translations.* does not exist/i.test(error.message)) {
                const { translations: _omit, ...rest } = insertPayload;
                const { data: d2, error: err2 } = await admin.from('forum_posts').insert(rest).select().single();
                post = d2;
                error = err2;
            }
        }
        if (error)
            return res.status(400).json({ error: error.message });
        // Register mentions best-effort
        if (mentions.length) {
            try {
                const ids = await resolveMentionedUserIds(admin, mentions, { excludeUserId: uid });
                if (ids.length) {
                    const rows = ids.map((id) => ({
                        mentioned_user_id: id,
                        mentioned_by: uid,
                        post_id: post.id,
                        is_read: false,
                    }));
                    await admin.from('forum_mentions').upsert(rows, { onConflict: 'post_id,mentioned_user_id' });
                }
            }
            catch { }
        }
        // Attachment metadata best-effort
        if (Array.isArray(attachment_urls) && attachment_urls.length) {
            for (const url of attachment_urls) {
                try {
                    const path = (url.split('/forum-attachments/')[1] || '').trim();
                    if (!path)
                        continue;
                    const folder = path.split('/')[0];
                    const filename = path.split('/').pop() || 'unknown';
                    const ext = filename.split('.').pop()?.toLowerCase() || '';
                    let fileType = 'document';
                    let mimeType = 'application/octet-stream';
                    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
                        fileType = 'image';
                        mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                    }
                    else if (['mp3', 'wav', 'ogg', 'webm', 'm4a'].includes(ext)) {
                        fileType = 'audio';
                        mimeType = `audio/${ext}`;
                    }
                    else if (['mp4', 'webm', 'mov'].includes(ext)) {
                        fileType = 'video';
                        mimeType = ext === 'mov' ? 'video/quicktime' : `video/${ext}`;
                    }
                    else if (ext === 'pdf') {
                        mimeType = 'application/pdf';
                    }
                    // Try to fetch file info to capture size
                    let fileSize = 0;
                    try {
                        const listFolder = folder;
                        const searchName = filename;
                        const { data: files } = await admin.storage.from('forum-attachments').list(listFolder, { search: searchName });
                        const found = (files || []).find((f) => f.name === filename);
                        fileSize = found?.metadata?.size || found?.size || 0;
                    }
                    catch { }
                    try {
                        await admin.from('forum_attachment_metadata').insert({
                            post_id: post.id,
                            storage_path: path,
                            file_type: fileType,
                            mime_type: mimeType,
                            file_size: fileSize,
                            original_filename: filename,
                        });
                    }
                    catch { }
                    // Attempt to invoke image metadata extraction function in background
                    if (fileType === 'image') {
                        try {
                            await admin.functions.invoke('extract-image-metadata', { body: { storage_path: path, post_id: post.id } });
                        }
                        catch { }
                    }
                }
                catch { }
            }
        }
        return res.status(200).json({ success: true, post });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
