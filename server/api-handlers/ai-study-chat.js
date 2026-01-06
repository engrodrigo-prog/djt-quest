import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import { extractPdfText, extractDocxText, extractJsonText, extractPlainText } from "../lib/import-parsers.js";
import { extractImageTextWithAi } from "../lib/ai-curation-provider.js";
import { DJT_RULES_ARTICLE } from "../../shared/djt-rules.js";
import { normalizeChatModel, pickChatModel } from "../lib/openai-models.js";
const require2 = createRequire(import.meta.url);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const STUDYLAB_DEFAULT_CHAT_MODEL = "gpt-5-nano-2025-08-07";
const STUDYLAB_MAX_COMPLETION_TOKENS = 320;
const STUDYLAB_WEB_SEARCH_TIMEOUT_MS = 4500;
const STUDYLAB_OPENAI_TIMEOUT_MS = Math.max(
  5e3,
  // Default keeps headroom for serverless runtimes while preventing early aborts.
  Math.min(6e4, Number(process.env.STUDYLAB_OPENAI_TIMEOUT_MS || 45e3))
);
const OPENAI_MODEL_STUDYLAB_CHAT = normalizeChatModel(process.env.OPENAI_MODEL_STUDYLAB_CHAT || "", STUDYLAB_DEFAULT_CHAT_MODEL);
function chooseModel(preferPremium = false) {
  const premium = process.env.OPENAI_MODEL_PREMIUM;
  const fast = process.env.OPENAI_MODEL_FAST;
  return pickChatModel(preferPremium, {
    premium,
    fast,
    fallbackFast: "gpt-5-2025-08-07",
    fallbackPremium: "gpt-5-2025-08-07"
  });
}
const uniqueStrings = (values) => {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const v of values || []) {
    const s = String(v || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
};
const pickStudyLabChatModels = (fallbackModel) => uniqueStrings([OPENAI_MODEL_STUDYLAB_CHAT, STUDYLAB_DEFAULT_CHAT_MODEL, fallbackModel]);
const extractChatText = (data) => {
  const choice = data?.choices?.[0];
  if (typeof choice?.text === "string") return choice.text;
  const msg = choice?.message;
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    const parts = msg.content.map((c) => typeof c?.text === "string" ? c.text : typeof c?.content === "string" ? c.content : typeof c?.value === "string" ? c.value : typeof c === "string" ? c : "").filter(Boolean);
    if (parts.length) return parts.join("\n");
  }
  if (typeof data?.output_text === "string") return data.output_text;
  if (Array.isArray(data?.output)) {
    const chunks = data.output.map((item) => {
      if (typeof item?.content === "string") return item.content;
      if (Array.isArray(item?.content)) return item.content.map((c) => c?.text || c?.content || "").join("\n");
      return item?.text || "";
    }).filter(Boolean);
    if (chunks.length) return chunks.join("\n");
  }
  return "";
};
const isFatalOpenAiStatus = (status) => status === 401 || status === 403 || status === 429;
const isAbortError = (err) => {
  if (!err) return false;
  if (String(err?.name || "") === "AbortError") return true;
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("aborted") || msg.includes("abort");
};
const toResponsesInputMessages = (messages) => (messages || []).map((m) => ({
  role: m?.role,
  content: [{ type: "input_text", text: String(m?.content || "") }]
})).filter((m) => m.role && m.content?.[0]?.text);
const callOpenAiChatCompletion = async (payload) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STUDYLAB_OPENAI_TIMEOUT_MS);
  try {
    return await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      signal: controller.signal,
      body: JSON.stringify(payload)
    });
  } finally {
    clearTimeout(timer);
  }
};
const normalizeForMatch = (raw) => String(raw || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
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
  "avaliacao"
];
const shouldInjectRules = (text) => {
  const normalized = normalizeForMatch(text);
  if (!normalized) return false;
  return RULES_KEYWORDS.some((k) => normalized.includes(k));
};
const buildRulesContext = () => `Base fixa (Regras do DJT Quest):
${DJT_RULES_ARTICLE.title}
${DJT_RULES_ARTICLE.body}`;
const collectOutputText = (payload) => {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = output.map((item) => {
    if (typeof item?.content === "string") return item.content;
    if (Array.isArray(item?.content)) {
      return item.content.map((c) => {
        if (typeof c?.text === "string") return c.text;
        if (typeof c?.text?.value === "string") return c.text.value;
        if (typeof c?.content === "string") return c.content;
        if (typeof c?.value === "string") return c.value;
        return "";
      }).filter(Boolean).join("\n");
    }
    return item?.text || "";
  }).filter(Boolean);
  return chunks.join("\n").trim();
};
const fetchWebSearchSummary = async (query, model, opts) => {
  if (!OPENAI_API_KEY || !query) return null;
  const timeoutMs = Math.max(800, Math.min(Number(opts?.timeoutMs) || STUDYLAB_WEB_SEARCH_TIMEOUT_MS, 15e3));
  const tools = ["web_search", "web_search_preview"];
  const input = [
    {
      role: "system",
      content: "Responda com um resumo objetivo (5 a 8 bullets) e inclua as principais fontes consultadas no fim."
    },
    { role: "user", content: query }
  ];
  for (const tool of tools) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          input,
          tools: [{ type: tool }],
          max_output_tokens: 260
        })
      });
      const json = await resp.json().catch(() => null);
      if (!resp.ok) {
        const msg = json?.error?.message || json?.message || "";
        if (/tool|web_search|unknown|invalid/i.test(msg)) {
          continue;
        }
        return null;
      }
      const text = collectOutputText(json);
      if (text) return { text, tool };
    } catch {
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
};
const normalizeHashtagTag = (raw) => {
  const base = String(raw || "").trim().replace(/^#+/, "");
  if (!base) return "";
  const ascii = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = ascii.replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
  if (cleaned.length < 3 || cleaned.length > 50) return "";
  return cleaned;
};
const extractHashtagsFromText = (text) => {
  const matches = Array.from(String(text || "").matchAll(/#([A-Za-z0-9_.-]+)/g)).map((m) => m[1]);
  const tags = matches.map(normalizeHashtagTag).filter(Boolean);
  return Array.from(new Set(tags)).slice(0, 24);
};
const mergeHashtags = (...groups) => {
  const out = /* @__PURE__ */ new Set();
  for (const group of groups) {
    for (const raw of group || []) {
      const tag = normalizeHashtagTag(raw);
      if (tag) out.add(tag);
    }
  }
  return Array.from(out).slice(0, 24);
};
const normalizeAttachment = (raw) => {
  if (!raw) return null;
  if (typeof raw === "string") {
    const url2 = raw.trim();
    return url2 ? { url: url2 } : null;
  }
  const url = String(raw?.url || raw?.publicUrl || "").trim();
  if (!url) return null;
  const name = String(raw?.name || raw?.filename || raw?.label || "").trim();
  const mime = String(raw?.mime || raw?.type || "").trim();
  const size = Number(raw?.size || 0) || 0;
  return { url, name, mime, size };
};
const uniqueAttachments = (items) => {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const item of items) {
    const url = String(item?.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...item, url });
  }
  return out;
};
const buildChatTitle = (messages) => {
  const firstUser = (messages || []).find((m) => m?.role === "user" && typeof m?.content === "string");
  const raw = String(firstUser?.content || "").trim();
  if (!raw) return "Conversa StudyLab";
  return raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
};
const buildChatSummary = (question, answer) => {
  const base = String(answer || question || "").trim();
  if (!base) return "";
  return base.length > 220 ? `${base.slice(0, 217)}...` : base;
};
const buildTranscript = (messages, attachments) => {
  const parts = (messages || []).map((m) => {
    const role = m?.role === "assistant" ? "Assistente" : "Usu\xE1rio";
    const content = String(m?.content || "").trim();
    if (!content) return "";
    return `${role}:
${content}`;
  }).filter(Boolean);
  const attachmentList = (attachments || []).map((att) => String(att?.url || "").trim()).filter(Boolean);
  if (attachmentList.length) {
    parts.push(`Anexos:
${attachmentList.join("\n")}`);
  }
  const joined = parts.join("\n\n").trim();
  return joined.length > 4e4 ? `${joined.slice(0, 39900)}...` : joined;
};
const normalizeOutlineNode = (node) => {
  if (!node) return null;
  if (typeof node === "string") {
    const title2 = node.trim();
    return title2 ? { title: title2 } : null;
  }
  const title = String(node.title || node.heading || node.name || "").trim();
  if (!title) return null;
  const rawChildren = Array.isArray(node.children) ? node.children : Array.isArray(node.items) ? node.items : [];
  const children = rawChildren.map((child) => normalizeOutlineNode(child)).filter(Boolean).slice(0, 12);
  return children.length ? { title, children } : { title };
};
const normalizeOutline = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((node) => normalizeOutlineNode(node)).filter(Boolean).slice(0, 20);
};
const normalizeQuestions = (raw) => {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const q of raw) {
    const question = String(q?.question || q?.pergunta || "").trim();
    if (!question) continue;
    const rawOptions = Array.isArray(q?.options) ? q.options : Array.isArray(q?.alternativas) ? q.alternativas : [];
    const answerIndexRaw = Number.isFinite(Number(q?.answer_index)) ? Number(q.answer_index) : -1;
    const correctText = String(q?.correct || q?.correta || "").trim();
    const options = rawOptions.map((opt, idx) => {
      if (typeof opt === "string") {
        const text2 = opt.trim();
        return text2 ? {
          text: text2,
          is_correct: idx === answerIndexRaw,
          explanation: String(q?.explanation || q?.explicacao || "").trim()
        } : null;
      }
      const text = String(opt?.text || opt?.option || opt?.alternativa || "").trim();
      if (!text) return null;
      const isCorrect = Boolean(opt?.is_correct) || Boolean(opt?.correct) || (answerIndexRaw >= 0 ? idx === answerIndexRaw : false);
      return {
        text,
        is_correct: isCorrect,
        explanation: String(opt?.explanation || opt?.explicacao || q?.explanation || q?.explicacao || "").trim()
      };
    }).filter(Boolean).slice(0, 6);
    if (correctText && !options.some((opt) => opt.text === correctText)) {
      options.unshift({
        text: correctText,
        is_correct: true,
        explanation: String(q?.explanation || q?.explicacao || "").trim()
      });
    }
    const cleanedOptions = options.map((opt, idx) => ({
      ...opt,
      text: String(opt.text || "").trim(),
      explanation: String(opt.explanation || "").trim(),
      is_correct: Boolean(opt.is_correct),
      order: idx
    })).filter((opt) => opt.text.length >= 2).slice(0, 5);
    const hasCorrect = cleanedOptions.some((opt) => opt.is_correct);
    if (!hasCorrect && cleanedOptions.length) cleanedOptions[0].is_correct = true;
    if (cleanedOptions.length < 2) continue;
    out.push({
      question_text: question,
      options: cleanedOptions.map(({ text, is_correct, explanation }) => ({
        text,
        is_correct,
        explanation
      })),
      answer_index: cleanedOptions.findIndex((opt) => opt.is_correct),
      explanation: String(q?.explanation || q?.explicacao || "").trim(),
      difficulty: String(q?.difficulty || q?.nivel || "basico").trim().toLowerCase()
    });
  }
  return out.slice(0, 12);
};
const replaceStudySourceHashtags = async (admin, sourceId, tags) => {
  if (!admin || !sourceId || !tags.length) return;
  try {
    const { data, error } = await admin.from("forum_hashtags").upsert(tags.map((tag) => ({ tag })), { onConflict: "tag" }).select("id, tag");
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return;
    const ids = rows.map((r) => r?.id).filter(Boolean);
    if (!ids.length) return;
    try {
      await admin.from("study_source_hashtags").delete().eq("source_id", sourceId);
    } catch {
    }
    await admin.from("study_source_hashtags").insert(
      ids.map((hashtag_id) => ({ source_id: sourceId, hashtag_id }))
    );
  } catch {
  }
};
async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const t0 = Date.now();
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    const admin = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
    const {
      messages = [],
      question = "",
      source_id = null,
      session_id = null,
      attachments = [],
      language = "pt-BR",
      mode = "study",
      kb_tags = [],
      kb_focus = "",
      use_web = false
    } = req.body || {};
    const allowDevIngest = mode === "ingest" && process.env.DJT_ALLOW_DEV_INGEST === "1" && process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production";
    const forumKbTagsRaw = Array.isArray(kb_tags) ? kb_tags : typeof kb_tags === "string" ? kb_tags.split(",") : [];
    const forumKbTags = Array.from(
      new Set(
        forumKbTagsRaw.map((t) => (t ?? "").toString().trim().replace(/^#+/, "").toLowerCase()).filter((t) => t.length > 0)
      )
    ).slice(0, 24);
    const forumKbFocus = (kb_focus || "").toString().trim().slice(0, 140);
    const rawAttachments = Array.isArray(attachments) ? attachments : [attachments];
    const normalizedAttachments = uniqueAttachments(
      rawAttachments.map((att) => normalizeAttachment(att)).filter(Boolean)
    ).slice(0, 5);
    let joinedContext = "";
    let sourceRow = null;
    let lastUserText = "";
    let webSummaryPromise = null;
    let usedWebSummary = false;
    let usedOracleSourcesCount = 0;
    let usedOracleCompendiumCount = 0;
    const stripHtml = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const fetchUrlContent = async (rawUrl) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8e3);
        const resp2 = await fetch(rawUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp2.ok) throw new Error(`Falha ao abrir URL (${resp2.status})`);
        const text = await resp2.text();
        return stripHtml(text).slice(0, 2e4);
      } catch (err) {
        throw new Error(err?.message || "N\xE3o foi poss\xEDvel ler a URL fornecida");
      }
    };
    let uid = null;
    let isLeaderOrStaff = false;
    const authHeader = req.headers["authorization"];
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
            admin.from("user_roles").select("role").eq("user_id", uid)
          ]);
          const roleSet = new Set((rolesRows || []).map((r) => String(r?.role || "").trim()).filter(Boolean));
          const STAFF = /* @__PURE__ */ new Set(["admin", "gerente_djt", "gerente_divisao_djtx", "coordenador_djtx", "content_curator", "lider_equipe"]);
          isLeaderOrStaff = Boolean(profile?.studio_access) || Boolean(profile?.is_leader) || Array.from(roleSet).some((r) => STAFF.has(r));
        } catch {
          isLeaderOrStaff = false;
        }
      }
    }
    const inferExt = (rawUrl) => {
      const clean = String(rawUrl || "").split("?")[0].split("#")[0];
      const i = clean.lastIndexOf(".");
      if (i === -1) return "";
      return clean.slice(i + 1).toLowerCase();
    };
    const fetchBinary = async (rawUrl) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12e3);
      const resp2 = await fetch(rawUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!resp2.ok) throw new Error(`Falha ao baixar arquivo (${resp2.status})`);
      const ab = await resp2.arrayBuffer();
      const contentType = resp2.headers.get("content-type") || "";
      return { buffer: Buffer.from(ab), contentType };
    };
    const extractFromFileUrl = async (rawUrl, hint = "") => {
      const { buffer, contentType } = await fetchBinary(rawUrl);
      const ext = inferExt(rawUrl);
      const mime = contentType || "";
      if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(ext)) {
        const ocr = await extractImageTextWithAi({
          buffer,
          mime: mime || `image/${ext || "jpeg"}`,
          hint,
          openaiKey: OPENAI_API_KEY
        });
        if (!ocr.ok) throw new Error(ocr.error);
        return [ocr.description, ocr.text].filter(Boolean).join("\n\n").trim();
      }
      if (ext === "pdf" || mime.includes("pdf")) {
        const text = await extractPdfText(buffer);
        if (text && text.length >= 120) return text.slice(0, 2e4);
        return `Observa\xE7\xE3o: este PDF parece escaneado (sem texto selecion\xE1vel). Se poss\xEDvel, envie as p\xE1ginas como imagens (JPG/PNG) para OCR.

Link do arquivo: ${rawUrl}`;
      }
      if (ext === "docx" || mime.includes("wordprocessingml")) {
        const text = await extractDocxText(buffer);
        return text.slice(0, 2e4);
      }
      if (ext === "json" || mime.includes("json")) {
        const text = extractJsonText(buffer);
        return text.slice(0, 2e4);
      }
      if (ext === "xlsx" || ext === "xls" || mime.includes("spreadsheet") || mime.includes("excel")) {
        try {
          const xlsx = require2("xlsx");
          const wb = xlsx.read(buffer, { type: "buffer" });
          const sheetName = wb.SheetNames?.[0];
          if (!sheetName) return "";
          const sheet = wb.Sheets[sheetName];
          const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
          const lines = (rows || []).slice(0, 200).map((r) => (r || []).slice(0, 24).join("	"));
          return `Planilha: ${sheetName}
` + lines.join("\n");
        } catch {
          return "";
        }
      }
      return extractPlainText(buffer).slice(0, 2e4);
    };
    const buildAttachmentContext = async (attachments2) => {
      const items = Array.isArray(attachments2) ? attachments2 : [];
      if (!items.length) return "";
      const parts = [];
      for (let idx = 0; idx < items.length; idx += 1) {
        const att = items[idx];
        const url = String(att?.url || "").trim();
        if (!url) continue;
        const label = String(att?.name || `Anexo ${idx + 1}`).trim() || `Anexo ${idx + 1}`;
        try {
          const text = await extractFromFileUrl(url, label);
          const trimmed = String(text || "").trim();
          if (trimmed) {
            const clipped = trimmed.length > 3500 ? `${trimmed.slice(0, 3400)}...` : trimmed;
            parts.push(`### ${label}
${clipped}`);
          } else {
            parts.push(`### ${label}
[Sem texto extra\xEDvel]`);
          }
        } catch (err) {
          parts.push(`### ${label}
[Erro ao ler anexo: ${err?.message || "falha"}]`);
        }
      }
      return parts.join("\n\n").trim();
    };
    if (admin && source_id) {
      const selectV2 = "id, user_id, title, summary, full_text, url, kind, topic, category, metadata, scope, published, ingest_status, ingest_error, ingested_at";
      const selectV1 = "id, user_id, title, summary, full_text, url, ingest_status, ingest_error, ingested_at";
      let sourceRes = await admin.from("study_sources").select(selectV2).eq("id", source_id).maybeSingle();
      if (sourceRes.error && /column .*?(category|metadata)/i.test(String(sourceRes.error.message || sourceRes.error))) {
        sourceRes = await admin.from("study_sources").select(selectV1).eq("id", source_id).maybeSingle();
      }
      sourceRow = sourceRes.data || null;
      if (sourceRow) {
        const scope = (sourceRow.scope || "user").toString().toLowerCase();
        const published = Boolean(sourceRow.published);
        const canRead = allowDevIngest || Boolean(uid && sourceRow.user_id && sourceRow.user_id === uid) || scope === "org" && (published || isLeaderOrStaff);
        if (canRead) {
          let baseText = (sourceRow.full_text || sourceRow.summary || sourceRow.url || "").toString();
          if (!sourceRow.full_text && sourceRow.url && sourceRow.url.startsWith("http")) {
            try {
              const isFile = String(sourceRow.kind || "").toLowerCase() === "file" || /\.(pdf|docx|xlsx|xls|csv|txt|json|png|jpe?g|webp)(\?|#|$)/i.test(String(sourceRow.url || ""));
              const fetched = isFile ? await extractFromFileUrl(sourceRow.url, sourceRow.title || "") : await fetchUrlContent(sourceRow.url);
              if (fetched?.trim()) {
                baseText = fetched;
                await admin.from("study_sources").update({
                  full_text: fetched,
                  ingest_status: "ok",
                  ingested_at: (/* @__PURE__ */ new Date()).toISOString(),
                  ingest_error: null
                }).eq("id", source_id);
              }
            } catch {
            }
          }
          if (baseText.trim()) {
            const category = (sourceRow.category || "").toString().trim().toUpperCase();
            const meta = sourceRow.metadata && typeof sourceRow.metadata === "object" ? sourceRow.metadata : null;
            const incident = meta?.incident && typeof meta.incident === "object" ? meta.incident : null;
            const aiIncident = meta?.ai?.incident && typeof meta.ai.incident === "object" ? meta.ai.incident : null;
            const metaParts = [];
            if (category) metaParts.push(`Tipo no cat\xE1logo: ${category}`);
            if (incident) {
              metaParts.push(
                `Formul\xE1rio (Relat\xF3rio de Ocorr\xEAncia):
- ocorrido: ${(incident.ocorrido || "").toString().slice(0, 500)}
- causa_raiz_modo_falha: ${(incident.causa_raiz_modo_falha || "").toString().slice(0, 500)}
- barreiras_cuidados: ${(incident.barreiras_cuidados || "").toString().slice(0, 500)}
- acoes_corretivas_preventivas: ${(incident.acoes_corretivas_preventivas || "").toString().slice(0, 500)}
- mudancas_implementadas: ${(incident.mudancas_implementadas || "").toString().slice(0, 500)}`
              );
            }
            if (aiIncident) {
              const aprendizados = Array.isArray(aiIncident.aprendizados) ? aiIncident.aprendizados.slice(0, 8) : [];
              const cuidados = Array.isArray(aiIncident.cuidados) ? aiIncident.cuidados.slice(0, 8) : [];
              const mudancas = Array.isArray(aiIncident.mudancas) ? aiIncident.mudancas.slice(0, 8) : [];
              const aiLines = [];
              if (aprendizados.length) aiLines.push(`Aprendizados (IA): ${aprendizados.join(" | ")}`);
              if (cuidados.length) aiLines.push(`Cuidados/Barreiras (IA): ${cuidados.join(" | ")}`);
              if (mudancas.length) aiLines.push(`Mudan\xE7as (IA): ${mudancas.join(" | ")}`);
              if (aiLines.length) metaParts.push(aiLines.join("\n"));
            }
            joinedContext = `### Fonte: ${sourceRow.title}
${baseText}${metaParts.length ? `

### Metadados
${metaParts.join("\n\n")}` : ""}`;
          }
        }
      }
    }
    let attachmentContext = "";
    if (mode !== "ingest" && normalizedAttachments.length) {
      try {
        attachmentContext = await buildAttachmentContext(normalizedAttachments);
      } catch {
        attachmentContext = "";
      }
    }
    if (mode === "ingest") {
      if (!admin || !source_id) {
        return res.status(400).json({ error: "Par\xE2metros inv\xE1lidos para ingest\xE3o" });
      }
      if (!joinedContext) {
        return res.status(200).json({ success: true, ingested: false });
      }
      const rawText = joinedContext.replace(/^### Fonte:[^\n]*\n/, "");
      const trimmed = rawText.trim();
      if (!trimmed) {
        return res.status(200).json({ success: true, ingested: false });
      }
      try {
        const preferPremiumIngest = sourceRow && String(sourceRow.scope || "").toLowerCase() === "org" && sourceRow.published !== false;
        const model2 = chooseModel(preferPremiumIngest);
        const allowedTopics = [
          "LINHAS",
          "SUBESTACOES",
          "PROCEDIMENTOS",
          "PROTECAO",
          "AUTOMACAO",
          "TELECOM",
          "SEGURANCA_DO_TRABALHO"
        ];
        const category = (sourceRow?.category || "").toString().trim().toUpperCase();
        const supportsMetadata = Boolean(sourceRow && Object.prototype.hasOwnProperty.call(sourceRow, "metadata"));
        const prevMeta = supportsMetadata && sourceRow?.metadata && typeof sourceRow.metadata === "object" ? sourceRow.metadata : null;
        const incident = prevMeta?.incident && typeof prevMeta.incident === "object" ? prevMeta.incident : null;
        const isIncident = category === "RELATORIO_OCORRENCIA" || Boolean(incident);
        const incidentContext = isIncident && incident ? `### Respostas do formul\xE1rio (Relat\xF3rio de Ocorr\xEAncia)
- ocorrido: ${(incident.ocorrido || "").toString().slice(0, 800)}
- causa_raiz_modo_falha: ${(incident.causa_raiz_modo_falha || "").toString().slice(0, 800)}
- barreiras_cuidados: ${(incident.barreiras_cuidados || "").toString().slice(0, 800)}
- acoes_corretivas_preventivas: ${(incident.acoes_corretivas_preventivas || "").toString().slice(0, 800)}
- mudancas_implementadas: ${(incident.mudancas_implementadas || "").toString().slice(0, 800)}

` : "";
        const baseMaterial = trimmed.slice(0, 6e3);
        const userContent = isIncident ? `Leia o conte\xFAdo abaixo e responda APENAS em JSON v\xE1lido no formato:
{
  "title": "...",
  "summary": "...",
  "topic": "LINHAS",
  "hashtags": ["#tag1", "#tag2"],
  "outline": [{"title": "Se\xE7\xE3o 1", "children": [{"title": "Subse\xE7\xE3o"}]}],
  "questions": [{"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "explanation": "...", "difficulty": "basico"}],
  "aprendizados": ["..."],
  "cuidados": ["..."],
  "mudancas": ["..."]
}

- title: t\xEDtulo curto.
- summary: 2 a 4 frases, em portugu\xEAs.
- topic: escolha UMA categoria entre: ${allowedTopics.join(", ")}.
- hashtags: 4 a 8 hashtags curtas (sem espa\xE7os), use termos do material.
- outline: 4 a 10 subt\xEDtulos, at\xE9 3 n\xEDveis (use [] se n\xE3o fizer sentido).
- questions: 4 a 8 perguntas com 4 alternativas (use [] se o material for insuficiente).
- aprendizados/cuidados/mudancas: 3 a 7 itens cada (use [] se n\xE3o tiver evid\xEAncia no texto/formul\xE1rio).
- N\xC3O invente detalhes que n\xE3o estejam no material ou no formul\xE1rio.

` + incidentContext + "### Material\n" + baseMaterial : `Leia o material abaixo e responda APENAS em JSON v\xE1lido no formato:
{
  "title": "...",
  "summary": "...",
  "topic": "LINHAS",
  "hashtags": ["#tag1", "#tag2"],
  "outline": [{"title": "Se\xE7\xE3o 1", "children": [{"title": "Subse\xE7\xE3o"}]}],
  "questions": [{"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "explanation": "...", "difficulty": "basico"}]
}

- title: t\xEDtulo curto, sem siglas de GED.
- summary: resumo em 2 a 4 frases, em portugu\xEAs.
- topic: escolha UMA categoria entre: ${allowedTopics.join(", ")}.
- hashtags: 4 a 8 hashtags curtas (sem espa\xE7os), use termos do material.
- outline: 4 a 10 subt\xEDtulos, at\xE9 3 n\xEDveis (use [] se n\xE3o fizer sentido).
- questions: 4 a 8 perguntas com 4 alternativas (use [] se o material for insuficiente).

` + baseMaterial;
        const wantsStrictJson = !/^gpt-5/i.test(String(model2 || ""));
        const requestBody = {
          model: model2,
          messages: [
            {
              role: "system",
              content: isIncident ? "Voc\xEA resume e extrai aprendizados de Relat\xF3rios de Ocorr\xEAncia no setor el\xE9trico (CPFL). Gere t\xEDtulo, resumo, assunto, aprendizados, cuidados e mudan\xE7as." : "Voc\xEA resume e classifica materiais de estudo t\xE9cnicos (setor el\xE9trico CPFL). Gere um t\xEDtulo curto, um resumo objetivo e uma categoria de assunto."
            },
            {
              role: "user",
              content: userContent
            }
          ],
          max_completion_tokens: isIncident ? 500 : 300
        };
        if (wantsStrictJson) {
          requestBody.response_format = { type: "json_object" };
        }
        const resp2 = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify(requestBody)
        });
        if (!resp2.ok) {
          const txt = await resp2.text().catch(() => `HTTP ${resp2.status}`);
          console.warn("Study ingest OpenAI error", txt);
          try {
            await admin.from("study_sources").update({
              full_text: trimmed,
              ingest_status: "failed",
              ingest_error: `OpenAI error: ${txt}`.slice(0, 900),
              ingested_at: (/* @__PURE__ */ new Date()).toISOString()
            }).eq("id", source_id);
          } catch {
          }
          return res.status(200).json({ success: false, error: `OpenAI error: ${txt}` });
        } else {
          const data2 = await resp2.json().catch(() => null);
          const content2 = data2?.choices?.[0]?.message?.content || "";
          const tryParse = (raw) => {
            try {
              return JSON.parse(raw);
            } catch {
              return null;
            }
          };
          const repairJson = async (raw) => {
            try {
              const repairModel = chooseModel(false);
              const repairBody = {
                model: repairModel,
                max_completion_tokens: 400,
                messages: [
                  {
                    role: "system",
                    content: "Voc\xEA corrige JSON malformado e devolve APENAS um JSON v\xE1lido seguindo o mesmo esquema esperado."
                  },
                  {
                    role: "user",
                    content: raw.slice(0, 6e3)
                  }
                ]
              };
              if (!/^gpt-5/i.test(String(repairModel || ""))) {
                repairBody.response_format = { type: "json_object" };
              }
              const repairResp = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify(repairBody)
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
          let parsed = tryParse(content2);
          if (!parsed) {
            const match = content2.match?.(/\{[\s\S]*\}/);
            if (match) parsed = tryParse(match[0]);
          }
          if (!parsed && content2) {
            parsed = await repairJson(content2);
          }
          if (!parsed || typeof parsed !== "object") {
            try {
              await admin.from("study_sources").update({
                full_text: trimmed,
                ingest_status: "failed",
                ingest_error: "Resposta inv\xE1lida da IA (JSON n\xE3o parse\xE1vel)."
              }).eq("id", source_id);
            } catch {
            }
            return res.status(200).json({ success: false, error: "Resposta inv\xE1lida da IA (JSON n\xE3o parse\xE1vel)." });
          }
          const newTitle = typeof parsed?.title === "string" ? parsed.title.trim() : null;
          const newSummary = typeof parsed?.summary === "string" ? parsed.summary.trim() : null;
          const topicRaw = typeof parsed?.topic === "string" ? parsed.topic.toUpperCase().trim() : null;
          const topic = topicRaw && allowedTopics.includes(topicRaw) ? topicRaw : null;
          const outline = normalizeOutline(parsed?.outline);
          const questions = normalizeQuestions(parsed?.questions);
          const aprendizados = Array.isArray(parsed?.aprendizados) ? parsed.aprendizados.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12) : [];
          const cuidados = Array.isArray(parsed?.cuidados) ? parsed.cuidados.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12) : [];
          const mudancas = Array.isArray(parsed?.mudancas) ? parsed.mudancas.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12) : [];
          const aiTags = Array.isArray(parsed?.hashtags) ? parsed.hashtags.map((x) => String(x || "").trim()).filter(Boolean) : [];
          const explicitTags = extractHashtagsFromText([newTitle, newSummary, trimmed].filter(Boolean).join(" "));
          const topicTag = topic ? normalizeHashtagTag(topic) : "";
          const prevTags = Array.isArray(prevMeta?.tags) ? prevMeta.tags : [];
          const mergedTags = mergeHashtags(
            prevTags,
            aiTags,
            explicitTags,
            topicTag ? [topicTag] : []
          );
          const nextMeta = supportsMetadata ? {
            ...prevMeta && typeof prevMeta === "object" ? prevMeta : {},
            ...mergedTags.length ? { tags: mergedTags } : {},
            ai: {
              ...(prevMeta && typeof prevMeta === "object" ? prevMeta.ai : null) || {},
              ingested_at: (/* @__PURE__ */ new Date()).toISOString(),
              ...topic ? { topic } : {},
              ...mergedTags.length ? { tags: mergedTags } : {},
              ...outline.length ? { outline } : {},
              ...isIncident ? {
                incident: {
                  ...prevMeta?.ai?.incident || {},
                  ...aprendizados.length ? { aprendizados } : {},
                  ...cuidados.length ? { cuidados } : {},
                  ...mudancas.length ? { mudancas } : {}
                }
              } : {}
            }
          } : null;
          await admin.from("study_sources").update({
            full_text: trimmed,
            ingest_status: "ok",
            ingested_at: (/* @__PURE__ */ new Date()).toISOString(),
            ingest_error: null,
            ...newTitle ? { title: newTitle } : {},
            ...newSummary ? { summary: newSummary } : {},
            ...topic ? { topic } : {},
            ...nextMeta ? { metadata: nextMeta } : {}
          }).eq("id", source_id);
          if (mergedTags.length) {
            await replaceStudySourceHashtags(admin, source_id, mergedTags);
          }
          if (questions.length) {
            try {
              await admin.from("study_source_questions").delete().eq("source_id", source_id);
              await admin.from("study_source_questions").insert(
                questions.map((q) => ({
                  source_id,
                  question_text: q.question_text,
                  options: q.options,
                  answer_index: q.answer_index,
                  explanation: q.explanation || null,
                  difficulty: q.difficulty || "basico",
                  tags: mergedTags
                }))
              );
            } catch {
            }
          }
          return res.status(200).json({
            success: true,
            ingested: true,
            title: newTitle,
            summary: newSummary,
            topic,
            ...isIncident ? { aprendizados, cuidados, mudancas } : {}
          });
        }
      } catch (e) {
        console.warn("Study ingest error", e?.message || e);
        try {
          await admin.from("study_sources").update({
            ingest_status: "failed",
            ingest_error: e?.message || e?.toString?.() || "Erro ao ingerir material"
          }).eq("id", source_id);
        } catch {
        }
      }
      return res.status(200).json({ success: true, ingested: true });
    }
    const normalizedMessages = Array.isArray(messages) ? messages : [];
    if (normalizedMessages.length === 0 && typeof question === "string" && question.trim()) {
      normalizedMessages.push({ role: "user", content: question.trim() });
    }
    if (!Array.isArray(normalizedMessages) || normalizedMessages.length === 0) {
      return res.status(400).json({ error: "Mensagens inv\xE1lidas" });
    }
    const lastUserMsgForLog = normalizedMessages.slice().reverse().find((m) => m?.role === "user" && m?.content)?.content;
    if (lastUserMsgForLog) {
      lastUserText = String(lastUserMsgForLog || "");
    }
    const focusHint = forumKbFocus ? `

Foco do usu\xE1rio (temas da base de conhecimento): ${forumKbFocus}
- Priorize esse foco ao responder e ao sugerir pr\xF3ximos passos.` : "";
    const system = mode === "oracle" ? `Voc\xEA \xE9 o Cat\xE1logo de Conhecimento do DJT Quest.
Voc\xEA ajuda colaboradores a encontrar respostas e aprendizados usando toda a base dispon\xEDvel (cat\xE1logo publicado da organiza\xE7\xE3o, materiais do pr\xF3prio usu\xE1rio e comp\xEAndio de ocorr\xEAncias aprovadas).

Regras:
- Seja claro e pr\xE1tico. Diga o que a pessoa deve fazer, checar ou perguntar em campo (quando fizer sentido).
- Seja conciso: responda em at\xE9 10 linhas. Se faltar contexto, fa\xE7a 1 pergunta objetiva antes de expandir.
- Se a resposta depender de uma informa\xE7\xE3o que N\xC3O aparece na base enviada, deixe isso expl\xEDcito e responda de forma geral (sem inventar detalhes).
- Quando usar a base, cite rapidamente de onde veio: t\xEDtulo da fonte/ocorr\xEAncia.
- Sugira 1 pr\xF3ximo passo (ex.: \u201Cquer que eu gere perguntas de quiz sobre isso?\u201D).
${focusHint}

Formato:
- Responda em ${language}, em texto livre, com quebras de linha amig\xE1veis.
- N\xE3o responda em JSON.` : `Voc\xEA \xE9 um tutor de estudos no contexto de treinamento t\xE9cnico CPFL / setor el\xE9trico brasileiro.
Voc\xEA recebe materiais de estudo (textos, resumos, transcri\xE7\xF5es, links) e perguntas de um colaborador.

Seu objetivo:
- Explicar conceitos passo a passo, em linguagem clara, mantendo a precis\xE3o t\xE9cnica.
- Sempre que poss\xEDvel, conectar a resposta diretamente ao conte\xFAdo das fontes fornecidas.
- Sempre deixe expl\xEDcito na resposta quando estiver usando um material espec\xEDfico, por exemplo: "Com base no material de estudo sobre X..." ou "No documento selecionado, vemos que...".
- Se algo n\xE3o estiver nas fontes, deixe claro que a informa\xE7\xE3o n\xE3o aparece no material e responda de forma geral sem inventar detalhes espec\xEDficos.
- Sugira, quando fizer sentido, 1 a 3 perguntas extras para o colaborador praticar em cima do tema.
${focusHint}

Formato da sa\xEDda:
- Responda em ${language}, em texto livre, com quebras de linha amig\xE1veis.
- Voc\xEA pode usar bullets e listas curtas, mas n\xE3o use nenhum formato de JSON.`;
    const openaiMessages = [{ role: "system", content: system }];
    if (mode === "oracle" && admin) {
      const normalizedMessagesForQuery = Array.isArray(messages) ? messages : [];
      const lastUserMsg = (normalizedMessagesForQuery.slice().reverse().find((m) => m?.role === "user" && m?.content)?.content || question || "") + "";
      const text = lastUserMsg.toString();
      lastUserText = text;
      const normalizedQuery = normalizeForMatch(text);
      const incidentLikely = /\b(ocorrenc|ocorr|acident|inciden|seguranca|epi|nr\s*\d|cipa|quase\s+acident)\b/i.test(normalizedQuery);
      const useWeb = Boolean(use_web);
      webSummaryPromise = useWeb && lastUserText ? fetchWebSearchSummary(lastUserText, chooseModel(true), { timeoutMs: STUDYLAB_WEB_SEARCH_TIMEOUT_MS }) : null;
      const stop = /* @__PURE__ */ new Set([
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
        "porqu\xEA",
        "isso",
        "essa",
        "esse",
        "esta",
        "este"
      ]);
      const keywords = Array.from(
        new Set(
          text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 4 && !stop.has(w)).slice(0, 30)
        )
      ).slice(0, 8);
      let sourcesForOracle = [];
      try {
        const selectV2 = "id, user_id, title, summary, url, topic, category, scope, published, metadata, created_at";
        const selectV1 = "id, user_id, title, summary, url, topic, created_at";
        const buildQuery = (select) => {
          const q = admin.from("study_sources").select(select).order("created_at", { ascending: false }).limit(80);
          if (uid) {
            if (isLeaderOrStaff) q.or(`user_id.eq.${uid},scope.eq.org`);
            else q.or(`user_id.eq.${uid},and(scope.eq.org,published.eq.true)`);
          } else {
            q.eq("scope", "org").eq("published", true);
          }
          return q;
        };
        let resp2 = await buildQuery(selectV2);
        let data2 = resp2?.data;
        let error = resp2?.error;
        if (error && /column .*?(category|scope|published|metadata)/i.test(String(error.message || error))) {
          resp2 = await buildQuery(selectV1);
          data2 = resp2?.data;
          error = resp2?.error;
        }
        if (error) throw error;
        sourcesForOracle = Array.isArray(data2) ? data2 : [];
      } catch {
        sourcesForOracle = [];
      }
      const scoreText = (s, kws) => {
        const hay = String(s || "").toLowerCase();
        let score = 0;
        for (const k of kws) if (hay.includes(k)) score += 1;
        return score;
      };
      const rankedSourcesBase = sourcesForOracle.map((s) => {
        const hay = [s.title, s.summary, s.topic, s.category].filter(Boolean).join(" ");
        return { s, score: keywords.length ? scoreText(hay, keywords) : 0 };
      }).filter((x) => keywords.length ? x.score > 0 : true).sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.s);
      const topSourceIds = rankedSourcesBase.map((s) => s?.id).filter(Boolean).slice(0, 3);
      const fullTextById = /* @__PURE__ */ new Map();
      if (topSourceIds.length) {
        try {
          const { data: data2, error } = await admin.from("study_sources").select("id, full_text").in("id", topSourceIds);
          if (!error && Array.isArray(data2)) {
            for (const row of data2) {
              const id = String(row?.id || "").trim();
              const ft = String(row?.full_text || "").trim();
              if (id && ft) fullTextById.set(id, ft);
            }
          }
        } catch {
        }
      }
      const rankedSources = rankedSourcesBase.map((s) => {
        const id = String(s?.id || "").trim();
        return id ? { ...s, full_text: fullTextById.get(id) || "" } : s;
      });
      usedOracleSourcesCount = rankedSources.length;
      let compendium = [];
      if (incidentLikely) {
        try {
          const { data: data2 } = await admin.from("content_imports").select("id, final_approved, created_at").eq("status", "FINAL_APPROVED").filter("final_approved->>kind", "eq", "incident_report").order("created_at", { ascending: false }).limit(80);
          compendium = Array.isArray(data2) ? data2 : [];
        } catch {
          compendium = [];
        }
      }
      const rankedCompendium = compendium.map((row) => {
        const cat = row?.final_approved?.catalog || row?.final_approved || {};
        const hay = [
          cat?.title,
          cat?.summary,
          cat?.asset_area,
          cat?.asset_type,
          cat?.asset_subtype,
          cat?.failure_mode,
          cat?.root_cause,
          ...Array.isArray(cat?.keywords) ? cat.keywords : [],
          ...Array.isArray(cat?.learning_points) ? cat.learning_points : []
        ].filter(Boolean).join(" ");
        return { row, cat, score: keywords.length ? scoreText(hay, keywords) : 0 };
      }).filter((x) => keywords.length ? x.score > 0 : true).sort((a, b) => b.score - a.score).slice(0, 3);
      usedOracleCompendiumCount = rankedCompendium.length;
      let forumKbRows = [];
      if (forumKbTags.length) {
        try {
          const { data: data2, error } = await admin.from("knowledge_base").select("source_type, title, post_id, source_id, content, content_html, hashtags, likes_count, is_solution, is_featured, kind, url").overlaps("hashtags", forumKbTags).order("is_solution", { ascending: false }).order("likes_count", { ascending: false }).limit(120);
          if (error) throw error;
          forumKbRows = Array.isArray(data2) ? data2 : [];
        } catch {
          try {
            const { data: data2 } = await admin.from("forum_knowledge_base").select("title, post_id, content, content_html, hashtags, likes_count, is_solution, is_featured").overlaps("hashtags", forumKbTags).order("is_solution", { ascending: false }).order("likes_count", { ascending: false }).limit(120);
            forumKbRows = Array.isArray(data2) ? data2 : [];
          } catch {
            forumKbRows = [];
          }
        }
      }
      const rankedForumKb = forumKbRows.map((row) => {
        const title = String(row?.title || "").trim();
        const raw = String(row?.content || "").trim();
        const html = String(row?.content_html || "").trim();
        const text2 = raw || (html ? stripHtml(html) : "");
        const hay = [title, text2, ...Array.isArray(row?.hashtags) ? row.hashtags : []].filter(Boolean).join(" ");
        return { row, text: text2, score: keywords.length ? scoreText(hay, keywords) : 0 };
      }).filter((x) => keywords.length ? x.score > 0 : true).sort((a, b) => b.score - a.score).slice(0, 6);
      const contextParts = [];
      if (attachmentContext) {
        contextParts.push(`### Anexos enviados
${attachmentContext}`);
      }
      if (rankedSources.length) {
        contextParts.push(
          "### Cat\xE1logo de Estudos (trechos)\n" + rankedSources.map((s, idx) => {
            const title = String(s.title || `Fonte ${idx + 1}`);
            const summary = String(s.summary || "").trim();
            const text2 = String(s.full_text || "").trim();
            const excerpt = text2 ? text2.slice(0, 900) : "";
            return `- ${title}
` + (summary ? `  Resumo: ${summary}
` : "") + (excerpt ? `  Trecho: ${excerpt}
` : "") + (s.url ? `  Link: ${s.url}
` : "");
          }).join("\n")
        );
      }
      if (rankedCompendium.length) {
        contextParts.push(
          "### Comp\xEAndio de Ocorr\xEAncias (resumos)\n" + rankedCompendium.map((x, idx) => {
            const cat = x.cat || {};
            const title = String(cat.title || `Ocorr\xEAncia ${idx + 1}`);
            const summary = String(cat.summary || "").trim();
            const header = [
              cat.asset_area ? `\xE1rea: ${cat.asset_area}` : "",
              cat.asset_type ? `ativo: ${cat.asset_type}` : "",
              cat.failure_mode ? `falha: ${cat.failure_mode}` : "",
              cat.root_cause ? `causa: ${cat.root_cause}` : ""
            ].filter(Boolean).join(" \u2022 ");
            const learn = Array.isArray(cat.learning_points) ? cat.learning_points.slice(0, 6) : [];
            return `- ${title}
` + (header ? `  ${header}
` : "") + (summary ? `  Resumo: ${summary}
` : "") + (learn.length ? `  Aprendizados: ${learn.join(" | ")}
` : "");
          }).join("\n")
        );
      }
      if (rankedForumKb.length) {
        contextParts.push(
          "### Base de Conhecimento (hashtags)\n" + rankedForumKb.map((x, idx) => {
            const row = x.row || {};
            const title = String(row.title || `T\xF3pico ${idx + 1}`);
            const sourceType = String(row.source_type || "forum").toLowerCase();
            const hashtags = Array.isArray(row.hashtags) ? row.hashtags.slice(0, 8).map((h) => `#${h}`) : [];
            const flags = [
              sourceType === "study" ? "StudyLab" : "",
              row.is_solution ? "solu\xE7\xE3o" : "",
              row.is_featured ? "destaque" : "",
              Number(row.likes_count || 0) > 0 ? `${Number(row.likes_count)} curtidas` : ""
            ].filter(Boolean).join(" \u2022 ");
            const excerpt = String(x.text || "").slice(0, 1600);
            return `- ${title}
` + (flags ? `  ${flags}
` : "") + (hashtags.length ? `  ${hashtags.join(" ")}
` : "") + (excerpt ? `  Trecho: ${excerpt}
` : "");
          }).join("\n")
        );
      }
      if (contextParts.length) {
        openaiMessages.push({
          role: "system",
          content: `A seguir est\xE1 a base de conhecimento dispon\xEDvel para esta pergunta. Use-a como principal refer\xEAncia:

${contextParts.join(
            "\n\n"
          )}`
        });
      }
    } else {
      if (attachmentContext) {
        openaiMessages.push({
          role: "system",
          content: `A seguir est\xE3o anexos enviados nesta conversa. Use-os como contexto adicional:

${attachmentContext}`
        });
      }
      if (joinedContext) {
        openaiMessages.push({
          role: "system",
          content: `Abaixo est\xE3o os materiais de estudo do usu\xE1rio. Use-os como base principal:

${joinedContext}`
        });
      }
      if (admin && forumKbTags.length) {
        try {
          let rows = [];
          try {
            const { data: data2, error } = await admin.from("knowledge_base").select("source_type, title, post_id, source_id, content, content_html, hashtags, likes_count, is_solution, is_featured, kind, url").overlaps("hashtags", forumKbTags).order("is_solution", { ascending: false }).order("likes_count", { ascending: false }).limit(8);
            if (error) throw error;
            rows = Array.isArray(data2) ? data2 : [];
          } catch {
            const { data: data2 } = await admin.from("forum_knowledge_base").select("title, post_id, content, content_html, hashtags, likes_count, is_solution, is_featured").overlaps("hashtags", forumKbTags).order("is_solution", { ascending: false }).order("likes_count", { ascending: false }).limit(8);
            rows = Array.isArray(data2) ? data2 : [];
          }
          if (rows.length) {
            const context = rows.map((row, idx) => {
              const title = String(row?.title || `T\xF3pico ${idx + 1}`);
              const sourceType = String(row?.source_type || "forum").toLowerCase();
              const raw = String(row?.content || "").trim();
              const html = String(row?.content_html || "").trim();
              const text = raw || (html ? stripHtml(html) : "");
              const hashtags = Array.isArray(row?.hashtags) ? row.hashtags.slice(0, 8).map((h) => `#${h}`) : [];
              const flags = [
                sourceType === "study" ? "StudyLab" : "",
                row?.is_solution ? "solu\xE7\xE3o" : "",
                row?.is_featured ? "destaque" : "",
                Number(row?.likes_count || 0) > 0 ? `${Number(row.likes_count)} curtidas` : ""
              ].filter(Boolean).join(" \u2022 ");
              const excerpt = text ? text.slice(0, 1500) : "";
              return `- ${title}
` + (flags ? `  ${flags}
` : "") + (hashtags.length ? `  ${hashtags.join(" ")}
` : "") + (excerpt ? `  Trecho: ${excerpt}
` : "");
            }).join("\n");
            openaiMessages.push({
              role: "system",
              content: `A seguir est\xE3o trechos da base de conhecimento (hashtags) para usar como contexto adicional:

${context}`
            });
          }
        } catch {
        }
      }
    }
    const useWeb = Boolean(use_web);
    if (mode === "oracle" && useWeb && lastUserText) {
      const webSummary = await (webSummaryPromise || fetchWebSearchSummary(lastUserText, chooseModel(true), { timeoutMs: STUDYLAB_WEB_SEARCH_TIMEOUT_MS }));
      if (webSummary?.text) {
        usedWebSummary = true;
        openaiMessages.push({
          role: "system",
          content: `Pesquisa web automatica (resumo):
${webSummary.text}`
        });
      }
    }
    if (mode === "oracle" && lastUserText && shouldInjectRules(lastUserText)) {
      openaiMessages.push({ role: "system", content: buildRulesContext() });
    }
    for (const m of normalizedMessages) {
      if (!m || !m.role || !m.content) continue;
      const role = m.role === "assistant" ? "assistant" : "user";
      openaiMessages.push({ role, content: m.content });
    }
    const preferPremium = mode === "oracle" || useWeb || sourceRow && String(sourceRow.scope || "").toLowerCase() === "org" && sourceRow.published !== false;
    const fallbackModel = chooseModel(preferPremium);
    const modelCandidates = pickStudyLabChatModels(fallbackModel);
    const maxTokens = useWeb ? Math.max(STUDYLAB_MAX_COMPLETION_TOKENS, 520) : STUDYLAB_MAX_COMPLETION_TOKENS;
    let content = "";
    let usedModel = fallbackModel;
    let lastErrTxt = "";
    let aborted = false;
    let attempts = 0;
    for (const model of modelCandidates) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        // Avoid stacking multiple long attempts (can exceed serverless max duration).
        if (attempts >= (useWeb ? 2 : 3)) break;
        let resp = null;
        try {
          attempts += 1;
          resp = await callOpenAiChatCompletion({
            model,
            input: toResponsesInputMessages(openaiMessages),
            text: { verbosity: "low" },
            reasoning: { effort: "low" },
            temperature: 0.2,
            max_output_tokens: maxTokens
          });
        } catch (e) {
          lastErrTxt = e?.message || "OpenAI request failed";
          if (isAbortError(e)) {
            aborted = true;
            break;
          }
          if (attempt === 0 && !useWeb) continue;
          break;
        }
        if (!resp.ok) {
          lastErrTxt = await resp.text().catch(() => `HTTP ${resp.status}`);
          if (isFatalOpenAiStatus(resp.status)) break;
          if (attempt === 0 && !useWeb) continue;
          break;
        }
        const data = await resp.json().catch(() => null);
        content = String(collectOutputText(data) || extractChatText(data) || "").trim();
        if (content) {
          usedModel = model;
          break;
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
          aborted,
          attempts,
          timeout_ms: STUDYLAB_OPENAI_TIMEOUT_MS,
          max_output_tokens: maxTokens,
          latency_ms: Date.now() - t0
        }
      });
    }
    let resolvedSessionId = typeof session_id === "string" && session_id.trim() ? session_id.trim() : null;
    if (!resolvedSessionId) {
      try {
        const crypto = require2("crypto");
        resolvedSessionId = crypto?.randomUUID?.() || null;
      } catch {
        resolvedSessionId = null;
      }
      if (!resolvedSessionId) {
        resolvedSessionId = `studychat_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
    }
    if (admin && uid) {
      try {
        const logMessages = [...normalizedMessages, { role: "assistant", content }];
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        let sessionRow = null;
        try {
          const { data: existing } = await admin.from("study_chat_sessions").select("id, attachments, title, compendium_source_id").eq("id", resolvedSessionId).maybeSingle();
          sessionRow = existing || null;
        } catch {
          sessionRow = null;
        }
        const mergedAttachments = uniqueAttachments([
          ...Array.isArray(sessionRow?.attachments) ? sessionRow.attachments : [],
          ...normalizedAttachments
        ]);
        const title = sessionRow?.title || buildChatTitle(logMessages);
        const summary = buildChatSummary(lastUserText || "", content);
        const metadata = {
          mode,
          source_id: source_id || null,
          use_web: Boolean(use_web),
          kb_tags: forumKbTags,
          kb_focus: forumKbFocus,
          model: usedModel
        };
        const sessionPayload = {
          id: resolvedSessionId,
          user_id: uid,
          mode,
          source_id: source_id || null,
          title,
          summary,
          messages: logMessages,
          attachments: mergedAttachments,
          metadata,
          updated_at: nowIso
        };
        if (sessionRow?.id) {
          await admin.from("study_chat_sessions").update(sessionPayload).eq("id", resolvedSessionId);
        } else {
          await admin.from("study_chat_sessions").insert({
            ...sessionPayload,
            created_at: nowIso
          });
        }
        const transcript = buildTranscript(logMessages, mergedAttachments);
        const compendiumMeta = {
          source: "study_chat",
          session_id: resolvedSessionId,
          attachments: mergedAttachments,
          mode,
          source_id: source_id || null,
          updated_at: nowIso
        };
        const compendiumPayload = {
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
          metadata: compendiumMeta
        };
        let compendiumId = sessionRow?.compendium_source_id || null;
        if (compendiumId) {
          try {
            await admin.from("study_sources").update({
              summary,
              full_text: transcript,
              last_used_at: nowIso,
              metadata: compendiumMeta
            }).eq("id", compendiumId);
          } catch {
          }
        } else {
          try {
            const { data: created, error } = await admin.from("study_sources").insert(compendiumPayload).select("id").maybeSingle();
            if (error) throw error;
            compendiumId = created?.id || null;
          } catch (err) {
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
                const { data: created } = await admin.from("study_sources").insert(legacyPayload).select("id").maybeSingle();
                compendiumId = created?.id || null;
              } catch {
                compendiumId = null;
              }
            }
          }
          if (compendiumId) {
            try {
              await admin.from("study_chat_sessions").update({ compendium_source_id: compendiumId }).eq("id", resolvedSessionId);
            } catch {
            }
          }
        }
      } catch {
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
        attempts,
        timeout_ms: STUDYLAB_OPENAI_TIMEOUT_MS,
        max_output_tokens: maxTokens,
        sources: usedOracleSourcesCount,
        compendium: usedOracleCompendiumCount,
        attachments: normalizedAttachments.length
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}
const config = { api: { bodyParser: true } };
export {
  config,
  handler as default
};
