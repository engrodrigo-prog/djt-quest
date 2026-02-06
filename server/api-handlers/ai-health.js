export default async function handler(req, res) {
    const started = Date.now();
    try {
        const key = String(process.env.OPENAI_API_KEY || '').trim();
        if (!key)
            return res.status(200).json({ ok: false, stage: 'env', error: 'OPENAI_API_KEY ausente' });
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 6000);
        const probe = await fetch('https://api.openai.com/v1/models?limit=1', {
            method: 'GET',
            headers: { Authorization: `Bearer ${key}` },
            signal: ctl.signal,
        }).finally(() => clearTimeout(timer));
        if (!probe.ok) {
            const bodyText = await probe.text().catch(() => '');
            const isAuth = probe.status === 401 || /invalid[_\s-]?api[_\s-]?key/i.test(bodyText);
            const stage = isAuth ? 'auth' : 'upstream';
            const error = isAuth ? 'OPENAI_API_KEY inválida ou revogada' : `OpenAI HTTP ${probe.status}`;
            return res.status(200).json({ ok: false, latency_ms: Date.now() - started, stage, error });
        }
        return res.status(200).json({ ok: true, latency_ms: Date.now() - started, stage: 'ready' });
    }
    catch (e) {
        const msg = e?.message || 'unknown';
        const stage = /abort|timeout/i.test(msg) ? 'network' : 'error';
        return res.status(200).json({ ok: false, latency_ms: Date.now() - started, stage, error: msg });
    }
}
export const config = { api: { bodyParser: false } };
