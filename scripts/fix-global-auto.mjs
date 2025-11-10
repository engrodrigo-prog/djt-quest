#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Load .env
try {
  const envPath = path.join(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  }
} catch {}

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const run = async () => {
  const { data: candidates, error } = await supa
    .from('challenges')
    .select('id, title, status, created_at, target_team_ids, target_coord_ids, target_div_ids')
    .or('target_team_ids.not.is.null,target_coord_ids.not.is.null,target_div_ids.not.is.null')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) throw error
  if (!candidates || candidates.length === 0) {
    console.log('No restricted challenges found — nothing to fix.')
    return
  }

  const pick = candidates[0]
  const { error: upErr } = await supa
    .from('challenges')
    .update({ target_team_ids: null, target_coord_ids: null, target_div_ids: null, status: pick.status || 'active' })
    .eq('id', pick.id)

  if (upErr) throw upErr
  console.log(`✅ Fixed to global: ${pick.id} — ${pick.title}`)
  if (candidates.length > 1) {
    console.log('Other restricted challenges (not changed):')
    candidates.slice(1).forEach(c => console.log(`- ${c.id} — ${c.title}`))
  }
}

run().catch(e => { console.error('❌', e?.message || e); process.exit(1) })

