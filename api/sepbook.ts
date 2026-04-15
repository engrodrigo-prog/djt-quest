// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertDjtQuestServerEnv } from '../server/env-guard.js';

import handleFeed from '../server/api-handlers/sepbook-feed.js';
import handlePost from '../server/api-handlers/sepbook-post.js';
import handleEdit from '../server/api-handlers/sepbook-edit.js';
import handleLikes from '../server/api-handlers/sepbook-likes.js';
import handleReact from '../server/api-handlers/sepbook-react.js';
import handleComments from '../server/api-handlers/sepbook-comments.js';
import handleCommentGps from '../server/api-handlers/sepbook-comment-gps.js';
import handleMentions from '../server/api-handlers/sepbook-mentions.js';
import handleMentionsInbox from '../server/api-handlers/sepbook-mentions-inbox.js';
import handleMentionSuggest from '../server/api-handlers/sepbook-mention-suggest.js';
import handleMentionsMarkSeen from '../server/api-handlers/sepbook-mentions-mark-seen.js';
import handleMarkSeen from '../server/api-handlers/sepbook-mark-seen.js';
import handleMarkLastSeen from '../server/api-handlers/sepbook-mark-last-seen.js';
import handleSummary from '../server/api-handlers/sepbook-summary.js';
import handleTags from '../server/api-handlers/sepbook-tags.js';
import handleTrending from '../server/api-handlers/sepbook-trending.js';
import handleModerate from '../server/api-handlers/sepbook-moderate.js';

const routes: Record<string, (req: VercelRequest, res: VercelResponse) => any> = {
  feed: handleFeed,
  post: handlePost,
  edit: handleEdit,
  likes: handleLikes,
  react: handleReact,
  comments: handleComments,
  'comment-gps': handleCommentGps,
  mentions: handleMentions,
  'mentions-inbox': handleMentionsInbox,
  'mention-suggest': handleMentionSuggest,
  'mentions-mark-seen': handleMentionsMarkSeen,
  'mark-seen': handleMarkSeen,
  'mark-last-seen': handleMarkLastSeen,
  summary: handleSummary,
  tags: handleTags,
  trending: handleTrending,
  moderate: handleModerate,
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
  if (!h) return res.status(404).json({ error: `Unknown sepbook action: ${action}` });

  return h(req, res);
}

export const config = { api: { bodyParser: false } };
