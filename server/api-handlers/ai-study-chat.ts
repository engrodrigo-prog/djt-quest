// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const admin =
      SUPABASE_URL && SERVICE_KEY
        ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
        : null;

    const { messages = [], question = "", source_id = null, language = "pt-BR", mode = "study" } = req.body || {};

    let joinedContext = "";
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

    if (admin && source_id) {
      // Resolve authenticated user (opcional, para checar permissão)
      let uid: string | null = null;
      const authHeader = req.headers["authorization"] as string | undefined;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        try {
          const { data: userData } = await admin.auth.getUser(token);
          uid = userData?.user?.id || null;
        } catch {
          uid = null;
        }
      }

      const { data: sourceRow } = await admin
        .from("study_sources")
        .select("id, user_id, title, summary, full_text, url")
        .eq("id", source_id)
        .maybeSingle();

      if (sourceRow) {
        if (!uid || !sourceRow.user_id || sourceRow.user_id === uid) {
          let baseText = (sourceRow.full_text || sourceRow.summary || sourceRow.url || "").toString();

          // Enriquecer contexto garantindo que URLs tenham texto otimizado
          if (!sourceRow.full_text && sourceRow.url && sourceRow.url.startsWith("http")) {
            try {
              const fetched = await fetchUrlContent(sourceRow.url);
              if (fetched?.trim()) {
                baseText = fetched;
                // Persistir para próximas consultas
                await admin.from("study_sources").update({ full_text: fetched }).eq("id", source_id);
              }
            } catch {
              /* não bloqueia resposta; segue com o que tiver */
            }
          }

          if (baseText.trim()) {
            joinedContext = `### Fonte: ${sourceRow.title}\n${baseText}`;
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
          const model =
            process.env.OPENAI_MODEL_FAST ||
            process.env.OPENAI_MODEL_PREMIUM ||
            "gpt-4.1-mini";

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
                  "Você resume e classifica materiais de estudo técnicos (setor elétrico CPFL). Gere um título curto, um resumo objetivo e uma categoria de assunto.",
              },
              {
                role: "user",
                content:
                  "Leia o material abaixo e responda APENAS em JSON no formato " +
                  "{\"title\": \"...\", \"summary\": \"...\", \"topic\": \"LINHAS\"|\"SUBESTACOES\"|\"PROCEDIMENTOS\"|\"PROTECAO\"|\"AUTOMACAO\"|\"TELECOM\"|\"SEGURANCA_DO_TRABALHO\"}.\n" +
                  "- title: título curto, sem siglas de GED.\n" +
                  "- summary: resumo em 2 a 4 frases, em português.\n" +
                  "- topic: escolha UMA categoria que melhor representa o assunto principal.\n\n" +
                  trimmed.slice(0, 6000),
              },
            ],
            temperature: 0.4,
            max_completion_tokens: 300,
          }),
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => `HTTP ${resp.status}`);
          console.warn("Study ingest OpenAI error", txt);
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

          const newTitle = typeof parsed?.title === "string" ? parsed.title.trim() : null;
          const newSummary = typeof parsed?.summary === "string" ? parsed.summary.trim() : null;
          const topicRaw = typeof parsed?.topic === "string" ? parsed.topic.toUpperCase().trim() : null;
          const allowedTopics = [
            "LINHAS",
            "SUBESTACOES",
            "PROCEDIMENTOS",
            "PROTECAO",
            "AUTOMACAO",
            "TELECOM",
            "SEGURANCA_DO_TRABALHO",
          ];
          const topic = topicRaw && allowedTopics.includes(topicRaw) ? topicRaw : null;

          await admin
            .from("study_sources")
            .update({
              full_text: trimmed,
              ...(newTitle ? { title: newTitle } : {}),
              ...(newSummary ? { summary: newSummary } : {}),
              ...(topic ? { topic } : {}),
            })
            .eq("id", source_id);

          return res.status(200).json({
            success: true,
            ingested: true,
            title: newTitle,
            summary: newSummary,
            topic,
          });
        }
      } catch (e: any) {
        console.warn("Study ingest error", e?.message || e);
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

    const system = `Você é um tutor de estudos no contexto de treinamento técnico CPFL / setor elétrico brasileiro.
Você recebe materiais de estudo (textos, resumos, transcrições, links) e perguntas de um colaborador.

Seu objetivo:
- Explicar conceitos passo a passo, em linguagem clara, mantendo a precisão técnica.
- Sempre que possível, conectar a resposta diretamente ao conteúdo das fontes fornecidas.
- Sempre deixe explícito na resposta quando estiver usando um material específico, por exemplo: "Com base no material de estudo sobre X..." ou "No documento selecionado, vemos que...".
- Se algo não estiver nas fontes, deixe claro que a informação não aparece no material e responda de forma geral sem inventar detalhes específicos.
- Sugira, quando fizer sentido, 1 a 3 perguntas extras para o colaborador praticar em cima do tema.

Formato da saída:
- Responda em ${language}, em texto livre, com quebras de linha amigáveis.
- Você pode usar bullets e listas curtas, mas não use nenhum formato de JSON.`;

    const openaiMessages: any[] = [{ role: "system", content: system }];
    if (joinedContext) {
      openaiMessages.push({
        role: "system",
        content: `Abaixo estão os materiais de estudo do usuário. Use-os como base principal:\n\n${joinedContext}`,
      });
    }

    for (const m of normalizedMessages) {
      if (!m || !m.role || !m.content) continue;
      const role = m.role === "assistant" ? "assistant" : "user";
      openaiMessages.push({ role, content: m.content });
    }

    const model =
      process.env.OPENAI_MODEL_FAST ||
      process.env.OPENAI_MODEL_PREMIUM ||
      "gpt-4.1-mini";

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
      return res.status(400).json({ error: `OpenAI error: ${txt}` });
    }

    const data = await resp.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content || "";
    if (!content) {
      return res.status(400).json({ error: "OpenAI retornou resposta vazia" });
    }

    return res.status(200).json({ success: true, answer: content });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}

export const config = { api: { bodyParser: true } };
