// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

type ApprovalRequest = { registrationId: string; notes?: string }

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) as string
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined
const GUEST_TEAM_ID = 'CONVIDADOS'
const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx', 'coordenador_djtx'])

const normTeamCode = (raw?: string | null) =>
  String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)

const computeScope = async (admin: any, userId: string) => {
  const [{ data: rolesData }, { data: profile }] = await Promise.all([
    admin.from('user_roles').select('role').eq('user_id', userId),
    admin
      .from('profiles')
      .select('team_id, coord_id, division_id, is_leader, studio_access, sigla_area, operational_base')
      .eq('id', userId)
      .maybeSingle(),
  ])

  const roles = (rolesData || []).map((r: any) => String(r.role || ''))
  const isLeader = Boolean((profile as any)?.is_leader)
  const roleSet = new Set(roles)

  let effectiveRole: string | null = null
  if (roleSet.has('admin')) effectiveRole = 'admin'
  else if (roleSet.has('gerente_djt')) effectiveRole = 'gerente_djt'
  else if (roleSet.has('gerente_divisao_djtx')) effectiveRole = 'gerente_divisao_djtx'
  else if (roleSet.has('coordenador_djtx')) effectiveRole = 'coordenador_djtx'
  else if (roleSet.has('lider_equipe') || isLeader) effectiveRole = 'lider_equipe'

  const studioAccess =
    Boolean((profile as any)?.studio_access) ||
    roles.some((r) => STAFF_ROLES.has(r)) ||
    roleSet.has('lider_equipe') ||
    isLeader

  let teamId: string | null = (profile as any)?.team_id || null
  if (!teamId) {
    const fallback = normTeamCode((profile as any)?.sigla_area || (profile as any)?.operational_base)
    teamId = fallback || null
  }
  let coordId: string | null = (profile as any)?.coord_id || null
  let divisionId: string | null = (profile as any)?.division_id || null

  if (teamId && !coordId) {
    try {
      const { data } = await admin.from('teams').select('coord_id').eq('id', teamId).maybeSingle()
      coordId = (data as any)?.coord_id || null
    } catch {}
  }
  if (coordId && !divisionId) {
    try {
      const { data } = await admin.from('coordinations').select('division_id').eq('id', coordId).maybeSingle()
      divisionId = (data as any)?.division_id || null
    } catch {}
  }

  return { roles, roleSet, studioAccess, effectiveRole, teamId, coordId, divisionId }
}

