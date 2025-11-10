import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'Missing Supabase env configuration' });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers['authorization'] as string | undefined;
    if (!authHeader) return res.status(401).json({ error: 'No authorization header' });
    const token = authHeader.replace('Bearer ', '');
    const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userRes?.user) return res.status(401).json({ error: 'Unauthorized' });

    const { challengeId, question_text, difficulty_level, options } = req.body || {};
    if (!challengeId || !question_text || !difficulty_level || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const hasCorrect = options.some((o: any) => o.is_correct === true);
    if (!hasCorrect) return res.status(400).json({ error: 'Uma alternativa correta é obrigatória' });

    const xpMap: Record<string, number> = { basico: 5, intermediario: 10, avancado: 20, especialista: 40 };
    const xp = xpMap[difficulty_level as keyof typeof xpMap];
    if (!xp) return res.status(400).json({ error: 'Dificuldade inválida' });

    const { data: question, error: qErr } = await supabase
      .from('quiz_questions')
      .insert({
        challenge_id: challengeId,
        question_text,
        difficulty_level,
        xp_value: xp,
        created_by: userRes.user.id,
      })
      .select()
      .single();
    if (qErr) return res.status(400).json({ error: qErr.message });

    const toInsert = options.map((o: any) => ({
      question_id: question.id,
      option_text: String(o.option_text || ''),
      is_correct: !!o.is_correct,
      explanation: o.explanation ? String(o.explanation) : null,
    }));
    const { error: optErr } = await supabase.from('quiz_options').insert(toInsert);
    if (optErr) return res.status(400).json({ error: optErr.message });

    return res.status(200).json({ success: true, questionId: question.id });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
