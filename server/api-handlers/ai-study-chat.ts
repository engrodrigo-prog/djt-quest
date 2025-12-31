// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "module";
import { extractPdfText, extractDocxText, extractJsonText, extractPlainText } from "../lib/import-parsers.js";
import { extractImageTextWithAi } from "../lib/ai-curation-provider.js";
import { DJT_RULES_ARTICLE } from "../../shared/djt-rules.js";

const require = createRequire(import.meta.url);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

function chooseModel(preferPremium = false) {
  const premium = process.env.OPENAI_MODEL_PREMIUM;
  const fast = process.env.OPENAI_MODEL_FAST;
  const fallback = preferPremium ? "gpt-5.2" : "gpt-5.2";

  const pick = preferPremium ? premium || fast : fast || premium;
  if (!pick) return fallback;

  const lower = pick.toLowerCase();
  // Valid OpenAI chat models begin with "gpt-" today; if not, ignore it
  if (!lower.startsWith("gpt-")) return fallback;
  return pick;
}

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

const collectOutputText = (payload: any) => {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = output
    .map((item: any) => {
      if (typeof item?.content === "string") return item.content;
      if (Array.isArray(item?.content)) {
        return item.content.map((c: any) => c?.text || c?.content || "").join("\n");
      }
      return item?.text || "";
    })
    .filter(Boolean);
  return chunks.join("\n").trim();
};

