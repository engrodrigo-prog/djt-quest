import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const projectUrl = process.env.SUPABASE_URL

if (!serviceRoleKey || !projectUrl) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(projectUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const csvPath = path.resolve('src', 'assets', 'cadastro_cpfl_go_import.csv')
if (!fs.existsSync(csvPath)) {
  console.error('CSV não encontrado em', csvPath)
  process.exit(1)
}

const parse = (line) => {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { q = !q; continue }
    if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else { cur += ch }
  }
  out.push(cur.trim());
  return out
}

const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(Boolean)
const header = parse(lines[0])
const idx = {
  nome: header.indexOf('nome'),
  matricula: header.indexOf('matricula'),
  email: header.indexOf('email'),
  date_of_birth: header.indexOf('date_of_birth')
}

const mismatches = []

for (let i = 1; i < lines.length; i++) {
  const cols = parse(lines[i])
  const email = cols[idx.email]?.toLowerCase()
  if (!email) continue
  const matriculaCsv = cols[idx.matricula] || null
  const dobCsv = cols[idx.date_of_birth] || null
  const { data: prof } = await supabase
    .from('profiles')
    .select('email, name, matricula, date_of_birth')
    .eq('email', email)
    .maybeSingle()
  if (!prof) {
    mismatches.push({ email, issue: 'missing_in_db' })
    continue
  }
  const matOk = String(prof.matricula || '').trim() === String(matriculaCsv || '').trim()
  const dobOk = String(prof.date_of_birth || '').trim() === String(dobCsv || '').trim()
  if (!matOk || !dobOk) {
    mismatches.push({ email, matriculaDb: prof.matricula, matriculaCsv, dobDb: prof.date_of_birth, dobCsv })
  }
}

if (mismatches.length === 0) {
  console.log('✔ Todos os usuários conferem com o CSV (matrícula e data de nascimento).')
} else {
  console.log('⚠ Inconsistências encontradas:', mismatches.length)
  mismatches.slice(0, 50).forEach((m) => console.log(m))
  if (mismatches.length > 50) console.log(`... +${mismatches.length - 50} outras`) 
  process.exitCode = 2
}

