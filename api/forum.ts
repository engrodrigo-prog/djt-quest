// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

import forumPost from '../server/api-handlers/forum-post.js';
import forumModerate from '../server/api-handlers/forum-moderate.js';
import forumCloseTopic from '../server/api-handlers/forum-close-topic.js';
import forumAiAssessPost from '../server/api-handlers/forum-ai-assess-post.js';
import forumTopInsights from '../server/api-handlers/forum-top-insights.js';
import forumApplyMonthlyBonus from '../server/api-handlers/forum-apply-monthly-bonus.js';

type Handler = (req: VercelRequest, res: VercelResponse) => any | Promise<any>;

const handlers: Record<string, Handler> = {
  post: forumPost,
  moderate: forumModerate,
  'close-topic': forumCloseTopic,
  'assess-post': forumAiAssessPost,
  'top-insights': forumTopInsights,
  'apply-monthly-bonus': forumApplyMonthlyBonus,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');

  const key =
    (typeof req.query.handler === 'string'
      ? req.query.handler
      : Array.isArray(req.query.handler)
      ? req.query.handler[0]
      : undefined) ||
    (req.body && typeof req.body.handler === 'string' ? req.body.handler : undefined);

  if (!key) {
    return res.status(400).json({ error: 'handler query param required' });
  }

  const fn = handlers[key];
  if (!fn) {
    return res.status(400).json({ error: `Unknown forum handler: ${key}` });
  }

  try {
    return await fn(req, res);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error in /api/forum' });
  }
}

export const config = { api: { bodyParser: true } };
