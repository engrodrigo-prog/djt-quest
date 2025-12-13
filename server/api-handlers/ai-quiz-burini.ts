// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY) as string;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const MODEL =
  process.env.OPENAI_MODEL_PREMIUM ||
  process.env.OPENAI_MODEL_OVERRIDE ||
  process.env.OPENAI_MODEL_FAST ||
  'gpt-4o';

type MonitorKey = 'subestacoes' | 'linhas' | 'protecao' | 'automacao' | 'telecom';

const MONITORS: Record<MonitorKey, { key: MonitorKey; name: string }> = {
  subestacoes: { key: 'subestacoes', name: 'Monitor Subestações' },
  linhas: { key: 'linhas', name: 'Monitor Linhas' },
  protecao: { key: 'protecao', name: 'Monitor Proteção' },
  automacao: { key: 'automacao', name: 'Monitor Automação' },
  telecom: { key: 'telecom', name: 'Monitor Telecom' },
};

const normalizeDomain = (raw: any): MonitorKey => {
  const s = String(raw || '').toLowerCase().trim();
  if (s.includes('linha')) return 'linhas';
  if (s.includes('prote')) return 'protecao';
  if (s.includes('auto')) return 'automacao';
  if (s.includes('tele')) return 'telecom';
  return 'subestacoes';
};

const pickTwo = <T,>(arr: T[]) => {
  const copy = [...arr];
  copy.sort(() => Math.random() - 0.5);
  return copy.slice(0, 2);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase config' });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = (req.headers['authorization'] as string | undefined) || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

    const { question, options, nivel, question_id, domain } = req.body || {};
    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'Campos obrigatórios: question, options[]' });
    }

    const monitor = MONITORS[normalizeDomain(domain)];

    // Se possível, elimina 2 alternativas erradas (por ID) sem expor a correta.
    let eliminate_option_ids: string[] = [];
    if (question_id) {
      try {
        const { data: rows } = await admin
          .from('quiz_options')
          .select('id, is_correct')
          .eq('question_id', question_id);
        const wrongIds = (rows || []).filter((r: any) => !r.is_correct).map((r: any) => r.id);
        eliminate_option_ids = pickTwo(wrongIds);
      } catch {
        eliminate_option_ids = [];
      }
    }

    const system = `Você é o ${monitor.name}, um especialista técnico da DJT/CPFL atuando em quizzes profissionais de SEP, proteção, telecom, operação e segurança.
Seu estilo:
- Linguagem técnica, direta, profissional, em pt-BR.
- Explica o raciocínio, compara alternativas, destaca riscos e normas.
- NUNCA entrega diretamente "a letra correta".
- Pode indicar 1 ou 2 alternativas mais improváveis e explicar o porquê.
- Se necessário, sugira duas alternativas que podem ser eliminadas (sem garantir a correta).`;

    const user = `Pergunta de quiz (nível: ${nivel || 'progressivo'}):
${question}

Alternativas:
${options
  .map(
    (opt: any, idx: number) =>
      `${String.fromCharCode(65 + idx)}) ${String(opt?.option_text || opt?.text || '').trim()}`
  )
  .join('\n')}

Tarefa:
- Analise tecnicamente a situação.
- Explique o que está sendo cobrado e qual é o conceito central.
- Comente as principais armadilhas ou confusões que podem levar ao erro.
- Indique apenas quais alternativas são claramente fracas/improváveis, com justificativa curta.
- NÃO diga explicitamente qual alternativa é a correta.

Retorne JSON estrito:
{
  "analysis": "explicação técnica em 1-2 parágrafos",
  "weak_options": [
    { "label": "B", "reason": "..." },
    { "label": "D", "reason": "..." }
  ],
  "hint": "dica final curta, sem revelar a letra certa"
}`;

    const body: any = {
      model: MODEL,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };

    if (/^gpt-5/i.test(String(MODEL))) body.max_completion_tokens = 900;
    else body.max_tokens = 900;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      return res.status(400).json({ error: 'OpenAI error', detail: txt || resp.statusText });
    }

    const data = await resp.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content || '';
    let json: any = null;
    try {
      json = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) {
        json = JSON.parse(m[0]);
      }
    }

    if (!json || typeof json.analysis !== 'string') {
      return res.status(400).json({ error: 'Resposta da IA em formato inesperado', raw: content });
    }

    return res.status(200).json({
      success: true,
      help: {
        ...json,
        monitor: monitor,
        eliminate_option_ids,
      },
    });
  } catch (err: any) {
    console.error('Error in ai-quiz-burini:', err);
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
