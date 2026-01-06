// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { assertDjtQuestServerEnv } from "../server/env-guard.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined;
const ANON_KEY = (process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY) as string;
const SERVICE_KEY = (SERVICE_ROLE_KEY || ANON_KEY) as string;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL_PREMIUM =
  process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_MODEL_OVERRIDE || "gpt-5.2";

type RangeKey = "week" | "month" | "quarter" | "semester" | "year";

function resolveRange(range: string | undefined): { key: RangeKey; from: string; to: string } {
  const now = new Date();
  const to = now.toISOString();
  let days = 7;
  let key: RangeKey = "week";
  switch (String(range || "").toLowerCase()) {
    case "month":
      days = 30;
      key = "month";
      break;
    case "quarter":
      days = 90;
      key = "quarter";
      break;
    case "semester":
      days = 180;
      key = "semester";
      break;
    case "year":
      days = 365;
      key = "year";
      break;
    default:
      days = 7;
      key = "week";
  }
  const fromDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { key, from: fromDate.toISOString(), to };
}

function extractHashtags(md: string): string[] {
  const tags = Array.from(md.matchAll(/#([A-Za-z0-9_.-]+)/g)).map((m) =>
    String(m[1] || "").toLowerCase()
  );
  return tags;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    assertDjtQuestServerEnv({ requireSupabaseUrl: false });
    if (!SUPABASE_URL || !SERVICE_KEY) {
      const { key, from, to } = resolveRange(String(req.query.range || "week"));
      return res.status(200).json({
        range: key,
        from,
        to,
        tags: [],
        ai: null,
        meta: { warning: "Supabase não configurado no servidor (SUPABASE_URL/SUPABASE_*_KEY)." },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    const authHeader = req.headers["authorization"] as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    const authed =
      token && ANON_KEY
        ? createClient(SUPABASE_URL, ANON_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          })
        : null;

    const { key, from, to } = resolveRange(String(req.query.range || "week"));

    if (!SERVICE_ROLE_KEY && !authed) {
      return res.status(200).json({
        range: key,
        from,
        to,
        tags: [],
        ai: null,
        meta: { warning: "Autenticação ausente para calcular trending (env sem SUPABASE_SERVICE_ROLE_KEY)." },
      });
    }

    const reader = SERVICE_ROLE_KEY ? admin : (authed || admin);

    const { data: posts, error } = await reader
      .from("sepbook_posts")
      .select("id, content_md, like_count, created_at")
      .gte("created_at", from)
      .lte("created_at", to);
    if (error) {
      if (/sepbook_posts/i.test(error.message) && /does not exist/i.test(error.message)) {
        return res.status(200).json({
          range: key,
          from,
          to,
          tags: [],
          ai: null,
          meta: { warning: "Tabela sepbook_posts ausente." },
        });
      }
      if (/(row level security|rls|permission denied|not authorized)/i.test(String(error.message || ""))) {
        return res.status(200).json({
          range: key,
          from,
          to,
          tags: [],
          ai: null,
          meta: { warning: "Permissão insuficiente para ler posts do SEPBook (RLS)." },
        });
      }
      return res.status(200).json({
        range: key,
        from,
        to,
        tags: [],
        ai: null,
        meta: { warning: "Falha ao carregar trending topics do SEPBook." },
      });
    }

    const tagMap: Record<
      string,
      { tag: string; count: number; likes: number; posts: string[]; latest: string }
    > = {};

    for (const p of posts || []) {
      const text = String(p.content_md || "");
      const tags = extractHashtags(text);
      if (!tags.length) continue;
      for (const t of tags) {
        if (!tagMap[t]) {
          tagMap[t] = {
            tag: t,
            count: 0,
            likes: 0,
            posts: [],
            latest: p.created_at,
          };
        }
        tagMap[t].count += 1;
        tagMap[t].likes += Number(p.like_count || 0);
        if (tagMap[t].posts.length < 3) tagMap[t].posts.push(text.slice(0, 280));
        if (p.created_at > tagMap[t].latest) tagMap[t].latest = p.created_at;
      }
    }

    let tags = Object.values(tagMap);
    tags.sort((a, b) => {
      const scoreA = a.count * 1.0 + a.likes * 0.5;
      const scoreB = b.count * 1.0 + b.likes * 0.5;
      return scoreB - scoreA;
    });
    tags = tags.slice(0, 15);

    let aiSummary: any = null;
    if (OPENAI_API_KEY && tags.length) {
      try {
        const system = `Você é um consultor de engajamento para uma rede social interna da DJT (SEPBook), ligada ao jogo de engajamento DJT Quest.
Objetivo: ler os hashtags e exemplos de posts mais usados e sintetizar os "temas quentes" da semana/mês/etc., SEM citar dados sensíveis.
Conecte sempre com o propósito do app: reforçar Conhecimento, Habilidades, Atitudes e Segurança (CHAS) em operações de energia.`;
        const user = `Período: ${key}
Hashtags agregadas:
${JSON.stringify(
  tags.map((t) => ({
    tag: t.tag,
    count: t.count,
    likes: t.likes,
    examples: t.posts,
  })),
  null,
  2
)}

Retorne um JSON estrito:
{"items":[
  {
    "tag":"texto",
    "label":"nome amigável do tema",
    "summary":"síntese em 2-3 frases do que está aparecendo",
    "dimension":"C|H|A|S",
    "suggested_actions":[
      "ação prática ou foco para líderes/colaboradores"
    ]
  }
]}`;

        const body: any = {
          model: OPENAI_MODEL_PREMIUM,
          temperature: 0.35,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        };

        if (/^gpt-5/i.test(String(OPENAI_MODEL_PREMIUM))) {
          body.max_completion_tokens = 1200;
        } else {
          body.max_tokens = 1200;
        }

        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (resp.ok) {
          const dj = await resp.json();
          const text = dj?.choices?.[0]?.message?.content || "";
          try {
            aiSummary = JSON.parse(text);
          } catch {
            const m = text.match(/\{[\s\S]*\}/);
            if (m) aiSummary = JSON.parse(m[0]);
          }
        }
      } catch {
        aiSummary = null;
      }
    }

    return res.status(200).json({
      range: key,
      from,
      to,
      tags,
      ai: aiSummary,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: false } };
