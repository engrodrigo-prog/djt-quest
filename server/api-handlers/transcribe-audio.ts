// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY as string;
const OPENAI_MODEL_AUDIO = (process.env.OPENAI_MODEL_AUDIO as string) || '';
const OPENAI_TRANSCRIBE_MODEL = (process.env.OPENAI_TRANSCRIBE_MODEL as string) || '';
const FAST_MODELS = Array.from(new Set([
  process.env.OPENAI_MODEL_FAST,
  process.env.OPENAI_MODEL_OVERRIDE,
  'gpt-5-2025-08-07',
  'gpt-5-2025-08-07'
].filter(Boolean)));

const ORGANIZER_SYSTEM = `Você é um organizador de transcrições. Receberá como ENTRADA um texto bruto gerado por reconhecimento de fala.
Regras (STRICT):
1) Não invente, não resuma, não traduza e não supra lacunas. Não acrescente nada além do que foi dito.
2) Preserve todo o conteúdo e a ordem cronológica das ideias.
3) Edite apenas: pontuação, letras maiúsculas/minúsculas, quebras de linha e parágrafos para legibilidade.
4) Agrupe frases afins no mesmo parágrafo, mantendo a sequência original do discurso.
5) Se houver trechos inaudíveis, mantenha-os como [inaudível] sem tentar adivinhar.
6) Saída final: apenas o texto organizado (sem títulos, notas, listas, explicações ou metadados).`;

const TRANSCRIBE_INSTRUCTION = (languageHint?: string) => {
  const hint = typeof languageHint === 'string' && languageHint.trim() ? `\nDica de idioma: ${languageHint.trim()}` : '';
  return (
    `Transcreva fielmente o áudio para texto (sem resumir e sem traduzir).` +
    `\nRegras:` +
    `\n- Preserve a ordem e o conteúdo.` +
    `\n- Pontue apenas para legibilidade (não invente nada).` +
    `\n- Para trechos inaudíveis, escreva exatamente: [inaudível].` +
    hint
  );
};

