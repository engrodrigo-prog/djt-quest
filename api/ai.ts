// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { assertDjtQuestServerEnv } from '../server/env-guard.js';

type Handler = (req: VercelRequest, res: VercelResponse) => any | Promise<any>;

const handlers: Record<string, () => Promise<{ default: Handler }>> = {
  // IA health check
  health: () => import('../server/api-handlers/ai-health.js'),
  // Quiz helpers
  'quiz-draft': () => import('../server/api-handlers/ai-quiz-draft.js'),
  'generate-wrongs': () => import('../server/api-handlers/ai-generate-wrongs.js'),
  'generate-wrongs-batch': () => import('../server/api-handlers/ai-generate-wrongs-batch.js'),
  'parse-quiz-text': () => import('../server/api-handlers/ai-parse-quiz-text.js'),
  'quiz-milhao': () => import('../server/api-handlers/ai-quiz-milhao.js'),
  'quiz-burini': () => import('../server/api-handlers/ai-quiz-burini.js'),
  'study-quiz': () => import('../server/api-handlers/ai-study-quiz.js'),
  'study-chat': () => import('../server/api-handlers/ai-study-chat.js'),
  // Audio -> texto
  'transcribe-audio': () => import('../server/api-handlers/transcribe-audio.js'),
  // Texto: limpeza ortográfica/pontuação (usado em fórum, quizzes, etc.)
  'cleanup-text': () => import('../server/api-handlers/forum-cleanup-text.js'),
  // Tradução (conteúdo dinâmico do banco)
  'translate-text': () => import('../server/api-handlers/ai-translate-text.js'),
  // Sugerir hashtags (IA premium, JSON)
  'suggest-hashtags': () => import('../server/api-handlers/ai-suggest-hashtags.js'),
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Invalid server environment' });
  }

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

  const loader = handlers[key];
  if (!loader) {
    return res.status(400).json({ error: `Unknown AI handler: ${key}` });
  }

  try {
    const mod = await loader();
    const fn = mod?.default;
    if (typeof fn !== 'function') {
      return res.status(500).json({ error: `Invalid AI handler module: ${key}` });
    }
    return await fn(req, res);
  } catch (e: any) {
    return res.status(500).json({
      error: e?.message || 'Unknown error in /api/ai',
      meta: { handler: key },
    });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
  },
  // Prevent premature termination for slower handlers (e.g., StudyLab with web search).
  maxDuration: 60,
};
