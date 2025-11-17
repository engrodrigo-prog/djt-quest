// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import coordRankingSummary from '../server/api-handlers/coord-ranking-summary.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return coordRankingSummary(req, res);
}

export const config = { api: { bodyParser: false } };

