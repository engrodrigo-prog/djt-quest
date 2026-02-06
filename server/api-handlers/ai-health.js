const clampText = (value, max = 320) => {
    const s = String(value || '').trim();
    if (!s)
        return '';
    return s.length > max ? `${s.slice(0, max)}…` : s;
};
const safeJsonParse = (text) => {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
};
const extractUpstreamMessage = (bodyText) => {
    const txt = String(bodyText || '').trim();
    if (!txt)
        return '';
    const parsed = safeJsonParse(txt);
    if (parsed && typeof parsed === 'object') {
        const msg = parsed?.error?.message || parsed?.message || parsed?.error_description || parsed?.error;
        if (typeof msg === 'string' && msg.trim())
            return clampText(msg, 420);
        return clampText(txt, 420);
    }
    return clampText(txt, 420);
};
const classifyUpstreamFailure = (status, bodyText) => {
    const body = String(bodyText || '');
    const msg = extractUpstreamMessage(body);
    const lower = msg.toLowerCase();
    const bodyLower = body.toLowerCase();
    if (status === 401 || /invalid[_\s-]?api[_\s-]?key/i.test(body) || lower.includes('invalid api key')) {
        return { stage: 'auth', error: 'OPENAI_API_KEY inválida ou revogada', upstream_message: msg };
    }
    if (status === 429 && (bodyLower.includes('insufficient_quota') || bodyLower.includes('exceeded your current quota') || bodyLower.includes('quota'))) {
        return { stage: 'quota', error: 'Quota da OpenAI esgotada (sem créditos para gerar respostas)', upstream_message: msg };
    }
    if (status === 429) {
        return { stage: 'rate_limit', error: 'OpenAI rate limit no momento', upstream_message: msg };
    }
    if (status === 400 && lower.includes('unsupported parameter')) {
        return { stage: 'payload', error: 'Payload incompatível com o modelo configurado', upstream_message: msg };
    }
    if ((status === 400 || status === 404) && (lower.includes('model') || bodyLower.includes('model'))) {
        return { stage: 'model', error: 'Modelo de IA inválido ou sem permissão no projeto', upstream_message: msg };
    }
    return { stage: 'upstream', error: `OpenAI HTTP ${status}`, upstream_message: msg };
};

const usesResponsesApiForModel = (model) => /^(ft:)?o\d/i.test(String(model || '').trim()) || /^gpt-5/i.test(String(model || '').trim());

const probeOpenAi = async (params) => {
    const { key, model, timeoutMs } = params;
    const usesResponsesApi = usesResponsesApiForModel(model);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs || 8000);
    try {
        const url = usesResponsesApi ? 'https://api.openai.com/v1/responses' : 'https://api.openai.com/v1/chat/completions';
        const body = usesResponsesApi
            ? { model, input: 'health check', max_output_tokens: 16 }
            : { model, messages: [{ role: 'user', content: 'health check' }], max_tokens: 16 };
        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal: ctl.signal,
        });
        const bodyText = resp.ok ? '' : await resp.text().catch(() => '');
        return { ok: resp.ok, status: resp.status, bodyText };
    }
    finally {
        clearTimeout(timer);
    }
};
export default async function handler(req, res) {
    const started = Date.now();
    try {
        const key = String(process.env.OPENAI_API_KEY || '').trim();
        if (!key)
            return res.status(200).json({ ok: false, stage: 'env', error: 'OPENAI_API_KEY ausente' });
        const model = String(process.env.OPENAI_MODEL_FAST || process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini').trim();
        const compatModel = String(process.env.OPENAI_MODEL_COMPAT || 'gpt-4o-mini').trim() || 'gpt-4o-mini';

        const primary = await probeOpenAi({ key, model, timeoutMs: 8000 });
        if (!primary.ok) {
            const details = classifyUpstreamFailure(primary.status, primary.bodyText);
            // If the configured model fails with a payload/model issue, try a known-compatible fallback.
            const shouldTryCompat = (primary.status === 400 || primary.status === 404) && compatModel && compatModel !== model;
            if (shouldTryCompat) {
                const compat = await probeOpenAi({ key, model: compatModel, timeoutMs: 8000 });
                if (compat.ok) {
                    return res.status(200).json({
                        ok: true,
                        latency_ms: Date.now() - started,
                        model,
                        compat_model: compatModel,
                        stage: 'ready_compat',
                        warning: details.error,
                        upstream_message: details.upstream_message || undefined,
                    });
                }
            }
            return res.status(200).json({
                ok: false,
                latency_ms: Date.now() - started,
                model,
                stage: details.stage,
                error: details.error,
                upstream_message: details.upstream_message || undefined,
            });
        }
        return res.status(200).json({
            ok: true,
            latency_ms: Date.now() - started,
            model,
            stage: 'ready',
        });
    }
    catch (e) {
        const msg = e?.message || 'unknown';
        const stage = /abort|timeout/i.test(msg) ? 'network' : 'error';
        return res.status(200).json({ ok: false, latency_ms: Date.now() - started, stage, error: msg });
    }
}
export const config = { api: { bodyParser: false } };
