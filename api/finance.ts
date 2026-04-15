// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertDjtQuestServerEnv } from '../server/env-guard.js';

import handleRequest from '../server/api-handlers/finance-request.js';
import handleRequestExtract from '../server/api-handlers/finance-request-extract.js';
import handleRequests from '../server/api-handlers/finance-requests.js';
import handleRequestsAdmin from '../server/api-handlers/finance-requests-admin.js';

const routes: Record<string, (req: VercelRequest, res: VercelResponse) => any> = {
  request: handleRequest,
  'request-extract': handleRequestExtract,
  requests: handleRequests,
  'requests-admin': handleRequestsAdmin,
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
  if (!h) return res.status(404).json({ error: `Unknown finance action: ${action}` });

  return h(req, res);
}

export const config = { api: { bodyParser: false } };
