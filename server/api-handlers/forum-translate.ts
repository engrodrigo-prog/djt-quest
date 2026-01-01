// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { translateForumTexts, mergeTranslations, localesForAllTargets } from '../lib/forum-translations.js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string

const parseBool = (v: any) => {
  if (v === true) return true
  const s = String(v ?? '').trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on'
}

const needsLocales = (map: any, locales: string[], force = false) => {
  if (force) return true
  if (!locales || locales.length === 0) return false
  const obj = (map && typeof map === 'object') ? map : {}
  return locales.some((loc) => typeof obj[loc] !== 'string' || obj[loc].trim().length === 0)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' })
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    const authHeader = req.headers['authorization'] as string | undefined
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
    const token = authHeader.slice(7)
    const { data: userData } = await admin.auth.getUser(token)
    const uid = userData?.user?.id
    if (!uid) return res.status(401).json({ error: 'Unauthorized' })

    const topicId = String((req.body as any)?.topic_id || (req.query as any)?.topic_id || '').trim()
    if (!topicId) return res.status(400).json({ error: 'topic_id required' })

    const targetLocales = localesForAllTargets((req.body as any)?.locales || (req.query as any)?.locales)
    const force = parseBool((req.body as any)?.force || (req.query as any)?.force)

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
    ])
    if (topicErr) return res.status(400).json({ error: topicErr.message })
    if (!topic) return res.status(404).json({ error: 'Tópico não encontrado' })

    const tasks: Array<{ kind: string; id: string; text: string }> = []
    if (needsLocales((topic as any).title_translations, targetLocales, force)) {
      tasks.push({ kind: 'topic_title', id: topic.id, text: topic.title || '' })
    }
    if (needsLocales((topic as any).description_translations, targetLocales, force) && (topic.description || '').trim()) {
      tasks.push({ kind: 'topic_description', id: topic.id, text: topic.description || '' })
    }

    const postsList = Array.isArray(posts) ? posts : []
    const cappedPosts = postsList.slice(0, 200)
    for (const p of cappedPosts) {
      if (needsLocales((p as any).translations, targetLocales, force)) {
        tasks.push({ kind: 'post', id: p.id, text: String(p.content_md || '') })
      }
    }

    if (compendium?.summary_md && needsLocales((compendium as any)?.summary_translations, targetLocales, force)) {
      tasks.push({ kind: 'compendium_summary', id: topic.id, text: String(compendium.summary_md || '') })
    }

    const translations = tasks.length
      ? await translateForumTexts({ texts: tasks.map((t) => t.text), targetLocales, maxPerBatch: 8 })
      : []

    let titleTranslations = mergeTranslations((topic as any).title_translations, { 'pt-BR': topic.title || '' })
    let descTranslations = mergeTranslations((topic as any).description_translations, { 'pt-BR': topic.description || '' })
    const postTranslations: Record<string, any> = {}
    let summaryTranslations = compendium?.summary_translations || (compendium?.summary_md ? { 'pt-BR': compendium.summary_md } : null)

    tasks.forEach((task, idx) => {
      const map = translations[idx] || { 'pt-BR': task.text }
      if (task.kind === 'topic_title') {
        titleTranslations = mergeTranslations(titleTranslations, map as any)
      } else if (task.kind === 'topic_description') {
        descTranslations = mergeTranslations(descTranslations, map as any)
      } else if (task.kind === 'post') {
        postTranslations[task.id] = mergeTranslations(
          (cappedPosts.find((p: any) => p.id === task.id) as any)?.translations,
          map as any,
        )
      } else if (task.kind === 'compendium_summary') {
        summaryTranslations = mergeTranslations(summaryTranslations, map as any)
      }
    })

    // Persist topic translations if changed
    try {
      await admin
        .from('forum_topics')
        .update({ title_translations: titleTranslations, description_translations: descTranslations } as any)
        .eq('id', topicId)
    } catch {}

    // Persist post translations (best-effort)
    for (const [postId, map] of Object.entries(postTranslations)) {
      try {
        await admin.from('forum_posts').update({ translations: map } as any).eq('id', postId)
      } catch {}
    }

    // Persist compendium summary translations
    if (summaryTranslations) {
      try {
        await admin
          .from('forum_compendia')
          .update({ summary_translations: summaryTranslations } as any)
          .eq('topic_id', topicId)
      } catch {}
    }

    // Prepare response with the merged maps for immediate UI use
    const postsMergedOut: Record<string, any> = {}
    for (const p of cappedPosts) {
      const merged = mergeTranslations((p as any).translations, postTranslations[p.id])
      if (merged && typeof merged === 'object') postsMergedOut[p.id] = merged
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
    })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
