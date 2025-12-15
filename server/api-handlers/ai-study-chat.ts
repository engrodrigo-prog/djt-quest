// @ts-nocheck
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;

function chooseModel(preferPremium = false) {
  const premium = process.env.OPENAI_MODEL_PREMIUM;
  const fast = process.env.OPENAI_MODEL_FAST;
  const fallback = preferPremium ? "gpt-4.1" : "gpt-4.1";

  const pick = preferPremium ? premium || fast : fast || premium;
  if (!pick) return fallback;

  const lower = pick.toLowerCase();
  // Valid OpenAI chat models begin with "gpt-" today; if not, ignore it
  if (!lower.startsWith("gpt-")) return fallback;
  return pick;
}

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
    let sourceRow: any = null;
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

      const selectV2 = "id, user_id, title, summary, full_text, url, topic, category, metadata, ingest_status, ingest_error, ingested_at";
      const selectV1 = "id, user_id, title, summary, full_text, url, ingest_status, ingest_error, ingested_at";

      let sourceRes = await admin.from("study_sources").select(selectV2).eq("id", source_id).maybeSingle();
      if (sourceRes.error && /column .*?(category|metadata)/i.test(String(sourceRes.error.message || sourceRes.error))) {
        sourceRes = await admin.from("study_sources").select(selectV1).eq("id", source_id).maybeSingle();
      }
      sourceRow = sourceRes.data || null;

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
        const model = chooseModel(true);

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
            '  "aprendizados": ["..."],\n' +
            '  "cuidados": ["..."],\n' +
            '  "mudancas": ["..."]\n' +
            "}\n\n" +
            "- title: título curto.\n" +
            "- summary: 2 a 4 frases, em português.\n" +
            `- topic: escolha UMA categoria entre: ${allowedTopics.join(", ")}.\n` +
            "- aprendizados/cuidados/mudancas: 3 a 7 itens cada (use [] se não tiver evidência no texto/formulário).\n" +
            "- NÃO invente detalhes que não estejam no material ou no formulário.\n\n" +
            incidentContext +
            "### Material\n" +
            baseMaterial
          : "Leia o material abaixo e responda APENAS em JSON no formato " +
            "{\"title\": \"...\", \"summary\": \"...\", \"topic\": \"LINHAS\"}.\n" +
            "- title: título curto, sem siglas de GED.\n" +
            "- summary: resumo em 2 a 4 frases, em português.\n" +
            `- topic: escolha UMA categoria entre: ${allowedTopics.join(", ")}.\n\n` +
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

          const aprendizados = Array.isArray(parsed?.aprendizados)
            ? parsed.aprendizados.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
            : [];
          const cuidados = Array.isArray(parsed?.cuidados)
            ? parsed.cuidados.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
            : [];
          const mudancas = Array.isArray(parsed?.mudancas)
            ? parsed.mudancas.map((x: any) => String(x || "").trim()).filter(Boolean).slice(0, 12)
            : [];

          const nextMeta = supportsMetadata
            ? {
                ...(prevMeta && typeof prevMeta === "object" ? prevMeta : {}),
                ai: {
                  ...((prevMeta && typeof prevMeta === "object" ? prevMeta.ai : null) || {}),
                  ingested_at: new Date().toISOString(),
                  ...(topic ? { topic } : {}),
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

    const model = chooseModel(true);

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
