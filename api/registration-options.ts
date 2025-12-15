// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

const GUEST_TEAM_ID = 'CONVIDADOS';

const normText = (s: any) =>
  String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);

const uniqSorted = (items: string[]) =>
  Array.from(new Set(items.map(normText).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const team =
      (typeof req.query.team === 'string' ? req.query.team : Array.isArray(req.query.team) ? req.query.team[0] : '') || '';
    const teamId = normText(team).toUpperCase();

    // Teams list (from DB when possible)
    let teams: Array<{ id: string; name: string | null }> = [];
    try {
      const { data } = await admin.from('teams').select('id,name').order('name').limit(500);
      teams = (data || []).map((t: any) => ({ id: normText(t.id), name: t.name ? normText(t.name) : null })).filter((t) => t.id);
    } catch {
      teams = [];
    }

    // Ensure guest option always present
    const hasGuest = teams.some((t) => t.id.toUpperCase() === GUEST_TEAM_ID);
    if (!hasGuest) teams = [{ id: GUEST_TEAM_ID, name: 'Convidados (externo)' }, ...teams];

    // Bases for selected team, derived from real usage (profiles + pending registrations)
    let bases: string[] = [];
    if (teamId && teamId !== GUEST_TEAM_ID && teamId !== 'EXTERNO') {
      try {
        const [p1, p2] = await Promise.all([
          admin.from('profiles').select('operational_base').eq('sigla_area', teamId).limit(2000),
          admin.from('pending_registrations').select('operational_base').eq('sigla_area', teamId).limit(2000),
        ]);
        const a = (p1?.data || []).map((r: any) => r.operational_base);
        const b = (p2?.data || []).map((r: any) => r.operational_base);
        bases = uniqSorted([...a, ...b]);
      } catch {
        bases = [];
      }
    }

    return res.status(200).json({
      success: true,
      guest_team_id: GUEST_TEAM_ID,
      teams,
      bases,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };

