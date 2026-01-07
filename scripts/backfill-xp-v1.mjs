import { createClient } from "@supabase/supabase-js";
import { loadLocalEnvIfNeeded } from "../server/lib/load-local-env.js";

loadLocalEnvIfNeeded();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para executar o backfill.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BACKFILL_KEY = "xp_backfill_v1";

const isImageUrl = (url) => {
  const clean = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(clean);
};

const normalizeAttachmentUrl = (raw) => {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object") {
    if (typeof raw.url === "string") return raw.url.trim();
    if (typeof raw.publicUrl === "string") return raw.publicUrl.trim();
  }
  return String(raw || "").trim();
};

const extractAttachmentUrls = (attachments) => {
  if (!attachments) return [];
  if (Array.isArray(attachments)) {
    return attachments.map(normalizeAttachmentUrl).filter(Boolean);
  }
  if (typeof attachments === "string") {
    const trimmed = attachments.trim();
    if (!trimmed) return [];
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      try {
        return extractAttachmentUrls(JSON.parse(trimmed));
      } catch {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  if (typeof attachments === "object") {
    if (Array.isArray(attachments.urls)) return attachments.urls.map(normalizeAttachmentUrl).filter(Boolean);
    if (Array.isArray(attachments.items)) return attachments.items.map(normalizeAttachmentUrl).filter(Boolean);
    if (Array.isArray(attachments.files)) return attachments.files.map(normalizeAttachmentUrl).filter(Boolean);
  }
  return [];
};

const addXp = (map, userId, amount) => {
  if (!userId || !amount) return;
  const current = map.get(userId) || 0;
  map.set(userId, current + amount);
};

const { data: existingSetting, error: settingError } = await supabase
  .from("system_settings")
  .select("value")
  .eq("key", BACKFILL_KEY)
  .maybeSingle();

if (settingError) {
  console.error("Falha ao ler system_settings:", settingError.message || settingError);
  process.exit(1);
}

if (existingSetting?.value?.done) {
  console.log("Backfill já executado. Nada a fazer.");
  process.exit(0);
}

const xpByUser = new Map();
const summary = {
  sepbook_posts: 0,
  sepbook_comments: 0,
  sepbook_likes: 0,
  sepbook_comment_likes: 0,
  forum_posts: 0,
};

const { data: sepbookPosts, error: postsErr } = await supabase
  .from("sepbook_posts")
  .select("id,user_id,attachments");

if (postsErr) {
  console.error("Erro lendo sepbook_posts:", postsErr.message || postsErr);
  process.exit(1);
}

for (const post of sepbookPosts || []) {
  const urls = extractAttachmentUrls(post.attachments);
  const photoCount = urls.filter(isImageUrl).length;
  if (photoCount > 0) {
    addXp(xpByUser, post.user_id, photoCount * 5);
    summary.sepbook_posts += photoCount;
  }
}

const { data: sepbookComments, error: commentsErr } = await supabase
  .from("sepbook_comments")
  .select("id,user_id");

if (commentsErr) {
  console.error("Erro lendo sepbook_comments:", commentsErr.message || commentsErr);
  process.exit(1);
}

for (const comment of sepbookComments || []) {
  addXp(xpByUser, comment.user_id, 2);
  summary.sepbook_comments += 1;
}

const { data: sepbookLikes, error: likesErr } = await supabase
  .from("sepbook_likes")
  .select("post_id,user_id");

if (likesErr) {
  console.error("Erro lendo sepbook_likes:", likesErr.message || likesErr);
  process.exit(1);
}

for (const like of sepbookLikes || []) {
  addXp(xpByUser, like.user_id, 1);
  summary.sepbook_likes += 1;
}

const { data: sepbookCommentLikes, error: commentLikesErr } = await supabase
  .from("sepbook_comment_likes")
  .select("comment_id,user_id");

if (!commentLikesErr) {
  for (const like of sepbookCommentLikes || []) {
    addXp(xpByUser, like.user_id, 1);
    summary.sepbook_comment_likes += 1;
  }
}

const { data: forumPosts, error: forumErr } = await supabase
  .from("forum_posts")
  .select("id,author_id,user_id");

if (forumErr) {
  console.error("Erro lendo forum_posts:", forumErr.message || forumErr);
  process.exit(1);
}

for (const post of forumPosts || []) {
  const userId = post.author_id || post.user_id;
  if (!userId) continue;
  addXp(xpByUser, userId, 10);
  summary.forum_posts += 1;
}

let totalXp = 0;
let updatedUsers = 0;
for (const [userId, amount] of xpByUser.entries()) {
  if (!amount) continue;
  totalXp += amount;
  const { error } = await supabase.rpc("increment_user_xp", {
    _user_id: userId,
    _xp_to_add: amount,
  });
  if (error) {
    console.error(`Falha ao aplicar XP para ${userId}:`, error.message || error);
  } else {
    updatedUsers += 1;
  }
}

const settingValue = {
  done: true,
  executed_at: new Date().toISOString(),
  updated_users: updatedUsers,
  total_xp_added: totalXp,
  totals: summary,
};

const { error: upsertErr } = await supabase
  .from("system_settings")
  .upsert({ key: BACKFILL_KEY, value: settingValue });

if (upsertErr) {
  console.error("Falha ao gravar system_settings:", upsertErr.message || upsertErr);
  process.exit(1);
}

console.log("Backfill concluído.");
console.log(settingValue);
