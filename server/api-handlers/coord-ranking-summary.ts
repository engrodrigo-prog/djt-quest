// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Missing Supabase config' });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.slice(7);
    const { data: userData } = await admin.auth.getUser(token);
    const uid = userData?.user?.id;
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const { data: profile } = await admin
      .from('profiles')
      .select('coord_id')
      .eq('id', uid)
      .maybeSingle();
    const coordId = profile?.coord_id as string | null;
    if (!coordId) {
      return res.status(200).json({
        coordId: null,
        coordName: null,
        latest: null,
        history: [],
        graph: { points: [] },
      });
    }

    const { data: coord } = await admin
      .from('coordinations')
      .select('id, name')
      .eq('id', coordId)
      .maybeSingle();

    const { data: historyRows } = await admin
      .from('bonus_ranking_history')
      .select('year, month, coord_id, position, bonus_xp')
      .eq('coord_id', coordId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(24);

    const history = (historyRows || []).map((r: any) => ({
      year: r.year,
      month: r.month,
      xp: r.bonus_xp,
      position: r.position,
    }));

    const latest = history.length ? history[0] : null;

    const graph = {
      points: history
        .slice()
        .reverse()
        .map((h) => ({
          label: `${h.year}-${String(h.month).padStart(2, '0')}`,
          xp: h.xp,
          position: h.position,
        })),
    };

    return res.status(200).json({
      coordId,
      coordName: coord?.name || coordId,
      latest,
      history,
      graph,
    });
  } catch (e: any) {
    console.error('Error in coord-ranking-summary:', e);
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: false } };

