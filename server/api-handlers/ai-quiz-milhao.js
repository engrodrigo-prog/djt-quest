import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: "Missing Supabase server configuration" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : void 0;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Unauthorized" });
    const callerId = userData.user.id;
    const callerEmail = userData.user.email || "";
    const { data: roles } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", callerId);
    const allowed = /* @__PURE__ */ new Set([
      "admin",
      "gerente_djt",
      "gerente_divisao_djtx",
      "coordenador_djtx",
      // Compat legado
      "gerente",
      "lider_divisao",
      "coordenador",
      "lider_equipe"
    ]);
    const hasPermission = (roles || []).some((r) => allowed.has(r.role));
    if (!hasPermission) return res.status(403).json({ error: "Sem permiss\xE3o (apenas l\xEDderes)" });
    const { topic, mode = "especial", language = "pt-BR" } = req.body || {};
    if (!topic || typeof topic !== "string") {
      return res.status(400).json({ error: "Informe um tema (topic)" });
    }
    const system = `Voc\xEA \xE9 um gerador de quizzes t\xE9cnicos no contexto CPFL / subtransmiss\xE3o / SEP / prote\xE7\xE3o / telecom / opera\xE7\xE3o de subesta\xE7\xF5es.
Crie um quiz completo com 10 quest\xF5es de m\xFAltipla escolha, no idioma ${language}, com foco em treinamento t\xE9cnico profissional (n\xE3o escolar).

Regras:
- P1 a P3: n\xEDvel B\xE1sico \u2014 cultura CPFL, conceitos gerais SEP, no\xE7\xF5es de opera\xE7\xE3o segura.
- P4 a P6: n\xEDvel Intermedi\xE1rio \u2014 prote\xE7\xE3o, telecom, equipamentos de bays, MTS, seguran\xE7a operacional.
- P7 a P9: n\xEDvel Avan\xE7ado \u2014 aplica\xE7\xE3o pr\xE1tica, an\xE1lise de evento, PRODIST, procedimentos COS/COI.
- P10: n\xEDvel S\xEAnior \u2014 decis\xE3o t\xE9cnica, norma aprofundada, cen\xE1rio real de subtransmiss\xE3o.

Para cada quest\xE3o:
- Gere enunciado claro, objetivo, sem numera\xE7\xE3o expl\xEDcita no texto.
- Gere exatamente 4 alternativas:
  - 1 correta (tecnicamente precisa).
  - 3 erradas plaus\xEDveis (distratores realistas, por\xE9m incorretos).
- N\xC3O coloque a resposta correta sempre na mesma posi\xE7\xE3o.

Retorne APENAS JSON v\xE1lido, no formato:
{
  "quiz_id": "uuid-simbolico",
  "tipo": "milzao" | "especial",
  "criador": "email ou nome do l\xEDder",
  "questoes": [
    {
      "id": 1,
      "nivel": 1,
      "enunciado": "...",
      "alternativas": {
        "A": "...",
        "B": "...",
        "C": "...",
        "D": "..."
      },
      "correta": "A",
      "xp_base": 100
    }
  ]
}

Observa\xE7\xF5es:
- Preencha "xp_base" com a tabela: [100,200,300,400,500,1000,2000,3000,5000,10000] de P1 a P10.
- Campo "tipo": use "milhao" quando o objetivo for um quiz de 10 n\xEDveis, ou "especial" como padr\xE3o.
- Traga temas atuais do setor el\xE9trico brasileiro (2024), normas e discuss\xF5es recentes de transmiss\xE3o/distribui\xE7\xE3o, e conex\xE3o com iniciativas da CPFL (moderniza\xE7\xE3o de rede, automa\xE7\xE3o, OSM, seguran\xE7a operacional).
- N\xE3o repita perguntas gen\xE9ricas; use linguagem t\xE9cnica clara.
- N\xC3O inclua coment\xE1rios fora do JSON.`;
    const userMessage = {
      role: "user",
      content: `Tema principal do quiz: ${topic}
Modo solicitado: ${mode}
Gere o objeto JSON seguindo exatamente o formato especificado. D\xEA aten\xE7\xE3o a atualidades (2024) do setor el\xE9trico e \xE0 realidade CPFL (subtransmiss\xE3o, automa\xE7\xE3o, seguran\xE7a, procedimentos COS/COI, PRODIST, MTS, cultura de seguran\xE7a).`
    };
    const models = Array.from(
      new Set(
        [
          process.env.OPENAI_MODEL_PREMIUM,
          "gpt-5-2025-08-07",
          "gpt-5-2025-08-07",
          process.env.OPENAI_MODEL_FAST,
          process.env.OPENAI_MODEL_OVERRIDE,
          "gpt-5-2025-08-07"
        ].filter(Boolean)
      )
    );
    let content = "";
    let lastErr = "";
    for (const model of models) {
      const body = {
        model,
        messages: [{ role: "system", content: system }, userMessage],
        temperature: 0.7
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
    if (!json || !Array.isArray(json.questoes)) {
      return res.status(400).json({ error: "Resposta da IA em formato inesperado", raw: content });
    }
    const xpTable = [100, 200, 300, 400, 500, 1e3, 2e3, 3e3, 5e3, 1e4];
    json.tipo = mode === "milzao" ? "milhao" : "especial";
    json.criador = callerEmail || json.criador || "l\xEDder";
    json.quiz_id = json.quiz_id || "milzao-" + callerId;
    const letters = ["A", "B", "C", "D"];
    json.questoes = json.questoes.map((raw, idx) => {
      const nivel = raw.nivel ?? idx + 1;
      const enunciado = raw.enunciado || raw.question || "";
      const baseAlternativas = raw.alternativas || raw.options || {};
      const baseCorreta = (raw.correta || raw.answer || "A").toString().trim().toUpperCase();
      const xp_base = raw.xp_base ?? xpTable[idx] ?? 100;
      const normalized = {};
      for (const [kRaw, vRaw] of Object.entries(baseAlternativas || {})) {
        const k = kRaw.toString().trim().toUpperCase();
        const v = (vRaw ?? "").toString().trim();
        if (!v) continue;
        if (!letters.includes(k)) continue;
        normalized[k] = v;
      }
      const availableKeys = Object.keys(normalized);
      const effectiveCorrectKey = (availableKeys.includes(baseCorreta) ? baseCorreta : availableKeys[0]) || "A";
      const correctText = normalized[effectiveCorrectKey] || "";
      const wrongTexts = letters.filter((l) => l !== effectiveCorrectKey).map((l) => normalized[l]).filter((v) => typeof v === "string" && v.trim().length > 0);
      if (!correctText || wrongTexts.length === 0) {
        return {
          id: idx + 1,
          nivel,
          enunciado,
          alternativas: baseAlternativas,
          correta: baseCorreta || "A",
          xp_base
        };
      }
      const perm = [...letters].sort(() => Math.random() - 0.5);
      const correctIndex = Math.floor(Math.random() * perm.length);
      const novasAlternativas = {};
      novasAlternativas[perm[correctIndex]] = correctText;
      let wi = 0;
      for (let i = 0; i < perm.length; i++) {
        if (i === correctIndex) continue;
        const txt = wrongTexts[wi] || "";
        if (txt) {
          novasAlternativas[perm[i]] = txt;
          wi++;
        }
      }
      for (const t of wrongTexts.slice(wi)) {
        const slot = letters.find((L) => !novasAlternativas[L]);
        if (!slot || !t) break;
        novasAlternativas[slot] = t;
      }
      return {
        id: idx + 1,
        nivel,
        enunciado,
        alternativas: novasAlternativas,
        correta: perm[correctIndex],
        xp_base
      };
    });
    return res.status(200).json({ success: true, quiz: json });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}
const config = { api: { bodyParser: true } };
export {
  config,
  handler as default
};
