import { createClient } from '@supabase/supabase-js';
import { translateForumTexts, mergeTranslations, localesForAllTargets } from '../lib/forum-translations.js';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
const parseBool = (v) => {
    if (v === true)
        return true;
    const s = String(v ?? '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
};
const needsLocales = (map, locales, force = false) => {
    if (force)
        return true;
    if (!locales || locales.length === 0)
        return false;
    const obj = (map && typeof map === 'object') ? map : {};
    return locales.some((loc) => typeof obj[loc] !== 'string' || obj[loc].trim().length === 0);
};
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
        const topicId = String((req.body)?.topic_id || (req.query)?.topic_id || '').trim();
        if (!topicId)
            return res.status(400).json({ error: 'topic_id required' });
        const targetLocales = localesForAllTargets((req.body)?.locales || (req.query)?.locales);
        const force = parseBool((req.body)?.force || (req.query)?.force);
        const [{ data: topic, error: topicErr }, { data: posts }, { data: compendium }] = await Promise.all([
            admin
                .from('forum_topics')
                .select('id,title,description,title_translations,description_translations')
                .eq('id', topicId)
                .maybeSingle(),
            admin
                .from('forum_posts')
                .select('id,content_md,translations,parent_post_id')
                .eq('topic_id', topicId)
                .order('created_at', { ascending: true })
                .limit(200),
            admin
                .from('forum_compendia')
                .select('summary_md,summary_translations')
                .eq('topic_id', topicId)
                .maybeSingle(),
        ]);
        if (topicErr)
            return res.status(400).json({ error: topicErr.message });
        if (!topic)
            return res.status(404).json({ error: 'Tópico não encontrado' });
        const tasks = [];
        if (needsLocales((topic)?.title_translations, targetLocales, force)) {
            tasks.push({ kind: 'topic_title', id: topic.id, text: topic.title || '' });
        }
        if (needsLocales((topic)?.description_translations, targetLocales, force) && (topic.description || '').trim()) {
            tasks.push({ kind: 'topic_description', id: topic.id, text: topic.description || '' });
        }
        const postsList = Array.isArray(posts) ? posts : [];
        const cappedPosts = postsList.slice(0, 200);
        for (const p of cappedPosts) {
            if (needsLocales((p)?.translations, targetLocales, force)) {
                tasks.push({ kind: 'post', id: p.id, text: String(p.content_md || '') });
            }
        }
        if (compendium?.summary_md && needsLocales((compendium)?.summary_translations, targetLocales, force)) {
            tasks.push({ kind: 'compendium_summary', id: topic.id, text: String(compendium.summary_md || '') });
        }
        const translations = tasks.length
            ? await translateForumTexts({ texts: tasks.map((t) => t.text), targetLocales, maxPerBatch: 8 })
            : [];
        let titleTranslations = mergeTranslations((topic).title_translations, { 'pt-BR': topic.title || '' });
        let descTranslations = mergeTranslations((topic).description_translations, { 'pt-BR': topic.description || '' });
        const postTranslations = {};
        let summaryTranslations = compendium?.summary_translations || (compendium?.summary_md ? { 'pt-BR': compendium.summary_md } : null);
        tasks.forEach((task, idx) => {
            const map = translations[idx] || { 'pt-BR': task.text };
            if (task.kind === 'topic_title') {
                titleTranslations = mergeTranslations(titleTranslations, map);
            }
            else if (task.kind === 'topic_description') {
                descTranslations = mergeTranslations(descTranslations, map);
            }
            else if (task.kind === 'post') {
                postTranslations[task.id] = mergeTranslations(cappedPosts.find((p) => p.id === task.id)?.translations, map);
            }
            else if (task.kind === 'compendium_summary') {
                summaryTranslations = mergeTranslations(summaryTranslations, map);
            }
        });
        try {
            await admin
                .from('forum_topics')
                .update({ title_translations: titleTranslations, description_translations: descTranslations })
                .eq('id', topicId);
        }
        catch (_a) { }
        for (const [postId, map] of Object.entries(postTranslations)) {
            try {
                await admin.from('forum_posts').update({ translations: map }).eq('id', postId);
            }
            catch (_b) { }
        }
        if (summaryTranslations) {
            try {
                await admin
                    .from('forum_compendia')
                    .update({ summary_translations: summaryTranslations })
                    .eq('topic_id', topicId);
            }
            catch (_c) { }
        }
        const postsMergedOut = {};
        for (const p of cappedPosts) {
            const merged = mergeTranslations((p)?.translations, postTranslations[p.id]);
            if (merged && typeof merged === 'object')
                postsMergedOut[p.id] = merged;
        }
        return res.status(200).json({
            success: true,
            topic: {
                id: topic.id,
                title_translations: titleTranslations,
                description_translations: descTranslations,
            },
            posts: postsMergedOut,
            compendium: summaryTranslations ? { summary_translations: summaryTranslations } : null,
            translated: tasks.length,
        });
    }
    catch (e) {
        return res.status(500).json({ error: e?.message || 'Unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
