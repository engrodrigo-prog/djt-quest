import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Crown, Gift, AlertTriangle, Building2, ChevronRight } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface Team {
  id: string;
  name: string;
  coordination_id: string;
  coordinations?: {
    id: string;
    name: string;
    division_id: string;
    divisions?: {
      id: string;
      name: string;
      department_id: string;
    };
  };
}

interface CoordinationRow {
  id: string;
  name: string;
  position: string;
}

export function AdminBonusManager() {
  const { user, orgScope, userRole } = useAuth();
  const { toast } = useToast();
  const isGlobal = userRole === 'gerente_djt' || userRole === 'admin';
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [eventType, setEventType] = useState<'reconhecimento' | 'ponto_atencao'>('reconhecimento');
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');

  const [coords, setCoords] = useState<CoordinationRow[]>([]);
  const [rankingYear, setRankingYear] = useState<string>(() => {
    const d = new Date();
    return String(d.getFullYear());
  });
  const [rankingMonth, setRankingMonth] = useState<string>(() => {
    const d = new Date();
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return String(prev.getMonth() + 1).padStart(2, '0');
  });
  const [savingRanking, setSavingRanking] = useState(false);

  const loadTeams = useCallback(async () => {
    if (!user || !orgScope) return;

    let query = supabase
      .from('teams')
      .select(`
        id,
        name,
        coordination_id,
        coordinations (
          id,
          name,
          division_id,
          divisions (
            id,
            name,
            department_id
          )
        )
      `)
      .order('name');

    // Filtrar equipes baseado na role e hierarquia
    if (userRole === 'coordenador_djtx' && orgScope.coordId) {
      query = query.eq('coordination_id', orgScope.coordId);
    } else if (userRole === 'gerente_divisao_djtx' && orgScope.divisionId) {
      query = query.eq('coordinations.division_id', orgScope.divisionId);
    }
    // gerente_djt/admin vê todas as equipes (sem filtro adicional)

    const { data, error } = await query;

    if (!error && data) {
      setTeams(data);
    }
  }, [orgScope, user, userRole]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    const loadCoordinations = async () => {
      try {
        const { data, error } = await supabase
          .from('coordinations')
          .select('id, name')
          .order('id');
        if (error) {
          console.warn('Erro ao carregar coordenações para ranking:', error.message);
          return;
        }
        setCoords((data || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          position: '',
        })));
      } catch (e) {
        console.warn('Erro inesperado ao carregar coordenações:', e);
      }
    };
    loadCoordinations();
  }, []);

  const handleApplyRankingBonus = async () => {
    if (!user) {
      toast({
        title: 'Erro',
        description: 'Usuário não autenticado',
        variant: 'destructive',
      });
      return;
    }
    const yearNum = Number(rankingYear);
    const monthNum = Number(rankingMonth);
    if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) {
      toast({
        title: 'Ano inválido',
        description: 'Informe um ano entre 2000 e 2100.',
        variant: 'destructive',
      });
      return;
    }
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) {
      toast({
        title: 'Mês inválido',
        description: 'Informe um mês de 1 a 12.',
        variant: 'destructive',
      });
      return;
    }

    const payloadCoords = coords
      .filter((c) => c.position && Number(c.position) >= 1 && Number(c.position) <= 6)
      .map((c) => ({
        sigla: c.id,
        posicao: Number(c.position),
      }));

    if (payloadCoords.length === 0) {
      toast({
        title: 'Nada para aplicar',
        description: 'Defina pelo menos uma coordenação com posição de 1 a 6.',
        variant: 'destructive',
      });
      return;
    }

    setSavingRanking(true);
    try {
      const resp = await apiFetch('/api/admin?handler=coord-ranking-bonus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ano: yearNum,
          mes: monthNum,
          coordenacoes: payloadCoords,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao aplicar bonificação de ranking');
      toast({
        title: 'Ranking aplicado',
        description: `Bonificação registrada para ${payloadCoords.length} coordenação(ões) em ${monthNum}/${yearNum}.`,
      });
    } catch (e: any) {
      console.error('Erro ao aplicar ranking das coordenações:', e);
      toast({
        title: 'Erro',
        description: e?.message || 'Erro ao aplicar bonificação de ranking',
        variant: 'destructive',
      });
    } finally {
      setSavingRanking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user || !selectedTeam) {
      toast({
        title: 'Erro',
        description: 'Selecione uma equipe',
        variant: 'destructive'
      });
      return;
    }

    if (eventType === 'reconhecimento' && (!points || parseInt(points) <= 0)) {
      toast({
        title: 'Erro',
        description: 'Pontos devem ser um número positivo para reconhecimento',
        variant: 'destructive'
      });
      return;
    }

    if (reason.length < 50) {
      toast({
        title: 'Erro',
        description: 'A justificativa deve ter no mínimo 50 caracteres',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);

    try {
      const { data: session } = await supabase.auth.getSession();
      
      const { data, error } = await supabase.functions.invoke('create-team-event', {
        body: {
          teamId: selectedTeam,
          eventType,
          points: eventType === 'reconhecimento' ? parseInt(points) : 0,
          reason: `[Admin Global] ${reason}`
        },
        headers: {
          Authorization: `Bearer ${session.session?.access_token}`
        }
      });

      if (error) throw error;

      toast({
        title: 'Sucesso!',
        description: data.message || `${eventType === 'reconhecimento' ? '🎉 Reconhecimento' : '⚠️ Ponto de atenção'} aplicado à equipe`
      });

      // Reset form
      setSelectedTeam('');
      setPoints('');
      setReason('');
      setEventType('reconhecimento');
    } catch (error: any) {
      console.error('Error creating team event:', error);
      toast({
        title: 'Erro',
        description: error.message || 'Erro ao criar evento de equipe',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {isGlobal && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-blue-400" />
              Ranking Mensal das Coordenações
            </CardTitle>
            <CardDescription className="text-xs">
              Defina a posição (1º a 6º) de cada coordenação no mês de referência. O sistema aplica automaticamente a bonificação:
              1º→500 XP, 2º→400 XP, 3º→300 XP, 4º→200 XP, 5º→100 XP, 6º→0 XP para todos os membros da coordenação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1">
                <Label htmlFor="ranking-year">Ano de referência</Label>
                <Input
                  id="ranking-year"
                  type="number"
                  value={rankingYear}
                  onChange={(e) => setRankingYear(e.target.value)}
                  min={2000}
                  max={2100}
                />
              </div>
              <div className="flex-1">
                <Label htmlFor="ranking-month">Mês de referência</Label>
                <Select value={rankingMonth} onValueChange={setRankingMonth}>
                  <SelectTrigger id="ranking-month">
                    <SelectValue placeholder="Mês" />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      ['01', 'Jan'],
                      ['02', 'Fev'],
                      ['03', 'Mar'],
                      ['04', 'Abr'],
                      ['05', 'Mai'],
                      ['06', 'Jun'],
                      ['07', 'Jul'],
                      ['08', 'Ago'],
                      ['09', 'Set'],
                      ['10', 'Out'],
                      ['11', 'Nov'],
                      ['12', 'Dez'],
                    ].map(([val, label]) => (
                      <SelectItem key={val} value={val}>
                        {val} — {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Posição de cada coordenação (1 a 6)</Label>
              <div className="space-y-2">
                {coords.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2 bg-background/60"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{c.id}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.name}</p>
                    </div>
                    <div className="w-28">
                      <Select
                        value={c.position}
                        onValueChange={(val) =>
                          setCoords((prev) =>
                            prev.map((row) =>
                              row.id === c.id ? { ...row, position: val } : row,
                            ),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Posição" />
                        </SelectTrigger>
                        <SelectContent>
                          {[1, 2, 3, 4, 5, 6].map((p) => (
                            <SelectItem key={p} value={String(p)}>
                              {p}º lugar
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
                {coords.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nenhuma coordenação encontrada. Verifique a estrutura organizacional em Supabase.
                  </p>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Dica: este ranking deve refletir o mês anterior, mas você pode ajustar ano e mês de referência conforme necessário.
              </p>
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={savingRanking || coords.length === 0}
              onClick={handleApplyRankingBonus}
            >
              {savingRanking ? 'Aplicando ranking...' : 'Aplicar Ranking das Coordenações'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Bonificação {isGlobal ? 'Global' : 'de Equipes'}
          </CardTitle>
          <CardDescription>
            {isGlobal
              ? 'Como Admin/Gerente DJT, você pode bonificar qualquer equipe da organização'
              : userRole === 'gerente_divisao_djtx'
              ? 'Como Gerente de Divisão, você pode bonificar equipes da sua divisão'
              : 'Como Coordenador, você pode bonificar equipes da sua coordenação'}
          </CardDescription>
          {orgScope && !isGlobal && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground mt-2 pt-2 border-t">
              <Building2 className="h-3 w-3" />
              <span className="text-xs">DJT</span>
              <ChevronRight className="h-3 w-3" />
              <span className="text-xs">{orgScope.divisionName || 'Divisão'}</span>
              {userRole === 'coordenador_djtx' && (
                <>
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-xs font-semibold">{orgScope.coordName || 'Coordenação'}</span>
                </>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="team">Selecionar Equipe</Label>
            <Select value={selectedTeam} onValueChange={setSelectedTeam}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha uma equipe..." />
              </SelectTrigger>
              <SelectContent>
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3">
            <Label>Tipo de Evento</Label>
            <RadioGroup value={eventType} onValueChange={(v) => setEventType(v as 'reconhecimento' | 'ponto_atencao')}>
              <div className="flex items-center space-x-2 p-4 border rounded-lg hover:bg-accent/50 cursor-pointer">
                <RadioGroupItem value="reconhecimento" id="admin-reconhecimento" />
                <Label htmlFor="admin-reconhecimento" className="flex items-center gap-2 cursor-pointer flex-1">
                  <Gift className="h-4 w-4 text-green-600" />
                  <div>
                    <p className="font-semibold">✅ Reconhecimento</p>
                    <p className="text-xs text-muted-foreground">Bonificar equipe com XP adicional</p>
                  </div>
                </Label>
              </div>
              <div className="flex items-center space-x-2 p-4 border rounded-lg hover:bg-accent/50 cursor-pointer">
                <RadioGroupItem value="ponto_atencao" id="admin-ponto-atencao" />
                <Label htmlFor="admin-ponto-atencao" className="flex items-center gap-2 cursor-pointer flex-1">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <div>
                    <p className="font-semibold">⚠️ Ponto de Atenção</p>
                    <p className="text-xs text-muted-foreground">Registrar evento sem bonificação</p>
                  </div>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {eventType === 'reconhecimento' && (
            <div className="space-y-2">
              <Label htmlFor="admin-points">Quantidade de Pontos</Label>
              <Input
                id="admin-points"
                type="number"
                min="1"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder="Ex: 50"
                required
              />
            </div>
          )}
          
          {eventType === 'ponto_atencao' && (
            <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
              <p className="text-sm text-muted-foreground">
                ⚠️ Ponto de atenção não adiciona XP. Serve apenas para registrar o evento.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="admin-reason">Justificativa (mínimo 50 caracteres)</Label>
            <Textarea
              id="admin-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo detalhado para este evento..."
              rows={4}
              className="resize-none"
              required
            />
            <p className="text-xs text-muted-foreground">
              {reason.length}/50 caracteres
            </p>
          </div>

          <Button 
            type="submit" 
            disabled={loading || !selectedTeam || (eventType === 'reconhecimento' && !points) || reason.length < 50}
            className="w-full"
          >
            {loading ? 'Processando...' : `Aplicar ${eventType === 'reconhecimento' ? 'Reconhecimento' : 'Ponto de Atenção'}`}
          </Button>
        </form>
      </CardContent>
    </Card>
    </div>
  );
}
