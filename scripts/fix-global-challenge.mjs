#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Load .env locally
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

const args = process.argv.slice(2)
let id = null, title = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--id') id = args[++i]
  if (args[i] === '--title') title = args.slice(i+1).join(' ')
}
if (!id && !title) {
  console.error('Usage: node scripts/fix-global-challenge.mjs --id <uuid> | --title <title>')
  process.exit(1)
}

const run = async () => {
  const sel = id ? { id } : { title }
  const { data: ch, error: chErr } = await supa.from('challenges').select('id,title,status').match(sel).maybeSingle()
  if (chErr || !ch) throw new Error('Challenge not found')
  const { error: upErr } = await supa.from('challenges').update({ target_team_ids: null, target_coord_ids: null, target_div_ids: null, status: ch.status || 'active' }).eq('id', ch.id)
  if (upErr) throw upErr
  console.log('✅ Fixed challenge to global:', ch.id, ch.title)
}

run().catch(e => { console.error('❌', e?.message || e); process.exit(1) })

