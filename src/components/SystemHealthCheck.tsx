import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, CheckCircle2, XCircle, AlertCircle, Settings, Sparkles, Bot, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';

interface HealthCheckResult {
  email: string;
  exists: boolean;
  is_leader: boolean | null;
  studio_access: boolean | null;
  tier: string | null;
  has_role: boolean;
  role_name: string | null;
}

export const SystemHealthCheck = () => {
  const [health, setHealth] = useState<HealthCheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ ok: boolean; model?: string; latency_ms?: number; error?: string; stage?: string } | null>(null);
  const [seedingTest, setSeedingTest] = useState(false);
  const [seedingProd, setSeedingProd] = useState(false);
  const [forumBonusEnabled, setForumBonusEnabled] = useState<boolean>(true);
  const [forumBonusMaxPct, setForumBonusMaxPct] = useState<number>(0.20);
  const [savingBonus, setSavingBonus] = useState(false);
  const [applyingBonus, setApplyingBonus] = useState(false);
  const [forumBonusPreview, setForumBonusPreview] = useState<any[] | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState<string | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageDiagnostics, setStorageDiagnostics] = useState<any | null>(null);

  const formatBytes = (bytesRaw: any) => {
    const bytes = Math.max(0, Number(bytesRaw) || 0);
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  const clearLocalCache = () => {
    try {
      localStorage.removeItem('auth_user_cache');
      localStorage.removeItem('auth_role_override');
      localStorage.removeItem('studio_compendium_draft');
      localStorage.removeItem('sepbook_draft');
    } catch {
      // ignore
    }
  };

  const runSystemCleanup = async (action: string, opts?: { dryRun?: boolean }) => {
    setCleanupLoading(action);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Não autenticado');
      const resp = await apiFetch('/api/admin?handler=system-cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...(opts || {}) }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha na limpeza');
      return json;
    } finally {
      setCleanupLoading(null);
    }
  };

  const checkSystem = async () => {
    setChecking(true);
    
    try {
      const testEmails = [
        'colab@teste.com',
        'coordenador@teste.com',
        'gerente-divisao@teste.com',
        'gerente-dept@teste.com'
      ];

      // Buscar profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, is_leader, studio_access, tier')
        .in('email', testEmails);

      // Buscar roles (sem join via PostgREST, pois pode falhar sem FK/relationship)
      const profileIds = (profiles || []).map((p: any) => p?.id).filter(Boolean);
      const { data: roles } = profileIds.length
        ? await supabase.from('user_roles').select('user_id, role').in('user_id', profileIds)
        : { data: [] as any[] };

      // Consolidar resultados
      const results: HealthCheckResult[] = testEmails.map(email => {
        const profile = profiles?.find((p: any) => p.email === email);
        const roleData = roles?.find((r: any) => r.user_id === profile?.id);

        return {
          email,
          exists: !!profile,
          is_leader: profile?.is_leader ?? null,
          studio_access: profile?.studio_access ?? null,
          tier: profile?.tier ?? null,
          has_role: !!roleData,
          role_name: roleData?.role ?? null
        };
      });

      setHealth(results);
    } catch (error) {
      console.error('Error checking system health:', error);
      setHealth([]);
    } finally {
      setChecking(false);
    }
  };

  const checkAI = async () => {
    try {
      setAiLoading(true);
      const base = (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/$/, '') || '';
      const url = base ? `${base}/api/ai?handler=health` : '/api/ai?handler=health';
      const resp = await fetch(url);
      let json: any = {};
      try { json = await resp.json(); } catch { json = { ok: false, error: 'Resposta inválida' }; }
      if (resp.ok) setAiStatus(json);
      else setAiStatus({ ok: false, ...(json || {}), stage: json?.stage || `http-${resp.status}` });
    } catch (e: any) {
      setAiStatus({ ok: false, stage: 'network', error: e?.message || 'network error' });
    } finally {
      setAiLoading(false);
    }
  };

  const loadStorage = async () => {
    setStorageLoading(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Não autenticado');
      const resp = await apiFetch('/api/admin?handler=system-storage-diagnostics', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar armazenamento');
      setStorageDiagnostics(json?.diagnostics || null);
      toast.success('Diagnóstico de armazenamento carregado');
    } catch (e: any) {
      toast.error('Erro ao carregar armazenamento', { description: e?.message || '' });
      setStorageDiagnostics(null);
    } finally {
      setStorageLoading(false);
    }
  };

  const loadForumBonusSettings = async () => {
    try {
      const { data } = await supabase.from('system_settings').select('value').eq('key', 'forumBonus').maybeSingle();
      if (data?.value) {
        setForumBonusEnabled(!!data.value.enabled);
        setForumBonusMaxPct(typeof data.value.maxPct === 'number' ? data.value.maxPct : 0.20);
      }
    } catch { /* noop */ }
  };

  const saveForumBonusSettings = async () => {
    setSavingBonus(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      // Save via RLS (leaders only)
      const { error } = await supabase
        .from('system_settings')
        .upsert({ key: 'forumBonus', value: { enabled: forumBonusEnabled, maxPct: forumBonusMaxPct } } as any);
      if (error) throw error;
      toast.success('Configurações salvas');
    } catch (e: any) {
      toast.error('Falha ao salvar', { description: e?.message || '' });
    } finally {
      setSavingBonus(false);
    }
  };

  const applyMonthlyBonus = async () => {
    setApplyingBonus(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Não autenticado');

      const base = (import.meta as any).env?.VITE_API_BASE_URL?.replace(/\/$/, '') || '';
      const urlBase = base ? `${base}/api/forum?handler=apply-monthly-bonus` : '/api/forum?handler=apply-monthly-bonus';

      // Prévia do top 10 (GET)
      const previewResp = await fetch(urlBase, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const previewJson: any = await previewResp.json().catch(() => ({}));
      if (!previewResp.ok) throw new Error(previewJson?.error || 'Falha ao carregar prévia do bônus');

      const awards: any[] = Array.isArray(previewJson.awards) ? previewJson.awards : [];
      if (!awards.length) {
        toast.info('Nenhum colaborador elegível para bônus de fórum neste mês.');
        setForumBonusPreview(null);
        return;
      }

      awards.sort((a, b) => (b.bonus_xp || 0) - (a.bonus_xp || 0));
      setForumBonusPreview(awards);

      const lines = awards.slice(0, 10).map((a, idx) => {
        const nome = a.profile_name || 'Colaborador';
        const sigla = a.profile_team || 'DJT';
        const baseXp = a.base_xp || 0;
        const bonusXp = a.bonus_xp || 0;
        const pct = Math.round((a.bonus_pct || 0) * 100);
        return `${idx + 1}. ${nome} (${sigla}) • base ${baseXp} XP • bônus +${bonusXp} XP (${pct}%)`;
      });

      const msg = `Top 10 engajamento do fórum (${previewJson.month || 'mês atual'}):\n\n${lines.join(
        '\n'
      )}\n\nAplicar esse bônus sobre o XP mensal desses colaboradores agora?`;

      if (!confirm(msg)) {
        return;
      }

      // Aplicar bônus (POST)
      const resp = await fetch(urlBase, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const j = await resp.json();
      if (!resp.ok) throw new Error(j?.error || 'Falha ao aplicar bônus');
      toast.success('Bônus aplicado', { description: `${j?.awards?.length || 0} usuários bonificados` });
    } catch (e: any) {
      toast.error('Erro ao aplicar bônus', { description: e?.message || '' });
    } finally {
      setApplyingBonus(false);
    }
  };

  const seedTestUsers = async () => {
    setSeedingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke('seed-test-users');
      
      if (error) throw error;
      
      toast.success('Usuários de teste criados/sincronizados com sucesso!', {
        description: `${data?.results?.length || 0} usuários processados`
      });
      
      // Recheck health after seeding
      await checkSystem();
    } catch (error) {
      console.error('Error seeding test users:', error);
      toast.error('Erro ao criar usuários de teste', {
        description: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    } finally {
      setSeedingTest(false);
    }
  };

  const seedProductionData = async () => {
    if (!confirm('⚠️ Isso criará 72 colaboradores com dados realistas. Continuar?')) {
      return;
    }

    setSeedingProd(true);
    try {
      const { data, error } = await supabase.functions.invoke('seed-production-data');
      
      if (error) throw error;
      
      toast.success('Sistema populado com sucesso!', {
        description: `${data?.summary?.total || 0} usuários criados (${data?.summary?.colaborador || 0} colaboradores, ${data?.summary?.coordenador_djtx || 0} coordenadores, ${data?.summary?.gerente_divisao_djtx || 0} gerentes divisão, ${data?.summary?.gerente_djt || 0} gerente geral)`
      });
      
      console.log('Seed results:', data);
    } catch (error) {
      console.error('Error seeding production data:', error);
      toast.error('Erro ao popular sistema', {
        description: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    } finally {
      setSeedingProd(false);
    }
  };

  const getStatusIcon = (user: HealthCheckResult) => {
    if (!user.exists) return <XCircle className="h-4 w-4 text-destructive" />;
    if (user.email === 'colab@teste.com') {
      // Colaborador não deve ser líder
      if (!user.is_leader && user.has_role) {
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      }
    } else {
      // Líderes devem ter is_leader e studio_access
      if (user.is_leader && user.studio_access && user.has_role) {
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      }
    }
    return <AlertCircle className="h-4 w-4 text-yellow-500" />;
  };

  return (
    <div className="space-y-4">
      {/* Cleanup */}
      <Card className="border-border/60 bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Limpeza & Cache
          </CardTitle>
          <CardDescription>
            Ferramentas para remover pendências antigas, usuários de teste e áudios temporários.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                clearLocalCache();
                toast.success('Cache local limpo.');
              }}
            >
              Limpar cache local
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const ok = confirm('Sair, limpar sessão local e recarregar?');
                if (!ok) return;
                try {
                  await supabase.auth.signOut();
                } catch {
                  // ignore
                }
                clearLocalCache();
                window.location.reload();
              }}
            >
              Sair + limpar sessão
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={cleanupLoading === 'purge-pending-registrations'}
                onClick={async () => {
                  try {
                    const r = await runSystemCleanup('purge-pending-registrations', { dryRun: true });
                    toast.success(`Prévia: ${r.deleteCount || 0} pendências antigas.`);
                  } catch (e: any) {
                    toast.error(e?.message || 'Falha na prévia');
                  }
                }}
              >
                Prévia pendências antigas
              </Button>
              <Button
                type="button"
                disabled={cleanupLoading === 'purge-pending-registrations'}
                onClick={async () => {
                  const ok = confirm('Excluir pendências antigas (pending/rejected) com mais de 30 dias?');
                  if (!ok) return;
                  try {
                    const r = await runSystemCleanup('purge-pending-registrations', { dryRun: false });
                    toast.success(`Excluídas: ${r.deleted || 0} pendências.`);
                  } catch (e: any) {
                    toast.error(e?.message || 'Falha ao excluir');
                  }
                }}
              >
                Excluir pendências antigas
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={cleanupLoading === 'purge-test-users'}
                onClick={async () => {
                  try {
                    const r = await runSystemCleanup('purge-test-users', { dryRun: true });
                    toast.success(`Prévia: ${r.found || 0} usuários de teste.`);
                  } catch (e: any) {
                    toast.error(e?.message || 'Falha na prévia');
                  }
                }}
              >
                Prévia usuários de teste
              </Button>
              <Button
                type="button"
                disabled={cleanupLoading === 'purge-test-users'}
                onClick={async () => {
                  const ok = confirm('Deletar usuários de teste detectados (@djtquest/@test/@exemplo)? Esta ação é irreversível.');
                  if (!ok) return;
                  try {
                    const r = await runSystemCleanup('purge-test-users', { dryRun: false });
                    toast.success(`Removidos: ${r.deleted || 0} usuários.`);
                  } catch (e: any) {
                    toast.error(e?.message || 'Falha ao remover');
                  }
                }}
              >
                Remover usuários de teste
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={cleanupLoading === 'purge-voice-transcribe'}
                onClick={async () => {
                  try {
                    const r = await runSystemCleanup('purge-voice-transcribe', { dryRun: true });
                    toast.success(`Prévia: ${r.found || 0} arquivo(s) de áudio temporário.`);
                  } catch (e: any) {
                    toast.error(e?.message || 'Falha na prévia');
                  }
                }}
              >
                Prévia áudios temporários
              </Button>
              <Button
                type="button"
                disabled={cleanupLoading === 'purge-voice-transcribe'}
                onClick={async () => {
                  const ok = confirm('Apagar áudios temporários de transcrição (voice-transcribe/*)?');
                  if (!ok) return;
                  try {
                    const r = await runSystemCleanup('purge-voice-transcribe', { dryRun: false });
                    toast.success(`Removidos: ${r.removed || 0} arquivo(s).`);
                  } catch (e: any) {
                    toast.error(e?.message || 'Falha ao remover');
                  }
                }}
              >
                Apagar áudios temporários
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Health Check */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Diagnóstico do Sistema
              </CardTitle>
              <CardDescription>
                Verificar integridade dos usuários de teste
              </CardDescription>
            </div>
            <Button 
              onClick={checkSystem} 
              disabled={checking}
              variant="outline"
              size="sm"
            >
              {checking ? 'Verificando...' : 'Verificar'}
            </Button>
          </div>
        </CardHeader>
      
      {health && (
        <CardContent>
          <div className="space-y-3">
            {health.map((user) => (
              <div 
                key={user.email}
                className="flex items-start justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-start gap-3 flex-1">
                  {getStatusIcon(user)}
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{user.email}</span>
                      {user.exists && (
                        <Badge variant="outline" className="text-xs">
                          {user.tier}
                        </Badge>
                      )}
                    </div>
                    
                    {user.exists ? (
                      <div className="text-xs text-muted-foreground space-y-0.5">
                        <div>Role: {user.role_name || 'Nenhuma'}</div>
                        <div>Líder: {user.is_leader ? 'Sim' : 'Não'}</div>
                        <div>Acesso Studio: {user.studio_access ? 'Sim' : 'Não'}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-destructive">
                        Usuário não encontrado
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-muted text-xs space-y-1">
            <div className="font-semibold">Legenda:</div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              <span>Configurado corretamente</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-3 w-3 text-yellow-500" />
              <span>Configuração incompleta</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-3 w-3 text-destructive" />
              <span>Usuário não existe</span>
            </div>
          </div>
        </CardContent>
      )}
      </Card>

      {/* AI Health */}
      <Card className="border-cyan-800/30 bg-white/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Status da IA (OpenAI)
              </CardTitle>
              <CardDescription>Ping simples ao endpoint /api/ai?handler=health</CardDescription>
            </div>
            <Button onClick={checkAI} variant="outline" size="sm" disabled={aiLoading}>
              {aiLoading ? 'Testando...' : 'Testar IA'}
            </Button>
          </div>
        </CardHeader>
        {aiStatus && (
          <CardContent>
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium border ${aiStatus.ok ? 'text-green-500 border-green-700/40 bg-green-900/20' : 'text-red-500 border-red-700/40 bg-red-900/20'}`}>
                <Bot className="h-3.5 w-3.5" />
                {aiStatus.ok ? 'AI ON' : 'AI OFF'}
              </span>
              {typeof aiStatus.latency_ms === 'number' && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Timer className="h-3.5 w-3.5" /> {aiStatus.latency_ms} ms
                </span>
              )}
              {aiStatus.model && (
                <Badge variant="outline">{aiStatus.model}</Badge>
              )}
            </div>
            {!aiStatus.ok && (
              <p className="text-xs text-muted-foreground mt-2">{[aiStatus.stage, aiStatus.error].filter(Boolean).join(' • ')}</p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Storage diagnostics */}
      <Card className="border-border/60 bg-card">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Armazenamento (DB + Storage)
              </CardTitle>
              <CardDescription>
                Tamanho do banco (Postgres) e ocupação por tipo de arquivo (fotos, áudios, vídeos e documentos).
              </CardDescription>
            </div>
            <Button onClick={loadStorage} variant="outline" size="sm" disabled={storageLoading}>
              {storageLoading ? 'Carregando...' : 'Atualizar'}
            </Button>
          </div>
        </CardHeader>
        {storageDiagnostics && (
          <CardContent className="space-y-3">
            <div className="text-sm">
              <span className="font-semibold">Banco (Postgres):</span> {formatBytes(storageDiagnostics?.db?.bytes)}
              {storageDiagnostics?.generated_at ? (
                <span className="text-xs text-muted-foreground"> {' '}• {new Date(storageDiagnostics.generated_at).toLocaleString()}</span>
              ) : null}
            </div>

            <div className="text-sm">
              <span className="font-semibold">Storage (arquivos):</span> {formatBytes(storageDiagnostics?.storage?.total_bytes)}
            </div>

            {Array.isArray(storageDiagnostics?.storage?.by_kind) && storageDiagnostics.storage.by_kind.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Por tipo</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {storageDiagnostics.storage.by_kind.map((k: any) => {
                    const total = Math.max(0, Number(storageDiagnostics?.storage?.total_bytes) || 0);
                    const bytes = Math.max(0, Number(k?.bytes) || 0);
                    const pct = total > 0 ? Math.round((bytes / total) * 100) : 0;
                    const labelMap: Record<string, string> = {
                      images: 'Fotos',
                      audio: 'Áudios',
                      video: 'Vídeos',
                      docs: 'Docs',
                      other: 'Outros',
                    };
                    const label = labelMap[String(k?.kind || '')] || String(k?.kind || 'Outros');
                    return (
                      <div key={String(k?.kind || label)} className="rounded-lg border p-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold">{label}</div>
                          <div className="text-xs text-muted-foreground">{pct}%</div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatBytes(bytes)} • {Number(k?.files) || 0} arquivo(s)
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {Array.isArray(storageDiagnostics?.storage?.by_bucket) && storageDiagnostics.storage.by_bucket.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Por bucket</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {storageDiagnostics.storage.by_bucket.slice(0, 10).map((b: any) => (
                    <div key={String(b?.bucket_id || '')} className="rounded-lg border p-2">
                      <div className="text-sm font-semibold truncate">{String(b?.bucket_id || '')}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatBytes(b?.bytes)} • {Number(b?.files) || 0} arquivo(s)
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(storageDiagnostics?.public_tables_top) && storageDiagnostics.public_tables_top.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Top tabelas (por tamanho)</div>
                <div className="max-h-56 overflow-auto rounded-lg border">
                  {storageDiagnostics.public_tables_top.slice(0, 20).map((t: any, idx: number) => (
                    <div key={`${t?.name || idx}`} className="flex items-center justify-between gap-3 px-3 py-2 border-b last:border-b-0">
                      <div className="text-xs font-medium truncate">{String(t?.name || '')}</div>
                      <div className="text-xs text-muted-foreground">{formatBytes(t?.bytes)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Fórum: bônus mensal de engajamento */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Bônus de Engajamento (Fórum)
              </CardTitle>
              <CardDescription>
                Multiplicador mensal (até 20%) para top 10 do fórum. Ative e ajuste o teto.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadForumBonusSettings}>Carregar</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={forumBonusEnabled} onChange={(e)=>setForumBonusEnabled(e.target.checked)} />
              <span>Habilitar bônus mensal</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm">Teto (máx 20%)</label>
            <input type="number" min={0.05} max={0.20} step={0.01} value={forumBonusMaxPct}
              onChange={(e)=>setForumBonusMaxPct(Math.max(0.05, Math.min(0.20, Number(e.target.value) || 0.20)))}
              className="h-9 w-28 rounded-md bg-transparent border px-2"
            />
            <span className="text-xs text-muted-foreground">Ex.: 0.20 = 20%</span>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={saveForumBonusSettings} disabled={savingBonus}>
              {savingBonus ? 'Salvando...' : 'Salvar Configuração'}
            </Button>
            <Button onClick={applyMonthlyBonus} disabled={applyingBonus}>
              {applyingBonus ? 'Aplicando...' : 'Aplicar bônus deste mês'}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>
              Regras: top 10 recebem de 5% a {Math.round(forumBonusMaxPct*100)}% sobre XP mensal (quizzes + ações). Proporcional ao engajamento.
            </div>
            {forumBonusPreview && forumBonusPreview.length > 0 && (
              <div className="mt-1 border-t border-border/40 pt-2 space-y-1">
                <div className="font-semibold text-[11px]">Prévia do Top 10 deste mês:</div>
                <ul className="text-[11px] text-muted-foreground space-y-0.5 max-h-32 overflow-auto">
                  {forumBonusPreview.slice(0, 10).map((a, idx) => (
                    <li key={a.user_id || idx}>
                      {idx + 1}. {a.profile_name || 'Colaborador'} ({a.profile_team || 'DJT'}) — base {a.base_xp || 0} XP, bônus +{a.bonus_xp || 0} XP
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
