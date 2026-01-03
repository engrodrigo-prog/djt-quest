// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { translateForumTexts, localesForAllTargets } from '../lib/forum-translations.js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string

const extractCampaignTitles = (md: string) => {
  const text = String(md || '')
  const out: string[] = []
  for (const m of text.matchAll(/&"([^"]{2,160})"/g)) out.push(String(m[1] || '').trim())
  for (const m of text.matchAll(/&([^\s#@&]{2,80})/g)) out.push(String(m[1] || '').trim())
  return Array.from(new Set(out.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean))).slice(0, 3)
}

async function resolveCampaignByTitle(admin: any, titleRaw: string) {
  const title = String(titleRaw || '').replace(/\s+/g, ' ').trim()
  if (!title) return null
  const safe = title.replace(/[%_]/g, '\\$&')
  const exact = await admin.from('campaigns').select('id,title,is_active').ilike('title', safe).limit(3)
  const exactRows = Array.isArray(exact?.data) ? exact.data : []
  if (exactRows.length === 1) return exactRows[0]
  if (exactRows.length > 1) return { error: `Título de campanha ambíguo: "${title}"` }
  const like = await admin.from('campaigns').select('id,title,is_active').ilike('title', `%${safe}%`).limit(5)
  const rows = Array.isArray(like?.data) ? like.data : []
  if (rows.length === 1) return rows[0]
  if (rows.length > 1) return { error: `Mais de uma campanha encontrada para: "${title}". Seja mais específico.` }
  return null
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

    const { title, description, chas_dimension = 'C', quiz_specialties = [], tags = [], category = null } = req.body || {}
    if (!title || typeof title !== 'string' || title.trim().length < 3) return res.status(400).json({ error: 'Invalid title' })

    // Optional campaign link via &"Nome da Campanha" in title/description (one per topic)
    const campaignTitles = extractCampaignTitles(`${title}\n${description || ''}`)
    if (campaignTitles.length > 1) {
      return res.status(400).json({ error: 'O tópico deve referenciar apenas 1 campanha via &"Nome". Remova campanhas extras.' })
    }
    let campaign_id: string | null = null
    if (campaignTitles.length === 1) {
      const candidate = await resolveCampaignByTitle(admin, campaignTitles[0])
      if ((candidate as any)?.error) return res.status(400).json({ error: (candidate as any).error })
      if ((candidate as any)?.id) campaign_id = (candidate as any).id
    }

    const targetLocales = localesForAllTargets((req.body as any)?.locales)
    let titleTranslations: any = { 'pt-BR': title.trim() }
    let descTranslations: any = { 'pt-BR': (description || '').trim() }
    try {
      const [titleMap] = await translateForumTexts({ texts: [title.trim()], targetLocales })
      if (titleMap && typeof titleMap === 'object') titleTranslations = titleMap
      if (typeof description === 'string' && description.trim()) {
        const [descMap] = await translateForumTexts({ texts: [description.trim()], targetLocales })
        if (descMap && typeof descMap === 'object') descTranslations = descMap
      }
    } catch {
      // fallback keeps base locale only
    }

    let topic, error
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
          campaign_id,
          title_translations: titleTranslations,
          description_translations: descTranslations,
        } as any)
        .select()
        .single()
      topic = data; error = err;
      if (error && /column .*translations.* does not exist/i.test(error.message)) throw error;
      if (error && /column .*campaign_id.* does not exist/i.test(error.message)) throw error;
    } catch (_) {
      const { data, error: err } = await admin
        .from('forum_topics')
        .insert({ title: title.trim(), description: (description || '').trim(), created_by: uid, chas_dimension, quiz_specialties, tags, category } as any)
        .select()
        .single()
      topic = data; error = err;
    }
    if (error) return res.status(400).json({ error: (error as any).message })

    return res.status(200).json({ success: true, topic })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
