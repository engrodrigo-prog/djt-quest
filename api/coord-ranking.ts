// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import coordRankingSummary from '../server/api-handlers/coord-ranking-summary.js';
import { assertDjtQuestServerEnv } from '../server/env-guard.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Invalid server environment' });
  }
  return coordRankingSummary(req, res);
}

export const config = { api: { bodyParser: false } };
