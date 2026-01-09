// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { parseJsonFromAiContent } from "../lib/ai-curation-provider.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

const LETTERS = ["A", "B", "C", "D"] as const;
type Letter = (typeof LETTERS)[number];

// Tabela de "premiação" em XP (10 degraus) inspirada no formato clássico de quiz de 10 níveis.
// Mantém saltos maiores do meio para o fim, como no programa original (sem citar nomes).
const XP_TABLE_MILHAO = [100, 200, 300, 400, 500, 1000, 2000, 3000, 5000, 10000] as const;
const BANNED_TERMS_RE = /smart\s*line|smartline|smarline/i;
const XP_BY_DIFFICULTY = { basico: 5, intermediario: 10, avancado: 20, especialista: 50 } as const;

const asLetter = (value: any): Letter | null => {
  const s = (value ?? "").toString().trim().toUpperCase();
  return (LETTERS as readonly string[]).includes(s) ? (s as Letter) : null;
};

const shuffleInPlace = <T,>(arr: T[]) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const normalizeOptions = (raw: any): Record<Letter, string> | null => {
  if (!raw) return null;

  const out: Partial<Record<Letter, string>> = {};

  if (Array.isArray(raw)) {
    const vals = raw
      .map((v) => (v ?? "").toString().trim())
      .filter((v) => v.length > 0);
    if (vals.length >= 4) {
      out.A = vals[0];
      out.B = vals[1];
      out.C = vals[2];
      out.D = vals[3];
    }
  } else if (typeof raw === "object") {
    for (const [kRaw, vRaw] of Object.entries(raw)) {
      const k = asLetter(kRaw);
      if (!k) continue;
      const v = (vRaw ?? "").toString().trim();
      if (!v) continue;
      out[k] = v;
    }
  }

  const filled = LETTERS.every((k) => typeof out[k] === "string" && out[k]!.trim().length > 0);
  if (!filled) return null;
  return out as Record<Letter, string>;
};

const buildCorrectLetterPlan = (count: number): Letter[] => {
  const plan: Letter[] = [];
  for (let i = 0; i < count; i++) {
    plan.push(LETTERS[i % LETTERS.length]);
  }
  return shuffleInPlace(plan);
};

const remapOptionsToTargetCorrect = (
  options: Record<Letter, string>,
  correctLetter: Letter,
  targetCorrectLetter: Letter,
): { options: Record<Letter, string>; correct_letter: Letter } => {
  const correctText = options[correctLetter];
  const wrongTexts = LETTERS.filter((l) => l !== correctLetter).map((l) => options[l]);
  shuffleInPlace(wrongTexts);

  const remainingLetters = LETTERS.filter((l) => l !== targetCorrectLetter);
  shuffleInPlace(remainingLetters);

  const out: Record<Letter, string> = { A: "", B: "", C: "", D: "" };
  out[targetCorrectLetter] = correctText;
  for (let i = 0; i < remainingLetters.length; i++) {
    out[remainingLetters[i]] = wrongTexts[i] ?? "";
  }
  return { options: out, correct_letter: targetCorrectLetter };
};

const safeTrim = (s: any) => (s ?? "").toString().trim();

