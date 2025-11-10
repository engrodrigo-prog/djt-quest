import fs from 'fs'
import path from 'path'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

// Lightweight .env loader for local dev (avoids dependency on dotenv)
try {
  const envPath = path.join(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2]
      }
    }
  }
} catch {}

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string
const SUPABASE_ANON_KEY = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY) as string

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return res.status(200).json({ approvals: 0, passwordResets: 0, evaluations: 0, leadershipAssignments: 0, forumMentions: 0, registrations: 0 })
    }

    const authHeader = (req.headers['authorization'] as string | undefined) || ''
    const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    })

    let userId: string | null = null
    try {
      const { data: userData } = await supa.auth.getUser()
      userId = userData?.user?.id || null
    } catch {}

    const safeCount = async (query: any) => {
      try {
        const { count, error } = await query.select('id', { count: 'exact', head: true })
        if (error) return 0
        return count || 0
      } catch { return 0 }
    }

    const approvals = await safeCount(supa.from('profile_change_requests').eq('status', 'pending'))
    const passwordResets = await safeCount(supa.from('password_reset_requests').eq('status', 'pending'))
    const evaluations = userId ? await safeCount(supa.from('evaluation_queue').eq('assigned_to', userId).is('completed_at', null)) : 0
    const leadershipAssignments = userId ? await safeCount(supa.from('leadership_challenge_assignments').eq('user_id', userId).eq('status', 'assigned')) : 0
    const forumMentions = userId ? await safeCount(supa.from('forum_mentions').eq('mentioned_user_id', userId).eq('is_read', false)) : 0
    const pendingRegistrations = await safeCount(supa.from('pending_registrations').eq('status', 'pending'))

    return res.status(200).json({ approvals, passwordResets, evaluations, leadershipAssignments, forumMentions, registrations: pendingRegistrations })
  } catch (err: any) {
    return res.status(200).json({ approvals: 0, passwordResets: 0, evaluations: 0, leadershipAssignments: 0, forumMentions: 0, registrations: 0 })
  }
}

export const config = { api: { bodyParser: false } }
