// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { assertDjtQuestServerEnv } from '../server/env-guard.js';

import approveRegistration from '../server/api-handlers/approve-registration.js';
import requestPasswordReset from '../server/api-handlers/request-password-reset.js';
import reviewPasswordReset from '../server/api-handlers/review-password-reset.js';
import challengesDelete from '../server/api-handlers/challenges-delete.js';
import challengesUpdateStatus from '../server/api-handlers/challenges-update-status.js';
import studioCreateQuizQuestion from '../server/api-handlers/studio-create-quiz-question.js';
import studioPendingCounts from '../server/api-handlers/studio-pending-counts.js';
import studioCreateUser from '../server/api-handlers/studio-create-user.js';
import studioUpdateUser from '../server/api-handlers/studio-update-user.js';
import uploadAvatar from '../server/api-handlers/upload-avatar.js';
import adminUpdateProfile from '../server/api-handlers/admin-update-profile.js';
import adminFixChallengeTargets from '../server/api-handlers/admin-fix-challenge-targets.js';
import adminStudySources from '../server/api-handlers/admin-study-sources.js';
import adminAdjustXp from '../server/api-handlers/admin-adjust-xp.js';
import leadershipChallenges from '../server/api-handlers/leadership-challenges.js';
import coordRankingBonus from '../server/api-handlers/coord-ranking-bonus.js';
import studioPublishQuizMilhao from '../server/api-handlers/studio-publish-quiz-milhao.js';
import adminResetMilhaoAttempts from '../server/api-handlers/admin-reset-milhao-attempts.js';

type Handler = (req: VercelRequest, res: VercelResponse) => any | Promise<any>;

const handlers: Record<string, Handler> = {
  'approve-registration': approveRegistration,
  'request-password-reset': requestPasswordReset,
  'review-password-reset': reviewPasswordReset,
  'challenges-delete': challengesDelete,
  'challenges-update-status': challengesUpdateStatus,
  'studio-create-quiz-question': studioCreateQuizQuestion,
  'studio-pending-counts': studioPendingCounts,
  'studio-create-user': studioCreateUser,
  'studio-update-user': studioUpdateUser,
  'upload-avatar': uploadAvatar,
  'admin-update-profile': adminUpdateProfile,
  'admin-fix-challenge-targets': adminFixChallengeTargets,
  'admin-study-sources': adminStudySources,
  'admin-adjust-xp': adminAdjustXp,
  'leadership-challenges': leadershipChallenges,
  'coord-ranking-bonus': coordRankingBonus,
  'studio-publish-quiz-milhao': studioPublishQuizMilhao,
  'admin-reset-milhao-attempts': adminResetMilhaoAttempts,
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

  const fn = handlers[key];
  if (!fn) {
    return res.status(400).json({ error: `Unknown admin handler: ${key}` });
  }

  try {
    return await fn(req, res);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error in /api/admin' });
  }
}

export const config = { api: { bodyParser: true } };
