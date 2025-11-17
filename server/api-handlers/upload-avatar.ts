// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL as string
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string

function parseDataUrl(input: string): { bytes: Uint8Array; mime: string } {
  let mime = 'image/png'
  let b64 = input
  if (input.startsWith('data:')) {
    const [, header, data] = input.match(/^data:([^;]+);base64,(.*)$/) || []
    if (header) mime = header
    if (data) b64 = data
  }
  const binary = Buffer.from(b64, 'base64')
  return { bytes: new Uint8Array(binary), mime }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase server configuration' })
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const authHeader = (req.headers['authorization'] as string | undefined) || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    const { data: me, error: meErr } = await supabaseAdmin.auth.getUser(token)
    if (meErr || !me?.user) return res.status(401).json({ error: 'Unauthorized' })

    const { userId, imageBase64 } = req.body || {}
    const targetUserId = userId || me.user.id
    if (!imageBase64 || !targetUserId) return res.status(400).json({ error: 'Missing imageBase64 or userId' })

    const { bytes, mime } = parseDataUrl(imageBase64)
    const timestamp = Date.now()
    const hash = Math.random().toString(36).slice(2, 8)
    const basePath = `${targetUserId}/${timestamp}-${hash}`
    const filename = `${basePath}.png`

    // Ensure bucket exists (idempotent)
    try {
      const { data: bucketInfo } = await (supabaseAdmin.storage as any).getBucket('avatars')
      if (!bucketInfo) {
        await (supabaseAdmin.storage as any).createBucket('avatars', { public: true })
      }
    } catch {/* ignore */}

    const { error: upErr } = await supabaseAdmin.storage
      .from('avatars')
      .upload(filename, bytes, { contentType: mime || 'image/png', upsert: true })
    if (upErr) return res.status(400).json({ error: upErr.message })

    const { data: pub } = supabaseAdmin.storage.from('avatars').getPublicUrl(filename)
    const publicUrl = pub.publicUrl

    const { error: upd } = await supabaseAdmin
      .from('profiles')
      .update({ avatar_url: publicUrl, avatar_thumbnail_url: publicUrl, avatar_meta: null })
      .eq('id', targetUserId)
    if (upd) return res.status(400).json({ error: upd.message })

    return res.status(200).json({ success: true, avatarUrl: publicUrl })
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
