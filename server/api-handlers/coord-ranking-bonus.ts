// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

const STAFF_ROLES = new Set(['admin', 'gerente_djt', 'gerente_divisao_djtx']);
const POSITION_XP: Record<number, number> = {
  1: 500,
  2: 400,
  3: 300,
  4: 200,
  5: 100,
  6: 0,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    // Apenas staff pode registrar ranking
    const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', uid);
    const roleNames = (roles || []).map((r: any) => r.role as string);
    const isStaff = roleNames.some((r) => STAFF_ROLES.has(r));
    if (!isStaff) return res.status(403).json({ error: 'Sem permissão para registrar ranking das coordenações' });

    const { ano, mes, coordenacoes } = req.body || {};
    const year = Number(ano);
    const month = Number(mes);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'ano inválido' });
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'mes inválido' });
    }
    if (!Array.isArray(coordenacoes) || coordenacoes.length === 0) {
      return res.status(400).json({ error: 'coordenacoes é obrigatório e deve ser uma lista' });
    }

    const entries: Array<{
      coord_id: string;
      position: number;
      bonus_xp: number;
      inserted: boolean;
    }> = [];

    for (const item of coordenacoes) {
      const siglaRaw = String(item?.sigla || '').trim();
      const posRaw = Number(item?.posicao);
      if (!siglaRaw) continue;
      if (!Number.isInteger(posRaw) || posRaw < 1 || posRaw > 6) continue;

      // Validar coordenação
      const { data: coord } = await admin
        .from('coordinations')
        .select('id, name')
        .eq('id', siglaRaw)
        .maybeSingle();
      if (!coord) {
        continue;
      }

      const bonus_xp = POSITION_XP[posRaw] ?? 0;

      // Verificar se já existe registro para (ano, mes, coord)
      const { data: existing } = await admin
        .from('bonus_ranking_history')
        .select('id')
        .eq('year', year)
        .eq('month', month)
        .eq('coord_id', coord.id)
        .maybeSingle();

      let inserted = false;
      if (!existing) {
        // Inserir novo registro e aplicar XP para os membros da coordenação
        const { error: insertErr } = await admin.from('bonus_ranking_history').insert({
          year,
          month,
          coord_id: coord.id,
          position: posRaw,
          bonus_xp,
          created_by: uid,
        });
        if (insertErr) {
          console.error('Erro ao inserir bonus_ranking_history:', insertErr);
        } else {
          inserted = true;
          if (bonus_xp > 0) {
            try {
              const { data: members } = await admin
                .from('profiles')
                .select('id')
                .eq('coord_id', coord.id);
              for (const m of members || []) {
                try {
                  await admin.rpc('increment_user_xp', {
                    _user_id: m.id,
                    _xp_to_add: bonus_xp,
                  });
                } catch (xpErr) {
                  console.error('Erro ao aplicar XP de ranking para usuário', m.id, xpErr);
                }
              }
            } catch (memErr) {
              console.error('Erro ao buscar membros da coordenação para XP de ranking:', memErr);
            }
          }
        }
      } else {
        // Atualizar posição/XP sem reaplicar XP (evita duplicar bônus)
        const { error: updErr } = await admin
          .from('bonus_ranking_history')
          .update({ position: posRaw, bonus_xp })
          .eq('id', existing.id);
        if (updErr) {
          console.error('Erro ao atualizar bonus_ranking_history:', updErr);
        }
      }

      entries.push({
        coord_id: coord.id,
        position: posRaw,
        bonus_xp,
        inserted,
      });
    }

    return res.status(200).json({
      success: true,
      year,
      month,
      entries,
    });
  } catch (e: any) {
    console.error('Error in coord-ranking-bonus:', e);
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };

