// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { assertDjtQuestServerEnv } from '../server/env-guard.js';

import approveRegistration from '../server/api-handlers/approve-registration.js';
import rejectRegistration from '../server/api-handlers/reject-registration.js';
import requestPasswordReset from '../server/api-handlers/request-password-reset.js';
import reviewPasswordReset from '../server/api-handlers/review-password-reset.js';
import challengesDelete from '../server/api-handlers/challenges-delete.js';
import challengesUpdateStatus from '../server/api-handlers/challenges-update-status.js';
import studioCreateQuizQuestion from '../server/api-handlers/studio-create-quiz-question.js';
import studioPendingCounts from '../server/api-handlers/studio-pending-counts.js';
import studioListPendingRegistrations from '../server/api-handlers/studio-list-pending-registrations.js';
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
import curationListQuizzes from '../server/api-handlers/curation-list-quizzes.js';
import curationCreateQuiz from '../server/api-handlers/curation-create-quiz.js';
import curationGetQuiz from '../server/api-handlers/curation-get-quiz.js';
import curationUpdateQuiz from '../server/api-handlers/curation-update-quiz.js';
import curationSubmitQuiz from '../server/api-handlers/curation-submit-quiz.js';
import curationReviewQuiz from '../server/api-handlers/curation-review-quiz.js';
import curationPublishQuiz from '../server/api-handlers/curation-publish-quiz.js';
import curationRepublishQuiz from '../server/api-handlers/curation-republish-quiz.js';
import curationDeleteQuizQuestion from '../server/api-handlers/curation-delete-quiz-question.js';
import curationCreateImport from '../server/api-handlers/curation-create-import.js';
import curationExtractImport from '../server/api-handlers/curation-extract-import.js';
import curationStructureImport from '../server/api-handlers/curation-structure-import.js';
import curationFinalizeImport from '../server/api-handlers/curation-finalize-import.js';
import curationApplyImportToQuiz from '../server/api-handlers/curation-apply-import-to-quiz.js';
import curationListQuizVersions from '../server/api-handlers/curation-list-quiz-versions.js';
import trackAccess from '../server/api-handlers/track-access.js';
import reportsQuizSummary from '../server/api-handlers/reports-quiz-summary.js';
import reportsQuestionUsage from '../server/api-handlers/reports-question-usage.js';
import reportsAccessSummary from '../server/api-handlers/reports-access-summary.js';
import reportsListQuizzes from '../server/api-handlers/reports-list-quizzes.js';
import compendiumCatalogImport from '../server/api-handlers/compendium-catalog-import.js';
import compendiumList from '../server/api-handlers/compendium-list.js';
import compendiumCreateImport from '../server/api-handlers/compendium-create-import.js';
import compendiumExtractImport from '../server/api-handlers/compendium-extract-import.js';
import compendiumFinalizeImport from '../server/api-handlers/compendium-finalize-import.js';
import systemCleanup from '../server/api-handlers/system-cleanup.js';
import quizResetAttempt from '../server/api-handlers/quiz-reset-attempt.js';
import sepbookBackfillTranslations from '../server/api-handlers/sepbook-backfill-translations.js';

type Handler = (req: VercelRequest, res: VercelResponse) => any | Promise<any>;

const handlers: Record<string, Handler> = {
  'approve-registration': approveRegistration,
  'reject-registration': rejectRegistration,
  'request-password-reset': requestPasswordReset,
  'review-password-reset': reviewPasswordReset,
  'challenges-delete': challengesDelete,
  'challenges-update-status': challengesUpdateStatus,
  'studio-create-quiz-question': studioCreateQuizQuestion,
  'studio-pending-counts': studioPendingCounts,
  'studio-list-pending-registrations': studioListPendingRegistrations,
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
  'curation-list-quizzes': curationListQuizzes,
  'curation-create-quiz': curationCreateQuiz,
  'curation-get-quiz': curationGetQuiz,
  'curation-update-quiz': curationUpdateQuiz,
  'curation-submit-quiz': curationSubmitQuiz,
  'curation-review-quiz': curationReviewQuiz,
  'curation-publish-quiz': curationPublishQuiz,
  'curation-republish-quiz': curationRepublishQuiz,
  'curation-delete-quiz-question': curationDeleteQuizQuestion,
  'curation-create-import': curationCreateImport,
  'curation-extract-import': curationExtractImport,
  'curation-structure-import': curationStructureImport,
  'curation-finalize-import': curationFinalizeImport,
  'curation-apply-import-to-quiz': curationApplyImportToQuiz,
  'curation-list-quiz-versions': curationListQuizVersions,
  'track-access': trackAccess,
  'reports-quiz-summary': reportsQuizSummary,
  'reports-question-usage': reportsQuestionUsage,
  'reports-access-summary': reportsAccessSummary,
  'reports-list-quizzes': reportsListQuizzes,
  'compendium-catalog-import': compendiumCatalogImport,
  'compendium-list': compendiumList,
  'compendium-create-import': compendiumCreateImport,
  'compendium-extract-import': compendiumExtractImport,
  'compendium-finalize-import': compendiumFinalizeImport,
  'system-cleanup': systemCleanup,
  'quiz-reset-attempt': quizResetAttempt,
  'sepbook-backfill-translations': sepbookBackfillTranslations,
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
