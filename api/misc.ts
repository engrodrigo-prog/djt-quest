// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertDjtQuestServerEnv } from '../server/env-guard.js';

import handleCoordRanking from '../server/api-handlers/coord-ranking.js';
import handleQuizPracticeCheck from '../server/api-handlers/quiz-practice-check.js';
import handleChallengeActionSubmit from '../server/api-handlers/challenge-action-submit.js';
import handleGuardiaoVidaDashboard from '../server/api-handlers/guardiao-vida-dashboard.js';
import handleProfileLookup from '../server/api-handlers/profile-lookup.js';
import handleRegistrationOptions from '../server/api-handlers/registration-options.js';
import handleReverseGeocode from '../server/api-handlers/reverse-geocode.js';
import handleForumMentionsMarkSeen from '../server/api-handlers/forum-mentions-mark-seen.js';

const routes: Record<string, (req: VercelRequest, res: VercelResponse) => any> = {
  'coord-ranking': handleCoordRanking,
  'quiz-practice-check': handleQuizPracticeCheck,
  'challenge-action-submit': handleChallengeActionSubmit,
  'guardiao-vida-dashboard': handleGuardiaoVidaDashboard,
  'profile-lookup': handleProfileLookup,
  'registration-options': handleRegistrationOptions,
  'reverse-geocode': handleReverseGeocode,
  'forum-mentions-mark-seen': handleForumMentionsMarkSeen,
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
  if (!h) return res.status(404).json({ error: `Unknown misc action: ${action}` });

  return h(req, res);
}

export const config = { api: { bodyParser: false } };
