// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertDjtQuestServerEnv } from '../server/env-guard.js';

import handleStats from '../server/api-handlers/campaign-stats.js';
import handleSuggest from '../server/api-handlers/campaign-suggest.js';
import handleEvidence from '../server/api-handlers/campaign-evidence.js';
import handleEvidenceSubmit from '../server/api-handlers/campaign-evidence-submit.js';

const routes: Record<string, (req: VercelRequest, res: VercelResponse) => any> = {
  stats: handleStats,
  suggest: handleSuggest,
  evidence: handleEvidence,
  'evidence-submit': handleEvidenceSubmit,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Invalid server environment' });
  }

  const action = req.query.action as string;
  const h = action ? routes[action] : undefined;
  if (!h) return res.status(404).json({ error: `Unknown campaign action: ${action}` });

  return h(req, res);
}

export const config = { api: { bodyParser: false } };
