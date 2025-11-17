// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Import handlers statically so Vercel bundles them correctly
import aiHealth from '../server/api-handlers/ai-health.js';
import aiQuizDraft from '../server/api-handlers/ai-quiz-draft.js';
import aiGenerateWrongs from '../server/api-handlers/ai-generate-wrongs.js';
import transcribeAudio from '../server/api-handlers/transcribe-audio.js';
import forumCleanupText from '../server/api-handlers/forum-cleanup-text.js';
import suggestHashtags from '../server/api-handlers/ai-suggest-hashtags.js';
import aiQuizMilhao from '../server/api-handlers/ai-quiz-milhao.js';

type Handler = (req: VercelRequest, res: VercelResponse) => any | Promise<any>;

const handlers: Record<string, Handler> = {
  // IA health check
  health: aiHealth,
  // Quiz helpers
  'quiz-draft': aiQuizDraft,
  'generate-wrongs': aiGenerateWrongs,
  'quiz-milhao': aiQuizMilhao,
  // Audio -> texto
  'transcribe-audio': transcribeAudio,
  // Texto: limpeza ortográfica/pontuação (usado em fórum, quizzes, etc.)
  'cleanup-text': forumCleanupText,
  // Sugerir hashtags (IA premium, JSON)
  'suggest-hashtags': suggestHashtags,
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
    return res.status(400).json({ error: `Unknown AI handler: ${key}` });
  }

  try {
    return await fn(req, res);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error in /api/ai' });
  }
}

export const config = { api: { bodyParser: true } };
