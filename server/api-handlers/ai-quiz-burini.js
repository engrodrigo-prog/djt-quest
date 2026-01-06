import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL_PREMIUM || process.env.OPENAI_MODEL_OVERRIDE || process.env.OPENAI_MODEL_FAST || "gpt-5-2025-08-07";
const BANNED_TERMS_RE = /smart\s*line|smartline|smarline/i;
const MONITORS = {
  subestacoes: { key: "subestacoes", name: "Monitor Subesta\xE7\xF5es" },
  linhas: { key: "linhas", name: "Monitor Linhas" },
  protecao: { key: "protecao", name: "Monitor Prote\xE7\xE3o" },
  automacao: { key: "automacao", name: "Monitor Automa\xE7\xE3o" },
  telecom: { key: "telecom", name: "Monitor Telecom" }
};
const normalizeDomain = (raw) => {
  const s = String(raw || "").toLowerCase().trim();
  if (s.includes("linha")) return "linhas";
  if (s.includes("prote")) return "protecao";
  if (s.includes("auto")) return "automacao";
  if (s.includes("tele")) return "telecom";
  return "subestacoes";
};
const pickTwo = (arr) => {
  const copy = [...arr];
  copy.sort(() => Math.random() - 0.5);
  return copy.slice(0, 2);
};
async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: "Missing Supabase config" });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : void 0;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Unauthorized" });
    const { question, options, nivel, question_id, domain, mode, selected_label, correct_label } = req.body || {};
    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: "Campos obrigat\xF3rios: question, options[]" });
    }
    const normalizedMode = String(mode || "").toLowerCase().trim();
    const isPostWrong = normalizedMode === "post_wrong" || normalizedMode === "post-wrong" || normalizedMode === "post" || normalizedMode === "review";
    const monitor = MONITORS[normalizeDomain(domain)];
    let eliminate_option_ids = [];
    if (!isPostWrong && question_id) {
      try {
        const { data: rows } = await admin.from("quiz_options").select("id, is_correct").eq("question_id", question_id);
        const wrongIds = (rows || []).filter((r) => !r.is_correct).map((r) => r.id);
        eliminate_option_ids = pickTwo(wrongIds);
      } catch {
        eliminate_option_ids = [];
      }
    }
    const system = `Voc\xEA \xE9 o ${monitor.name}, um especialista t\xE9cnico da DJT/CPFL atuando em quizzes profissionais de SEP, prote\xE7\xE3o, telecom, opera\xE7\xE3o e seguran\xE7a.
Seu estilo:
- Linguagem t\xE9cnica, direta, profissional, em pt-BR.
- Explica o racioc\xEDnio, compara alternativas, destaca riscos e normas.
- ${isPostWrong ? "Modo revis\xE3o: o usu\xE1rio j\xE1 respondeu e errou; voc\xEA PODE dizer qual alternativa era a correta (letra) e explicar o porqu\xEA, e por que a escolhida estava errada." : 'NUNCA entrega diretamente "a letra correta".'}
- Pode indicar 1 ou 2 alternativas mais improv\xE1veis e explicar o porqu\xEA.
- ${isPostWrong ? "Trate com respeito e foco did\xE1tico." : "Se necess\xE1rio, sugira duas alternativas que podem ser eliminadas (sem garantir a correta)."}`;
    const safety = `Regras de seguran\xE7a/conte\xFAdo:
- Proibido mencionar SmartLine/Smartline/Smart Line (outro projeto).
- N\xE3o cite/compare com nomes de programas de TV/marcas.
- N\xE3o invente procedimentos internos inexistentes; se faltar contexto, explique a incerteza e foque em princ\xEDpios.`;
    const user = isPostWrong ? `Pergunta de quiz (n\xEDvel: ${nivel || "progressivo"}):
${question}

Alternativas:
${options.map(
      (opt, idx) => `${String.fromCharCode(65 + idx)}) ${String(opt?.option_text || opt?.text || "").trim()}`
    ).join("\n")}

Usu\xE1rio respondeu: ${String(selected_label || "").toUpperCase() || "N/D"}.
Correta: ${String(correct_label || "").toUpperCase() || "N/D"}.

Tarefa (revis\xE3o p\xF3s-erro):
- Explique em linguagem t\xE9cnica e did\xE1tica por que a correta \xE9 a correta.
- Explique o erro conceitual t\xEDpico por tr\xE1s da resposta escolhida (sem humilhar).
- Traga 1 dica pr\xE1tica para acertar perguntas assim no futuro.

Retorne JSON estrito:
{
  "analysis": "texto curto estilo bal\xE3o (6-10 linhas), pode citar a letra correta",
  "hint": "dica final curta"
}` : `Pergunta de quiz (n\xEDvel: ${nivel || "progressivo"}):
${question}

Alternativas:
${options.map(
      (opt, idx) => `${String.fromCharCode(65 + idx)}) ${String(opt?.option_text || opt?.text || "").trim()}`
    ).join("\n")}

Tarefa:
- Analise tecnicamente a situa\xE7\xE3o.
- Explique o que est\xE1 sendo cobrado e qual \xE9 o conceito central.
- Comente as principais armadilhas ou confus\xF5es que podem levar ao erro.
- Indique apenas quais alternativas s\xE3o claramente fracas/improv\xE1veis, com justificativa curta.
- N\xC3O diga explicitamente qual alternativa \xE9 a correta.

Retorne JSON estrito:
{
  "analysis": "explica\xE7\xE3o t\xE9cnica em 1-2 par\xE1grafos",
  "weak_options": [
    { "label": "B", "reason": "..." },
    { "label": "D", "reason": "..." }
  ],
  "hint": "dica final curta, sem revelar a letra certa"
}`;
    const body = {
      model: MODEL,
      temperature: 0.4,
      messages: [
        { role: "system", content: `${system}

${safety}` },
        { role: "user", content: user }
      ]
    };
    if (/^gpt-5/i.test(String(MODEL))) body.max_completion_tokens = 900;
    else body.max_tokens = 900;
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return res.status(400).json({ error: "OpenAI error", detail: txt || resp.statusText });
    }
    const data = await resp.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content || "";
    let json = null;
    try {
      json = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        json = JSON.parse(m[0]);
      }
    }
    if (!json || typeof json.analysis !== "string") {
      return res.status(400).json({ error: "Resposta da IA em formato inesperado", raw: content });
    }
    const rawOut = JSON.stringify(json);
    if (BANNED_TERMS_RE.test(rawOut)) {
      return res.status(400).json({ error: 'Conte\xFAdo fora do escopo detectado ("SmartLine").' });
    }
    return res.status(200).json({
      success: true,
      help: {
        ...json,
        monitor,
        eliminate_option_ids
      }
    });
  } catch (err) {
    console.error("Error in ai-quiz-burini:", err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}
const config = { api: { bodyParser: true } };
export {
  config,
  handler as default
};
