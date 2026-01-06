import { createClient } from "@supabase/supabase-js";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const LETTERS = ["A", "B", "C", "D"];
const XP_TABLE_MILHAO = [100, 200, 300, 400, 500, 1e3, 2e3, 3e3, 5e3, 1e4];
const BANNED_TERMS_RE = /smart\s*line|smartline|smarline/i;
const asLetter = (value) => {
  const s = (value ?? "").toString().trim().toUpperCase();
  return LETTERS.includes(s) ? s : null;
};
const shuffleInPlace = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const normalizeOptions = (raw) => {
  if (!raw) return null;
  const out = {};
  if (Array.isArray(raw)) {
    const vals = raw.map((v) => (v ?? "").toString().trim()).filter((v) => v.length > 0);
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
  const filled = LETTERS.every((k) => typeof out[k] === "string" && out[k].trim().length > 0);
  if (!filled) return null;
  return out;
};
const buildCorrectLetterPlan = (count) => {
  const plan = [];
  for (let i = 0; i < count; i++) {
    plan.push(LETTERS[i % LETTERS.length]);
  }
  return shuffleInPlace(plan);
};
const remapOptionsToTargetCorrect = (options, correctLetter, targetCorrectLetter) => {
  const correctText = options[correctLetter];
  const wrongTexts = LETTERS.filter((l) => l !== correctLetter).map((l) => options[l]);
  shuffleInPlace(wrongTexts);
  const remainingLetters = LETTERS.filter((l) => l !== targetCorrectLetter);
  shuffleInPlace(remainingLetters);
  const out = { A: "", B: "", C: "", D: "" };
  out[targetCorrectLetter] = correctText;
  for (let i = 0; i < remainingLetters.length; i++) {
    out[remainingLetters[i]] = wrongTexts[i] ?? "";
  }
  return { options: out, correct_letter: targetCorrectLetter };
};
const safeTrim = (s) => (s ?? "").toString().trim();
const sanitizeOptionText = (s) => {
  return s.replace(/^\s*[A-D]\)\s*/i, "").replace(/^\s*[A-D]\.\s*/i, "").replace(/\s+/g, " ").trim();
};
async function refineMilhaoDistractors(params) {
  const { openaiKey, model, language, forbidTermsRe, questions } = params;
  if (!openaiKey) return questions;
  if (!questions.length) return questions;
  const payload = questions.map((q) => {
    const wrongs = LETTERS.filter((l) => l !== q.correct_letter).map((l) => q.options[l]);
    return {
      level: q.level,
      question_text: q.question_text,
      correct_text: q.options[q.correct_letter],
      wrong_texts: wrongs
    };
  });
  const system = `Voc\xEA \xE9 um especialista em elabora\xE7\xE3o de alternativas (distratores) para quizzes t\xE9cnicos no setor el\xE9trico (CPFL/SEP/subtransmiss\xE3o), em ${language}.
Sua tarefa: reescrever APENAS as 3 alternativas ERRADAS de cada quest\xE3o para ficarem menos \xF3bvias e mais veross\xEDmeis, respeitando a progress\xE3o de dificuldade do n\xEDvel (1\u219210).

Regras obrigat\xF3rias:
- N\xC3O altere o enunciado nem a alternativa correta (correct_text). Reescreva somente wrong_texts.
- Para cada quest\xE3o, retorne exatamente 3 alternativas erradas.
- Distratores devem ser "near-miss": bem pr\xF3ximos da correta, mudando 1 detalhe-chave (par\xE2metro, passo, condi\xE7\xE3o, sigla/termo, responsabilidade, sequ\xEAncia).
- Garanta que cada alternativa errada seja definitivamente INCORRETA no contexto do enunciado. Se algum wrong_text estiver correto ou parcialmente correto, reescreva para torn\xE1-lo errado (mudando 1 detalhe-chave), sem criar uma \u201Csegunda correta\u201D.
- Evite alternativas absurdas, vagas, gen\xE9ricas ou placeholders.
- Evite "todas/nenhuma", "A e B", e respostas autoevidentes.
- Proibido mencionar SmartLine/Smartline/Smart Line (outro projeto).
- N\xE3o cite marcas/programas de TV.

Formato de sa\xEDda: JSON estrito (sem markdown):
{ "items": [ { "level": 1, "wrong_texts": ["...","...","..."] } ] }`;
  const user = `Reescreva os distratores mantendo o mesmo tema e vocabul\xE1rio do enunciado/correct_text.
Entrada JSON:
${JSON.stringify({ items: payload })}`;
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };
  if (/^gpt-5/i.test(String(model))) body.max_completion_tokens = 2200;
  else body.max_tokens = 2200;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) return questions;
  const data = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content || "";
  if (!content) return questions;
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  }
  const items = parsed?.items;
  if (!Array.isArray(items)) return questions;
  const byLevel = /* @__PURE__ */ new Map();
  for (const it of items) {
    const level = Number(it?.level);
    const wrongs = Array.isArray(it?.wrong_texts) ? it.wrong_texts : [];
    const cleaned = wrongs.map((w) => sanitizeOptionText(safeTrim(w))).filter(Boolean);
    if (!Number.isFinite(level) || cleaned.length < 3) continue;
    if (cleaned.some((w) => forbidTermsRe.test(w))) continue;
    byLevel.set(level, cleaned.slice(0, 3));
  }
  return questions.map((q) => {
    const wrongs = byLevel.get(q.level);
    if (!wrongs || wrongs.length < 3) return q;
    const out = { ...q.options };
    const wrongLetters = LETTERS.filter((l) => l !== q.correct_letter);
    for (let i = 0; i < wrongLetters.length; i++) {
      out[wrongLetters[i]] = wrongs[i] ?? out[wrongLetters[i]];
    }
    return { ...q, options: out };
  });
}
async function handler(req, res) {
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
      kb_tags = [],
      kb_focus = "",
      mode = "standard",
      question_count = 5,
      language = "pt-BR",
      save_source = false
    } = req.body || {};
    const items = [];
    const admin = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }) : null;
    const getUserId = async () => {
      if (!admin) return null;
      const authHeader = req.headers["authorization"];
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
          admin.from("user_roles").select("role").eq("user_id", currentUserId)
        ]);
        const roleSet = new Set((rolesRows || []).map((r) => String(r?.role || "").trim()).filter(Boolean));
        const STAFF = /* @__PURE__ */ new Set([
          "admin",
          "gerente_djt",
          "gerente_divisao_djtx",
          "coordenador_djtx",
          "content_curator",
          "lider_equipe"
        ]);
        isLeaderOrStaff = Boolean(profile?.studio_access) || Boolean(profile?.is_leader) || Array.from(roleSet).some((r) => STAFF.has(r));
      } catch {
        isLeaderOrStaff = false;
      }
    }
    const stripHtml = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const fetchUrlContent = async (rawUrl) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8e3);
        const resp = await fetch(rawUrl, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok) throw new Error(`Falha ao abrir URL (${resp.status})`);
        const text = await resp.text();
        return stripHtml(text).slice(0, 2e4);
      } catch (err) {
        throw new Error(`N\xE3o foi poss\xEDvel ler o conte\xFAdo da URL (${rawUrl}): ${err?.message || err}`);
      }
    };
    const primaryUrl = (url || "").toString().trim();
    const topicText = (topic || "").toString().trim();
    const contextText = (context || "").toString().trim();
    const instructionsText = (instructions || "").toString().trim();
    const forumKbTagsRaw = Array.isArray(kb_tags) ? kb_tags : typeof kb_tags === "string" ? kb_tags.split(",") : [];
    const forumKbTags = Array.from(
      new Set(
        forumKbTagsRaw.map((t) => (t ?? "").toString().trim().replace(/^#+/, "").toLowerCase()).filter((t) => t.length > 0)
      )
    ).slice(0, 24);
    const forumKbFocus = (kb_focus || "").toString().trim().slice(0, 140);
    const specialtiesList = Array.isArray(specialties) ? specialties.map((s) => (s ?? "").toString().trim()).filter((s) => s.length > 0) : [];
    const hasAnyInput = Boolean(primaryUrl) || Array.isArray(sources) && sources.length > 0 || Array.isArray(source_ids) && source_ids.length > 0 || Array.isArray(source_urls) && source_urls.length > 0 || Boolean(topicText) || Boolean(contextText) || Boolean(instructionsText) || forumKbTags.length > 0;
    if (!hasAnyInput) {
      return res.status(400).json({ error: "Informe um tema/contexto, uma URL, ou fontes v\xE1lidas." });
    }
    if (Array.isArray(sources)) {
      for (const s of sources) {
        if (!s) continue;
        const title2 = (s.title || "").toString();
        const text = (s.text || "").toString();
        if (text.trim().length > 0) {
          items.push({ title: title2, text });
        }
      }
    }
    const contextualSeedParts = [
      topicText ? `Tema: ${topicText}` : "",
      specialtiesList.length ? `Especialidades: ${specialtiesList.join(", ")}` : "",
      contextText ? `Contexto: ${contextText}` : "",
      instructionsText ? `Instru\xE7\xF5es: ${instructionsText}` : "",
      forumKbFocus ? `Foco (base de conhecimento): ${forumKbFocus}` : "",
      forumKbTags.length ? `Hashtags (base de conhecimento): ${forumKbTags.map((t) => `#${t}`).join(" ")}` : ""
    ].filter(Boolean);
    if (contextualSeedParts.length && items.length === 0) {
      items.push({ title: "Contexto do usu\xE1rio", text: contextualSeedParts.join("\n") });
    }
    if (admin && forumKbTags.length) {
      try {
        let rows = [];
        try {
          const { data, error } = await admin.from("knowledge_base").select("source_type, title, post_id, source_id, content, content_html, hashtags, likes_count, is_solution, is_featured, kind, url").overlaps("hashtags", forumKbTags).order("is_solution", { ascending: false }).order("likes_count", { ascending: false }).limit(8);
          if (error) throw error;
          rows = Array.isArray(data) ? data : [];
        } catch {
          const { data } = await admin.from("forum_knowledge_base").select("title, post_id, content, content_html, hashtags, likes_count, is_solution, is_featured").overlaps("hashtags", forumKbTags).order("is_solution", { ascending: false }).order("likes_count", { ascending: false }).limit(8);
          rows = Array.isArray(data) ? data : [];
        }
        for (const row of rows) {
          const title2 = (row?.title || "").toString().trim() || "Base de Conhecimento";
          const sourceType = String(row?.source_type || "forum").toLowerCase();
          const raw = (row?.content || "").toString().trim();
          const html = (row?.content_html || "").toString().trim();
          const text = raw || (html ? stripHtml(html) : "");
          if (!text.trim()) continue;
          const hashtags = Array.isArray(row?.hashtags) ? row.hashtags.slice(0, 10).map((h) => `#${h}`) : [];
          const flags = [
            sourceType === "study" ? "StudyLab" : "",
            row?.is_solution ? "solu\xE7\xE3o" : "",
            row?.is_featured ? "destaque" : "",
            Number(row?.likes_count || 0) > 0 ? `${Number(row.likes_count)} curtidas` : ""
          ].filter(Boolean).join(" \u2022 ");
          const header = [
            forumKbFocus ? `Foco: ${forumKbFocus}` : "",
            sourceType === "study" ? "Origem: StudyLab" : "",
            flags ? `Sinais: ${flags}` : "",
            hashtags.length ? `Hashtags: ${hashtags.join(" ")}` : ""
          ].filter(Boolean).join("\n");
          items.push({
            title: sourceType === "study" ? `StudyLab: ${title2}` : `F\xF3rum: ${title2}`,
            text: `${header ? `${header}

` : ""}${text.slice(0, 2e3)}`
          });
        }
      } catch {
      }
    }
    if (Array.isArray(source_ids) && source_ids.length && admin) {
      if (!currentUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const { data } = await admin.from("study_sources").select("id, user_id, scope, published, title, full_text, summary").in("id", source_ids);
      const rows = Array.isArray(data) ? data : [];
      const allowed = rows.filter((row) => {
        if (isLeaderOrStaff) return true;
        if (String(row?.user_id || "") === String(currentUserId)) return true;
        const scope = String(row?.scope || "user").toLowerCase();
        const published = Boolean(row?.published);
        return scope === "org" && published;
      });
      if (!allowed.length) {
        return res.status(403).json({ error: "Voc\xEA n\xE3o tem acesso \xE0s fontes selecionadas do StudyLab." });
      }
      for (const row of allowed) {
        const text = (row.full_text || row.summary || "").toString();
        if (text.trim().length > 0) {
          items.push({ title: row.title || "Fonte", text });
        }
      }
    }
    const fetchedUrls = [];
    if (Array.isArray(source_urls) && source_urls.length) {
      for (const entry of source_urls) {
        if (!entry) continue;
        const url2 = (entry.url || "").toString().trim();
        if (!url2) continue;
        const title2 = (entry.title || url2).toString();
        try {
          const text = await fetchUrlContent(url2);
          if (text) {
            fetchedUrls.push({ url: url2, title: title2, text });
            items.push({ title: title2, text });
          }
        } catch (err) {
          return res.status(400).json({ error: err?.message || `Falha ao ler URL ${url2}` });
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
      } catch (err) {
        return res.status(400).json({ error: err?.message || `Falha ao ler URL ${primaryUrl}` });
      }
    }
    if (!items.length) {
      return res.status(400).json({ error: "Nenhum conte\xFAdo v\xE1lido encontrado. Envie texto, 'source_ids' ou URLs v\xE1lidas." });
    }
    const savedSources = [];
    if (save_source && (currentUserId || userId) && admin && fetchedUrls.length) {
      const ownerId = userId || currentUserId;
      for (const entry of fetchedUrls) {
        const summary = entry.text.slice(0, 600);
        const { data: saved, error } = await admin.from("study_sources").insert({
          user_id: ownerId,
          title: entry.title,
          kind: "url",
          url: entry.url,
          summary,
          full_text: entry.text,
          is_persistent: true
        }).select("id, user_id, title, kind, url, storage_path, summary, is_persistent, created_at, last_used_at").maybeSingle();
        if (!error && saved) {
          savedSources.push(saved);
        }
      }
    }
    const joinedContext = items.map((s, idx) => `### Fonte ${idx + 1}: ${s.title || ""}
${s.text || ""}`).join("\n\n");
    const isMilhao = mode === "milhao";
    const hasReferenceSources = Boolean(primaryUrl) || Array.isArray(source_ids) && source_ids.length > 0 || Array.isArray(source_urls) && source_urls.length > 0 || Array.isArray(sources) && sources.length > 0 || forumKbTags.length > 0;
    const systemWithSources = `Voc\xEA \xE9 um gerador de quizzes t\xE9cnicos para treinamento profissional no setor el\xE9trico brasileiro (CPFL, SEP, subtransmiss\xE3o, seguran\xE7a, prote\xE7\xE3o, telecom).
Voc\xEA receber\xE1 um conjunto de textos de estudo (fontes), e sua tarefa \xE9 criar um quiz COMPLETAMENTE baseado nesses materiais.

Regras de fidelidade:
- Use APENAS informa\xE7\xF5es presentes nas fontes.
- Se algum detalhe n\xE3o estiver explicitamente nas fontes, N\xC3O invente.
- Em "explanation", cite pelo menos uma refer\xEAncia no formato "Fonte X" (ex.: "Fonte 2") para mostrar de onde veio a resposta.
- N\xE3o crie perguntas \u201Cmeta\u201D sobre o texto/fonte (ex.: \u201Cqual \xE9 o tema do texto?\u201D, \u201Co que a fonte diz?\u201D). As perguntas devem ser sobre o conte\xFAdo t\xE9cnico.
- No "question_text", n\xE3o mencione \u201CFonte X\u201D; use a refer\xEAncia apenas em "explanation".
- Proibido mencionar SmartLine/Smartline/Smart Line (\xE9 outro produto/projeto e \xE9 fora do escopo).
- N\xE3o cite/compare com nomes de programas de TV ou marcas; apenas siga um formato cl\xE1ssico de perguntas progressivas (sem nomes pr\xF3prios).
- Se as fontes forem normas/procedimentos (ex.: NR-10, LOTO, PT/APR, padr\xF5es CPFL), use a terminologia e ordem de passos exatamente como escrito nelas; n\xE3o complete com \u201Cconhecimento geral\u201D.

Qualidade das alternativas (muito importante):
- Cada quest\xE3o deve ter exatamente 4 alternativas (A, B, C, D), com textos distintos.
- Distratores devem ser plaus\xEDveis (near-miss), no mesmo estilo/tamanho da correta e tecnicamente veross\xEDmeis no contexto da pergunta.
- Distratores devem refletir confus\xF5es comuns do setor (troca de termos, passo de procedimento fora de ordem, par\xE2metro parecido, sigla confundida), e n\xE3o \u201Cabsurdos\u201D.
- Evite alternativas obviamente absurdas, piadas, ou "todas/nenhuma das anteriores".
- Deve existir UMA \xFAnica alternativa correta (sem ambiguidade).
- Evite que a correta seja sempre a mais longa ou a \xFAnica com termos absolutos ("sempre", "nunca") sem suporte nas fontes.

Campos obrigat\xF3rios por quest\xE3o:
- "question_text": enunciado claro, objetivo.
- "options": { "A": "...", "B": "...", "C": "...", "D": "..." }
- "correct_letter": "A" | "B" | "C" | "D"
- "explanation": explica\xE7\xE3o curta (1-3 frases) do porqu\xEA a alternativa correta \xE9 a correta, ancorada nas fontes.
- "difficulty_level": "basica" | "intermediaria" | "avancada" | "especialista"
- "xp_value": n\xFAmero (XP sugerido)

Modo padr\xE3o (standard):
- Gere entre 3 e 15 perguntas (use question_count como sugest\xE3o).
- Misture dificuldades de forma equilibrada.

Modo Quiz do Milh\xE3o (milhao):
- Gere exatamente 10 perguntas com jornada de dificuldade 1\u219210.
- Use a tabela de XP: [100,200,300,400,500,1000,2000,3000,5000,10000] da pergunta 1 \xE0 10.
- Curva 1\u219210 (guia):
  1) defini\xE7\xE3o/recall direto do texto
  2) identifica\xE7\xE3o/interpreta\xE7\xE3o de conceito no texto
  3) aplica\xE7\xE3o simples (ex.: escolha de conduta ou conceito correto)
  4) procedimento/ordem correta descrita nas fontes
  5) diferenciar conceitos parecidos presentes nas fontes
  6) consequ\xEAncia/risco de uma decis\xE3o (dentro do que as fontes permitem)
  7) cen\xE1rio pr\xE1tico com decis\xE3o (combinar 2+ detalhes do texto)
  8) cen\xE1rio com trade-off e melhor conduta (sem extrapolar)
 9) troubleshooting/diagn\xF3stico (combinar 2+ trechos do texto)
 10) cen\xE1rio especialista multi-etapas (combinar 2+ trechos do texto), sem inventar normas/regras fora das fontes

Retorne APENAS JSON v\xE1lido (sem markdown), no formato:
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
    const systemWithoutSources = `Voc\xEA \xE9 um gerador de quizzes t\xE9cnicos para treinamento profissional no setor el\xE9trico brasileiro (CPFL, SEP, subtransmiss\xE3o, seguran\xE7a, prote\xE7\xE3o, telecom).
Voc\xEA receber\xE1 um tema/contexto fornecido pelo usu\xE1rio e deve criar um quiz coerente com essas instru\xE7\xF5es.

Regras:
- N\xE3o mencione SmartLine/Smartline/Smart Line (\xE9 outro produto/projeto e \xE9 fora do escopo).
- Se o usu\xE1rio n\xE3o forneceu normas/manuais/textos, N\xC3O invente "padr\xF5es CPFL" ou detalhes de procedimentos internos; prefira perguntas sobre princ\xEDpios, seguran\xE7a, boas pr\xE1ticas e conceitos gerais do setor.
- N\xE3o cite/compare com nomes de programas de TV ou marcas; apenas siga um formato cl\xE1ssico de perguntas progressivas (sem nomes pr\xF3prios).
- Evite perguntas \u201Cmeta\u201D sobre o contexto.

Qualidade das alternativas (muito importante):
- Cada quest\xE3o deve ter exatamente 4 alternativas (A, B, C, D), com textos distintos.
- Distratores devem ser plaus\xEDveis (near-miss), no mesmo estilo/tamanho da correta e tecnicamente veross\xEDmeis no setor el\xE9trico.
- Distratores devem refletir confus\xF5es comuns (conceito parecido, termo/sigla trocada, par\xE2metro pr\xF3ximo), e n\xE3o \u201Cabsurdos\u201D.
- Evite alternativas obviamente absurdas, piadas, ou "todas/nenhuma das anteriores".
- Deve existir UMA \xFAnica alternativa correta (sem ambiguidade).

Campos obrigat\xF3rios por quest\xE3o:
- "question_text": enunciado claro, objetivo.
- "options": { "A": "...", "B": "...", "C": "...", "D": "..." }
- "correct_letter": "A" | "B" | "C" | "D"
- "explanation": explica\xE7\xE3o curta (1-3 frases) do porqu\xEA a alternativa correta \xE9 a correta (sem inventar refer\xEAncias).
- "difficulty_level": "basica" | "intermediaria" | "avancada" | "especialista"
- "xp_value": n\xFAmero (XP sugerido)

Modo padr\xE3o (standard):
- Gere entre 3 e 15 perguntas (use question_count como sugest\xE3o).
- Misture dificuldades de forma equilibrada.

Modo Quiz do Milh\xE3o (milhao):
- Gere exatamente 10 perguntas com jornada de dificuldade 1\u219210.
- Use a tabela de XP: [100,200,300,400,500,1000,2000,3000,5000,10000] da pergunta 1 \xE0 10.

Retorne APENAS JSON v\xE1lido (sem markdown), no formato:
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
    const userMessage = {
      role: "user",
      content: `Idioma: ${language}
Tipo de quiz: ${isMilhao ? "Quiz do Milh\xE3o (10 n\xEDveis)" : "Quiz r\xE1pido"}
Quantidade desejada de perguntas: ${question_count}
${userPreferences ? `
Prefer\xEAncias do usu\xE1rio (n\xE3o s\xE3o fonte de fatos; use apenas as Fontes para conte\xFAdo t\xE9cnico):
${userPreferences}
` : ""}

Conte\xFAdo de estudo:
${joinedContext}`
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
          "gpt-5"
        ].filter(Boolean)
      )
    );
    let content = "";
    let lastErr = "";
    for (const model of models) {
      const body = {
        model,
        messages: [{ role: "system", content: system }, userMessage]
      };
      if (/^gpt-5/i.test(String(model))) body.max_completion_tokens = 4500;
      else body.max_tokens = 4500;
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        lastErr = await resp.text().catch(() => `HTTP ${resp.status}`);
        continue;
      }
      const data = await resp.json().catch(() => null);
      content = data?.choices?.[0]?.message?.content || "";
      if (content) break;
    }
    if (!content) {
      return res.status(400).json({ error: `OpenAI error: ${lastErr || "no output"}` });
    }
    let json;
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
    const desiredCount = isMilhao ? 10 : Math.max(3, Math.min(15, Number(question_count) || 5));
    const questions = json.questions.slice(0, desiredCount);
    if (isMilhao && questions.length !== 10) {
      return res.status(400).json({ error: `A IA retornou ${questions.length} perguntas; esperado 10.`, raw: content });
    }
    const correctLetterPlan = buildCorrectLetterPlan(questions.length);
    let normalizedQuestions = [];
    try {
      normalizedQuestions = questions.map((q, idx) => {
        const options = normalizeOptions(q.options);
        const correct = asLetter(q.correct_letter) || "A";
        if (!options) {
          throw new Error("Formato inv\xE1lido de alternativas: esperado options com A-D");
        }
        const effectiveCorrect = options[correct] ? correct : "A";
        const targetCorrect = correctLetterPlan[idx] || "A";
        const remapped = remapOptionsToTargetCorrect(options, effectiveCorrect, targetCorrect);
        const level = idx + 1;
        const difficulty = level <= 3 ? "basico" : level <= 6 ? "intermediario" : level <= 8 ? "avancado" : "especialista";
        return {
          question_text: (q.question_text ?? "").toString().trim(),
          options: remapped.options,
          correct_letter: remapped.correct_letter,
          explanation: (q.explanation ?? "").toString().trim(),
          difficulty_level: isMilhao ? difficulty : q.difficulty_level ?? difficulty,
          xp_value: isMilhao ? XP_TABLE_MILHAO[idx] : Number(q.xp_value) || 100,
          level
        };
      });
    } catch (e) {
      return res.status(400).json({ error: e?.message || "Falha ao normalizar perguntas da IA", raw: content });
    }
    if (isMilhao) {
      try {
        const refineModel = process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_MODEL_OVERRIDE || "gpt-5-2025-08-07";
        normalizedQuestions = await refineMilhaoDistractors({
          openaiKey: OPENAI_API_KEY,
          model: refineModel,
          language,
          forbidTermsRe: BANNED_TERMS_RE,
          questions: normalizedQuestions
        });
      } catch {
      }
    }
    json.mode = isMilhao ? "milhao" : "standard";
    json.questions = normalizedQuestions;
    for (const q of normalizedQuestions) {
      if (BANNED_TERMS_RE.test(String(q?.question_text || ""))) {
        return res.status(400).json({ error: 'Conte\xFAdo fora do escopo detectado ("SmartLine"). Revise as fontes selecionadas e gere novamente.' });
      }
      if (BANNED_TERMS_RE.test(String(q?.explanation || ""))) {
        return res.status(400).json({ error: 'Conte\xFAdo fora do escopo detectado ("SmartLine"). Revise as fontes selecionadas e gere novamente.' });
      }
      const opts = q?.options || {};
      for (const v of Object.values(opts)) {
        if (BANNED_TERMS_RE.test(String(v || ""))) {
          return res.status(400).json({ error: 'Conte\xFAdo fora do escopo detectado ("SmartLine"). Revise as fontes selecionadas e gere novamente.' });
        }
      }
    }
    return res.status(200).json({ success: true, quiz: json, saved_sources: savedSources });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}
const config = { api: { bodyParser: true } };
export {
  config,
  handler as default
};
