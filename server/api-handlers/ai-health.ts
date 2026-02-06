// @ts-nocheck
import type { VercelRequest, VercelResponse } from '@vercel/node';

const clampText = (value: any, max = 320) => {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}...` : s;
};

const safeJsonParse = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const extractUpstreamMessage = (bodyText: string) => {
  const txt = String(bodyText || '').trim();
  if (!txt) return '';
  const parsed = safeJsonParse(txt);
  if (parsed && typeof parsed === 'object') {
    const msg = (parsed as any)?.error?.message || (parsed as any)?.message || (parsed as any)?.error_description || (parsed as any)?.error;
    if (typeof msg === 'string' && msg.trim()) return clampText(msg, 420);
  }
  return clampText(txt, 420);
};

const classifyUpstreamFailure = (status: number, bodyText: string) => {
  const body = String(bodyText || '');
  const msg = extractUpstreamMessage(body);
  const lower = msg.toLowerCase();
  const bodyLower = body.toLowerCase();

  if (status === 401 || /invalid[_\s-]?api[_\s-]?key/i.test(body) || lower.includes('invalid api key')) {
    return { stage: 'auth', error: 'OPENAI_API_KEY invalida ou revogada', upstream_message: msg };
  }

  if (status === 429 && (bodyLower.includes('insufficient_quota') || bodyLower.includes('exceeded your current quota') || bodyLower.includes('quota'))) {
    return { stage: 'quota', error: 'Quota da OpenAI esgotada (sem creditos para gerar respostas)', upstream_message: msg };
  }

  if (status === 429) {
    return { stage: 'rate_limit', error: 'OpenAI rate limit no momento', upstream_message: msg };
  }

  if ((status === 400 || status === 404) && (lower.includes('model') || bodyLower.includes('model'))) {
    return { stage: 'model', error: 'Modelo de IA invalido ou sem permissao no projeto', upstream_message: msg };
  }

  return { stage: 'upstream', error: `OpenAI HTTP ${status}`, upstream_message: msg };
};

const CACHE_TTL_OK_MS = 5 * 60 * 1000;
const CACHE_TTL_ERR_MS = 45 * 1000;
let lastHealthCache: { expiresAt: number; payload: any } | null = null;

const probeOpenAiModelAccess = async (params: { key: string; model: string; timeoutMs?: number }) => {
  const { key, model, timeoutMs } = params;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 5000);
  try {
    const url = `https://api.openai.com/v1/models/${encodeURIComponent(String(model || '').trim())}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: ctl.signal,
    });
    const bodyText = resp.ok ? '' : await resp.text().catch(() => '');
    return { ok: resp.ok, status: resp.status, bodyText };
  } finally {
    clearTimeout(timer);
  }
};

const cacheTtlForPayload = (payload: any) => (payload?.ok ? CACHE_TTL_OK_MS : CACHE_TTL_ERR_MS);

const cacheResult = (payload: any) => {
  lastHealthCache = {
    expiresAt: Date.now() + cacheTtlForPayload(payload),
    payload,
  };
  return payload;
};

const getCachedResult = (forceRefresh: boolean) => {
  if (forceRefresh) return null;
  if (!lastHealthCache) return null;
  if (Date.now() > Number(lastHealthCache.expiresAt || 0)) return null;
  return lastHealthCache.payload || null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const started = Date.now();
  try {
    const forceRefreshRaw = Array.isArray((req.query as any)?.force) ? (req.query as any).force[0] : (req.query as any)?.force;
    const forceRefresh = String(forceRefreshRaw || '').trim() === '1';
    const cached = getCachedResult(forceRefresh);
    if (cached) {
      return res.status(200).json({ ...cached, cached: true });
    }

    const key = String(process.env.OPENAI_API_KEY || '').trim();
    if (!key) return res.status(200).json(cacheResult({ ok: false, stage: 'env', error: 'OPENAI_API_KEY ausente', latency_ms: Date.now() - started }));

    const model =
      String(process.env.OPENAI_MODEL_FAST || process.env.OPENAI_TEXT_MODEL || 'gpt-4o-mini').trim();

    const probe = await probeOpenAiModelAccess({ key, model, timeoutMs: 5000 });

    if (!probe.ok) {
      const details = classifyUpstreamFailure(probe.status, probe.bodyText);
      return res.status(200).json({
        ...cacheResult({
          ok: false,
          latency_ms: Date.now() - started,
          model,
          stage: details.stage,
          error: details.error,
          upstream_message: details.upstream_message || undefined,
        }),
      });
    }

    return res.status(200).json({
      ...cacheResult({
        ok: true,
        latency_ms: Date.now() - started,
        model,
        stage: 'ready_model_access',
      }),
    });
  } catch (e: any) {
    const msg = e?.message || 'unknown';
    const stage = /abort|timeout/i.test(msg) ? 'network' : 'error';
    return res.status(200).json(cacheResult({ ok: false, latency_ms: Date.now() - started, stage, error: msg }));
  }
}

export const config = { api: { bodyParser: false } };