const inScope = (regSiglaRaw: string, scope: any) => {
  const sigla = String(regSiglaRaw || '').trim().toUpperCase()
  if (!sigla) return false
  if (sigla === 'EXTERNO' || sigla === GUEST_TEAM_ID) return true

  const div = String(scope.divisionId || '').toUpperCase()
  const coord = String(scope.coordId || '').toUpperCase()
  const team = String(scope.teamId || '').toUpperCase()

  if (scope.effectiveRole === 'admin' || scope.effectiveRole === 'gerente_djt') return true
  if (scope.effectiveRole === 'gerente_divisao_djtx') return !!div && sigla.startsWith(div)
  if (scope.effectiveRole === 'coordenador_djtx')
    return (!!div && sigla.startsWith(div)) || (!!coord && sigla.startsWith(coord)) || (!!team && sigla === team)
  if (scope.effectiveRole === 'lider_equipe') return !!team && sigla === team
  return false
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!SUPABASE_URL) return res.status(500).json({ error: 'Missing SUPABASE_URL' })
    if (!SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' })

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
    const authHeader = (req.headers['authorization'] as string | undefined) || ''
    let requesterId: string | null = null
    if (authHeader) {
      try {
        const { data } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
        requesterId = data.user?.id || null
      } catch {}
    }

    // Verify permissions
    if (!requesterId) return res.status(401).json({ error: 'Unauthorized' })
    const scope = await computeScope(admin, requesterId)
    if (!scope.studioAccess || !scope.effectiveRole) return res.status(403).json({ error: 'Insufficient permissions' })

    const body = req.body as ApprovalRequest
    if (!body?.registrationId) return res.status(400).json({ error: 'registrationId required' })

    const { data: reg, error: regErr } = await admin
      .from('pending_registrations')
      .select('*')
      .eq('id', body.registrationId)
      .eq('status', 'pending')
      .single()
    if (regErr || !reg) return res.status(404).json({ error: 'Registration not found or processed' })

    if (!inScope(reg.sigla_area, scope)) return res.status(403).json({ error: 'Fora do escopo' })

    // Prevent duplicate approvals
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id')
      .eq('email', reg.email)
      .maybeSingle()
    if (existingProfile?.id) {
      return res.status(400).json({ error: 'Já existe um perfil ativo com este e-mail. Rejeite ou edite o usuário existente.' })
    }

    // Create auth user
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: reg.email,
      password: '123456',
      email_confirm: true,
      user_metadata: { name: reg.name },
    })
    if (createErr) return res.status(400).json({ error: createErr.message })
    const newUserId = created.user!.id

    // Create or update profile to avoid duplicate key on retries
    const { error: profErr } = await admin.from('profiles').upsert({
      id: newUserId,
      name: reg.name,
      email: reg.email,
      matricula: reg.matricula,
      operational_base: reg.operational_base,
      sigla_area: reg.sigla_area,
      must_change_password: true,
      needs_profile_completion: true,
    }, { onConflict: 'id' })
    if (profErr) {
      await admin.auth.admin.deleteUser(newUserId)
      return res.status(400).json({ error: profErr.message })
    }

    const regSigla = String(reg.sigla_area || '').trim().toUpperCase()
    const isGuest = regSigla === 'EXTERNO' || regSigla === GUEST_TEAM_ID
    if (isGuest) {
      // Garantia: convidado entra como colaborador comum e fica sob "CONVIDADOS",
      // sem compor hierarquia (sem divisão/coord) e sem exigir base específica.
      try {
        await admin.from('teams').upsert({ id: GUEST_TEAM_ID, name: 'Convidados (externo)' } as any, { onConflict: 'id' } as any)
      } catch {}
      await admin
        .from('profiles')
        .update({
          sigla_area: GUEST_TEAM_ID,
          operational_base: GUEST_TEAM_ID,
          team_id: GUEST_TEAM_ID,
          coord_id: null,
          division_id: null,
        } as any)
        .eq('id', newUserId)
      // pula deriveOrg
    } else {
      const desiredTeamId = normTeamCode(reg.sigla_area)
      if (desiredTeamId) {
        // Garantia: o valor do cadastro (sigla_area) também existe como teams.id,
        // para que perfis possam referenciar team_id sem falhar FK.
        try {
          const { data: existing } = await admin.from('teams').select('id').eq('id', desiredTeamId).maybeSingle()
          if (!existing?.id) {
            await admin.from('teams').insert({ id: desiredTeamId, name: desiredTeamId } as any)
          }
        } catch {}
      }

      // Derive org from DB
      const deriveOrg = async (raw?: string | null) => {
        const s = String(raw || '')
          .toUpperCase()
          .replace(/[^A-Z0-9-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '')
        if (!s) return null
        let teamId: string | null = null
        let coordId: string | null = null
        let divisionId: string | null = null
        // Try direct team id
        const { data: team } = await admin.from('teams').select('id, coord_id').eq('id', s).maybeSingle()
        if (team?.id) {
          teamId = team.id
          coordId = team.coord_id
          if (coordId) {
            const { data: coord } = await admin.from('coordinations').select('division_id').eq('id', coordId).maybeSingle()
            divisionId = coord?.division_id || null
          }
        } else if (s.includes('-')) {
          const [div, tag] = s.split('-', 2)
          divisionId = div || null
          coordId = div && tag ? `${div}-${tag}` : null
          if (tag) {
            const { data: t2 } = await admin.from('teams').select('id').eq('id', tag).maybeSingle()
            if (t2?.id) teamId = t2.id
          }
        }
        if (!divisionId && coordId) {
          const { data: coord } = await admin.from('coordinations').select('division_id').eq('id', coordId).maybeSingle()
          divisionId = coord?.division_id || null
        }
        if (!divisionId && !coordId && !teamId) return null
        return { divisionId, coordId, teamId }
      }
      const org = await deriveOrg(reg.sigla_area || reg.operational_base)
      if (org) {
        await admin.from('profiles').update({ division_id: org.divisionId, coord_id: org.coordId, team_id: org.teamId }).eq('id', newUserId)
      } else if (desiredTeamId) {
        await admin.from('profiles').update({ team_id: desiredTeamId } as any).eq('id', newUserId)
      }
    }

    // Assign default role
    const { error: roleErr } = await admin.from('user_roles').insert({ user_id: newUserId, role: 'colaborador' })
    if (roleErr && !String(roleErr.message || '').toLowerCase().includes('duplicate')) {
      await admin.auth.admin.deleteUser(newUserId)
      return res.status(400).json({ error: roleErr.message })
    }

    // Update registration
    await admin
      .from('pending_registrations')
      .update({ status: 'approved', reviewed_by: requesterId, reviewed_at: new Date().toISOString(), review_notes: body.notes || null })
      .eq('id', body.registrationId)

    return res.status(200).json({ success: true, userId: newUserId })
  } catch (err: any) {
    return res.status(400).json({ error: err?.message || 'Unknown error' })
  }
}

export const config = { api: { bodyParser: true } }
