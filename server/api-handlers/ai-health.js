export default async function handler(req, res) {
    const started = Date.now();
    try {
        const hasKey = !!process.env.OPENAI_API_KEY;
        if (!hasKey)
            return res.status(200).json({ ok: false, stage: 'env', error: 'OPENAI_API_KEY ausente' });
        // Lightweight reachability probe (best-effort)
        try {
            const ctl = new AbortController();
            setTimeout(() => ctl.abort(), 2500);
            await fetch('https://api.openai.com/v1', { method: 'HEAD', signal: ctl.signal });
        }
        catch {
            // ignore; treat network as flaky but not OFF
        }
        return res.status(200).json({ ok: true, latency_ms: Date.now() - started, stage: 'ready' });
    }
    catch (e) {
        return res.status(200).json({ ok: false, latency_ms: Date.now() - started, stage: 'error', error: e?.message || 'unknown' });
    }
}
export const config = { api: { bodyParser: false } };
