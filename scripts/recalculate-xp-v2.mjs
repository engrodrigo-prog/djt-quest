import { createClient } from "@supabase/supabase-js";
import { loadLocalEnvIfNeeded } from "../server/lib/load-local-env.js";

loadLocalEnvIfNeeded();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para executar o recálculo.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(name);
  if (idx < 0) return null;
  return args[idx + 1] || null;
};

const userIdArg = getArg("--user-id");
const emailArg = getArg("--email");
const nameArg = getArg("--name");

const isImageUrl = (url) => {
  const clean = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif|avif)$/.test(clean);
};

const normalizeAttachmentUrl = (raw) => {
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object") {
    if (typeof raw.url === "string") return raw.url.trim();
    if (typeof raw.publicUrl === "string") return raw.publicUrl.trim();
    if (typeof raw.href === "string") return raw.href.trim();
    if (typeof raw.src === "string") return raw.src.trim();
  }
  return String(raw || "").trim();
};

const extractAttachmentUrls = (attachments) => {
  if (!attachments) return [];
  if (Array.isArray(attachments)) return attachments.map(normalizeAttachmentUrl).filter(Boolean);
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

const fetchForumPostIdsForUser = async (userId) => {
  const ids = new Set();
  try {
    const { data } = await supabase.from("forum_posts").select("id").eq("user_id", userId).limit(50000);
    for (const row of data || []) if (row?.id) ids.add(String(row.id));
  } catch {}
  try {
    const { data } = await supabase.from("forum_posts").select("id").eq("author_id", userId).limit(50000);
    for (const row of data || []) if (row?.id) ids.add(String(row.id));
  } catch {}
  return Array.from(ids);
};

const resolveTargetUserId = async () => {
  if (userIdArg) return String(userIdArg).trim();
  if (emailArg) {
    const email = String(emailArg).trim().toLowerCase();
    const { data, error } = await supabase.from("profiles").select("id,email,name").ilike("email", email).limit(5);
    if (error) throw new Error(error.message || "Falha ao buscar por email");
    if (!data || data.length === 0) throw new Error("Nenhum usuário encontrado para esse email.");
    if (data.length > 1) {
      throw new Error(`Email ambíguo. Encontrados: ${data.map((p) => `${p.name || "?"} (${p.id})`).join(", ")}`);
    }
    return String(data[0].id);
  }
  if (nameArg) {
    const name = String(nameArg).trim();
    if (!name) throw new Error("Informe um valor não vazio em --name.");

    const exact = await supabase.from("profiles").select("id,name,email").ilike("name", name).limit(10);
    if (exact.error) throw new Error(exact.error.message || "Falha ao buscar por nome");
    if (exact.data && exact.data.length === 1) return String(exact.data[0].id);
    if (exact.data && exact.data.length > 1) {
      throw new Error(`Nome ambíguo. Encontrados: ${exact.data.map((p) => `${p.name || "?"} (${p.id})`).join(", ")}`);
    }

    const safe = name.replace(/[%_]/g, "\\$&");
    const like = await supabase.from("profiles").select("id,name,email").ilike("name", `%${safe}%`).limit(10);
    if (like.error) throw new Error(like.error.message || "Falha ao buscar por nome");
    if (!like.data || like.data.length === 0) throw new Error("Nenhum usuário encontrado para esse nome.");
    if (like.data.length > 1) {
      throw new Error(`Nome ambíguo. Encontrados: ${like.data.map((p) => `${p.name || "?"} (${p.id})`).join(", ")}`);
    }
    return String(like.data[0].id);
  }
  throw new Error("Informe --user-id <uuid>, --email <email> ou --name \"Nome\".");
};

const userId = await resolveTargetUserId();

const { data: profile, error: profErr } = await supabase
  .from("profiles")
  .select("id,name,email,xp,tier")
  .eq("id", userId)
  .maybeSingle();

if (profErr || !profile) {
  console.error("Usuário não encontrado:", profErr?.message || profErr);
  process.exit(1);
}

const currentXp = Number(profile.xp || 0);

let quizXp = 0;
try {
  const { data } = await supabase.from("user_quiz_answers").select("xp_earned").eq("user_id", userId).limit(50000);
  quizXp = (data || []).reduce((sum, r) => sum + (Number(r?.xp_earned) || 0), 0);
} catch {}

const forumPostIds = await fetchForumPostIdsForUser(userId);
const forumPosts = forumPostIds.length;
const forumXp = forumPosts * 10;

let sepbookPhotoCount = 0;
try {
  const { data } = await supabase.from("sepbook_posts").select("attachments").eq("user_id", userId).limit(20000);
  for (const row of data || []) {
    const urls = extractAttachmentUrls(row?.attachments);
    sepbookPhotoCount += urls.filter(isImageUrl).length;
  }
} catch {}
const sepbookPostXp = sepbookPhotoCount * 5;

let sepbookComments = 0;
try {
  const { count } = await supabase.from("sepbook_comments").select("id", { count: "exact", head: true }).eq("user_id", userId);
  sepbookComments = Number(count || 0);
} catch {}
const sepbookCommentXp = sepbookComments * 2;

let sepbookLikes = 0;
try {
  const { count } = await supabase.from("sepbook_likes").select("post_id", { count: "exact", head: true }).eq("user_id", userId);
  sepbookLikes += Number(count || 0);
} catch {}
try {
  const { count } = await supabase
    .from("sepbook_comment_likes")
    .select("comment_id", { count: "exact", head: true })
    .eq("user_id", userId);
  sepbookLikes += Number(count || 0);
} catch {}
const sepbookLikeXp = sepbookLikes;

let campaignsXp = 0;
try {
  const { data } = await supabase.from("events").select("final_points").eq("user_id", userId).limit(50000);
  campaignsXp = (data || []).reduce((sum, r) => sum + (Number(r?.final_points) || 0), 0);
} catch {}

let evaluationsCompleted = 0;
try {
  const { data } = await supabase
    .from("evaluation_queue")
    .select("completed_at")
    .eq("assigned_to", userId)
    .limit(50000);
  evaluationsCompleted = (data || []).filter((r) => Boolean(r?.completed_at)).length;
} catch {}
const evaluationsXp = evaluationsCompleted * 5;

const expectedXp = quizXp + forumXp + sepbookPostXp + sepbookCommentXp + sepbookLikeXp + campaignsXp + evaluationsXp;
const delta = expectedXp - currentXp;

console.log("Recalcular XP:", {
  user: { id: profile.id, name: profile.name, email: profile.email, currentXp, expectedXp, delta },
  breakdown: {
    quizXp,
    forumPosts,
    forumXp,
    sepbookPhotoCount,
    sepbookPostXp,
    sepbookComments,
    sepbookCommentXp,
    sepbookLikes,
    sepbookLikeXp,
    campaignsXp,
    evaluationsCompleted,
    evaluationsXp,
  },
});

if (delta <= 0) {
  console.log("Nada a aplicar (XP atual já é >= ao esperado).");
  process.exit(0);
}

const { error: xpErr } = await supabase.rpc("increment_user_xp", {
  _user_id: userId,
  _xp_to_add: delta,
});

if (xpErr) {
  console.error("Falha ao aplicar incremento de XP:", xpErr.message || xpErr);
  process.exit(1);
}

console.log("XP atualizado com sucesso.");