const normalizeKey = (value: any) =>
  safeTrim(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeDifficultyKey = (value: any): keyof typeof XP_BY_DIFFICULTY | null => {
  const s = normalizeKey(value);
  if (!s) return null;
  if (["basico", "basica", "basic"].includes(s)) return "basico";
  if (["intermediario", "intermediaria", "intermediate"].includes(s)) return "intermediario";
  if (["avancado", "avancada", "advanced"].includes(s)) return "avancado";
  if (["especialista", "expert", "expertise"].includes(s)) return "especialista";
  return null;
};

const levelToDifficulty = (level: number): keyof typeof XP_BY_DIFFICULTY => {
  if (level <= 3) return "basico";
  if (level <= 6) return "intermediario";
  if (level <= 8) return "avancado";
  return "especialista";
};

const sanitizeOptionText = (s: string) => {
  // remove bullets/labels that models sometimes add
  return s
    .replace(/^\s*[A-D]\)\s*/i, "")
    .replace(/^\s*[A-D]\.\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
};

async function refineMilhaoDistractors(params: {
  openaiKey: string;
  model: string;
  language: string;
  forbidTermsRe: RegExp;
  questions: Array<{
    level: number;
    question_text: string;
    correct_letter: Letter;
    options: Record<Letter, string>;
  }>;
}) {
  const { openaiKey, model, language, forbidTermsRe, questions } = params;
  if (!openaiKey) return questions;
  if (!questions.length) return questions;

  const payload = questions.map((q) => {
    const wrongs = LETTERS.filter((l) => l !== q.correct_letter).map((l) => q.options[l]);
    return {
      level: q.level,
      question_text: q.question_text,
      correct_text: q.options[q.correct_letter],
      wrong_texts: wrongs,
    };
  });

  const system = `Você é um especialista em elaboração de alternativas (distratores) para quizzes técnicos no setor elétrico (CPFL/SEP/subtransmissão), em ${language}.
Sua tarefa: reescrever APENAS as 3 alternativas ERRADAS de cada questão para ficarem menos óbvias e mais verossímeis, respeitando a progressão de dificuldade do nível (1→10).

Regras obrigatórias:
- NÃO altere o enunciado nem a alternativa correta (correct_text). Reescreva somente wrong_texts.
- Para cada questão, retorne exatamente 3 alternativas erradas.
- Distratores devem ser "near-miss": bem próximos da correta, mudando 1 detalhe-chave (parâmetro, passo, condição, sigla/termo, responsabilidade, sequência).
- Garanta que cada alternativa errada seja definitivamente INCORRETA no contexto do enunciado. Se algum wrong_text estiver correto ou parcialmente correto, reescreva para torná-lo errado (mudando 1 detalhe-chave), sem criar uma “segunda correta”.
- Evite alternativas absurdas, vagas, genéricas ou placeholders.
- Evite "todas/nenhuma", "A e B", e respostas autoevidentes.
- Proibido mencionar SmartLine/Smartline/Smart Line (outro projeto).
- Não cite marcas/programas de TV.

Formato de saída: JSON estrito (sem markdown):
{ "items": [ { "level": 1, "wrong_texts": ["...","...","..."] } ] }`;

  const user = `Reescreva os distratores mantendo o mesmo tema e vocabulário do enunciado/correct_text.
Entrada JSON:
${JSON.stringify({ items: payload })}`;

  const body: any = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (/^gpt-5/i.test(String(model))) body.max_completion_tokens = 2200;
  else body.max_tokens = 2200;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) return questions;
  const data = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content || "";
  if (!content) return questions;

  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  }

  const items = parsed?.items;
  if (!Array.isArray(items)) return questions;
  const byLevel = new Map<number, string[]>();
  for (const it of items) {
    const level = Number(it?.level);
    const wrongs = Array.isArray(it?.wrong_texts) ? it.wrong_texts : [];
    const cleaned = wrongs.map((w: any) => sanitizeOptionText(safeTrim(w))).filter(Boolean);
    if (!Number.isFinite(level) || cleaned.length < 3) continue;
    if (cleaned.some((w) => forbidTermsRe.test(w))) continue;
    byLevel.set(level, cleaned.slice(0, 3));
  }

  return questions.map((q) => {
    const wrongs = byLevel.get(q.level);
    if (!wrongs || wrongs.length < 3) return q;
    const out: Record<Letter, string> = { ...q.options };
    const wrongLetters = LETTERS.filter((l) => l !== q.correct_letter);
    for (let i = 0; i < wrongLetters.length; i++) {
      out[wrongLetters[i]] = wrongs[i] ?? out[wrongLetters[i]];
    }
    return { ...q, options: out };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    const {
      url,
      title,
      topic,
      context,
      specialties = [],
      instructions,
      userId,
      sources = [],
      source_ids = [],
      source_urls = [],
      web_query = "",
      web_context = "",
      kb_tags = [],
      kb_focus = "",
      mode = "standard",
      question_count = 5,
      language = "pt-BR",
      save_source = false,
      difficulty_level = null,
      xp_value = null,
      milhao_level_start = null,
      milhao_level = null,
      refine_distractors = null,
    } = req.body || {};

    const items: Array<{ title: string; text: string }> = [];
    const admin =
      SUPABASE_URL && SERVICE_KEY
        ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
        : null;

    const getUserId = async () => {
      if (!admin) return null;
      const authHeader = req.headers["authorization"] as string | undefined;
      if (!authHeader?.startsWith("Bearer ")) return null;
      const token = authHeader.slice(7);
      try {
        const { data } = await admin.auth.getUser(token);
        return data?.user?.id || null;
      } catch {
        return null;
      }
    };

    const currentUserId = await getUserId();
    let isLeaderOrStaff = false;
    if (admin && currentUserId) {
      try {
        const [{ data: profile }, { data: rolesRows }] = await Promise.all([
          admin.from("profiles").select("studio_access, is_leader").eq("id", currentUserId).maybeSingle(),
          admin.from("user_roles").select("role").eq("user_id", currentUserId),
        ]);
        const roleSet = new Set((rolesRows || []).map((r: any) => String(r?.role || "").trim()).filter(Boolean));
        const STAFF = new Set([
          "admin",
          "gerente_djt",
          "gerente_divisao_djtx",
          "coordenador_djtx",
          "content_curator",
          "lider_equipe",
        ]);
        isLeaderOrStaff =
          Boolean(profile?.studio_access) ||
          Boolean(profile?.is_leader) ||
          Array.from(roleSet).some((r) => STAFF.has(r));
      } catch {
        isLeaderOrStaff = false;
      }
    }

    const stripHtml = (html: string) =>
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const collectOutputText = (payload: any) => {
      if (typeof payload?.output_text === "string") return payload.output_text.trim();
      const output = Array.isArray(payload?.output) ? payload.output : [];
      const chunks = output
        .map((item: any) => {
          if (typeof item?.content === "string") return item.content;
          if (Array.isArray(item?.content)) return item.content.map((c: any) => c?.text || c?.content || "").join("\n");
          return item?.text || "";
        })
        .filter(Boolean);
      return chunks.join("\n").trim();
    };

    const fetchWebQueryContext = async (query: string) => {
      const q = String(query || "").trim();
      if (!OPENAI_API_KEY || !q) return null;

      const tools = ["web_search", "web_search_preview"];
      const model =
        (process.env.OPENAI_MODEL_FAST as string) ||
        (process.env.OPENAI_MODEL_PREMIUM as string) ||
        (process.env.OPENAI_MODEL_COMPAT as string) ||
        "gpt-5-nano-2025-08-07";

      const input = [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "Use a ferramenta de pesquisa na web UMA vez e depois devolva um contexto curto para gerar perguntas de quiz (8 a 12 bullets) + 'Fontes:' com 3 a 6 links. Seja objetivo e não invente normas internas.",
            },
          ],
        },
        { role: "user", content: [{ type: "input_text", text: q }] },
      ];

      for (const tool of tools) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          const resp = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
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
            if (/tool|web_search|unknown|invalid/i.test(msg)) continue;
            return null;
          }
          const out = Array.isArray(json?.output) ? json.output : [];
          const usedTool = out.some((o: any) => o?.type === "web_search_call");
          if (!usedTool) continue;
          const text = collectOutputText(json);
          if (text) return text;
        } catch {
          // ignore
        } finally {
          clearTimeout(timer);
        }
      }
      return null;
    };

    const fetchUrlContent = async (rawUrl: string) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(rawUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`Falha ao abrir URL (${resp.status})`);
        const text = await resp.text();
        return stripHtml(text).slice(0, 12000);
      } catch (err: any) {
        throw new Error(`Não foi possível ler o conteúdo da URL (${rawUrl}): ${err?.message || err}`);
      }
    };

    const primaryUrl = (url || "").toString().trim();
    const webQuery = (web_query || "").toString().trim();
    const webContext = (web_context || "").toString().trim();
    let webContextOut: string | null = null;
    const topicText = (topic || "").toString().trim();
    const contextText = (context || "").toString().trim();
    const instructionsText = (instructions || "").toString().trim();
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
    const specialtiesList = Array.isArray(specialties)
      ? (specialties as any[])
          .map((s) => (s ?? "").toString().trim())
          .filter((s) => s.length > 0)
      : [];

    const hasAnyInput =
      Boolean(primaryUrl) ||
      Boolean(webQuery) ||
      Boolean(webContext) ||
      (Array.isArray(sources) && sources.length > 0) ||
      (Array.isArray(source_ids) && source_ids.length > 0) ||
      (Array.isArray(source_urls) && source_urls.length > 0) ||
      Boolean(topicText) ||
      Boolean(contextText) ||
      Boolean(instructionsText) ||
      forumKbTags.length > 0;

    if (!hasAnyInput) {
      return res.status(400).json({ error: "Informe um tema/contexto, uma URL, ou fontes válidas." });
    }

    if (webContext) {
      items.push({
        title: `Pesquisa web (pré-carregada): ${webQuery.slice(0, 120) || "contexto"}`,
        text: webContext.slice(0, 6000),
      });
      webContextOut = webContext.slice(0, 6000);
    } else if (webQuery) {
      try {
        const txt = await fetchWebQueryContext(webQuery);
        if (txt) {
          items.push({
            title: `Pesquisa web: ${webQuery.slice(0, 120)}`,
            text: txt.slice(0, 6000),
          });
          webContextOut = txt.slice(0, 6000);
        }
      } catch {
        // ignore web failures
      }
    }

    if (Array.isArray(sources)) {
      for (const s of sources) {
        if (!s) continue;
        const title = (s.title || "").toString();
        const text = (s.text || "").toString();
        if (text.trim().length > 0) {
          items.push({ title, text: text.slice(0, 12000) });
        }
      }
    }

    // Permite geração sem StudyLab: usa apenas instruções/contexto fornecidos no momento.
    // Se houver fontes (dataset/StudyLab/URLs), elas continuam sendo a base principal.
    const contextualSeedParts = [
      topicText ? `Tema: ${topicText}` : "",
      specialtiesList.length ? `Especialidades: ${specialtiesList.join(", ")}` : "",
      contextText ? `Contexto: ${contextText}` : "",
      instructionsText ? `Instruções: ${instructionsText}` : "",
      forumKbFocus ? `Foco (base de conhecimento): ${forumKbFocus}` : "",
      forumKbTags.length ? `Hashtags (base de conhecimento): ${forumKbTags.map((t: string) => `#${t}`).join(" ")}` : "",
    ].filter(Boolean);

    if (contextualSeedParts.length && items.length === 0) {
      items.push({ title: "Contexto do usuário", text: contextualSeedParts.join("\n").slice(0, 6000) });
    }

    // Base de conhecimento (por hashtags) como fontes adicionais
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
        for (const row of rows) {
          const title = (row?.title || "").toString().trim() || "Base de Conhecimento";
          const sourceType = String(row?.source_type || "forum").toLowerCase();
          const raw = (row?.content || "").toString().trim();
          const html = (row?.content_html || "").toString().trim();
          const text = raw || (html ? stripHtml(html) : "");
          if (!text.trim()) continue;
          const hashtags = Array.isArray(row?.hashtags) ? row.hashtags.slice(0, 10).map((h: any) => `#${h}`) : [];
          const flags = [
            sourceType === "study" ? "StudyLab" : "",
            row?.is_solution ? "solução" : "",
            row?.is_featured ? "destaque" : "",
            Number(row?.likes_count || 0) > 0 ? `${Number(row.likes_count)} curtidas` : "",
          ]
            .filter(Boolean)
            .join(" • ");
          const header = [
            forumKbFocus ? `Foco: ${forumKbFocus}` : "",
            sourceType === "study" ? "Origem: StudyLab" : "",
            flags ? `Sinais: ${flags}` : "",
            hashtags.length ? `Hashtags: ${hashtags.join(" ")}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          items.push({
            title: sourceType === "study" ? `StudyLab: ${title}` : `Fórum: ${title}`,
            text: `${header ? `${header}\n\n` : ""}${text.slice(0, 2000)}`,
          });
        }
      } catch {
        // best-effort
      }
    }

    if (Array.isArray(source_ids) && source_ids.length && admin) {
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { data } = await admin
        .from("study_sources")
        .select("id, user_id, scope, published, title, full_text, summary")
        .in("id", source_ids as string[]);
      const rows = Array.isArray(data) ? data : [];
      const allowed = rows.filter((row: any) => {
        if (isLeaderOrStaff) return true;
        if (String(row?.user_id || "") === String(currentUserId)) return true;
        const scope = String(row?.scope || "user").toLowerCase();
        const published = Boolean(row?.published);
        return scope === "org" && published;
      });

      if (!allowed.length) {
        return res.status(403).json({ error: "Você não tem acesso às fontes selecionadas do StudyLab." });
      }

      for (const row of allowed) {
        const text = (row.full_text || row.summary || "").toString();
        if (text.trim().length > 0) {
          items.push({ title: row.title || "Fonte", text: text.slice(0, 12000) });
        }
      }
    }

    const fetchedUrls: Array<{ title: string; text: string; url: string }> = [];
    if (Array.isArray(source_urls) && source_urls.length) {
      for (const entry of source_urls) {
        if (!entry) continue;
        const url = (entry.url || "").toString().trim();
        if (!url) continue;
        const title = (entry.title || url).toString();
        try {
          const text = await fetchUrlContent(url);
          if (text) {
            fetchedUrls.push({ url, title, text });
            items.push({ title, text: text.slice(0, 12000) });
          }
        } catch (err: any) {
          return res.status(400).json({ error: err?.message || `Falha ao ler URL ${url}` });
        }
      }
    }

    if (primaryUrl) {
      try {
        const text = await fetchUrlContent(primaryUrl);
        if (text) {
          items.push({ title: title || primaryUrl, text: text.slice(0, 12000) });
          fetchedUrls.push({ url: primaryUrl, title: title || primaryUrl, text: text.slice(0, 12000) });
        }
      } catch (err: any) {
        return res.status(400).json({ error: err?.message || `Falha ao ler URL ${primaryUrl}` });
      }
    }

    if (!items.length) {
      return res.status(400).json({ error: "Nenhum conteúdo válido encontrado. Envie texto, 'source_ids' ou URLs válidas." });
    }

    const savedSources: any[] = [];
    if (save_source && (currentUserId || userId) && admin && fetchedUrls.length) {
      const ownerId = userId || currentUserId;
      for (const entry of fetchedUrls) {
        const summary = entry.text.slice(0, 600);
        const { data: saved, error } = await admin
          .from("study_sources")
          .insert({
            user_id: ownerId,
            title: entry.title,
            kind: "url",
            url: entry.url,
            summary,
            full_text: entry.text,
            is_persistent: true,
          })
          .select("id, user_id, title, kind, url, storage_path, summary, is_persistent, created_at, last_used_at")
          .maybeSingle();
        if (!error && saved) {
          savedSources.push(saved);
        }
      }
    }

    const joinedContext = items
      .map((s: any, idx: number) => `### Fonte ${idx + 1}: ${s.title || ""}\n${s.text || ""}`)
      .join("\n\n");

    const isMilhao = mode === "milhao";
    const milhaoStartRaw = milhao_level_start ?? milhao_level ?? null;
    const milhaoStartLevel = isMilhao
      ? Math.max(1, Math.min(10, Number(milhaoStartRaw) || 1))
      : 1;
    const maxMilhaoCount = isMilhao ? Math.max(1, 10 - milhaoStartLevel + 1) : 0;
    const desiredCount = isMilhao
      ? Math.max(1, Math.min(maxMilhaoCount, Number(question_count) || (milhaoStartRaw ? 1 : 10)))
      : Math.max(1, Math.min(50, Number(question_count) || 5));

    const forcedDifficulty = normalizeDifficultyKey(difficulty_level);
    const forcedXpRaw = Number(xp_value);
    const forcedXp = Number.isFinite(forcedXpRaw) && forcedXpRaw > 0 ? Math.floor(forcedXpRaw) : null;
    const hasReferenceSources =
      Boolean(primaryUrl) ||
      (Array.isArray(source_ids) && source_ids.length > 0) ||
      (Array.isArray(source_urls) && source_urls.length > 0) ||
      (Array.isArray(sources) && sources.length > 0) ||
      forumKbTags.length > 0;

    const systemWithSources = `Você é um gerador de quizzes técnicos para treinamento profissional no setor elétrico brasileiro (CPFL, SEP, subtransmissão, segurança, proteção, telecom).
Você receberá um conjunto de textos de estudo (fontes), e sua tarefa é criar um quiz COMPLETAMENTE baseado nesses materiais.

Regras de fidelidade:
- Use APENAS informações presentes nas fontes.
- Se algum detalhe não estiver explicitamente nas fontes, NÃO invente.
- Em "explanation", cite pelo menos uma referência no formato "Fonte X" (ex.: "Fonte 2") para mostrar de onde veio a resposta.
- Não crie perguntas “meta” sobre o texto/fonte (ex.: “qual é o tema do texto?”, “o que a fonte diz?”). As perguntas devem ser sobre o conteúdo técnico.
- No "question_text", não mencione “Fonte X”; use a referência apenas em "explanation".
- Proibido mencionar SmartLine/Smartline/Smart Line (é outro produto/projeto e é fora do escopo).
- Não cite/compare com nomes de programas de TV ou marcas; apenas siga um formato clássico de perguntas progressivas (sem nomes próprios).
- Se as fontes forem normas/procedimentos (ex.: NR-10, LOTO, PT/APR, padrões CPFL), use a terminologia e ordem de passos exatamente como escrito nelas; não complete com “conhecimento geral”.

Qualidade das alternativas (muito importante):
- Cada questão deve ter exatamente 4 alternativas (A, B, C, D), com textos distintos.
- Distratores devem ser plausíveis (near-miss), no mesmo estilo/tamanho da correta e tecnicamente verossímeis no contexto da pergunta.
- Distratores devem refletir confusões comuns do setor (troca de termos, passo de procedimento fora de ordem, parâmetro parecido, sigla confundida), e não “absurdos”.
- Evite alternativas obviamente absurdas, piadas, ou "todas/nenhuma das anteriores".
- Deve existir UMA única alternativa correta (sem ambiguidade).
- Evite que a correta seja sempre a mais longa ou a única com termos absolutos ("sempre", "nunca") sem suporte nas fontes.

Campos obrigatórios por questão:
- "question_text": enunciado claro, objetivo.
- "options": { "A": "...", "B": "...", "C": "...", "D": "..." }
- "correct_letter": "A" | "B" | "C" | "D"
- "explanation": explicação curta (1-3 frases) do porquê a alternativa correta é a correta, ancorada nas fontes.
- "difficulty_level": "basica" | "intermediaria" | "avancada" | "especialista"
- "xp_value": número (XP sugerido)

Modo padrão (standard):
- Gere entre 1 e 50 perguntas (use question_count como sugestão).
- Misture dificuldades de forma equilibrada.

Modo Quiz do Milhão (milhao):
- Gere perguntas na jornada de dificuldade 1→10. Por padrão são 10; se question_count indicar menos, gere apenas a quantidade solicitada.
- Use a tabela de XP: [100,200,300,400,500,1000,2000,3000,5000,10000] da pergunta 1 à 10.
- Curva 1→10 (guia):
  1) definição/recall direto do texto
  2) identificação/interpretação de conceito no texto
  3) aplicação simples (ex.: escolha de conduta ou conceito correto)
  4) procedimento/ordem correta descrita nas fontes
  5) diferenciar conceitos parecidos presentes nas fontes
  6) consequência/risco de uma decisão (dentro do que as fontes permitem)
  7) cenário prático com decisão (combinar 2+ detalhes do texto)
  8) cenário com trade-off e melhor conduta (sem extrapolar)
 9) troubleshooting/diagnóstico (combinar 2+ trechos do texto)
 10) cenário especialista multi-etapas (combinar 2+ trechos do texto), sem inventar normas/regras fora das fontes

Retorne APENAS JSON válido (sem markdown), no formato:
{
  "mode": "standard" | "milhao",
  "questions": [
    {
      "question_text": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct_letter": "A",
      "explanation": "...",
      "difficulty_level": "basica",
      "xp_value": 100
    }
  ]
}`;

    const systemWithoutSources = `Você é um gerador de quizzes técnicos para treinamento profissional no setor elétrico brasileiro (CPFL, SEP, subtransmissão, segurança, proteção, telecom).
Você receberá um tema/contexto fornecido pelo usuário e deve criar um quiz coerente com essas instruções.

Regras:
- Não mencione SmartLine/Smartline/Smart Line (é outro produto/projeto e é fora do escopo).
- Se o usuário não forneceu normas/manuais/textos, NÃO invente "padrões CPFL" ou detalhes de procedimentos internos; prefira perguntas sobre princípios, segurança, boas práticas e conceitos gerais do setor.
- Não cite/compare com nomes de programas de TV ou marcas; apenas siga um formato clássico de perguntas progressivas (sem nomes próprios).
- Evite perguntas “meta” sobre o contexto.

Qualidade das alternativas (muito importante):
- Cada questão deve ter exatamente 4 alternativas (A, B, C, D), com textos distintos.
- Distratores devem ser plausíveis (near-miss), no mesmo estilo/tamanho da correta e tecnicamente verossímeis no setor elétrico.
- Distratores devem refletir confusões comuns (conceito parecido, termo/sigla trocada, parâmetro próximo), e não “absurdos”.
- Evite alternativas obviamente absurdas, piadas, ou "todas/nenhuma das anteriores".
- Deve existir UMA única alternativa correta (sem ambiguidade).

Campos obrigatórios por questão:
- "question_text": enunciado claro, objetivo.
- "options": { "A": "...", "B": "...", "C": "...", "D": "..." }
- "correct_letter": "A" | "B" | "C" | "D"
- "explanation": explicação curta (1-3 frases) do porquê a alternativa correta é a correta (sem inventar referências).
- "difficulty_level": "basica" | "intermediaria" | "avancada" | "especialista"
- "xp_value": número (XP sugerido)

Modo padrão (standard):
- Gere entre 1 e 50 perguntas (use question_count como sugestão).
- Misture dificuldades de forma equilibrada.

Modo Quiz do Milhão (milhao):
- Gere perguntas na jornada de dificuldade 1→10. Por padrão são 10; se question_count indicar menos, gere apenas a quantidade solicitada.
- Use a tabela de XP: [100,200,300,400,500,1000,2000,3000,5000,10000] da pergunta 1 à 10.

Retorne APENAS JSON válido (sem markdown), no formato:
{
  "mode": "standard" | "milhao",
  "questions": [
    {
      "question_text": "...",
      "options": { "A": "...", "B": "...", "C": "...", "D": "..." },
      "correct_letter": "A",
      "explanation": "...",
      "difficulty_level": "basica",
      "xp_value": 100
    }
  ]
}`;

    const system = hasReferenceSources ? systemWithSources : systemWithoutSources;

    const userPreferences = contextualSeedParts.join("\n");
    const requestedXpValue = forcedXp || (forcedDifficulty ? XP_BY_DIFFICULTY[forcedDifficulty] : null);
    const userMessage = {
      role: "user",
      content: `Idioma: ${language}
Tipo de quiz: ${isMilhao ? "Quiz do Milhão (10 níveis)" : "Quiz rápido"}
Quantidade desejada de perguntas: ${desiredCount}
${
  isMilhao && milhaoStartLevel !== 1
    ? `\nNível inicial (Milhão): ${milhaoStartLevel} (gere níveis ${milhaoStartLevel}→${milhaoStartLevel + desiredCount - 1})`
    : ""
}
${
  !isMilhao && (forcedDifficulty || requestedXpValue)
    ? `\nDificuldade alvo: ${forcedDifficulty || "auto"} • XP alvo: ${requestedXpValue || "auto"}`
    : ""
}
${
  userPreferences
    ? `\nPreferências do usuário (não são fonte de fatos; use apenas as Fontes para conteúdo técnico):\n${userPreferences}\n`
    : ""
}

Conteúdo de estudo:
${joinedContext}`,
    };

    const models = Array.from(
      new Set(
        [
          process.env.OPENAI_MODEL_PREMIUM,
          "gpt-5-2025-08-07",
          "gpt-5-2025-08-07",
          process.env.OPENAI_MODEL_OVERRIDE,
          process.env.OPENAI_MODEL_FAST,
          "gpt-5-2025-08-07",
          "gpt-5-2025-08-07",
          "gpt-5",
        ].filter(Boolean),
      ),
    );

    let content = "";
    let lastErr = "";

    for (const model of models) {
      const maxTokens = desiredCount <= 1 ? 1600 : desiredCount <= 3 ? 2400 : desiredCount <= 5 ? 3200 : 4500;
      try {
        const body: any = {
          model,
          messages: [{ role: "system", content: system }, userMessage],
        };
        if (/^gpt-5/i.test(String(model))) body.max_completion_tokens = maxTokens;
        else body.max_tokens = maxTokens;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 22000);
        try {
          const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            signal: controller.signal,
            body: JSON.stringify(body),
          });

          if (!resp.ok) {
            lastErr = await resp.text().catch(() => `HTTP ${resp.status}`);
            continue;
          }

          const data = await resp.json().catch(() => null);
          content = data?.choices?.[0]?.message?.content || "";
          if (content) break;
        } finally {
          clearTimeout(timer);
        }
      } catch (e: any) {
        lastErr = e?.name === "AbortError" ? "timeout" : e?.message || String(e);
        continue;
      }
    }

    if (!content) {
      return res.status(400).json({ error: `OpenAI error: ${lastErr || "no output"}` });
    }

    const json: any = parseJsonFromAiContent(content).parsed;

    if (!json || !Array.isArray(json.questions)) {
      return res.status(400).json({ error: "Formato inesperado da IA", raw: content });
    }

    const questions = (json.questions as any[]).slice(0, desiredCount);
    if (isMilhao && !milhaoStartRaw && desiredCount === 10 && questions.length !== 10) {
      return res.status(400).json({ error: `A IA retornou ${questions.length} perguntas; esperado 10.`, raw: content });
    }
    if (!questions.length) {
      return res.status(400).json({ error: "A IA não retornou perguntas.", raw: content });
    }

    const correctLetterPlan = buildCorrectLetterPlan(questions.length);

    let normalizedQuestions: any[] = [];
    try {
      normalizedQuestions = questions.map((q: any, idx: number) => {
        const options = normalizeOptions(q.options);
        const correct = asLetter(q.correct_letter) || "A";
        if (!options) {
          throw new Error("Formato inválido de alternativas: esperado options com A-D");
        }

        const effectiveCorrect = options[correct] ? correct : ("A" as Letter);
        const targetCorrect = correctLetterPlan[idx] || "A";
        const remapped = remapOptionsToTargetCorrect(options, effectiveCorrect, targetCorrect);

        const level = isMilhao ? milhaoStartLevel + idx : idx + 1;
        const derivedDifficulty = isMilhao ? levelToDifficulty(level) : levelToDifficulty(idx + 1);
        const normalizedDifficulty = normalizeDifficultyKey(q.difficulty_level) || null;
        const effectiveDifficulty = isMilhao ? derivedDifficulty : (forcedDifficulty || normalizedDifficulty || derivedDifficulty);
        const derivedXp = XP_BY_DIFFICULTY[effectiveDifficulty] || 10;
        const effectiveXp = isMilhao ? XP_TABLE_MILHAO[level - 1] : (forcedXp || derivedXp || Number(q.xp_value) || derivedXp);

        return {
          question_text: (q.question_text ?? "").toString().trim(),
          options: remapped.options,
          correct_letter: remapped.correct_letter,
          explanation: (q.explanation ?? "").toString().trim(),
          difficulty_level: effectiveDifficulty,
          xp_value: effectiveXp,
          level,
        };
      });
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Falha ao normalizar perguntas da IA", raw: content });
    }

    const shouldRefine =
      isMilhao && ((refine_distractors === true) || (refine_distractors == null && !milhaoStartRaw && desiredCount === 10));

    if (shouldRefine) {
      try {
        const refineModel =
          (process.env.OPENAI_MODEL_PREMIUM as string) ||
          (process.env.OPENAI_MODEL_OVERRIDE as string) ||
          "gpt-5-2025-08-07";
        normalizedQuestions = await refineMilhaoDistractors({
          openaiKey: OPENAI_API_KEY,
          model: refineModel,
          language,
          forbidTermsRe: BANNED_TERMS_RE,
          questions: normalizedQuestions,
        });
      } catch {
        // keep original options if refinement fails
      }
    }

    json.mode = isMilhao ? "milhao" : "standard";
    json.questions = normalizedQuestions;

    for (const q of normalizedQuestions) {
      if (BANNED_TERMS_RE.test(String(q?.question_text || ""))) {
        return res.status(400).json({ error: 'Conteúdo fora do escopo detectado ("SmartLine"). Revise as fontes selecionadas e gere novamente.' });
      }
      if (BANNED_TERMS_RE.test(String(q?.explanation || ""))) {
        return res.status(400).json({ error: 'Conteúdo fora do escopo detectado ("SmartLine"). Revise as fontes selecionadas e gere novamente.' });
      }
      const opts = q?.options || {};
      for (const v of Object.values(opts)) {
        if (BANNED_TERMS_RE.test(String(v || ""))) {
          return res.status(400).json({ error: 'Conteúdo fora do escopo detectado ("SmartLine"). Revise as fontes selecionadas e gere novamente.' });
        }
      }
    }

    return res.status(200).json({ success: true, quiz: json, saved_sources: savedSources, web_context: webContextOut });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