async function fetchBytesFromUrl(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch failed ${resp.status}`);
  const mime = (resp.headers?.get?.('content-type') || '').toString();
  const ab = await resp.arrayBuffer();
  return { bytes: new Uint8Array(ab), mime };
}

function parseDataUrl(input: string): { bytes: Uint8Array; mime: string } {
  let mime = 'audio/mpeg';

  if (!input || typeof input !== 'string') {
    return { bytes: new Uint8Array(), mime };
  }

  // Raw base64 (sem prefixo data:)
  if (!input.startsWith('data:')) {
    const binary = Buffer.from(input, 'base64');
    return { bytes: new Uint8Array(binary), mime };
  }

  // Data URL (pode vir como `data:audio/webm;codecs=opus;base64,...`)
  const comma = input.indexOf(',');
  if (comma < 0) {
    throw new Error('Invalid data URL: missing comma');
  }

  const meta = input.slice(5, comma); // remove "data:"
  const data = input.slice(comma + 1);
  const parts = meta.split(';').map((p) => String(p || '').trim()).filter(Boolean);
  const maybeMime = parts[0];
  if (maybeMime && maybeMime.includes('/')) {
    mime = maybeMime;
  }

  const isBase64 = parts.some((p) => p.toLowerCase() === 'base64');
  if (!isBase64) {
    // fallback raro: dados URL-encoded
    try {
      const decoded = decodeURIComponent(data);
      const binary = Buffer.from(decoded);
      return { bytes: new Uint8Array(binary), mime };
    } catch {
      const binary = Buffer.from(data);
      return { bytes: new Uint8Array(binary), mime };
    }
  }

  const binary = Buffer.from(data, 'base64');
  return { bytes: new Uint8Array(binary), mime };
}

function extFromMime(input: string) {
  const mime = String(input || '').split(';')[0].trim().toLowerCase();
  if (!mime) return 'mp3';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/mp4' || mime === 'audio/x-m4a') return 'm4a';
  if (mime === 'audio/aac') return 'aac';
  if (mime === 'audio/wav') return 'wav';
  if (mime === 'audio/ogg') return 'ogg';
  if (mime === 'audio/webm') return 'webm';
  const p = mime.split('/')[1] || 'mp3';
  return p.toLowerCase();
}

const collectOutputText = (payload: any) => {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = output
    .map((item: any) => {
      if (typeof item?.content === 'string') return item.content;
      if (Array.isArray(item?.content)) {
        return item.content.map((c: any) => c?.text || c?.content || '').join('\n');
      }
      return item?.text || '';
    })
    .filter(Boolean);
  return chunks.join('\n').trim();
};

async function transcribeWithResponses(params: { bytes: Uint8Array; mime: string; model: string; language?: string }) {
  const base64 = Buffer.from(params.bytes).toString('base64');
  const format = extFromMime(params.mime);

  const input = [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: TRANSCRIBE_INSTRUCTION(params.language) },
        { type: 'input_audio', input_audio: { data: base64, format } },
      ],
    },
  ];

  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model,
      input,
      modalities: ['text'],
      max_output_tokens: 900,
    }),
  });

  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = json?.error?.message || json?.message || '';
    throw new Error(msg ? `responses transcription failed: ${msg}` : `responses transcription failed: HTTP ${resp.status}`);
  }

  const text = collectOutputText(json);
  if (!text) throw new Error('responses transcription returned empty text');
  return text;
}

async function transcribeWithTranscriptionsEndpoint(params: { bytes: Uint8Array; mime: string; model: string; language?: string }) {
  const blob = new Blob([params.bytes], { type: params.mime });
  const form = new FormData();
  form.append('model', params.model);
  form.append('file', blob, `audio.${extFromMime(params.mime)}`);
  if (typeof params.language === 'string' && params.language.trim()) {
    form.append('language', params.language.trim());
  }
  const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form as any,
  });
  if (!tr.ok) {
    const t = await tr.text().catch(() => '');
    throw new Error(t ? `transcription failed: ${t}` : `transcription failed: HTTP ${tr.status}`);
  }
  const tj = await tr.json().catch(() => null);
  return String(tj?.text || '').trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    const { audioBase64, fileUrl, summarize, organize, mode, language } = req.body || {};
    // Back-compat and default behavior: organize text unless explicitly summarizing
    const wantedMode: 'organize' | 'summarize' = (typeof mode === 'string' && (mode === 'organize' || mode === 'summarize'))
      ? mode
      : (organize === true ? 'organize' : (summarize === true ? 'summarize' : 'organize'));
    if (!audioBase64 && !fileUrl) return res.status(400).json({ error: 'audioBase64 or fileUrl required' });

    let bytes: Uint8Array;
    let mime = 'audio/mpeg';
    if (fileUrl) {
      const fetched = await fetchBytesFromUrl(fileUrl);
      bytes = fetched.bytes;
      const headerMime = String(fetched.mime || '').split(';')[0].trim();
      if (headerMime && headerMime.includes('/')) {
        mime = headerMime;
      } else {
        const urlLower = String(fileUrl).toLowerCase();
        if (urlLower.endsWith('.wav')) mime = 'audio/wav';
        else if (urlLower.endsWith('.ogg') || urlLower.endsWith('.oga')) mime = 'audio/ogg';
        else if (urlLower.endsWith('.webm')) mime = 'audio/webm';
        else if (urlLower.endsWith('.m4a') || urlLower.endsWith('.mp4')) mime = 'audio/mp4';
        else if (urlLower.endsWith('.mp3')) mime = 'audio/mpeg';
        else if (urlLower.endsWith('.aac')) mime = 'audio/aac';
      }
    } else {
      const parsed = parseDataUrl(audioBase64);
      bytes = parsed.bytes;
      mime = String(parsed.mime || '').split(';')[0].trim() || mime;
    }

    if (!bytes || bytes.length === 0) return res.status(400).json({ error: 'empty audio payload' });

    // Transcription (prefer gpt-audio via Responses API when configured; fallback to /audio/transcriptions)
    const preferredAudioModel = String(OPENAI_MODEL_AUDIO || '').trim();
    const preferredTranscribeModel = String(OPENAI_TRANSCRIBE_MODEL || '').trim() || 'whisper-1';
    let transcript = '';
    let usedTranscribeModel = '';
    let lastTranscribeErr: any = null;

    if (preferredAudioModel) {
      try {
        transcript = await transcribeWithResponses({ bytes, mime, model: preferredAudioModel, language });
        usedTranscribeModel = preferredAudioModel;
      } catch (e: any) {
        lastTranscribeErr = e;
        transcript = '';
      }
    }

    if (!transcript) {
      try {
        transcript = await transcribeWithTranscriptionsEndpoint({ bytes, mime, model: preferredTranscribeModel, language });
        usedTranscribeModel = preferredTranscribeModel;
      } catch (e: any) {
        lastTranscribeErr = e;
        if (preferredTranscribeModel !== 'whisper-1') {
          try {
            transcript = await transcribeWithTranscriptionsEndpoint({ bytes, mime, model: 'whisper-1', language });
            usedTranscribeModel = 'whisper-1';
            lastTranscribeErr = null;
          } catch (e2: any) {
            lastTranscribeErr = e2;
          }
        }
      }
    }

    if (!transcript) {
      return res.status(400).json({ error: lastTranscribeErr?.message || 'transcription failed' });
    }

    // Post-processing: organize or summarize
    let textOut: string | null = null;
    let summaryOut: string | null = null;
    if (transcript && (wantedMode === 'organize' || wantedMode === 'summarize')) {
      const system = wantedMode === 'organize'
        ? ORGANIZER_SYSTEM
        : 'Você é um assistente que organiza feedbacks de avaliações de segurança do trabalho em bullets curtos, claros e objetivos.';
      const userContent = wantedMode === 'organize'
        ? transcript
        : `Transcreva e organize em itens: ${transcript}`;

      for (const model of FAST_MODELS) {
        try {
          const comp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: userContent },
              ],
            }),
          });
          if (!comp.ok) continue;
          const cj = await comp.json().catch(() => null);
          const content = cj?.choices?.[0]?.message?.content || null;
          if (content) {
            if (wantedMode === 'organize') textOut = content;
            else summaryOut = content;
            break;
          }
        } catch {
          continue;
        }
      }
    }

    return res.status(200).json({
      transcript,
      text: textOut || summaryOut || transcript,
      summary: summaryOut,
      meta: { transcribe_model: usedTranscribeModel || null },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'unknown error' });
  }
}

export const config = { api: { bodyParser: true } };
