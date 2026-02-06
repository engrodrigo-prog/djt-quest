const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL_AUDIO = process.env.OPENAI_MODEL_AUDIO || 'gpt-audio-2025-08-28';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || '';
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
const TRANSCRIBE_INSTRUCTION = (languageHint) => {
    const hint = typeof languageHint === 'string' && languageHint.trim() ? `\nDica de idioma: ${languageHint.trim()}` : '';
    return (`Transcreva fielmente o áudio para texto (sem resumir e sem traduzir).` +
        `\nRegras:` +
        `\n- Preserve a ordem e o conteúdo.` +
        `\n- Pontue apenas para legibilidade (não invente nada).` +
        `\n- Para trechos inaudíveis, escreva exatamente: [inaudível].` +
        hint);
};
async function fetchBytesFromUrl(url) {
    const resp = await fetch(url);
    if (!resp.ok)
        throw new Error(`fetch failed ${resp.status}`);
    const mime = resp.headers?.get?.('content-type') || '';
    const ab = await resp.arrayBuffer();
    return { bytes: new Uint8Array(ab), mime };
}
const AUDIO_MIME_BY_EXT = {
    mp3: 'audio/mpeg',
    mpeg: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    wave: 'audio/wav',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    webm: 'audio/webm',
};
function toAudioMime(input) {
    const value = String(input || '').split(';')[0].trim().toLowerCase();
    if (!value)
        return null;
    if (value in AUDIO_MIME_BY_EXT)
        return AUDIO_MIME_BY_EXT[value];
    if (value.startsWith('audio/')) {
        if (value === 'audio/x-m4a')
            return 'audio/mp4';
        if (value === 'audio/x-wav')
            return 'audio/wav';
        return value;
    }
    if (value === 'video/webm')
        return 'audio/webm';
    return null;
}
function cleanUrlPath(input) {
    const raw = String(input || '').trim();
    if (!raw)
        return '';
    try {
        const url = new URL(raw);
        return `${url.pathname || ''}`.toLowerCase();
    }
    catch {
        return raw.split('?')[0].split('#')[0].toLowerCase();
    }
}
function audioMimeFromUrl(input) {
    const path = cleanUrlPath(input);
    const m = path.match(/\.([a-z0-9]{2,8})$/i);
    if (!m)
        return null;
    const ext = String(m[1] || '').toLowerCase();
    return AUDIO_MIME_BY_EXT[ext] || null;
}
function sniffAudioMime(bytes) {
    if (!bytes || bytes.length < 12)
        return null;
    if (bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70)
        return 'audio/wav';
    if (bytes[0] === 79 && bytes[1] === 103 && bytes[2] === 103 && bytes[3] === 83)
        return 'audio/ogg';
    if (bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163)
        return 'audio/webm';
    if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51)
        return 'audio/mpeg';
    if (bytes[0] === 255 && (bytes[1] & 224) === 224)
        return 'audio/mpeg';
    const tag = String.fromCharCode(bytes[4] || 0, bytes[5] || 0, bytes[6] || 0, bytes[7] || 0);
    if (tag === 'ftyp')
        return 'audio/mp4';
    return null;
}
function pickAudioMime(params) {
    const fromHint = toAudioMime(params.hintMime);
    if (fromHint)
        return fromHint;
    const fromUrl = params.fileUrl ? audioMimeFromUrl(String(params.fileUrl)) : null;
    if (fromUrl)
        return fromUrl;
    const fromBytes = params.bytes ? sniffAudioMime(params.bytes) : null;
    if (fromBytes)
        return fromBytes;
    return 'audio/mpeg';
}
function normalizeTranscribeLanguage(raw) {
    const src = String(raw || '').trim().toLowerCase();
    if (!src)
        return undefined;
    const base = src.replace(/_/g, '-').split('-')[0];
    const aliases = {
        'pt-br': 'pt',
        pt: 'pt',
        'en-us': 'en',
        'en-gb': 'en',
        en: 'en',
        'zh-cn': 'zh',
        'zh-tw': 'zh',
        zh: 'zh',
    };
    if (aliases[src])
        return aliases[src];
    if (aliases[base])
        return aliases[base];
    if (/^[a-z]{2}$/.test(base))
        return base;
    return undefined;
}
function parseDataUrl(input) {
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
    const parts = meta
        .split(';')
        .map((p) => String(p || '').trim())
        .filter(Boolean);
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
        }
        catch {
            const binary = Buffer.from(data);
            return { bytes: new Uint8Array(binary), mime };
        }
    }
    const binary = Buffer.from(data, 'base64');
    return { bytes: new Uint8Array(binary), mime };
}
function extFromMime(input) {
    const mime = String(input || '').split(';')[0].trim().toLowerCase();
    if (!mime)
        return 'mp3';
    if (mime === 'audio/mpeg')
        return 'mp3';
    if (mime === 'audio/mp4' || mime === 'audio/x-m4a')
        return 'm4a';
    if (mime === 'audio/aac')
        return 'aac';
    if (mime === 'audio/wav')
        return 'wav';
    if (mime === 'audio/ogg')
        return 'ogg';
    if (mime === 'audio/webm')
        return 'webm';
    const p = mime.split('/')[1] || 'mp3';
    return p.toLowerCase();
}
const collectOutputText = (payload) => {
    if (typeof payload?.output_text === 'string')
        return payload.output_text.trim();
    const output = Array.isArray(payload?.output) ? payload.output : [];
    const chunks = output
        .map((item) => {
        if (typeof item?.content === 'string')
            return item.content;
        if (Array.isArray(item?.content)) {
            return item.content.map((c) => c?.text || c?.content || '').join('\n');
        }
        return item?.text || '';
    })
        .filter(Boolean);
    return chunks.join('\n').trim();
};
async function transcribeWithResponses(params) {
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
    if (!text)
        throw new Error('responses transcription returned empty text');
    return text;
}
async function transcribeWithTranscriptionsEndpoint(params) {
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
        body: form,
    });
    if (!tr.ok) {
        const t = await tr.text().catch(() => '');
        throw new Error(t ? `transcription failed: ${t}` : `transcription failed: HTTP ${tr.status}`);
    }
    const tj = await tr.json().catch(() => null);
    return String(tj?.text || '').trim();
}
async function transcribeWithTranscriptionsFallback(params) {
    let firstErr = null;
    try {
        return await transcribeWithTranscriptionsEndpoint(params);
    }
    catch (e) {
        firstErr = e;
    }
    if (params.language) {
        try {
            return await transcribeWithTranscriptionsEndpoint({ ...params, language: undefined });
        }
        catch (e2) {
            throw e2 || firstErr;
        }
    }
    throw firstErr;
}
export default async function handler(req, res) {
    if (req.method === 'OPTIONS')
        return res.status(204).send('');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    try {
        if (!OPENAI_API_KEY)
            return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
        const { audioBase64, fileUrl, audioMime, summarize, organize, mode, language } = req.body || {};
        // Back-compat and default behavior: organize text unless explicitly summarizing
        const wantedMode = (typeof mode === 'string' && (mode === 'organize' || mode === 'summarize'))
            ? mode
            : (organize === true ? 'organize' : (summarize === true ? 'summarize' : 'organize'));
        if (!audioBase64 && !fileUrl)
            return res.status(400).json({ error: 'audioBase64 or fileUrl required' });
        let bytes;
        let mime = 'audio/mpeg';
        if (fileUrl) {
            const fetched = await fetchBytesFromUrl(fileUrl);
            bytes = fetched.bytes;
            mime = pickAudioMime({ hintMime: fetched.mime || audioMime, fileUrl, bytes });
        }
        else {
            const parsed = parseDataUrl(audioBase64);
            bytes = parsed.bytes;
            mime = pickAudioMime({ hintMime: parsed.mime || audioMime, fileUrl: null, bytes });
        }
        if (!bytes || bytes.length === 0) {
            return res.status(400).json({ error: 'empty audio payload' });
        }
        const safeLanguage = normalizeTranscribeLanguage(language);
        // Transcription (prefer gpt-audio via Responses API when configured; fallback to /audio/transcriptions)
        const preferredAudioModel = String(OPENAI_MODEL_AUDIO || '').trim();
        const preferredTranscribeModel = String(OPENAI_TRANSCRIBE_MODEL || '').trim() || 'whisper-1';
        let transcript = '';
        let usedTranscribeModel = '';
        let lastTranscribeErr = null;
        if (preferredAudioModel) {
            try {
                transcript = await transcribeWithResponses({ bytes, mime, model: preferredAudioModel, language: safeLanguage || language });
                usedTranscribeModel = preferredAudioModel;
            }
            catch (e) {
                lastTranscribeErr = e;
                transcript = '';
            }
        }
        if (!transcript) {
            try {
                transcript = await transcribeWithTranscriptionsFallback({
                    bytes,
                    mime,
                    model: preferredTranscribeModel,
                    language: safeLanguage,
                });
                usedTranscribeModel = preferredTranscribeModel;
            }
            catch (e) {
                lastTranscribeErr = e;
                if (preferredTranscribeModel !== 'whisper-1') {
                    try {
                        transcript = await transcribeWithTranscriptionsFallback({
                            bytes,
                            mime,
                            model: 'whisper-1',
                            language: safeLanguage,
                        });
                        usedTranscribeModel = 'whisper-1';
                        lastTranscribeErr = null;
                    }
                    catch (e2) {
                        lastTranscribeErr = e2;
                    }
                }
            }
        }
        if (!transcript) {
            return res.status(400).json({ error: lastTranscribeErr?.message || 'transcription failed' });
        }
        // Post-processing: organize or summarize
        let textOut = null;
        let summaryOut = null;
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
                    if (!comp.ok)
                        continue;
                    const cj = await comp.json().catch(() => null);
                    const content = cj?.choices?.[0]?.message?.content || null;
                    if (content) {
                        if (wantedMode === 'organize')
                            textOut = content;
                        else
                            summaryOut = content;
                        break;
                    }
                }
                catch {
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
    }
    catch (err) {
        return res.status(500).json({ error: err?.message || 'unknown error' });
    }
}
export const config = { api: { bodyParser: true } };
