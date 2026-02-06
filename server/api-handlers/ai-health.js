const classifyUpstreamFailure = (status, bodyText) => {
    const body = String(bodyText || '');
    const lower = body.toLowerCase();
    if (status === 401 || /invalid[_\s-]?api[_\s-]?key/i.test(body)) {
        return { stage: 'auth', error: 'OPENAI_API_KEY inválida ou revogada' };
    }
    if (status === 429 && (lower.includes('insufficient_quota') || lower.includes('exceeded your current quota') || lower.includes('quota'))) {
        return { stage: 'quota', error: 'Quota da OpenAI esgotada (sem créditos para gerar respostas)' };
    }
    if (status === 429) {
        return { stage: 'rate_limit', error: 'OpenAI rate limit no momento' };
    }
    if (status === 400 && lower.includes('model')) {
        return { stage: 'model', error: 'Modelo de IA inválido ou sem permissão no projeto' };
    }
    return { stage: 'upstream', error: `OpenAI HTTP ${status}` };
};
export default async function handler(req, res) {
    const started = Date.now();
    try {
        const key = String(process.env.OPENAI_API_KEY || '').trim();
        if (!key)
            return res.status(200).json({ ok: false, stage: 'env', error: 'OPENAI_API_KEY ausente' });
        const model = String(process.env.OPENAI_MODEL_FAST || process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini').trim();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 8000);
        const probe = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'health check' }],
                max_tokens: 1,
            }),
            signal: ctl.signal,
        }).finally(() => clearTimeout(timer));
        if (!probe.ok) {
            const bodyText = await probe.text().catch(() => '');
            const details = classifyUpstreamFailure(probe.status, bodyText);
            return res.status(200).json({
                ok: false,
                latency_ms: Date.now() - started,
                model,
                stage: details.stage,
                error: details.error,
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
