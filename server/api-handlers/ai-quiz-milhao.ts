// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase server configuration' });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = (req.headers['authorization'] as string | undefined) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

    const callerId = userData.user.id;
    const callerEmail = userData.user.email || '';

    const { data: roles } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', callerId);
    const allowed = new Set([
      'admin',
      'gerente_djt',
      'gerente_divisao_djtx',
      'coordenador_djtx',
      // Compat legado
      'gerente',
      'lider_divisao',
      'coordenador',
      'lider_equipe',
    ]);
    const hasPermission = (roles || []).some((r: any) => allowed.has(r.role));
    if (!hasPermission) return res.status(403).json({ error: 'Sem permissão (apenas líderes)' });

    const { topic, mode = 'especial', language = 'pt-BR' } = req.body || {};
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Informe um tema (topic)' });
    }

    const system = `Você é um gerador de quizzes técnicos no contexto CPFL / subtransmissão / SEP / proteção / telecom / operação de subestações.
Crie um quiz completo com 10 questões de múltipla escolha, no idioma ${language}, com foco em treinamento técnico profissional (não escolar).

Regras:
- P1 a P3: nível Básico — cultura CPFL, conceitos gerais SEP, noções de operação segura.
- P4 a P6: nível Intermediário — proteção, telecom, equipamentos de bays, MTS, segurança operacional.
- P7 a P9: nível Avançado — aplicação prática, análise de evento, PRODIST, procedimentos COS/COI.
- P10: nível Sênior — decisão técnica, norma aprofundada, cenário real de subtransmissão.

Para cada questão:
- Gere enunciado claro, objetivo, sem numeração explícita no texto.
- Gere exatamente 4 alternativas:
  - 1 correta (tecnicamente precisa).
  - 3 erradas plausíveis (distratores realistas, porém incorretos).
- NÃO coloque a resposta correta sempre na mesma posição.

Retorne APENAS JSON válido, no formato:
{
  "quiz_id": "uuid-simbolico",
  "tipo": "milzao" | "especial",
  "criador": "email ou nome do líder",
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

Observações:
- Preencha "xp_base" com a tabela: [100,200,300,400,500,1000,2000,3000,5000,10000] de P1 a P10.
- Campo "tipo": use "milhao" quando o objetivo for um quiz de 10 níveis, ou "especial" como padrão.
- Traga temas atuais do setor elétrico brasileiro (2024), normas e discussões recentes de transmissão/distribuição, e conexão com iniciativas da CPFL (modernização de rede, automação, OSM, segurança operacional).
- Não repita perguntas genéricas; use linguagem técnica clara.
- NÃO inclua comentários fora do JSON.`;

    const userMessage = {
      role: 'user',
      content: `Tema principal do quiz: ${topic}\nModo solicitado: ${mode}\nGere o objeto JSON seguindo exatamente o formato especificado. Dê atenção a atualidades (2024) do setor elétrico e à realidade CPFL (subtransmissão, automação, segurança, procedimentos COS/COI, PRODIST, MTS, cultura de segurança).`,
    };

    const models = Array.from(
      new Set(
        [
          process.env.OPENAI_MODEL_PREMIUM,
          'gpt-5.2-thinking',
          'gpt-5.2',
          process.env.OPENAI_MODEL_FAST,
          process.env.OPENAI_MODEL_OVERRIDE,
          'gpt-5.2-fast',
          'gpt-4.1',
          'gpt-4.1-mini',
          'gpt-4o',
        ].filter(Boolean),
      ),
    );

    let content = '';
    let lastErr = '';
    for (const model of models) {
      const body: any = {
        model,
        messages: [{ role: 'system', content: system }, userMessage],
        temperature: 0.7,
      };
      if (/^gpt-5/i.test(String(model))) body.max_completion_tokens = 4500;
      else body.max_tokens = 4500;

      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        lastErr = await resp.text().catch(() => `HTTP ${resp.status}`);
        continue;
      }
      const data = await resp.json().catch(() => null);
      content = data?.choices?.[0]?.message?.content || '';
      if (content) break;
    }

    if (!content) {
      return res.status(400).json({ error: `OpenAI error: ${lastErr || 'no output'}` });
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

    if (!json || !Array.isArray(json.questoes)) {
      return res.status(400).json({ error: 'Resposta da IA em formato inesperado', raw: content });
    }

    // Normalização mínima: garantir campos obrigatórios e tipo
    const xpTable = [100, 200, 300, 400, 500, 1000, 2000, 3000, 5000, 10000];
    json.tipo = mode === 'milzao' ? 'milhao' : 'especial';
    json.criador = callerEmail || json.criador || 'líder';
    json.quiz_id = json.quiz_id || 'milzao-' + callerId;
    const letters = ['A', 'B', 'C', 'D'] as const;

    json.questoes = json.questoes.map((raw: any, idx: number) => {
      const nivel = raw.nivel ?? idx + 1;
      const enunciado = raw.enunciado || raw.question || '';
      const baseAlternativas = raw.alternativas || raw.options || {};
      const baseCorreta = (raw.correta || raw.answer || 'A').toString().trim().toUpperCase();
      const xp_base = raw.xp_base ?? xpTable[idx] ?? 100;

      // Normalizar alternativas para A-D
      const normalized: Record<string, string> = {};
      for (const [kRaw, vRaw] of Object.entries(baseAlternativas || {})) {
        const k = kRaw.toString().trim().toUpperCase();
        const v = (vRaw ?? '').toString().trim();
        if (!v) continue;
        if (!letters.includes(k as any)) continue;
        normalized[k] = v;
      }

      const availableKeys = Object.keys(normalized);
      const effectiveCorrectKey =
        (availableKeys.includes(baseCorreta) ? baseCorreta : availableKeys[0]) || 'A';
      const correctText = normalized[effectiveCorrectKey] || '';
      const wrongTexts = letters
        .filter((l) => l !== effectiveCorrectKey)
        .map((l) => normalized[l])
        .filter((v) => typeof v === 'string' && v.trim().length > 0);

      // Se não conseguirmos identificar claramente correta + erradas, mantém estrutura original
      if (!correctText || wrongTexts.length === 0) {
        return {
          id: idx + 1,
          nivel,
          enunciado,
          alternativas: baseAlternativas,
          correta: baseCorreta || 'A',
          xp_base,
        };
      }

      // Embaralhar posição da alternativa correta entre A-D
      const perm = [...letters].sort(() => Math.random() - 0.5);
      const correctIndex = Math.floor(Math.random() * perm.length);
      const novasAlternativas: Record<string, string> = {};

      novasAlternativas[perm[correctIndex]] = correctText;

      let wi = 0;
      for (let i = 0; i < perm.length; i++) {
        if (i === correctIndex) continue;
        const txt = wrongTexts[wi] || '';
        if (txt) {
          novasAlternativas[perm[i]] = txt;
          wi++;
        }
      }

      // Se ainda faltarem alternativas (entrada incompleta), reaproveita quaisquer textos restantes
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
        xp_base,
      };
    });

    return res.status(200).json({ success: true, quiz: json });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
