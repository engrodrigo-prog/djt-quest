import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, CheckCircle2, XCircle, AlertCircle, Settings, Sparkles, Bot, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

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
        .select('email, is_leader, studio_access, tier')
        .in('email', testEmails);

      // Buscar roles
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id, role, profiles!inner(email)')
        .in('profiles.email', testEmails);

      // Consolidar resultados
      const results: HealthCheckResult[] = testEmails.map(email => {
        const profile = profiles?.find(p => p.email === email);
        const roleData = roles?.find(r => (r.profiles as any)?.email === email);

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
      const url = base ? `${base}/api/ai-health` : '/api/ai-health';
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

  const loadForumBonusSettings = async () => {
    try {
      const { data } = await supabase.from('system_settings').select('value').eq('key', 'forumBonus').maybeSingle();
      if (data?.value) {
        setForumBonusEnabled(!!data.value.enabled);
        setForumBonusMaxPct(typeof data.value.maxPct === 'number' ? data.value.maxPct : 0.20);
      }
    } catch {}
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
    if (!confirm('Aplicar bônus de engajamento do fórum neste mês?')) return;
    setApplyingBonus(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const resp = await fetch('/api/forum-apply-monthly-bonus', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
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
              <CardDescription>Ping simples ao endpoint /api/ai-health</CardDescription>
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
          <div className="text-xs text-muted-foreground">
            Regras: top 10 recebem de 5% a {Math.round(forumBonusMaxPct*100)}% sobre XP mensal (quizzes + ações). Proporcional ao engajamento.
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
