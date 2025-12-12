// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

function chooseModel(preferPremium = false) {
  const premium = process.env.OPENAI_MODEL_PREMIUM;
  const fast = process.env.OPENAI_MODEL_FAST;
  const fallback = "gpt-4.1";
  const pick = preferPremium ? premium || fast : fast || premium;
  if (!pick) return fallback;
  const lower = pick.toLowerCase();
  if (!lower.startsWith("gpt-")) return fallback;
  return pick;
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
      userId,
      sources = [],
      source_ids = [],
      source_urls = [],
      mode = "standard",
      question_count = 5,
      language = "pt-BR",
      save_source = false,
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
        throw new Error(`Não foi possível ler o conteúdo da URL (${rawUrl}): ${err?.message || err}`);
      }
    };

    const invalidSources =
      !Array.isArray(sources) && !Array.isArray(source_ids) && !Array.isArray(source_urls) && !url;
    if (invalidSources) {
      return res.status(400).json({ error: "Informe uma URL ou fontes válidas." });
    }

    const primaryUrl = (url || "").toString().trim();
    if (!primaryUrl && (!Array.isArray(sources) || sources.length === 0) && (!Array.isArray(source_ids) || source_ids.length === 0) && (!Array.isArray(source_urls) || source_urls.length === 0)) {
      return res.status(400).json({ error: "Missing url" });
    }

    if (Array.isArray(sources)) {
      for (const s of sources) {
        if (!s) continue;
        const title = (s.title || "").toString();
        const text = (s.text || "").toString();
        if (text.trim().length > 0) {
          items.push({ title, text });
        }
      }
    }

    if (Array.isArray(source_ids) && source_ids.length && admin) {
      const { data } = await admin
        .from("study_sources")
        .select("title, full_text, summary")
        .in("id", source_ids as string[]);
      for (const row of data || []) {
        const text = (row.full_text || row.summary || "").toString();
        if (text.trim().length > 0) {
          items.push({ title: row.title || "Fonte", text });
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
            items.push({ title, text });
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
          items.push({ title: title || primaryUrl, text });
          fetchedUrls.push({ url: primaryUrl, title: title || primaryUrl, text });
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
    const system = `Você é um gerador de quizzes técnicos para treinamento profissional no setor elétrico brasileiro (CPFL, SEP, subtransmissão, segurança, proteção, telecom).
Você receberá um conjunto de textos de estudo (fontes), e sua tarefa é criar um quiz completamente baseado nesses materiais.

Regras gerais:
- Use APENAS as informações presentes nas fontes para montar as perguntas.
- Evite perguntas genéricas demais; faça perguntas aplicadas, que ajudem o colaborador a reter o conteúdo.
- Cada questão deve ter:
  - "question_text": enunciado claro e objetivo.
  - "options": exatamente 4 alternativas (A, B, C, D) com textos distintos.
  - "correct_letter": letra da alternativa correta.
  - "explanation": explicação curta do porquê a alternativa correta é correta (e, se útil, o porquê as outras não são).
  - "difficulty_level": "basica" | "intermediaria" | "avancada" | "especialista".
  - "xp_value": valor de XP sugerido.

Modo padrão (standard):
- Gere entre 3 e 15 perguntas (use o campo question_count como sugestão).
- Distribua as dificuldades de forma equilibrada.

Modo Quiz do Milhão (milhao):
- Gere exatamente 10 perguntas, em níveis crescentes.
- Use a tabela de XP: [100,150,200,250,300,400,550,700,850,1000] da pergunta 1 à 10.
- Comece com questões básicas sobre conceitos diretos do texto e avance para cenários mais complexos/decisões técnicas.

Retorne APENAS JSON válido, no formato:
{
  "mode": "standard" | "milhao",
  "questions": [
    {
      "question_text": "...",
      "options": {
        "A": "...",
        "B": "...",
        "C": "...",
        "D": "..."
      },
      "correct_letter": "A",
      "explanation": "...",
      "difficulty_level": "basica",
      "xp_value": 100
    }
  ]
}`;

    const userMessage = {
      role: "user",
      content: `Idioma: ${language}
Tipo de quiz: ${isMilhao ? "Quiz do Milhão (10 níveis)" : "Quiz rápido"}
Quantidade desejada de perguntas: ${question_count}

Conteúdo de estudo:
${joinedContext}`,
    };

    const model = chooseModel(true);

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          userMessage,
        ],
        temperature: 0.7,
        max_completion_tokens: 3500,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => `HTTP ${resp.status}`);
      return res.status(400).json({ error: `OpenAI error: ${txt}` });
    }

    const data = await resp.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content || "";
    if (!content) {
      return res.status(400).json({ error: "OpenAI retornou resposta vazia" });
    }

    let json: any;
    try {
      json = JSON.parse(content);
    } catch {
      const match = content?.match?.(/\{[\s\S]*\}/);
      if (match) {
        json = JSON.parse(match[0]);
      }
    }

    if (!json || !Array.isArray(json.questions)) {
      return res.status(400).json({ error: "Formato inesperado da IA", raw: content });
    }

    return res.status(200).json({ success: true, quiz: json, saved_sources: savedSources });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
