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
  console.log('⚠️ Deleting all action-related data (events, evaluations, assignments, participants)...')
  // Order to avoid FK issues
  await supa.from('evaluation_queue').delete().neq('id','00000000-0000-0000-0000-000000000000')
  await supa.from('action_evaluations').delete().neq('id','00000000-0000-0000-0000-000000000000')
  await supa.from('event_participants').delete().neq('event_id','00000000-0000-0000-0000-000000000000')
  const { error } = await supa.from('events').delete().neq('id','00000000-0000-0000-0000-000000000000')
  if (error) throw error
  console.log('✅ All actions removed.')
}

run().catch(e => { console.error('❌', e?.message || e); process.exit(1) })

