import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const normalizeSigla = (value?: string | null) => {
  if (typeof value !== 'string') return null
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return cleaned || null
}

const deriveOrg = (sigla?: string | null) => {
  const normalized = normalizeSigla(sigla)
  if (!normalized) return null
  const parts = normalized.split('-').filter(Boolean)
  const divisionId = parts[0] || 'DJT'
  const coordTag = parts[1] || 'SEDE'
  return {
    divisionId,
    coordinationId: `${divisionId}-${coordTag}`,
    teamId: normalized,
  }
}

type UpdatePayload = {
  userId: string
  email?: string
  name?: string
  matricula?: string | null
  team_id?: string | null
  operational_base?: string | null
  sigla_area?: string | null
  is_leader?: boolean | null
  studio_access?: boolean | null
  date_of_birth?: string | null
  role?: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Check caller
    const { data: { user: caller }, error: callerErr } = await supabase.auth.getUser()
    if (callerErr || !caller) {
      return new Response(JSON.stringify({ error: 'Usuário não autenticado' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Permission: must be gerente/coordenador
    const { data: roles } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', caller.id)

    const allowed = new Set(['gerente_djt','gerente_divisao_djtx','coordenador_djtx','admin'])
    const hasPermission = (roles || []).some(r => allowed.has(r.role as string))
    if (!hasPermission) {
      return new Response(JSON.stringify({ error: 'Sem permissão' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const body = await req.json() as UpdatePayload
    const { userId } = body
    if (!userId) {
      return new Response(JSON.stringify({ error: 'userId é obrigatório' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const updates: Record<string, unknown> = {}
    if (typeof body.name === 'string') updates.name = body.name
    if (typeof body.email === 'string') updates.email = body.email.toLowerCase()
    if (typeof body.matricula !== 'undefined') updates.matricula = body.matricula
    if (typeof body.team_id !== 'undefined') updates.team_id = body.team_id
    const hasSigla = Object.prototype.hasOwnProperty.call(body, 'sigla_area')
    const hasBase = Object.prototype.hasOwnProperty.call(body, 'operational_base')
    if (hasSigla) {
      const sigla = normalizeSigla(body.sigla_area)
      updates.sigla_area = sigla
      updates.operational_base = sigla
      const org = deriveOrg(sigla)
      if (org) {
        updates.division_id = org.divisionId
        updates.coord_id = org.coordinationId
        updates.team_id = org.teamId
      }
    } else if (hasBase) {
      const siglaFromBase = normalizeSigla(body.operational_base)
      updates.operational_base = siglaFromBase
      const org = deriveOrg(siglaFromBase)
      if (org) {
        updates.sigla_area = siglaFromBase
        updates.division_id = org.divisionId
        updates.coord_id = org.coordinationId
        updates.team_id = org.teamId
      }
    }
    if (typeof body.is_leader !== 'undefined') updates.is_leader = body.is_leader
    if (typeof body.studio_access !== 'undefined') updates.studio_access = body.studio_access
    if (typeof body.date_of_birth !== 'undefined') updates.date_of_birth = body.date_of_birth

    // Update Auth if needed (email/name)
    if (body.email || body.name) {
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        email: body.email,
        user_metadata: body.name ? { name: body.name } : undefined,
      })
      if (updErr) {
        return new Response(JSON.stringify({ error: `Auth update failed: ${updErr.message}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    if (Object.keys(updates).length > 0) {
      const { error: profErr } = await supabaseAdmin
        .from('profiles')
        .update(updates)
        .eq('id', userId)
      if (profErr) {
        return new Response(JSON.stringify({ error: `Profile update failed: ${profErr.message}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    if (body.role) {
      // Replace user role with the provided one
      await supabaseAdmin.from('user_roles').delete().eq('user_id', userId)
      const { error: roleErr } = await supabaseAdmin
        .from('user_roles')
        .insert({ user_id: userId, role: body.role })
      if (roleErr) {
        return new Response(JSON.stringify({ error: `Role update failed: ${roleErr.message}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    const { data: updated } = await supabaseAdmin
      .from('profiles')
      .select('id, email, name, matricula, team_id, operational_base, sigla_area, is_leader, studio_access')
      .eq('id', userId)
      .maybeSingle()

    return new Response(JSON.stringify({ success: true, profile: updated }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('Error in studio-update-user:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
