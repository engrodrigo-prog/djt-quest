import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' })
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    const now = new Date()
    const ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthEnd = new Date(now.getFullYear(), now.getMonth()+1, 1).toISOString()

    // fetch posts and reactions this month
    const { data: posts } = await admin.from('forum_posts').select('user_id, created_at, ai_assessment, payload').gte('created_at', monthStart).lt('created_at', monthEnd)
    const { data: reacts } = await admin.from('forum_reactions').select('post_id, user_id, type, created_at').gte('created_at', monthStart).lt('created_at', monthEnd)

    const qty: Record<string, number> = {}
    const qual: Record<string, number> = {}

    for (const p of (posts || [])) {
      qty[p.user_id] = (qty[p.user_id] || 0) + 1
      const assess = p.ai_assessment || {}
      const help = Number(assess.helpfulness || 0)
      const clar = Number(assess.clarity || 0)
      const nov = Number(assess.novelty || 0)
      const tox = Number(assess.toxicity || 0)
      const mult = Math.max(0.6, Math.min(1.6, (help + clar + nov) / 3 + (p.payload?.images?.length ? 0.05 : 0) + (p.payload?.transcript ? 0.05 : 0) - tox * 0.2))
      qual[p.user_id] = (qual[p.user_id] || 0) + mult
    }

    // reactions grant extra qty points to post authors (approx without join)
    // optional improvement: join to fetch post authors

    const rows = Object.keys({ ...qty, ...qual }).map(uid => {
      const q = qty[uid] || 0
      const qa = Math.round((qual[uid] || 0) * 10)
      const finalp = Math.max(0, q + qa)
      return { month: ym, user_id: uid, qty_points: q, qual_points: qa, final_points: finalp, breakdown: {} }
    })

    if (rows.length) {
      await admin.from('forum_monthly_scores').upsert(rows as any, { onConflict: 'month,user_id' } as any)
    }

    return res.status(200).json({ success: true, month: ym, users: rows.length })
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }

