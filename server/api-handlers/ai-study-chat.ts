// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import { extractPdfText, extractDocxText, extractJsonText, extractPlainText } from "../lib/import-parsers.js";
import { extractImageTextWithAi } from "../lib/ai-curation-provider.js";
import { DJT_RULES_ARTICLE } from "../../shared/djt-rules.js";
import { normalizeChatModel, pickChatModel } from "../lib/openai-models.js";

const require = createRequire(import.meta.url);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;
const STUDYLAB_DEFAULT_CHAT_MODEL = "gpt-5-nano-2025-08-07";
// Keep answers reasonably short to reduce latency and avoid timeouts.
const STUDYLAB_MAX_COMPLETION_TOKENS = Math.max(
  240,
  Math.min(1200, Number(process.env.STUDYLAB_MAX_COMPLETION_TOKENS || 520)),
);
const STUDYLAB_WEB_SEARCH_TIMEOUT_MS = Math.max(
  1500,
  Math.min(30000, Number(process.env.STUDYLAB_WEB_SEARCH_TIMEOUT_MS || 12000)),
);
const STUDYLAB_OPENAI_TIMEOUT_MS = Math.max(
  5000,
  // Default keeps headroom for serverless runtimes while preventing early aborts.
  Math.min(60000, Number(process.env.STUDYLAB_OPENAI_TIMEOUT_MS || 55000)),
);
const STUDYLAB_HISTORY_LIMIT = Math.max(6, Math.min(16, Number(process.env.STUDYLAB_HISTORY_LIMIT || 10)));
const STUDYLAB_INLINE_IMAGE_BYTES = Math.max(
  256000,
  Math.min(3000000, Number(process.env.STUDYLAB_INLINE_IMAGE_BYTES || 1500000)),
);

const OPENAI_MODEL_STUDYLAB_CHAT = normalizeChatModel(
  (process.env.OPENAI_MODEL_STUDYLAB_CHAT as string) || "",
  STUDYLAB_DEFAULT_CHAT_MODEL,
);

function chooseModel(preferPremium = false) {
  const premium = process.env.OPENAI_MODEL_PREMIUM;
  const fast = process.env.OPENAI_MODEL_FAST;
  return pickChatModel(preferPremium, {
    premium,
    fast,
    fallbackFast: "gpt-5-2025-08-07",
    fallbackPremium: "gpt-5-2025-08-07",
  });
}

const uniqueStrings = (values: any[]) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values || []) {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};

const pickStudyLabChatModels = (fallbackModel: string) =>
  uniqueStrings([
    OPENAI_MODEL_STUDYLAB_CHAT,
    STUDYLAB_DEFAULT_CHAT_MODEL,
    fallbackModel,
    // Compatibility fallbacks in case the environment key does not have access to GPT-5 models.
    process.env.OPENAI_MODEL_COMPAT,
    "gpt-4.1-mini",
    "gpt-4o-mini",
  ]);

const extractChatText = (data: any) => {
  const choice = data?.choices?.[0];
  if (typeof choice?.text === "string") return choice.text;
  const msg = choice?.message;
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    const parts = msg.content
      .map((c: any) =>
        typeof c?.text === "string"
          ? c.text
          : typeof c?.content === "string"
            ? c.content
            : typeof c?.value === "string"
              ? c.value
              : typeof c === "string"
                ? c
                : "",
      )
      .filter(Boolean);
    if (parts.length) return parts.join("\n");
  }
  if (typeof data?.output_text === "string") return data.output_text;
  if (Array.isArray(data?.output)) {
    const chunks = data.output
      .map((item: any) => {
        if (typeof item?.content === "string") return item.content;
        if (Array.isArray(item?.content)) return item.content.map((c: any) => c?.text || c?.content || "").join("\n");
        return item?.text || "";
      })
      .filter(Boolean);
    if (chunks.length) return chunks.join("\n");
  }
  return "";
};

const isFatalOpenAiStatus = (status: number) => status === 401 || status === 403 || status === 429;
const isAbortError = (err: any) => {
  if (!err) return false;
  if (String(err?.name || "") === "AbortError") return true;
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("aborted") || msg.includes("abort");
};

const normalizeResponseRole = (raw: any) => {
  const role = String(raw || "").trim().toLowerCase();
  if (role === "assistant" || role === "system" || role === "user") return role;
  return "user";
};

const toResponsesInputMessages = (
  messages: Array<{ role: string; content: string | Array<any> }>,
) =>
  (messages || [])
    .map((m) => {
      const role = normalizeResponseRole(m?.role);
      const isAssistant = role === "assistant";
      const rawContent = (m as any)?.content;
      let contentItems: any[] = [];

      if (Array.isArray(rawContent)) {
        contentItems = rawContent
          .map((item) => {
            if (!item) return null;
            if (typeof item === "string") {
              return isAssistant
                ? { type: "output_text", text: item }
                : { type: "input_text", text: item };
            }
            const t = String(item?.type || "").trim();
            if (t === "input_text" || t === "output_text") {
              const text = String(item?.text || item?.content || "");
              if (!text) return null;
              return isAssistant ? { type: "output_text", text } : { type: "input_text", text };
            }
            if (!isAssistant && (t === "input_image" || t === "image_url")) {
              const imageUrl =
                typeof item?.image_url === "string" ? item.image_url : item?.image_url?.url || item?.url || "";
              if (!imageUrl) return null;
              return { type: "input_image", image_url: imageUrl };
            }
            return null;
          })
          .filter(Boolean);
      } else {
        const text = String(rawContent || "");
        if (text) {
          contentItems = [
            isAssistant ? { type: "output_text", text } : { type: "input_text", text },
          ];
        }
      }

      return { role, content: contentItems };
    })
    .filter((m) => m.role && Array.isArray(m.content) && m.content.length);

const toResponsesTextMessages = (messages: Array<{ role: string; content: string | Array<any> }>) =>
  (messages || [])
    .map((m) => {
      const normalizedRole = normalizeResponseRole(m?.role);
      if (!normalizedRole) return null;
      const rawContent = (m as any)?.content;
      let text = "";
      if (Array.isArray(rawContent)) {
        text = rawContent
          .map((item) => {
            if (!item) return "";
            if (typeof item === "string") return item;
            const t = String(item?.type || "").trim();
            if (t === "input_text" || t === "output_text") {
              return String(item?.text || item?.content || "");
            }
            if (t === "input_image" || t === "image_url") {
              const url = typeof item?.image_url === "string" ? item.image_url : item?.image_url?.url || item?.url || "";
              return url ? `Imagem: ${url}` : "";
            }
            return String(item?.text || item?.content || "");
          })
          .filter(Boolean)
          .join("\n");
      } else {
        text = String(rawContent || "");
      }
      const trimmed = text.trim();
      if (!trimmed) return null;
      return {
        role: normalizedRole,
        content: [
          {
            type: normalizedRole === "assistant" ? "output_text" : "input_text",
            text: trimmed,
          },
        ],
      };
    })
    .filter(Boolean);

const callOpenAiResponse = async (payload: any, timeoutMs?: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || STUDYLAB_OPENAI_TIMEOUT_MS);
  try {
    return await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
  } finally {
    clearTimeout(timer);
  }
};

const normalizeForMatch = (raw: string) =>
  String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const RULES_KEYWORDS = [
  "djt",
  "quest",
  "regras",
  "pontuacao",
  "xp",
  "bonus",
  "ranking",
  "campanha",
  "desafio",
  "forum",
  "sepbook",
  "quiz",
  "avaliacao",
];

const shouldInjectRules = (text: string) => {
  const normalized = normalizeForMatch(text);
  if (!normalized) return false;
  return RULES_KEYWORDS.some((k) => normalized.includes(k));
};

const buildRulesContext = () =>
  `Base fixa (Regras do DJT Quest):\n${DJT_RULES_ARTICLE.title}\n${DJT_RULES_ARTICLE.body}`;

const extractMessageText = (rawContent: any) => {
  if (Array.isArray(rawContent)) {
    return rawContent
      .map((item) => {
        if (!item) return "";
        if (typeof item === "string") return item;
        const t = String(item?.type || "").trim();
        if (t === "input_text" || t === "output_text") {
          return String(item?.text || item?.content || "");
        }
        if (t === "input_image" || t === "image_url") {
          const url = typeof item?.image_url === "string" ? item.image_url : item?.image_url?.url || item?.url || "";
          return url ? `Imagem: ${url}` : "";
        }
        return String(item?.text || item?.content || "");
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (typeof rawContent === "string") return rawContent.trim();
  if (rawContent == null) return "";
  return String(rawContent).trim();
};

const normalizeIncomingMessages = (rawMessages: any[]) =>
  (Array.isArray(rawMessages) ? rawMessages : [])
    .map((m) => {
      const role = m?.role === "assistant" ? "assistant" : "user";
      const content = extractMessageText(m?.content);
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);

const collectOutputText = (payload: any) => {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = output
    .map((item: any) => {
      if (typeof item?.content === "string") return item.content;
      if (Array.isArray(item?.content)) {
        return item.content
          .map((c: any) => {
            if (typeof c?.text === "string") return c.text;
            if (typeof c?.text?.value === "string") return c.text.value;
            if (typeof c?.content === "string") return c.content;
            if (typeof c?.value === "string") return c.value;
            return "";
          })
          .filter(Boolean)
          .join("\n");
      }
      return item?.text || "";
    })
    .filter(Boolean);
  return chunks.join("\n").trim();
};

const fetchWebSearchSummary = async (query: string, opts?: { timeoutMs?: number }) => {
  if (!OPENAI_API_KEY || !query) return null;
  const timeoutMs = Math.max(1200, Math.min(Number(opts?.timeoutMs) || STUDYLAB_WEB_SEARCH_TIMEOUT_MS, 30000));
  const tools = ["web_search", "web_search_preview"];
  const model = STUDYLAB_DEFAULT_CHAT_MODEL;
  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: "Use a ferramenta de pesquisa na web UMA vez e então responda com um resumo objetivo (6 a 10 bullets) + fontes (3 a 6 links) no fim. Seja direto.",
        },
      ],
    },
    { role: "user", content: [{ type: "input_text", text: query }] },
  ];

  for (const tool of tools) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          input,
          tools: [{ type: tool }],
          tool_choice: { type: tool },
          max_tool_calls: 1,
          text: { verbosity: "low" },
          reasoning: { effort: "low" },
          max_output_tokens: 900,
        }),
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        const msg = json?.error?.message || json?.message || "";
        if (/tool|web_search|unknown|invalid/i.test(msg)) {
          continue;
        }
        return null;
      }
      const output = Array.isArray(json?.output) ? json.output : [];
      const usedTool = output.some((o: any) => o?.type === "web_search_call");
      if (!usedTool) continue;
      const text = collectOutputText(json);
      if (text) return { text, tool };
    } catch {
      // ignore and try fallback
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
};

const normalizeHashtagTag = (raw: string) => {
  const base = String(raw || "").trim().replace(/^#+/, "");
  if (!base) return "";
  const ascii = base
    .normalize("NFD")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0300-\u036f]/g, "");
  const cleaned = ascii.replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  if (cleaned.length < 3 || cleaned.length > 50) return "";
  return cleaned;
};

const extractHashtagsFromText = (text: string) => {
  const matches = Array.from(String(text || "").matchAll(/#([A-Za-z0-9_.-]+)/g)).map((m) => m[1]);
  const tags = matches.map(normalizeHashtagTag).filter(Boolean);
  return Array.from(new Set(tags)).slice(0, 24);
};

const mergeHashtags = (...groups: Array<string[] | null | undefined>) => {
  const out = new Set<string>();
  for (const group of groups) {
    for (const raw of group || []) {
      const tag = normalizeHashtagTag(raw);
      if (tag) out.add(tag);
    }
  }
  return Array.from(out).slice(0, 24);
};

const normalizeAttachment = (raw: any) => {
  if (!raw) return null;
  if (typeof raw === "string") {
    const url = raw.trim();
    return url ? { url } : null;
  }
  const url = String(raw?.url || raw?.publicUrl || "").trim();
  if (!url) return null;
  const name = String(raw?.name || raw?.filename || raw?.label || "").trim();
  const mime = String(raw?.mime || raw?.type || "").trim();
  const size = Number(raw?.size || 0) || 0;
  return { url, name, mime, size };
};

const uniqueAttachments = (items: any[]) => {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const item of items) {
    const url = String(item?.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...item, url });
  }
  return out;
};

const buildChatTitle = (messages: any[]) => {
  const firstUser = (messages || []).find((m) => m?.role === "user" && typeof m?.content === "string");
  const raw = String(firstUser?.content || "").trim();
  if (!raw) return "Conversa StudyLab";
  return raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
};

const buildChatSummary = (question: string, answer: string) => {
  const base = String(answer || question || "").trim();
  if (!base) return "";
  return base.length > 220 ? `${base.slice(0, 217)}...` : base;
};

const buildTranscript = (messages: any[], attachments: any[]) => {
  const parts = (messages || [])
    .map((m) => {
      const role = m?.role === "assistant" ? "Assistente" : "Usuário";
      const content = String(m?.content || "").trim();
      if (!content) return "";
      return `${role}:\n${content}`;
    })
    .filter(Boolean);
  const attachmentList = (attachments || [])
    .map((att: any) => String(att?.url || "").trim())
    .filter(Boolean);
  if (attachmentList.length) {
    parts.push(`Anexos:\n${attachmentList.join("\n")}`);
  }
  const joined = parts.join("\n\n").trim();
  return joined.length > 40000 ? `${joined.slice(0, 39900)}...` : joined;
};


const normalizeOutlineNode = (node: any): any | null => {
  if (!node) return null;
  if (typeof node === "string") {
    const title = node.trim();
    return title ? { title } : null;
  }
  const title = String(node.title || node.heading || node.name || "").trim();
  if (!title) return null;
  const rawChildren = Array.isArray(node.children)
    ? node.children
    : Array.isArray(node.items)
      ? node.items
      : [];
  const children = rawChildren
    .map((child: any) => normalizeOutlineNode(child))
    .filter(Boolean)
    .slice(0, 12);
  return children.length ? { title, children } : { title };
};

const normalizeOutline = (raw: any) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((node) => normalizeOutlineNode(node)).filter(Boolean).slice(0, 20);
};

const normalizeQuestions = (raw: any) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const q of raw) {
    const question = String(q?.question || q?.pergunta || "").trim();
    if (!question) continue;
    const rawOptions = Array.isArray(q?.options)
      ? q.options
      : Array.isArray(q?.alternativas)
        ? q.alternativas
        : [];
    const answerIndexRaw = Number.isFinite(Number(q?.answer_index)) ? Number(q.answer_index) : -1;
    const correctText = String(q?.correct || q?.correta || "").trim();
    const options = rawOptions
      .map((opt: any, idx: number) => {
        if (typeof opt === "string") {
          const text = opt.trim();
          return text
            ? {
                text,
                is_correct: idx === answerIndexRaw,
                explanation: String(q?.explanation || q?.explicacao || "").trim(),
              }
            : null;
        }
        const text = String(opt?.text || opt?.option || opt?.alternativa || "").trim();
        if (!text) return null;
        const isCorrect =
          Boolean(opt?.is_correct) ||
          Boolean(opt?.correct) ||
          (answerIndexRaw >= 0 ? idx === answerIndexRaw : false);
        return {
          text,
          is_correct: isCorrect,
          explanation: String(opt?.explanation || opt?.explicacao || q?.explanation || q?.explicacao || "").trim(),
        };
      })
      .filter(Boolean)
      .slice(0, 6);

    if (correctText && !options.some((opt: any) => opt.text === correctText)) {
      options.unshift({
        text: correctText,
        is_correct: true,
        explanation: String(q?.explanation || q?.explicacao || "").trim(),
      });
    }

    const cleanedOptions = options
      .map((opt: any, idx: number) => ({
        ...opt,
        text: String(opt.text || "").trim(),
        explanation: String(opt.explanation || "").trim(),
        is_correct: Boolean(opt.is_correct),
        order: idx,
      }))
      .filter((opt: any) => opt.text.length >= 2)
      .slice(0, 5);

    const hasCorrect = cleanedOptions.some((opt: any) => opt.is_correct);
    if (!hasCorrect && cleanedOptions.length) cleanedOptions[0].is_correct = true;
    if (cleanedOptions.length < 2) continue;

    out.push({
      question_text: question,
      options: cleanedOptions.map(({ text, is_correct, explanation }: any) => ({
        text,
        is_correct,
        explanation,
      })),
      answer_index: cleanedOptions.findIndex((opt: any) => opt.is_correct),
      explanation: String(q?.explanation || q?.explicacao || "").trim(),
      difficulty: String(q?.difficulty || q?.nivel || "basico").trim().toLowerCase(),
    });
  }
  return out.slice(0, 12);
};

const replaceStudySourceHashtags = async (admin: any, sourceId: string, tags: string[]) => {
  if (!admin || !sourceId || !tags.length) return;
  try {
    const { data, error } = await admin
      .from("forum_hashtags")
      .upsert(tags.map((tag) => ({ tag })), { onConflict: "tag" })
      .select("id, tag");
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return;
    const ids = rows.map((r: any) => r?.id).filter(Boolean);
    if (!ids.length) return;

    try {
      await admin.from("study_source_hashtags").delete().eq("source_id", sourceId);
    } catch {
      // ignore
    }

    await admin.from("study_source_hashtags").insert(
      ids.map((hashtag_id: string) => ({ source_id: sourceId, hashtag_id })),
    );
  } catch {
    // best-effort
  }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const t0 = Date.now();
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    const requestDeadlineMs = Math.max(45000, Math.min(59000, Number(process.env.STUDYLAB_REQUEST_DEADLINE_MS || 58000)));
    const timeLeftMs = () => Math.max(0, requestDeadlineMs - (Date.now() - t0));
    const WEB_RESERVE_FOR_OPENAI_MS = 42000;

    const admin =
      SUPABASE_URL && SERVICE_KEY
        ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
        : null;

    const {
      messages = [],
      question = "",
      source_id = null,
      session_id = null,
      attachments = [],
      language = "pt-BR",
      mode = "study",
      save_compendium = false,
      quality = "auto",
      kb_tags = [],
      kb_focus = "",
      use_web = false,
    } = req.body || {};
    const qualityKey = String(quality || "auto").toLowerCase();
    const allowDevIngest =
      mode === "ingest" &&
      process.env.DJT_ALLOW_DEV_INGEST === "1" &&
      process.env.NODE_ENV !== "production" &&
      process.env.VERCEL_ENV !== "production";

    const forumKbTagsRaw = Array.isArray(kb_tags)
      ? kb_tags
      : typeof kb_tags === "string"
        ? kb_tags.split(",")
        : [];
    const forumKbTags = Array.from(
      new Set(
        forumKbTagsRaw
          .map((t: any) => (t ?? "").toString().trim().replace(/^#+/, "").toLowerCase())
          .filter((t: string) => t.length > 0),
      ),
    ).slice(0, 24);
    const forumKbFocus = (kb_focus || "").toString().trim().slice(0, 140);

    const rawAttachments = Array.isArray(attachments) ? attachments : [attachments];
    const normalizedAttachments = uniqueAttachments(
      rawAttachments.map((att) => normalizeAttachment(att)).filter(Boolean) as any[],
    ).slice(0, 5);

    let joinedContext = "";
    let sourceRow: any = null;
    let lastUserText = "";
    let usedWebSummary = false;
    let oracleBestScore = 0;
    let usedOracleSourcesCount = 0;
    let usedOracleCompendiumCount = 0;
    const stripHtml = (html: string) =>
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const fetchUrlContent = async (rawUrl: string) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(rawUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`Falha ao abrir URL (${resp.status})`);
        const text = await resp.text();
        return stripHtml(text).slice(0, 20000);
      } catch (err: any) {
        throw new Error(err?.message || "Não foi possível ler a URL fornecida");
      }
    };

    // Resolve authenticated user (opcional, para checar permissão e escopo)
    let uid: string | null = null;
    let isLeaderOrStaff = false;
    const authHeader = req.headers["authorization"] as string | undefined;
    if (admin && authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const { data: userData } = await admin.auth.getUser(token);
        uid = userData?.user?.id || null;
      } catch {
        uid = null;
      }
      if (uid) {
        try {
          const [{ data: profile }, { data: rolesRows }] = await Promise.all([
            admin.from("profiles").select("studio_access, is_leader").eq("id", uid).maybeSingle(),
            admin.from("user_roles").select("role").eq("user_id", uid),
          ]);
          const roleSet = new Set((rolesRows || []).map((r: any) => String(r?.role || "").trim()).filter(Boolean));
          const STAFF = new Set(["admin", "gerente_djt", "gerente_divisao_djtx", "coordenador_djtx", "content_curator", "lider_equipe"]);
          isLeaderOrStaff = Boolean(profile?.studio_access) || Boolean(profile?.is_leader) || Array.from(roleSet).some((r) => STAFF.has(r));
        } catch {
          isLeaderOrStaff = false;
        }
      }
    }

    const inferExt = (rawUrl: string) => {
      const clean = String(rawUrl || "").split("?")[0].split("#")[0];
      const i = clean.lastIndexOf(".");
      if (i === -1) return "";
      return clean.slice(i + 1).toLowerCase();
    };

    const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"]);
    const isImageAttachment = (att: any) => {
      const candidate = String(att?.name || att?.url || "");
      const ext = inferExt(candidate);
      return IMAGE_EXTS.has(ext);
    };
    const promptImageAttachments = normalizedAttachments.filter(isImageAttachment).slice(0, 2);
    let includeImagesInPrompt = promptImageAttachments.length > 0;

    const fetchBinary = async (rawUrl: string) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const resp = await fetch(rawUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`Falha ao baixar arquivo (${resp.status})`);
      const ab = await resp.arrayBuffer();
      const contentType = resp.headers.get("content-type") || "";
      return { buffer: Buffer.from(ab), contentType };
    };

    const buildPromptImageInputs = async (attachments: any[]) => {
      const items: Array<{ type: "input_image"; image_url: string }> = [];
      for (const att of attachments) {
        const url = String(att?.url || "").trim();
        if (!url) continue;
        if (url.startsWith("data:")) {
          items.push({ type: "input_image", image_url: url });
          continue;
        }
        try {
          const { buffer, contentType } = await fetchBinary(url);
          if (buffer.length > STUDYLAB_INLINE_IMAGE_BYTES) {
            items.push({ type: "input_image", image_url: url });
            continue;
          }
          const mime = contentType || `image/${inferExt(url) || "jpeg"}`;
          const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
          items.push({ type: "input_image", image_url: dataUrl });
        } catch {
          items.push({ type: "input_image", image_url: url });
        }
      }
      return items;
    };

    const extractFromFileUrl = async (rawUrl: string, hint = "") => {
      const { buffer, contentType } = await fetchBinary(rawUrl);
      const ext = inferExt(rawUrl);
      const mime = contentType || "";

      if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(ext)) {
        const ocr = await extractImageTextWithAi({
          buffer,
          mime: mime || `image/${ext || "jpeg"}`,
          hint,
          openaiKey: OPENAI_API_KEY,
        });
        if (!ocr.ok) throw new Error(ocr.error);
        return [ocr.description, ocr.text].filter(Boolean).join("\n\n").trim();
      }

      if (ext === "pdf" || mime.includes("pdf")) {
        const text = await extractPdfText(buffer);
        if (text && text.length >= 120) return text.slice(0, 20000);
        // PDF escaneado: retorna aviso + link
        return (
          "Observação: este PDF parece escaneado (sem texto selecionável). " +
          "Se possível, envie as páginas como imagens (JPG/PNG) para OCR.\n\n" +
          `Link do arquivo: ${rawUrl}`
        );
      }

      if (ext === "docx" || mime.includes("wordprocessingml")) {
        const text = await extractDocxText(buffer);
        return text.slice(0, 20000);
      }

      if (ext === "json" || mime.includes("json")) {
        const text = extractJsonText(buffer);
        return text.slice(0, 20000);
      }

      if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheet") || mime.includes("excel")) {
        try {
          // Best-effort: transforma planilha em texto tabular (primeira aba)
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const xlsx = require("xlsx");
          const wb = xlsx.read(buffer, { type: "buffer" });
          const sheetName = wb.SheetNames?.[0];
          if (!sheetName) return "";
          const sheet = wb.Sheets[sheetName];
          const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
          const lines = (rows || []).slice(0, 200).map((r: any[]) => (r || []).slice(0, 24).join("\t"));
          return `Planilha: ${sheetName}\n` + lines.join("\n");
        } catch {
          return "";
        }
      }

      // Fallback texto puro (csv, txt, etc.)
      return extractPlainText(buffer).slice(0, 20000);
    };

    const buildAttachmentContext = async (attachments: any[]) => {
      const items = Array.isArray(attachments) ? attachments : [];
      if (!items.length) return "";
      const parts: string[] = [];
      for (let idx = 0; idx < items.length; idx += 1) {
        const att = items[idx];
        const url = String(att?.url || "").trim();
        if (!url) continue;
        const label = String(att?.name || `Anexo ${idx + 1}`).trim() || `Anexo ${idx + 1}`;
        if (includeImagesInPrompt && isImageAttachment(att)) {
          parts.push(`### ${label}\n[Imagem enviada para interpretação direta pela IA]`);
          continue;
        }
        try {
          const text = await extractFromFileUrl(url, label);
          const trimmed = String(text || "").trim();
          if (trimmed) {
            const clipped = trimmed.length > 3500 ? `${trimmed.slice(0, 3400)}...` : trimmed;
            parts.push(`### ${label}\n${clipped}`);
          } else {
            parts.push(`### ${label}\n[Sem texto extraível]`);
          }
        } catch (err: any) {
          parts.push(`### ${label}\n[Erro ao ler anexo: ${err?.message || "falha"}]`);
        }
      }
      return parts.join("\n\n").trim();
    };

    if (admin && source_id) {

      const selectV2 =
        "id, user_id, title, summary, full_text, url, kind, topic, category, metadata, scope, published, ingest_status, ingest_error, ingested_at";
      const selectV1 = "id, user_id, title, summary, full_text, url, ingest_status, ingest_error, ingested_at";

      let sourceRes = await admin.from("study_sources").select(selectV2).eq("id", source_id).maybeSingle();
      if (sourceRes.error && /column .*?(category|metadata)/i.test(String(sourceRes.error.message || sourceRes.error))) {
        sourceRes = await admin.from("study_sources").select(selectV1).eq("id", source_id).maybeSingle();
      }
      sourceRow = sourceRes.data || null;

      if (sourceRow) {
        const scope = (sourceRow.scope || "user").toString().toLowerCase();
        const published = Boolean(sourceRow.published);
        const canRead =
          allowDevIngest ||
          Boolean(uid && sourceRow.user_id && sourceRow.user_id === uid) ||
          (scope === "org" && (published || isLeaderOrStaff));
        if (canRead) {
          let baseText = (sourceRow.full_text || sourceRow.summary || sourceRow.url || "").toString();

          // Enriquecer contexto garantindo que URLs tenham texto otimizado
          if (!sourceRow.full_text && sourceRow.url && sourceRow.url.startsWith("http")) {
            try {
              const isFile =
                String(sourceRow.kind || "").toLowerCase() === "file" ||
                /\.(pdf|docx|xlsx|xls|csv|txt|json|png|jpe?g|webp)(\?|#|$)/i.test(String(sourceRow.url || ""));

              const fetched = isFile ? await extractFromFileUrl(sourceRow.url, sourceRow.title || "") : await fetchUrlContent(sourceRow.url);
              if (fetched?.trim()) {
                baseText = fetched;
                // Persistir para próximas consultas
                await admin
                  .from("study_sources")
                  .update({
                    full_text: fetched,
                    ingest_status: "ok",
                    ingested_at: new Date().toISOString(),
                    ingest_error: null,
                  })
                  .eq("id", source_id);
              }
            } catch {
              /* não bloqueia resposta; segue com o que tiver */
            }
          }

          if (baseText.trim()) {
            const category = (sourceRow.category || "").toString().trim().toUpperCase();
            const meta = sourceRow.metadata && typeof sourceRow.metadata === "object" ? sourceRow.metadata : null;
            const incident = meta?.incident && typeof meta.incident === "object" ? meta.incident : null;
            const aiIncident = meta?.ai?.incident && typeof meta.ai.incident === "object" ? meta.ai.incident : null;
            const metaParts: string[] = [];
            if (category) metaParts.push(`Tipo no catálogo: ${category}`);
            if (incident) {
              metaParts.push(
                `Formulário (Relatório de Ocorrência):\n` +
                  `- ocorrido: ${(incident.ocorrido || "").toString().slice(0, 500)}\n` +
                  `- causa_raiz_modo_falha: ${(incident.causa_raiz_modo_falha || "").toString().slice(0, 500)}\n` +
                  `- barreiras_cuidados: ${(incident.barreiras_cuidados || "").toString().slice(0, 500)}\n` +
                  `- acoes_corretivas_preventivas: ${(incident.acoes_corretivas_preventivas || "").toString().slice(0, 500)}\n` +
                  `- mudancas_implementadas: ${(incident.mudancas_implementadas || "").toString().slice(0, 500)}`
              );
            }
            if (aiIncident) {
              const aprendizados = Array.isArray(aiIncident.aprendizados) ? aiIncident.aprendizados.slice(0, 8) : [];
              const cuidados = Array.isArray(aiIncident.cuidados) ? aiIncident.cuidados.slice(0, 8) : [];
              const mudancas = Array.isArray(aiIncident.mudancas) ? aiIncident.mudancas.slice(0, 8) : [];
              const aiLines: string[] = [];
              if (aprendizados.length) aiLines.push(`Aprendizados (IA): ${aprendizados.join(" | ")}`);
              if (cuidados.length) aiLines.push(`Cuidados/Barreiras (IA): ${cuidados.join(" | ")}`);
              if (mudancas.length) aiLines.push(`Mudanças (IA): ${mudancas.join(" | ")}`);
              if (aiLines.length) metaParts.push(aiLines.join("\n"));
            }

            joinedContext = `### Fonte: ${sourceRow.title}\n${baseText}${metaParts.length ? `\n\n### Metadados\n${metaParts.join("\n\n")}` : ""}`;
          }
        }
      }
    }

    const promptImageInputs = includeImagesInPrompt ? await buildPromptImageInputs(promptImageAttachments) : [];
    includeImagesInPrompt = promptImageInputs.length > 0;

    let attachmentContext = "";
    if (mode !== "ingest" && normalizedAttachments.length) {
      try {
        attachmentContext = await buildAttachmentContext(normalizedAttachments);
      } catch {
        attachmentContext = "";
      }
    }

    // Modo de ingestão: preparar e salvar texto/resumo no Supabase, sem responder chat
    if (mode === "ingest") {
      if (!admin || !source_id) {
        return res.status(400).json({ error: "Parâmetros inválidos para ingestão" });
      }

      if (!joinedContext) {
        // Mesmo fluxo acima já tentou buscar texto; se ainda estiver vazio, aborta silenciosamente
        return res.status(200).json({ success: true, ingested: false });
      }

      // joinedContext está no formato: "### Fonte: Título\n<texto>"
      const rawText = joinedContext.replace(/^### Fonte:[^\n]*\n/, "");
      const trimmed = rawText.trim();
      if (!trimmed) {
        return res.status(200).json({ success: true, ingested: false });
      }

      try {
        const preferPremiumIngest =
          sourceRow && String(sourceRow.scope || "").toLowerCase() === "org" && sourceRow.published !== false;
        const model = chooseModel(preferPremiumIngest);

        const allowedTopics = [
          "LINHAS",
          "SUBESTACOES",
          "PROCEDIMENTOS",
          "PROTECAO",
          "AUTOMACAO",
          "TELECOM",
          "SEGURANCA_DO_TRABALHO",
        ];
        const allowedCategories = [
          "MANUAIS",
          "PROCEDIMENTOS",
          "APOSTILAS",
          "RELATORIO_OCORRENCIA",
          "AUDITORIA_INTERNA",
          "AUDITORIA_EXTERNA",
          "OUTROS",
        ];

        const category = (sourceRow?.category || "").toString().trim().toUpperCase();
        const supportsMetadata = Boolean(sourceRow && Object.prototype.hasOwnProperty.call(sourceRow, "metadata"));
        const prevMeta = supportsMetadata && sourceRow?.metadata && typeof sourceRow.metadata === "object" ? sourceRow.metadata : null;
        const incident = prevMeta?.incident && typeof prevMeta.incident === "object" ? prevMeta.incident : null;
        const isIncident = Boolean(incident);

        const incidentContext =
          isIncident && incident
            ? `### Respostas do formulário (Relatório de Ocorrência)\n` +
              `- ocorrido: ${(incident.ocorrido || "").toString().slice(0, 800)}\n` +
              `- causa_raiz_modo_falha: ${(incident.causa_raiz_modo_falha || "").toString().slice(0, 800)}\n` +
              `- barreiras_cuidados: ${(incident.barreiras_cuidados || "").toString().slice(0, 800)}\n` +
              `- acoes_corretivas_preventivas: ${(incident.acoes_corretivas_preventivas || "").toString().slice(0, 800)}\n` +
              `- mudancas_implementadas: ${(incident.mudancas_implementadas || "").toString().slice(0, 800)}\n\n`
            : "";

        const materialFileName = (() => {
          const sp = String(sourceRow?.storage_path || "").trim();
          if (!sp) return "";
          const name = sp.split("/").pop() || "";
          return name;
        })();
        const materialHost = (() => {
          const u = String(sourceRow?.url || "").trim();
          if (!u) return "";
          try {
            return new URL(u).hostname.replace(/^www\./, "");
          } catch {
            return "";
          }
        })();
        const materialHints = [
          sourceRow?.title ? `Título atual: ${String(sourceRow.title).slice(0, 140)}` : "",
          sourceRow?.kind ? `Tipo: ${String(sourceRow.kind)}` : "",
          materialHost ? `Host: ${materialHost}` : "",
          materialFileName ? `Arquivo: ${materialFileName}` : "",
          category ? `Categoria atual (se houver): ${category}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const baseMaterial = trimmed.slice(0, 9000);
        const userContent = isIncident
          ? "Leia o conteúdo abaixo e responda APENAS em JSON válido no formato:\n" +
            "{\n" +
            '  "title": "...",\n' +
            '  "subtitle": "...",\n' +
            '  "summary": "...",\n' +
            '  "category": "MANUAIS",\n' +
            '  "topic": "LINHAS",\n' +
            '  "hashtags": ["#tag1", "#tag2"],\n' +
            '  "outline": [{"title": "Seção 1", "children": [{"title": "Subseção"}]}],\n' +
            '  "questions": [{"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "explanation": "...", "difficulty": "basico"}],\n' +
            '  "aprendizados": ["..."],\n' +
            '  "cuidados": ["..."],\n' +
            '  "mudancas": ["..."]\n' +
            "}\n\n" +
            "- title: título curto e específico (6 a 12 palavras). Evite títulos genéricos.\n" +
            "- subtitle: 1 frase curta com escopo e público-alvo (não repita o título).\n" +
            "- summary: 2 a 4 frases, em português.\n" +
            `- category: escolha UMA categoria entre: ${allowedCategories.join(", ")}.\n` +
            `- topic: escolha UMA categoria entre: ${allowedTopics.join(", ")}.\n` +
            "- hashtags: 4 a 8 hashtags curtas (sem espaços), use termos do material.\n" +
            "- outline: 4 a 10 subtítulos, até 3 níveis (use [] se não fizer sentido).\n" +
            "- questions: 4 a 8 perguntas com 4 alternativas (use [] se o material for insuficiente).\n" +
            "- aprendizados/cuidados/mudancas: 3 a 7 itens cada (use [] se não tiver evidência no texto/formulário).\n" +
            "- NÃO invente detalhes que não estejam no material ou no formulário.\n\n" +
            (materialHints ? `### Contexto do item\n${materialHints}\n\n` : "") +
            incidentContext +
            "### Material\n" +
            baseMaterial
          : "Leia o material abaixo e responda APENAS em JSON válido no formato:\n" +
            "{\n" +
            '  "title": "...",\n' +
            '  "subtitle": "...",\n' +
            '  "summary": "...",\n' +
            '  "category": "MANUAIS",\n' +
            '  "topic": "LINHAS",\n' +
            '  "hashtags": ["#tag1", "#tag2"],\n' +
            '  "outline": [{"title": "Seção 1", "children": [{"title": "Subseção"}]}],\n' +
            '  "questions": [{"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "explanation": "...", "difficulty": "basico"}]\n' +
            "}\n\n" +
            "- title: título curto e específico (6 a 12 palavras), sem siglas de GED.\n" +
            "- subtitle: 1 frase curta com escopo e público-alvo (não repita o título).\n" +
            "- summary: 2 a 4 frases, em português, destacando o que o material cobre e como usar.\n" +
            `- category: escolha UMA categoria entre: ${allowedCategories.join(", ")}.\n` +
            `- topic: escolha UMA categoria entre: ${allowedTopics.join(", ")}.\n` +
            "- hashtags: 4 a 8 hashtags curtas (sem espaços), use termos do material.\n" +
            "- outline: 4 a 10 subtítulos, até 3 níveis (use [] se não fizer sentido).\n" +
            "- questions: 4 a 8 perguntas com 4 alternativas (use [] se o material for insuficiente).\n\n" +
            "- Critério de qualidade: o título/subtítulo devem diferenciar este material de outros (use termos, equipamentos, tensão, norma, procedimento, local ou fabricante se existirem no texto).\n" +
            "- NÃO invente dados (especialmente modelo/fabricante) se não houver evidência no material.\n\n" +
            (materialHints ? `### Contexto do item\n${materialHints}\n\n` : "") +
            baseMaterial;

        const wantsStrictJson = !/^gpt-5/i.test(String(model || ""));
        const requestBody: any = {
          model,
          messages: [
            {
              role: "system",
              content:
                isIncident
                  ? "Você é um bibliotecário técnico: resume e extrai aprendizados de Relatórios de Ocorrência no setor elétrico (CPFL). Gere título, subtítulo, resumo, tema, aprendizados, cuidados e mudanças com linguagem clara e pesquisável."
                  : "Você é um bibliotecário técnico: renomeia e classifica materiais de estudo técnicos (setor elétrico CPFL). Gere título, subtítulo, resumo, tema e tags de forma pesquisável e específica.",
            },
            {
              role: "user",
              content: userContent,
            },
          ],
          max_completion_tokens: isIncident ? 650 : 420,
        };
        if (wantsStrictJson) {
          requestBody.response_format = { type: "json_object" };
        }

        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => `HTTP ${resp.status}`);
          console.warn("Study ingest OpenAI error", txt);
          try {
            await admin
              .from("study_sources")
              .update({
                full_text: trimmed,
                ingest_status: "failed",
                ingest_error: `OpenAI error: ${txt}`.slice(0, 900),
                ingested_at: new Date().toISOString(),
              })
              .eq("id", source_id);
          } catch {}
          return res.status(200).json({ success: false, error: `OpenAI error: ${txt}` });
        } else {
          const data = await resp.json().catch(() => null);
          const content = data?.choices?.[0]?.message?.content || "";
          const tryParse = (raw: string) => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          };
          const repairJson = async (raw: string) => {
            try {
              const repairModel = chooseModel(false);
              const repairBody: any = {
                model: repairModel,
                max_completion_tokens: 400,
                messages: [
                  {
                    role: "system",
                    content:
                      "Você corrige JSON malformado e devolve APENAS um JSON válido seguindo o mesmo esquema esperado.",
                  },
                  {
                    role: "user",
                    content: raw.slice(0, 6000),
                  },
                ],
              };
              if (!/^gpt-5/i.test(String(repairModel || ""))) {
                repairBody.response_format = { type: "json_object" };
              }
              const repairResp = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify(repairBody),
              });
              if (!repairResp.ok) return null;
              const repairData = await repairResp.json().catch(() => null);
              const repairContent = repairData?.choices?.[0]?.message?.content || "";
              let repaired = tryParse(repairContent);
              if (!repaired) {
                const match = repairContent.match?.(/\{[\s\S]*\}/);
                if (match) repaired = tryParse(match[0]);
              }
              return repaired;
            } catch {
              return null;
            }
          };
          let parsed: any = tryParse(content);
          if (!parsed) {
            const match = content.match?.(/\{[\s\S]*\}/);
            if (match) parsed = tryParse(match[0]);
          }
          if (!parsed && content) {
            parsed = await repairJson(content);
          }

          if (!parsed || typeof parsed !== "object") {
            try {
              await admin
                .from("study_sources")
                .update({
                  full_text: trimmed,
                  ingest_status: "failed",
                  ingest_error: "Resposta inválida da IA (JSON não parseável).",
                })
                .eq("id", source_id);
            } catch {}
            return res.status(200).json({ success: false, error: "Resposta inválida da IA (JSON não parseável)." });
          }

          const newTitle = typeof parsed?.title === "string" ? parsed.title.trim() : null;
          const newSubtitle = typeof parsed?.subtitle === "string" ? parsed.subtitle.trim() : null;
          const newSummary = typeof parsed?.summary === "string" ? parsed.summary.trim() : null;
          const topicRaw = typeof parsed?.topic === "string" ? parsed.topic.toUpperCase().trim() : null;
          const topic = topicRaw && allowedTopics.includes(topicRaw) ? topicRaw : null;
          const categoryRaw = typeof parsed?.category === "string" ? parsed.category.toUpperCase().trim() : null;
          const nextCategory = categoryRaw && allowedCategories.includes(categoryRaw) ? categoryRaw : null;
          const finalCategory = isIncident ? "RELATORIO_OCORRENCIA" : nextCategory;
          const outline = normalizeOutline(parsed?.outline);
          const questions = normalizeQuestions(parsed?.questions);

          const aprendizados = Array.isArray(parsed?.aprendizados)
            ? parsed.aprendizados.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
            : [];
          const cuidados = Array.isArray(parsed?.cuidados)
            ? parsed.cuidados.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
            : [];
          const mudancas = Array.isArray(parsed?.mudancas)
            ? parsed.mudancas.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
            : [];

          const aiTags = Array.isArray(parsed?.hashtags)
            ? parsed.hashtags.map((x: any) => String(x || "").trim()).filter(Boolean)
            : [];
          const explicitTags = extractHashtagsFromText([newTitle, newSummary, trimmed].filter(Boolean).join(" "));
          const topicTag = topic ? normalizeHashtagTag(topic) : "";
          const prevTags = Array.isArray(prevMeta?.tags) ? prevMeta.tags : [];
          const mergedTags = mergeHashtags(
            prevTags,
            aiTags,
            explicitTags,
            topicTag ? [topicTag] : [],
          );

          const nextMeta = supportsMetadata
            ? {
                ...(prevMeta && typeof prevMeta === "object" ? prevMeta : {}),
                ...(mergedTags.length ? { tags: mergedTags } : {}),
                ...(newSubtitle ? { subtitle: newSubtitle } : {}),
                ai: {
                  ...((prevMeta && typeof prevMeta === "object" ? prevMeta.ai : null) || {}),
                  ingested_at: new Date().toISOString(),
                  ...(topic ? { topic } : {}),
                  ...(finalCategory ? { category: finalCategory } : {}),
                  ...(mergedTags.length ? { tags: mergedTags } : {}),
                  ...(outline.length ? { outline } : {}),
                  ...(newSubtitle ? { subtitle: newSubtitle } : {}),
                  ...(isIncident
                    ? {
                        incident: {
                          ...(prevMeta?.ai?.incident || {}),
                          ...(aprendizados.length ? { aprendizados } : {}),
                          ...(cuidados.length ? { cuidados } : {}),
                          ...(mudancas.length ? { mudancas } : {}),
                        },
                      }
                    : {}),
                },
              }
            : null;

          await admin
            .from("study_sources")
            .update({
              full_text: trimmed,
              ingest_status: "ok",
              ingested_at: new Date().toISOString(),
              ingest_error: null,
              ...(newTitle ? { title: newTitle } : {}),
              ...(newSummary ? { summary: newSummary } : {}),
              ...(topic ? { topic } : {}),
              ...(finalCategory ? { category: finalCategory } : {}),
              ...(nextMeta ? { metadata: nextMeta } : {}),
            })
            .eq("id", source_id);

          if (mergedTags.length) {
            await replaceStudySourceHashtags(admin, source_id, mergedTags);
          }

          if (questions.length) {
            try {
              await admin.from("study_source_questions").delete().eq("source_id", source_id);
              await admin.from("study_source_questions").insert(
                questions.map((q: any) => ({
                  source_id,
                  question_text: q.question_text,
                  options: q.options,
                  answer_index: q.answer_index,
                  explanation: q.explanation || null,
                  difficulty: q.difficulty || "basico",
                  tags: mergedTags,
                })),
              );
            } catch {
              // best-effort
            }
          }

          return res.status(200).json({
            success: true,
            ingested: true,
            title: newTitle,
            subtitle: newSubtitle,
            summary: newSummary,
            topic,
            ...(isIncident ? { aprendizados, cuidados, mudancas } : {}),
          });
        }
      } catch (e: any) {
        console.warn("Study ingest error", e?.message || e);
        try {
          await admin
            .from("study_sources")
            .update({
              ingest_status: "failed",
              ingest_error: e?.message || e?.toString?.() || "Erro ao ingerir material",
            })
            .eq("id", source_id);
        } catch {}
      }

      return res.status(200).json({ success: true, ingested: true });
    }

    // Modo padrão de chat de estudos
    const normalizedMessages = normalizeIncomingMessages(messages);
    if (normalizedMessages.length === 0 && typeof question === "string" && question.trim()) {
      normalizedMessages.push({ role: "user", content: question.trim() });
    }

    if (!Array.isArray(normalizedMessages) || normalizedMessages.length === 0) {
      return res.status(400).json({ error: "Mensagens inválidas" });
    }

    const lastUserMsgForLog = normalizedMessages
      .slice()
      .reverse()
      .find((m: any) => m?.role === "user" && m?.content)?.content;
    if (lastUserMsgForLog) {
      lastUserText = String(lastUserMsgForLog || "");
    }

    const focusHint = forumKbFocus
      ? `\n\nFoco do usuário (temas da base de conhecimento): ${forumKbFocus}\n- Priorize esse foco ao responder e ao sugerir próximos passos.`
      : "";

    const langIsEn = String(language || "").toLowerCase().startsWith("en");
    const system =
      mode === "oracle"
        ? langIsEn
          ? `You are DJT Quest's Knowledge Catalog and training monitor.
You help collaborators find answers using the available internal base (published org catalog + the user's materials + approved compendium). When the base is insufficient, rely on the automated web summary (when present).

Rules:
- Do NOT ask questions. If a detail is missing, state assumptions and how to verify in the field.
- Be practical and instructive: steps, checks, safety notes when relevant.
- Do NOT fabricate manufacturer specs, model numbers, or procedures not present in the base/web summary. If you can't find it, say so.
- If “Automated web search (summary)” exists, use it and cite sources (links) at the end.
- When using the internal base, cite the source title briefly.
${focusHint}

Output format (plain text, no JSON):
1) Direct answer (short)
2) Steps / checklist
3) Safety / attention points (if applicable)
4) Sources (if any)

Answer in ${language}.`
          : `Você é o Catálogo de Conhecimento do DJT Quest e atua como monitor de treinamento.
Você ajuda colaboradores a encontrar respostas usando a base interna (catálogo publicado da organização + materiais do usuário + compêndio aprovado). Quando a base for insuficiente, use o resumo de pesquisa web (quando existir).

Regras:
- NÃO faça perguntas. Se faltar um detalhe, declare suposições e diga como validar em campo.
- Seja prático e instrutivo: passo a passo, checagens, pontos de segurança quando fizer sentido.
- NÃO invente especificações, dados de fabricantes/modelos ou procedimentos que não estejam na base/resumo web. Se não encontrar, diga que não encontrou.
- Se houver “Pesquisa web automatica (resumo)”, use-a e cite fontes (links) no fim.
- Quando usar a base interna, cite rapidamente o título da fonte.
${focusHint}

Formato da resposta (texto livre, sem JSON):
1) Resposta direta (curta)
2) Passo a passo / checklist
3) Pontos de atenção / segurança (se aplicável)
4) Fontes (se houver)

Responda em ${language}.`
        : langIsEn
          ? `You are a technical training tutor (Brazilian power sector context).
Use the selected material (when provided) and the uploaded attachments as primary evidence.

Rules:
- Do NOT ask questions. If a detail is missing, state assumptions and how to verify.
- Explain step-by-step, clear but technically accurate.
- When you rely on a specific material, say so explicitly (e.g., “Based on the selected document…”).
- Do NOT invent details that are not in the material/attachments.
${focusHint}

Output (plain text, no JSON), in ${language}.`
          : `Você é um tutor de estudos no contexto de treinamento técnico (setor elétrico brasileiro).
Use o material selecionado (quando houver) e os anexos enviados como evidência principal.

Regras:
- NÃO faça perguntas. Se faltar um detalhe, declare suposições e diga como validar.
- Explique passo a passo, com clareza e precisão técnica.
- Quando estiver usando um material específico, deixe explícito (ex.: “Com base no documento selecionado…”).
- NÃO invente detalhes que não estejam no material/anexos.
${focusHint}

Formato da saída: texto livre (sem JSON), em ${language}.`;

    const openaiMessages: any[] = [{ role: "system", content: system }];

    // Oracle: monta contexto com busca nas fontes + compêndio
    if (mode === "oracle" && admin) {
      const normalizedMessagesForQuery = normalizeIncomingMessages(messages);
      const lastUserMsg =
        (normalizedMessagesForQuery.slice().reverse().find((m: any) => m?.role === "user" && m?.content)?.content ||
          question ||
          "") + "";

      const text = lastUserMsg.toString();
      lastUserText = text;
      const normalizedQuery = normalizeForMatch(text);
      const incidentLikely =
        /\b(ocorrenc|ocorr|acident|inciden|seguranca|epi|nr\s*\d|cipa|quase\s+acident)\b/i.test(normalizedQuery);
      const stop = new Set([
        "de",
        "da",
        "do",
        "das",
        "dos",
        "a",
        "o",
        "as",
        "os",
        "e",
        "ou",
        "para",
        "por",
        "com",
        "sem",
        "em",
        "no",
        "na",
        "nos",
        "nas",
        "um",
        "uma",
        "que",
        "como",
        "qual",
        "quais",
        "quando",
        "onde",
        "porque",
        "porquê",
        "isso",
        "essa",
        "esse",
        "esta",
        "este",
      ]);
      const keywords = Array.from(
        new Set(
          text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .split(/\s+/)
            .map((w) => w.trim())
            .filter((w) => w.length >= 4 && !stop.has(w))
            .slice(0, 30)
        )
      ).slice(0, 8);

      // 1) Study sources (org + user)
      let sourcesForOracle: any[] = [];
      try {
        const selectV2 = "id, user_id, title, summary, url, topic, category, scope, published, metadata, created_at";
        const selectV1 = "id, user_id, title, summary, url, topic, created_at";
        const buildQuery = (select: string) => {
          const q = admin.from("study_sources").select(select).order("created_at", { ascending: false }).limit(80);
          if (uid) {
            if (isLeaderOrStaff) q.or(`user_id.eq.${uid},scope.eq.org`);
            else q.or(`user_id.eq.${uid},and(scope.eq.org,published.eq.true)`);
          } else {
            q.eq("scope", "org").eq("published", true);
          }
          return q;
        };
        let resp = await buildQuery(selectV2);
        let data = resp?.data;
        let error = resp?.error;
        if (error && /column .*?(category|scope|published|metadata)/i.test(String(error.message || error))) {
          resp = await buildQuery(selectV1);
          data = resp?.data;
          error = resp?.error;
        }
        if (error) throw error;
        sourcesForOracle = Array.isArray(data) ? data : [];
      } catch {
        sourcesForOracle = [];
      }

      const scoreText = (s: string, kws: string[]) => {
        const hay = String(s || "").toLowerCase();
        let score = 0;
        for (const k of kws) if (hay.includes(k)) score += 1;
        return score;
      };

      const rankedSourcesScored = sourcesForOracle
        .map((s) => {
          const hay = [s.title, s.summary, s.topic, s.category].filter(Boolean).join(" ");
          return { s, score: keywords.length ? scoreText(hay, keywords) : 0 };
        })
        .filter((x) => (keywords.length ? x.score > 0 : true))
        .sort((a, b) => b.score - a.score);
      const bestSourceScore = rankedSourcesScored[0]?.score || 0;
      const rankedSourcesBase = rankedSourcesScored.slice(0, 3).map((x) => x.s);

      // Fetch full_text only for top sources (to reduce payload/latency)
      const topSourceIds = rankedSourcesBase.map((s: any) => s?.id).filter(Boolean).slice(0, 3);
      const fullTextById = new Map<string, string>();
      if (topSourceIds.length) {
        try {
          const { data, error } = await admin.from("study_sources").select("id, full_text").in("id", topSourceIds as any);
          if (!error && Array.isArray(data)) {
            for (const row of data) {
              const id = String(row?.id || "").trim();
              const ft = String(row?.full_text || "").trim();
              if (id && ft) fullTextById.set(id, ft);
            }
          }
        } catch {
          // ignore
        }
      }
      const rankedSources = rankedSourcesBase.map((s: any) => {
        const id = String(s?.id || "").trim();
        return id ? { ...s, full_text: fullTextById.get(id) || "" } : s;
      });
      usedOracleSourcesCount = rankedSources.length;

      // 2) Compêndio de ocorrências (aprovadas)
      let compendium: any[] = [];
      if (incidentLikely) {
        try {
          const { data } = await admin
            .from("content_imports")
            .select("id, final_approved, created_at")
            .eq("status", "FINAL_APPROVED")
            .filter("final_approved->>kind", "eq", "incident_report")
            .order("created_at", { ascending: false })
            .limit(80);
          compendium = Array.isArray(data) ? data : [];
        } catch {
          compendium = [];
        }
      }

      const rankedCompendium = compendium
        .map((row) => {
          const cat = row?.final_approved?.catalog || row?.final_approved || {};
          const hay = [
            cat?.title,
            cat?.summary,
            cat?.asset_area,
            cat?.asset_type,
            cat?.asset_subtype,
            cat?.failure_mode,
            cat?.root_cause,
            ...(Array.isArray(cat?.keywords) ? cat.keywords : []),
            ...(Array.isArray(cat?.learning_points) ? cat.learning_points : []),
          ]
            .filter(Boolean)
            .join(" ");
          return { row, cat, score: keywords.length ? scoreText(hay, keywords) : 0 };
        })
        .filter((x) => (keywords.length ? x.score > 0 : true))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const bestCompendiumScore = rankedCompendium[0]?.score || 0;
      usedOracleCompendiumCount = rankedCompendium.length;

      // 3) Fórum (base por hashtags)
      let forumKbRows: any[] = [];
      if (forumKbTags.length) {
        try {
          const { data, error } = await admin
            .from("knowledge_base")
            .select("source_type, title, post_id, source_id, content, content_html, hashtags, likes_count, is_solution, is_featured, kind, url")
            .overlaps("hashtags", forumKbTags as any)
            .order("is_solution", { ascending: false })
            .order("likes_count", { ascending: false })
            .limit(120);
          if (error) throw error;
          forumKbRows = Array.isArray(data) ? data : [];
        } catch {
          try {
            const { data } = await admin
              .from("forum_knowledge_base")
              .select("title, post_id, content, content_html, hashtags, likes_count, is_solution, is_featured")
              .overlaps("hashtags", forumKbTags as any)
              .order("is_solution", { ascending: false })
              .order("likes_count", { ascending: false })
              .limit(120);
            forumKbRows = Array.isArray(data) ? data : [];
          } catch {
            forumKbRows = [];
          }
        }
      }

      const rankedForumKb = forumKbRows
        .map((row) => {
          const title = String(row?.title || "").trim();
          const raw = String(row?.content || "").trim();
          const html = String(row?.content_html || "").trim();
          const text = raw || (html ? stripHtml(html) : "");
          const hay = [title, text, ...(Array.isArray(row?.hashtags) ? row.hashtags : [])].filter(Boolean).join(" ");
          return { row, text, score: keywords.length ? scoreText(hay, keywords) : 0 };
        })
        .filter((x) => (keywords.length ? x.score > 0 : true))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);
      const bestForumScore = rankedForumKb[0]?.score || 0;
      oracleBestScore = Math.max(bestSourceScore, bestCompendiumScore, bestForumScore);

      const contextParts: string[] = [];
      if (attachmentContext) {
        contextParts.push(`### Anexos enviados\n${attachmentContext}`);
      }
      if (rankedSources.length) {
        contextParts.push(
          "### Catálogo de Estudos (trechos)\n" +
            rankedSources
              .map((s, idx) => {
                const title = String(s.title || `Fonte ${idx + 1}`);
                const summary = String(s.summary || "").trim();
                const text = String(s.full_text || "").trim();
                const excerpt = text ? text.slice(0, 900) : "";
                return (
                  `- ${title}\n` +
                  (summary ? `  Resumo: ${summary}\n` : "") +
                  (excerpt ? `  Trecho: ${excerpt}\n` : "") +
                  (s.url ? `  Link: ${s.url}\n` : "")
                );
              })
              .join("\n")
        );
      }

      if (rankedCompendium.length) {
        contextParts.push(
          "### Compêndio de Ocorrências (resumos)\n" +
            rankedCompendium
              .slice(0, 3)
              .map((x, idx) => {
                const cat = x.cat || {};
                const title = String(cat.title || `Ocorrência ${idx + 1}`);
                const summary = String(cat.summary || "").trim();
                const header = [
                  cat.asset_area ? `área: ${cat.asset_area}` : "",
                  cat.asset_type ? `ativo: ${cat.asset_type}` : "",
                  cat.failure_mode ? `falha: ${cat.failure_mode}` : "",
                  cat.root_cause ? `causa: ${cat.root_cause}` : "",
                ]
                  .filter(Boolean)
                  .join(" • ");
                const learn = Array.isArray(cat.learning_points) ? cat.learning_points.slice(0, 6) : [];
                return (
                  `- ${title}\n` +
                  (header ? `  ${header}\n` : "") +
                  (summary ? `  Resumo: ${summary}\n` : "") +
                  (learn.length ? `  Aprendizados: ${learn.join(" | ")}\n` : "")
                );
              })
              .join("\n")
        );
      }

      if (rankedForumKb.length) {
        contextParts.push(
          "### Base de Conhecimento (hashtags)\n" +
            rankedForumKb
              .map((x, idx) => {
                const row = x.row || {};
                const title = String(row.title || `Tópico ${idx + 1}`);
                const sourceType = String(row.source_type || "forum").toLowerCase();
                const hashtags = Array.isArray(row.hashtags) ? row.hashtags.slice(0, 8).map((h: any) => `#${h}`) : [];
                const flags = [
                  sourceType === "study" ? "StudyLab" : "",
                  row.is_solution ? "solução" : "",
                  row.is_featured ? "destaque" : "",
                  Number(row.likes_count || 0) > 0 ? `${Number(row.likes_count)} curtidas` : "",
                ]
                  .filter(Boolean)
                  .join(" • ");
                const excerpt = String(x.text || "").slice(0, 1600);
                return (
                  `- ${title}\n` +
                  (flags ? `  ${flags}\n` : "") +
                  (hashtags.length ? `  ${hashtags.join(" ")}\n` : "") +
                  (excerpt ? `  Trecho: ${excerpt}\n` : "")
                );
              })
              .join("\n")
        );
      }

      if (contextParts.length) {
        openaiMessages.push({
          role: "system",
          content: `A seguir está a base de conhecimento disponível para esta pergunta. Use-a como principal referência:\n\n${contextParts.join(
            "\n\n"
          )}`,
        });
      }
    } else {
      if (attachmentContext) {
        openaiMessages.push({
          role: "system",
          content: `A seguir estão anexos enviados nesta conversa. Use-os como contexto adicional:\n\n${attachmentContext}`,
        });
      }
      if (joinedContext) {
        openaiMessages.push({
          role: "system",
          content: `Abaixo estão os materiais de estudo do usuário. Use-os como base principal:\n\n${joinedContext}`,
        });
      }

      if (admin && forumKbTags.length) {
        try {
          let rows: any[] = [];
          try {
            const { data, error } = await admin
              .from("knowledge_base")
              .select("source_type, title, post_id, source_id, content, content_html, hashtags, likes_count, is_solution, is_featured, kind, url")
              .overlaps("hashtags", forumKbTags as any)
              .order("is_solution", { ascending: false })
              .order("likes_count", { ascending: false })
              .limit(8);
            if (error) throw error;
            rows = Array.isArray(data) ? data : [];
          } catch {
            const { data } = await admin
              .from("forum_knowledge_base")
              .select("title, post_id, content, content_html, hashtags, likes_count, is_solution, is_featured")
              .overlaps("hashtags", forumKbTags as any)
              .order("is_solution", { ascending: false })
              .order("likes_count", { ascending: false })
              .limit(8);
            rows = Array.isArray(data) ? data : [];
          }
          if (rows.length) {
            const context = rows
              .map((row, idx) => {
                const title = String(row?.title || `Tópico ${idx + 1}`);
                const sourceType = String(row?.source_type || "forum").toLowerCase();
                const raw = String(row?.content || "").trim();
                const html = String(row?.content_html || "").trim();
                const text = raw || (html ? stripHtml(html) : "");
                const hashtags = Array.isArray(row?.hashtags) ? row.hashtags.slice(0, 8).map((h: any) => `#${h}`) : [];
                const flags = [
                  sourceType === "study" ? "StudyLab" : "",
                  row?.is_solution ? "solução" : "",
                  row?.is_featured ? "destaque" : "",
                  Number(row?.likes_count || 0) > 0 ? `${Number(row.likes_count)} curtidas` : "",
                ]
                  .filter(Boolean)
                  .join(" • ");
                const excerpt = text ? text.slice(0, 1500) : "";
                return (
                  `- ${title}\n` +
                  (flags ? `  ${flags}\n` : "") +
                  (hashtags.length ? `  ${hashtags.join(" ")}\n` : "") +
                  (excerpt ? `  Trecho: ${excerpt}\n` : "")
                );
              })
              .join("\n");
            openaiMessages.push({
              role: "system",
              content: `A seguir estão trechos da base de conhecimento (hashtags) para usar como contexto adicional:\n\n${context}`,
            });
          }
        } catch {
          // ignore
        }
      }
    }

    const useWeb = Boolean(use_web);
    const webAllowed = use_web !== false;
    // Web search: automatically when the catalog match is weak (otherwise keep latency low).
    const shouldSearchWeb = mode === "oracle" && webAllowed && lastUserText && oracleBestScore < 2;
    if (shouldSearchWeb) {
      const webTimeout = Math.min(
        STUDYLAB_WEB_SEARCH_TIMEOUT_MS,
        Math.max(1500, timeLeftMs() - WEB_RESERVE_FOR_OPENAI_MS),
      );
      const webSummary = await fetchWebSearchSummary(lastUserText, { timeoutMs: webTimeout });
      if (webSummary?.text) {
        usedWebSummary = true;
        openaiMessages.push({
          role: "system",
          content: `Pesquisa web automatica (resumo):\n${webSummary.text}`,
        });
      }
    }

    if (mode === "oracle" && lastUserText && shouldInjectRules(lastUserText)) {
      openaiMessages.push({ role: "system", content: buildRulesContext() });
    }

    const modelMessages = normalizedMessages.slice(-STUDYLAB_HISTORY_LIMIT);
    const lastUserIndex = (() => {
      for (let i = modelMessages.length - 1; i >= 0; i -= 1) {
        if (modelMessages[i]?.role === "user") return i;
      }
      return -1;
    })();
    const attachmentOnlyPrompt = String(language || "").toLowerCase().startsWith("en")
      ? "Analyze the attached files and answer using the study context."
      : "Analise os anexos enviados e responda usando o contexto de estudo.";

    for (let i = 0; i < modelMessages.length; i += 1) {
      const m = modelMessages[i];
      if (!m || !m.role || !m.content) continue;
      const role = m.role === "assistant" ? "assistant" : "user";
      if (role === "user" && i === lastUserIndex && promptImageInputs.length) {
        const rawText = typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .map((item: any) =>
                  typeof item === "string"
                    ? item
                    : typeof item?.text === "string"
                      ? item.text
                      : typeof item?.content === "string"
                        ? item.content
                        : "",
                )
                .filter(Boolean)
                .join("\n")
            : "";
        const trimmedText = String(rawText || "").trim();
        const contentItems: any[] = [];
        contentItems.push({
          type: "input_text",
          text: trimmedText || attachmentOnlyPrompt,
        });
        contentItems.push(...promptImageInputs);
        openaiMessages.push({ role, content: contentItems });
      } else {
        openaiMessages.push({ role, content: m.content });
      }
    }

    const minimalOpenAiMessages = (() => {
      const systems = openaiMessages.filter((m) => m?.role === "system");
      const lastUser = [...openaiMessages].reverse().find((m) => m?.role === "user");
      if (lastUser) systems.push(lastUser);
      return systems.length ? systems : openaiMessages;
    })();

    const preferPremium =
      qualityKey === "thinking" ||
      mode === "oracle" ||
      useWeb ||
      (sourceRow && String(sourceRow.scope || "").toLowerCase() === "org" && sourceRow.published !== false);
    const fallbackModel = chooseModel(preferPremium);
    const baseCandidates = pickStudyLabChatModels(fallbackModel);
    const modelCandidates = (() => {
      if (qualityKey === "instant") {
        const preferred = "gpt-5-nano-2025-08-07";
        return uniqueStrings([preferred, ...baseCandidates]);
      }
      if (qualityKey === "thinking") {
        const preferred = "gpt-5-2025-08-07";
        return uniqueStrings([preferred, ...baseCandidates]);
      }
      return baseCandidates;
    })();
    const maxTokensBase =
      qualityKey === "thinking"
        ? Math.max(STUDYLAB_MAX_COMPLETION_TOKENS, 1200)
        : useWeb
          ? Math.max(STUDYLAB_MAX_COMPLETION_TOKENS, 900)
          : STUDYLAB_MAX_COMPLETION_TOKENS;
    let usedMaxTokens = maxTokensBase;

    let content = "";
    let usedModel = fallbackModel;
    let lastErrTxt = "";
    let aborted = false;
    let attempts = 0;
    let forceTextOnly = false;
    let useMinimalPrompt = false;
    const verbosity = mode === "oracle" || useWeb || includeImagesInPrompt ? "medium" : "low";
    const reasoningEffort = qualityKey === "thinking" ? "medium" : "low";
    const maxOutputCap = qualityKey === "thinking" ? 1600 : 1400;

    for (const model of modelCandidates) {
      let modelMaxTokens = maxTokensBase;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        // Avoid stacking multiple long attempts (can exceed serverless max duration).
        if (attempts >= (useWeb ? 2 : 3)) break;
        let resp: Response | null = null;
        try {
          attempts += 1;
          const promptMessages = useMinimalPrompt ? minimalOpenAiMessages : openaiMessages;
          const inputPayload = forceTextOnly
            ? toResponsesTextMessages(promptMessages)
            : toResponsesInputMessages(promptMessages);
          const openAiTimeout = Math.max(
            5000,
            Math.min(STUDYLAB_OPENAI_TIMEOUT_MS, timeLeftMs() - 1200),
          );
          resp = await callOpenAiResponse({
            model,
            input: inputPayload,
            text: { verbosity },
            reasoning: { effort: reasoningEffort },
            max_output_tokens: modelMaxTokens,
          }, openAiTimeout);
        } catch (e: any) {
          lastErrTxt = e?.message || "OpenAI request failed";
          if (isAbortError(e)) {
            if (!useMinimalPrompt) {
              useMinimalPrompt = true;
              continue;
            }
            aborted = true;
            break;
          }
          if (attempt === 0 && !useWeb) continue;
          break;
        }

        if (!resp.ok) {
          lastErrTxt = await resp.text().catch(() => `HTTP ${resp?.status}`);
          if (!forceTextOnly && /input_text.*output_text|output_text.*refusal|invalid value/i.test(lastErrTxt)) {
            forceTextOnly = true;
            continue;
          }
          if (isFatalOpenAiStatus(resp.status)) break;
          if (attempt === 0 && !useWeb) continue;
          break;
        }

        const data = await resp.json().catch(() => null);
        const incompleteReason = data?.incomplete_details?.reason;
        content = String(collectOutputText(data) || extractChatText(data) || "").trim();
        if (content) {
          usedModel = model;
          usedMaxTokens = modelMaxTokens;
          break;
        }
        if (incompleteReason === "max_output_tokens" && modelMaxTokens < maxOutputCap) {
          modelMaxTokens = Math.min(modelMaxTokens + 380, maxOutputCap);
          lastErrTxt = "OpenAI retornou resposta truncada";
          continue;
        }
        if (!useMinimalPrompt && attempt === 0 && !useWeb) {
          useMinimalPrompt = true;
          lastErrTxt = "OpenAI retornou resposta vazia";
          continue;
        }
        lastErrTxt = "OpenAI retornou resposta vazia";
        if (attempt === 0 && !useWeb) continue;
      }

      if (content) break;
      if (aborted) break;
    }

    if (!content) {
      return res.status(200).json({
        success: false,
        error: `OpenAI error: ${lastErrTxt || "unknown"}`,
        meta: {
          model_candidates: modelCandidates,
          used_web_summary: usedWebSummary,
          use_web: Boolean(use_web),
          oracle_best_score: oracleBestScore,
          aborted,
          attempts,
          timeout_ms: STUDYLAB_OPENAI_TIMEOUT_MS,
          max_output_tokens: usedMaxTokens,
          latency_ms: Date.now() - t0,
        },
      });
    }

    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());

    let resolvedSessionId =
      typeof session_id === "string" && session_id.trim() && isUuid(session_id.trim())
        ? session_id.trim()
        : null;
    if (!resolvedSessionId) {
      try {
        const crypto = require("crypto");
        resolvedSessionId = crypto?.randomUUID?.() || null;
      } catch {
        resolvedSessionId = null;
      }
      if (!resolvedSessionId) {
        // Fallback UUID v4 (avoid non-uuid values because the DB column is uuid).
        resolvedSessionId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = Math.floor(Math.random() * 16);
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }
    }

    if (admin && uid) {
      try {
        const logMessages = [...normalizedMessages, { role: "assistant", content }];
        const nowIso = new Date().toISOString();

        let sessionRow: any = null;
        try {
          const { data: existing } = await admin
            .from("study_chat_sessions")
            .select("id, attachments, title, compendium_source_id")
            .eq("id", resolvedSessionId)
            .maybeSingle();
          sessionRow = existing || null;
        } catch {
          sessionRow = null;
        }

        const mergedAttachments = uniqueAttachments([
          ...(Array.isArray(sessionRow?.attachments) ? sessionRow.attachments : []),
          ...normalizedAttachments,
        ]);

        const title = sessionRow?.title || buildChatTitle(logMessages);
        const summary = buildChatSummary(lastUserText || "", content);
        const metadata = {
          mode,
          source_id: source_id || null,
          use_web: Boolean(use_web),
          kb_tags: forumKbTags,
          kb_focus: forumKbFocus,
          model: usedModel,
        };

        const sessionPayload: any = {
          id: resolvedSessionId,
          user_id: uid,
          mode,
          source_id: source_id || null,
          title,
          summary,
          messages: logMessages,
          attachments: mergedAttachments,
          metadata,
          updated_at: nowIso,
        };

        if (sessionRow?.id) {
          await admin.from("study_chat_sessions").update(sessionPayload).eq("id", resolvedSessionId);
        } else {
          await admin.from("study_chat_sessions").insert({
            ...sessionPayload,
            created_at: nowIso,
          });
        }

        if (save_compendium) {
          const transcript = buildTranscript(logMessages, mergedAttachments);
          const compendiumMeta = {
            source: "study_chat",
            session_id: resolvedSessionId,
            attachments: mergedAttachments,
            mode,
            source_id: source_id || null,
            updated_at: nowIso,
          };

          const compendiumPayload: any = {
            user_id: uid,
            title,
            kind: "text",
            summary,
            full_text: transcript,
            ingest_status: "ok",
            ingested_at: nowIso,
            ingest_error: null,
            is_persistent: true,
            last_used_at: nowIso,
            category: "OUTROS",
            scope: "user",
            published: false,
            metadata: compendiumMeta,
          };

          let compendiumId = sessionRow?.compendium_source_id || null;
          if (compendiumId) {
            try {
              await admin
                .from("study_sources")
                .update({
                  summary,
                  full_text: transcript,
                  last_used_at: nowIso,
                  metadata: compendiumMeta,
                })
                .eq("id", compendiumId);
            } catch {
              // ignore
            }
          } else {
            try {
              const { data: created, error } = await admin
                .from("study_sources")
                .insert(compendiumPayload as any)
                .select("id")
                .maybeSingle();
              if (error) throw error;
              compendiumId = created?.id || null;
            } catch (err: any) {
              if (/column .*?(category|scope|published|metadata|ingest_status|ingested_at|ingest_error|last_used_at)/i.test(String(err?.message || err))) {
                const {
                  category: _c,
                  scope: _s,
                  published: _p,
                  metadata: _m,
                  ingest_status: _is,
                  ingested_at: _ia,
                  ingest_error: _ie,
                  last_used_at: _lu,
                  ...legacyPayload
                } = compendiumPayload;
                try {
                  const { data: created } = await admin
                    .from("study_sources")
                    .insert(legacyPayload as any)
                    .select("id")
                    .maybeSingle();
                  compendiumId = created?.id || null;
                } catch {
                  compendiumId = null;
                }
              }
            }

            if (compendiumId) {
              try {
                await admin
                  .from("study_chat_sessions")
                  .update({ compendium_source_id: compendiumId })
                  .eq("id", resolvedSessionId);
              } catch {
                // ignore
              }
            }
          }
        }
      } catch {
        // best-effort; nunca bloqueia a resposta do chat
      }
    }

    return res.status(200).json({
      success: true,
      answer: content,
      session_id: resolvedSessionId,
      meta: {
        model: usedModel,
        model_candidates: modelCandidates,
        latency_ms: Date.now() - t0,
        web: usedWebSummary,
        used_web_summary: usedWebSummary,
        use_web: Boolean(use_web),
        oracle_best_score: oracleBestScore,
        attempts,
        timeout_ms: STUDYLAB_OPENAI_TIMEOUT_MS,
        max_output_tokens: usedMaxTokens,
        sources: usedOracleSourcesCount,
        compendium: usedOracleCompendiumCount,
        attachments: normalizedAttachments.length,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
