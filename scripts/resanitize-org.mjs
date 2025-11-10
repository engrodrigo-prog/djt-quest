#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
// Lightweight .env loader (to avoid extra deps)
try {
  const envPath = path.join(process.cwd(), '.env')
  if (fs.existsSync(envPath)) {
    const txt = fs.readFileSync(envPath, 'utf8')
    for (const line of txt.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  }
} catch {}
import { createClient } from '@supabase/supabase-js'

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const url = process.env.SUPABASE_URL
if (!serviceKey || !url) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  process.exit(1)
}

const supa = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const chunk = (arr, size) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const baseOf = (sigla) => {
  if (!sigla) return null
  const s = String(sigla).trim()
  if (!s) return null
  if (s.includes('-')) return s.split('-').pop()
  // If looks like division (DJTB/DJTV/DJT), no base team
  if (/^DJT[BV]$/.test(s) || s === 'DJT') return null
  // If just a base like CUB, SAN, ITP etc.
  if (/^[A-Z]{2,5}$/.test(s)) return s
  return null
}

const divOf = (sigla) => {
  if (!sigla) return null
  const s = String(sigla).trim()
  if (s.startsWith('DJTB')) return 'DJTB'
  if (s.startsWith('DJTV')) return 'DJTV'
  if (s.startsWith('DJT')) return 'DJT'
  return null
}

const coordOf = (sigla) => {
  if (!sigla) return null
  const s = String(sigla).trim()
  if (s.includes('-')) return s
  return null
}

async function ensureDiv(id, name) {
  await supa.from('divisions').upsert([{ id, name, department_id: 'DJT' }], { onConflict: 'id' })
}

async function ensureCoord(id, divisionId, name) {
  await supa.from('coordinations').upsert([{ id, division_id: divisionId, name }], { onConflict: 'id' })
}

async function ensureTeam(id, coordId, name) {
  await supa.from('teams').upsert([{ id, coord_id: coordId, name }], { onConflict: 'id' })
}

async function main() {
  console.log('🔧 Re-sanitizing org hierarchy (letters-based)…')

  // 0) Ensure core divisions exist
  await ensureDiv('DJT', 'Divisão DJT (Global)')
  await ensureDiv('DJTB', 'Divisão DJTB')
  await ensureDiv('DJTV', 'Divisão DJTV')

  // 1) Remove artifacts DJTX*
  console.log('🧹 Removing DJTX* artifacts…')
  try {
    const { error: tErr } = await supa.from('teams').delete().ilike('id','DJTX%')
    if (tErr) console.warn('teams cleanup warn:', tErr.message)
    const { error: cErr } = await supa.from('coordinations').delete().ilike('id','DJTX%')
    if (cErr) console.warn('coordinations cleanup warn:', cErr.message)
    const { error: dErr } = await supa.from('divisions').delete().ilike('id','DJTX%')
    if (dErr) console.warn('divisions cleanup warn:', dErr.message)
  } catch (e) { console.warn('DJTX cleanup skipped:', e?.message || e) }

  // 2) Normalize teams: from hyphenated (DJTB-CUB) to base (CUB)
  console.log('🔄 Normalizing teams to base sigla…')
  const { data: teams, error: teamsErr } = await supa.from('teams').select('id, name, coord_id')
  if (teamsErr) throw teamsErr
  const renames = []
  for (const t of teams || []) {
    if (!t.id) continue
    if (t.id.includes('-')) {
      const newId = baseOf(t.id)
      if (!newId) continue
      renames.push({ oldId: t.id, newId, coordId: t.coord_id, name: t.name })
    }
  }
  // Upsert new teams
  for (const r of renames) {
    await ensureTeam(r.newId, r.coordId, r.name?.includes(r.oldId) ? r.name.replace(r.oldId, r.newId) : (r.name || `Equipe ${r.newId}`))
  }
  // Update profiles.team_id
  for (const batch of chunk(renames, 50)) {
    const mapping = batch.reduce((acc, r) => { acc[r.oldId] = r.newId; return acc }, {})
    const oldIds = batch.map(b => b.oldId)
    const { data: profs } = await supa.from('profiles').select('id, team_id').in('team_id', oldIds)
    for (const p of profs || []) {
      const newTeamId = mapping[p.team_id]
      if (!newTeamId) continue
      await supa.from('profiles').update({ team_id: newTeamId }).eq('id', p.id)
    }
  }
  // Update challenges.target_team_ids arrays
  try {
    const { data: chals, error: chErr } = await supa.from('challenges').select('id, target_team_ids')
    if (!chErr) {
      const map = renames.reduce((acc, r) => { acc[r.oldId] = r.newId; return acc }, {})
      for (const ch of chals || []) {
        const arr = Array.isArray(ch.target_team_ids) ? ch.target_team_ids : []
        const newArr = arr.map((v) => map[v] || (v?.includes('-') ? v.split('-').pop() : v)).filter(Boolean)
        const changed = JSON.stringify(newArr) !== JSON.stringify(arr)
        if (changed) await supa.from('challenges').update({ target_team_ids: newArr }).eq('id', ch.id)
      }
    }
  } catch (e) { console.warn('challenges target_team_ids update skipped:', e?.message || e) }
  // Delete old team rows
  if (renames.length) {
    const oldIds = renames.map(r => r.oldId)
    await supa.from('teams').delete().in('id', oldIds)
  }

  // 3) Re-hydrate hierarchy for profiles from sigla/operational_base
  console.log('📐 Re-hydrating profile org fields…')
  const { data: profiles, error: pErr } = await supa
    .from('profiles')
    .select('id, sigla_area, operational_base, team_id, coord_id, division_id')
  if (pErr) throw pErr

  for (const p of profiles || []) {
    const ref = p.sigla_area || p.operational_base || p.team_id
    if (!ref) continue
    const divisionId = divOf(ref)
    const coordId = coordOf(ref)
    const teamId = baseOf(ref)
    // Ensure division/coord/team exist when possible
    if (divisionId === 'DJTB') await ensureDiv('DJTB', 'Divisão DJTB')
    if (divisionId === 'DJTV') await ensureDiv('DJTV', 'Divisão DJTV')
    if (divisionId === 'DJT') await ensureDiv('DJT', 'Divisão DJT (Global)')
    if (coordId && divisionId) await ensureCoord(coordId, divisionId, coordId)
    if (teamId && coordId) await ensureTeam(teamId, coordId, `Equipe ${teamId}`)

    const patch = {}
    if (divisionId && p.division_id !== divisionId) patch.division_id = divisionId
    if (coordId && p.coord_id !== coordId) patch.coord_id = coordId
    if (teamId && p.team_id !== teamId) patch.team_id = teamId
    if (Object.keys(patch).length) {
      await supa.from('profiles').update(patch).eq('id', p.id)
    }
  }

  console.log('✅ Re-sanitization completed.')
}

main().catch((e) => { console.error(e); process.exit(1) })
