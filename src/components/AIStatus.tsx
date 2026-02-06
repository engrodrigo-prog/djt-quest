import React from 'react';
import { Bot, AlertTriangle } from 'lucide-react';

type Health = { ok: boolean; latency_ms?: number; stage?: string; error?: string } | null;

const HEALTH_POLL_INTERVAL_MS = 5 * 60_000;
const HEALTH_CACHE_TTL_MS = 5 * 60_000;
const HEALTH_CACHE_KEY = 'djt:ai-health-cache:v1';
let inMemoryHealthCache: { ts: number; value: Health } | null = null;

const readCachedHealth = (): Health => {
  try {
    const now = Date.now();
    if (inMemoryHealthCache && now - inMemoryHealthCache.ts <= HEALTH_CACHE_TTL_MS) {
      return inMemoryHealthCache.value;
    }
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(HEALTH_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ts = Number(parsed?.ts || 0);
    if (!ts || now - ts > HEALTH_CACHE_TTL_MS) return null;
    const value = (parsed?.value || null) as Health;
    inMemoryHealthCache = { ts, value };
    return value;
  } catch {
    return null;
  }
};

const writeCachedHealth = (value: Health) => {
  try {
    const payload = { ts: Date.now(), value };
    inMemoryHealthCache = payload;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(payload));
    }
  } catch {
    // ignore cache failures
  }
};

export function AIStatus({ className }: { className?: string }) {
  const [health, setHealth] = React.useState<Health>(() => readCachedHealth());
  const [checking, setChecking] = React.useState(false);

  const check = React.useCallback(async (opts?: { force?: boolean }) => {
    try {
      if (typeof window !== 'undefined') {
        const isDevWithoutApi = import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL && window.location.port !== '3000';
        if (isDevWithoutApi) {
          setHealth({ ok: false, stage: 'dev-proxy', error: 'Execute `vercel dev` para ler /api/*' });
          return;
        }
      }

      if (!opts?.force) {
        const cached = readCachedHealth();
        if (cached) {
          setHealth(cached);
          return;
        }
      }

      setChecking(true);
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
      const endpoint = base ? `${base}/api/ai?handler=health` : '/api/ai?handler=health';
      const resp = await fetch(endpoint, { method: 'GET', signal: ctl.signal });
      clearTimeout(t);
      let json: any = {};
      try {
        json = await resp.json();
      } catch {
        json = { ok: false, stage: 'parse', error: 'Resposta inválida da API' };
      }
      if (resp.ok) {
        setHealth(json);
        writeCachedHealth(json);
      } else {
        const next = { ok: false, ...(json || {}), stage: json?.stage || `http-${resp.status}` };
        setHealth(next);
        writeCachedHealth(next);
      }
    } catch (e) {
      const next = { ok: false, stage: 'network', error: (e as any)?.message || 'network error' };
      setHealth(next);
      writeCachedHealth(next);
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    if (!readCachedHealth()) {
      void check({ force: true });
    }
    const runIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void check();
    };
    const id = setInterval(runIfVisible, HEALTH_POLL_INTERVAL_MS);
    window.addEventListener('focus', runIfVisible);
    document.addEventListener('visibilitychange', runIfVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', runIfVisible);
      document.removeEventListener('visibilitychange', runIfVisible);
    };
  }, [check]);

  const ok = !!health?.ok;
  const title = ok
    ? `AI ON • ${health?.latency_ms ?? '?'} ms`
    : `AI OFF${health?.stage ? ` • ${health.stage}` : ''}${health?.error ? ` • ${health.error}` : ''}`;

  return (
    <div className={className} title={title}>
      <span
        className={[
          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium border',
          ok
            ? 'text-green-500 border-green-700/40 bg-green-900/20'
            : 'text-red-500 border-red-700/40 bg-red-900/20',
        ].join(' ')}
      >
        {ok ? <Bot className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
        {ok ? 'AI ON' : 'AI OFF'}
        {!ok && health?.stage && <span className="ml-1 opacity-80">• {health.stage}</span>}
        {checking && <span className="ml-1 animate-pulse">•</span>}
      </span>
    </div>
  );
}