const fetchWebSearchSummary = async (query: string, model: string) => {
  if (!OPENAI_API_KEY || !query) return null;
  const tools = ["web_search", "web_search_preview"];
  const input = [
    {
      role: "system",
      content:
        "Responda com um resumo objetivo (5 a 8 bullets) e inclua as principais fontes consultadas no fim.",
    },
    { role: "user", content: query },
  ];

  for (const tool of tools) {
    try {
      const resp = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          input,
          tools: [{ type: tool }],
          max_output_tokens: 520,
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
      const text = collectOutputText(json);
      if (text) return { text, tool };
    } catch {
      // ignore and try fallback
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
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const admin =
      SUPABASE_URL && SERVICE_KEY
        ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
        : null;

    const {
      messages = [],
      question = "",
      source_id = null,
      language = "pt-BR",
      mode = "study",
      kb_tags = [],
      kb_focus = "",
      use_web = false,
    } = req.body || {};

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

    let joinedContext = "";
    let sourceRow: any = null;
    let lastUserText = "";
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

        const category = (sourceRow?.category || "").toString().trim().toUpperCase();
        const supportsMetadata = Boolean(sourceRow && Object.prototype.hasOwnProperty.call(sourceRow, "metadata"));
        const prevMeta = supportsMetadata && sourceRow?.metadata && typeof sourceRow.metadata === "object" ? sourceRow.metadata : null;
        const incident = prevMeta?.incident && typeof prevMeta.incident === "object" ? prevMeta.incident : null;
        const isIncident = category === "RELATORIO_OCORRENCIA" || Boolean(incident);

        const incidentContext =
          isIncident && incident
            ? `### Respostas do formulário (Relatório de Ocorrência)\n` +
              `- ocorrido: ${(incident.ocorrido || "").toString().slice(0, 800)}\n` +
              `- causa_raiz_modo_falha: ${(incident.causa_raiz_modo_falha || "").toString().slice(0, 800)}\n` +
              `- barreiras_cuidados: ${(incident.barreiras_cuidados || "").toString().slice(0, 800)}\n` +
              `- acoes_corretivas_preventivas: ${(incident.acoes_corretivas_preventivas || "").toString().slice(0, 800)}\n` +
              `- mudancas_implementadas: ${(incident.mudancas_implementadas || "").toString().slice(0, 800)}\n\n`
            : "";

        const baseMaterial = trimmed.slice(0, 6000);
        const userContent = isIncident
          ? "Leia o conteúdo abaixo e responda APENAS em JSON válido no formato:\n" +
            "{\n" +
            '  "title": "...",\n' +
            '  "summary": "...",\n' +
            '  "topic": "LINHAS",\n' +
            '  "hashtags": ["#tag1", "#tag2"],\n' +
            '  "outline": [{"title": "Seção 1", "children": [{"title": "Subseção"}]}],\n' +
            '  "questions": [{"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "explanation": "...", "difficulty": "basico"}],\n' +
            '  "aprendizados": ["..."],\n' +
            '  "cuidados": ["..."],\n' +
            '  "mudancas": ["..."]\n' +
            "}\n\n" +
            "- title: título curto.\n" +
            "- summary: 2 a 4 frases, em português.\n" +
            `- topic: escolha UMA categoria entre: ${allowedTopics.join(", ")}.\n` +
            "- hashtags: 4 a 8 hashtags curtas (sem espaços), use termos do material.\n" +
            "- outline: 4 a 10 subtítulos, até 3 níveis (use [] se não fizer sentido).\n" +
            "- questions: 4 a 8 perguntas com 4 alternativas (use [] se o material for insuficiente).\n" +
            "- aprendizados/cuidados/mudancas: 3 a 7 itens cada (use [] se não tiver evidência no texto/formulário).\n" +
            "- NÃO invente detalhes que não estejam no material ou no formulário.\n\n" +
            incidentContext +
            "### Material\n" +
            baseMaterial
          : "Leia o material abaixo e responda APENAS em JSON válido no formato:\n" +
            "{\n" +
            '  "title": "...",\n' +
            '  "summary": "...",\n' +
            '  "topic": "LINHAS",\n' +
            '  "hashtags": ["#tag1", "#tag2"],\n' +
            '  "outline": [{"title": "Seção 1", "children": [{"title": "Subseção"}]}],\n' +
            '  "questions": [{"question": "...", "options": ["A", "B", "C", "D"], "answer_index": 0, "explanation": "...", "difficulty": "basico"}]\n' +
            "}\n\n" +
            "- title: título curto, sem siglas de GED.\n" +
            "- summary: resumo em 2 a 4 frases, em português.\n" +
            `- topic: escolha UMA categoria entre: ${allowedTopics.join(", ")}.\n` +
            "- hashtags: 4 a 8 hashtags curtas (sem espaços), use termos do material.\n" +
            "- outline: 4 a 10 subtítulos, até 3 níveis (use [] se não fizer sentido).\n" +
            "- questions: 4 a 8 perguntas com 4 alternativas (use [] se o material for insuficiente).\n\n" +
            baseMaterial;

        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content:
                  isIncident
                    ? "Você resume e extrai aprendizados de Relatórios de Ocorrência no setor elétrico (CPFL). Gere título, resumo, assunto, aprendizados, cuidados e mudanças."
                    : "Você resume e classifica materiais de estudo técnicos (setor elétrico CPFL). Gere um título curto, um resumo objetivo e uma categoria de assunto.",
              },
              {
                role: "user",
                content: userContent,
              },
            ],
            temperature: 0.4,
            max_completion_tokens: isIncident ? 500 : 300,
          }),
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
          let parsed: any = null;
          try {
            parsed = JSON.parse(content);
          } catch {
            const match = content.match?.(/\{[\s\S]*\}/);
            if (match) {
              parsed = JSON.parse(match[0]);
            }
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
          const newSummary = typeof parsed?.summary === "string" ? parsed.summary.trim() : null;
          const topicRaw = typeof parsed?.topic === "string" ? parsed.topic.toUpperCase().trim() : null;
          const topic = topicRaw && allowedTopics.includes(topicRaw) ? topicRaw : null;
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
                ai: {
                  ...((prevMeta && typeof prevMeta === "object" ? prevMeta.ai : null) || {}),
                  ingested_at: new Date().toISOString(),
                  ...(topic ? { topic } : {}),
                  ...(mergedTags.length ? { tags: mergedTags } : {}),
                  ...(outline.length ? { outline } : {}),
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
    const normalizedMessages = Array.isArray(messages) ? messages : [];
    if (normalizedMessages.length === 0 && typeof question === "string" && question.trim()) {
      normalizedMessages.push({ role: "user", content: question.trim() });
    }

    if (!Array.isArray(normalizedMessages) || normalizedMessages.length === 0) {
      return res.status(400).json({ error: "Mensagens inválidas" });
    }

    const focusHint = forumKbFocus
      ? `\n\nFoco do usuário (temas da base de conhecimento): ${forumKbFocus}\n- Priorize esse foco ao responder e ao sugerir próximos passos.`
      : "";

    const system =
      mode === "oracle"
        ? `Você é o Oráculo de Conhecimento do DJT Quest.
Você ajuda colaboradores a encontrar respostas e aprendizados usando toda a base disponível (catálogo publicado da organização, materiais do próprio usuário e compêndio de ocorrências aprovadas).

Regras:
- Seja claro e prático. Diga o que a pessoa deve fazer, checar ou perguntar em campo (quando fizer sentido).
- Se a resposta depender de uma informação que NÃO aparece na base enviada, deixe isso explícito e responda de forma geral (sem inventar detalhes).
- Quando usar a base, cite rapidamente de onde veio: título da fonte/ocorrência.
- Sugira 1 a 3 próximos passos (ex.: “quer que eu gere perguntas de quiz sobre isso?”).
${focusHint}

Formato:
- Responda em ${language}, em texto livre, com quebras de linha amigáveis.
- Não responda em JSON.`
        : `Você é um tutor de estudos no contexto de treinamento técnico CPFL / setor elétrico brasileiro.
Você recebe materiais de estudo (textos, resumos, transcrições, links) e perguntas de um colaborador.

Seu objetivo:
- Explicar conceitos passo a passo, em linguagem clara, mantendo a precisão técnica.
- Sempre que possível, conectar a resposta diretamente ao conteúdo das fontes fornecidas.
- Sempre deixe explícito na resposta quando estiver usando um material específico, por exemplo: "Com base no material de estudo sobre X..." ou "No documento selecionado, vemos que...".
- Se algo não estiver nas fontes, deixe claro que a informação não aparece no material e responda de forma geral sem inventar detalhes específicos.
- Sugira, quando fizer sentido, 1 a 3 perguntas extras para o colaborador praticar em cima do tema.
${focusHint}

Formato da saída:
- Responda em ${language}, em texto livre, com quebras de linha amigáveis.
- Você pode usar bullets e listas curtas, mas não use nenhum formato de JSON.`;

    const openaiMessages: any[] = [{ role: "system", content: system }];

    // Oracle: monta contexto com busca nas fontes + compêndio
    if (mode === "oracle" && admin) {
      const normalizedMessagesForQuery = Array.isArray(messages) ? messages : [];
      const lastUserMsg =
        (normalizedMessagesForQuery.slice().reverse().find((m: any) => m?.role === "user" && m?.content)?.content ||
          question ||
          "") + "";

      const text = lastUserMsg.toString();
      lastUserText = text;
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
        const select =
          "id, user_id, title, summary, full_text, url, topic, category, scope, published, metadata, created_at";
        const q = admin.from("study_sources").select(select).order("created_at", { ascending: false }).limit(200);
        if (uid) {
          if (isLeaderOrStaff) q.or(`user_id.eq.${uid},scope.eq.org`);
          else q.or(`user_id.eq.${uid},and(scope.eq.org,published.eq.true)`);
        } else {
          q.eq("scope", "org").eq("published", true);
        }
        const { data } = await q;
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

      const rankedSources = sourcesForOracle
        .map((s) => {
          const hay = [s.title, s.summary, s.full_text, s.topic, s.category].filter(Boolean).join(" ");
          return { s, score: keywords.length ? scoreText(hay, keywords) : 0 };
        })
        .filter((x) => (keywords.length ? x.score > 0 : true))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => x.s);

      // 2) Compêndio de ocorrências (aprovadas)
      let compendium: any[] = [];
      try {
        const { data } = await admin
          .from("content_imports")
          .select("id, final_approved, created_at")
          .eq("status", "FINAL_APPROVED")
          .filter("final_approved->>kind", "eq", "incident_report")
          .order("created_at", { ascending: false })
          .limit(200);
        compendium = Array.isArray(data) ? data : [];
      } catch {
        compendium = [];
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
        .slice(0, 5);

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

      const contextParts: string[] = [];
      if (rankedSources.length) {
        contextParts.push(
          "### Catálogo de Estudos (trechos)\n" +
            rankedSources
              .map((s, idx) => {
                const title = String(s.title || `Fonte ${idx + 1}`);
                const summary = String(s.summary || "").trim();
                const text = String(s.full_text || "").trim();
                const excerpt = text ? text.slice(0, 1800) : "";
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
    if (mode === "oracle" && useWeb && lastUserText) {
      const webModel = chooseModel(true);
      const webSummary = await fetchWebSearchSummary(lastUserText, webModel);
      if (webSummary?.text) {
        openaiMessages.push({
          role: "system",
          content: `Pesquisa web automatica (resumo):\n${webSummary.text}`,
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

    const preferPremium =
      mode === "oracle" ||
      useWeb ||
      (sourceRow && String(sourceRow.scope || "").toLowerCase() === "org" && sourceRow.published !== false);
    const model = chooseModel(preferPremium);

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: openaiMessages,
        temperature: 0.6,
        max_completion_tokens: 1200,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => `HTTP ${resp.status}`);
      return res.status(200).json({ success: false, error: `OpenAI error: ${txt}` });
    }

    const data = await resp.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content || "";
    if (!content) {
      return res.status(200).json({ success: false, error: "OpenAI retornou resposta vazia" });
    }

    return res.status(200).json({ success: true, answer: content });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
