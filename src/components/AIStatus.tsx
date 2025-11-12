import React from 'react';
import { Bot, AlertTriangle } from 'lucide-react';

type Health = { ok: boolean; latency_ms?: number; stage?: string; error?: string } | null;

export function AIStatus({ className }: { className?: string }) {
  const [health, setHealth] = React.useState<Health>(null);
  const [checking, setChecking] = React.useState(false);

  const check = React.useCallback(async () => {
    try {
      if (typeof window !== 'undefined') {
        const isDevWithoutApi = import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL && window.location.port !== '3000';
        if (isDevWithoutApi) {
          setHealth({ ok: false, stage: 'dev-proxy', error: 'Execute `vercel dev` para ler /api/*' });
          return;
        }
      }

      setChecking(true);
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
      const endpoint = base ? `${base}/api/ai-health` : '/api/ai-health';
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
      } else {
        setHealth({ ok: false, ...(json || {}), stage: json?.stage || `http-${resp.status}` });
      }
    } catch (e) {
      setHealth({ ok: false, stage: 'network', error: (e as any)?.message || 'network error' });
    } finally {
      setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
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
        {checking && <span className="ml-1 animate-pulse">•</span>}
      </span>
    </div>
  );
}
