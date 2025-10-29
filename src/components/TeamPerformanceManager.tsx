import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Minus, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Team {
  id: string;
  name: string;
  team_modifier: number;
  last_modifier_update: string | null;
  modifier_reason: string | null;
  coordination_id?: string;
  coordinations?: {
    division_id: string;
  };
}

interface PerformanceLog {
  id: string;
  team_id: string;
  previous_modifier: number;
  new_modifier: number;
  reason: string | null;
  created_at: string;
  updated_by: string;
  profiles?: {
    name: string;
  };
}

export function TeamPerformanceManager() {
  const { user, orgScope, userRole } = useAuth();
  const { toast } = useToast();
  const [managedTeams, setManagedTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [newModifier, setNewModifier] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [performanceLog, setPerformanceLog] = useState<PerformanceLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchManagedTeams();
    fetchAllTeams();
  }, []);

  useEffect(() => {
    if (selectedTeamId) {
      fetchPerformanceLog(selectedTeamId);
    }
  }, [selectedTeamId]);

  const fetchManagedTeams = async () => {
    if (!user || !orgScope) return;

    let query = supabase
      .from('teams')
      .select(`
        *,
        coordinations (
          division_id
        )
      `)
      .order('name');

    // Filtrar equipes gerenciadas baseado na role
    if (userRole === 'coordenador_djtx' && orgScope.coordId) {
      query = query.eq('coordination_id', orgScope.coordId);
    } else if (userRole === 'gerente_divisao_djtx' && orgScope.divisionId) {
      query = query.eq('coordinations.division_id', orgScope.divisionId);
    }
    // gerente_djt vê todas

    const { data, error } = await query;

    if (error) {
      toast({
        title: 'Erro ao carregar equipes gerenciadas',
        description: error.message,
        variant: 'destructive'
      });
      return;
    }

    setManagedTeams(data || []);
  };

  const fetchAllTeams = async () => {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .order('team_modifier', { ascending: false });

    if (error) {
      toast({
        title: 'Erro ao carregar ranking de equipes',
        description: error.message,
        variant: 'destructive'
      });
      return;
    }

    setAllTeams(data || []);
  };

  const fetchPerformanceLog = async (teamId: string) => {
    const { data } = await supabase
      .from("team_performance_log")
      .select(`
        id,
        previous_modifier,
        new_modifier,
        reason,
        created_at,
        profiles!team_performance_log_updated_by_fkey(name)
      `)
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (data) {
      setPerformanceLog(data as any);
    }
  };

  const handleTeamChange = (teamId: string) => {
    setSelectedTeamId(teamId);
    const team = managedTeams.find(t => t.id === teamId);
    if (team) {
      setNewModifier(team.team_modifier.toString());
    }
  };

  const handleUpdateModifier = async () => {
    if (!selectedTeamId || !user) {
      toast({
        title: 'Erro',
        description: 'Selecione uma equipe',
        variant: 'destructive'
      });
      return;
    }

    const modifier = parseFloat(newModifier);
    if (isNaN(modifier) || modifier < 0.7 || modifier > 1.3) {
      toast({
        title: 'Erro',
        description: 'Modificador deve estar entre 0.7 e 1.3',
        variant: 'destructive'
      });
      return;
    }

    if (!reason || reason.length < 20) {
      toast({
        title: 'Erro',
        description: 'Justificativa deve ter no mínimo 20 caracteres',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      // Verificar se a equipe está nas equipes gerenciadas
      const team = managedTeams.find(t => t.id === selectedTeamId);
      if (!team) {
        toast({
          title: 'Erro',
          description: 'Você não tem permissão para ajustar esta equipe',
          variant: 'destructive'
        });
        return;
      }

      const previousModifier = team.team_modifier;

      // Registrar no log
      const { error: logError } = await supabase
        .from('team_performance_log')
        .insert({
          team_id: selectedTeamId,
          previous_modifier: previousModifier,
          new_modifier: modifier,
          reason,
          updated_by: user.id
        });

      if (logError) throw logError;

      // Atualizar equipe
      const { error: updateError } = await supabase
        .from('teams')
        .update({
          team_modifier: modifier,
          modifier_reason: reason,
          last_modifier_update: new Date().toISOString()
        })
        .eq('id', selectedTeamId);

      if (updateError) throw updateError;

      toast({
        title: 'Sucesso!',
        description: `Modificador da equipe atualizado para ${modifier}x`
      });

      // Limpar formulário e recarregar
      setNewModifier('');
      setReason('');
      setSelectedTeamId('');
      fetchManagedTeams();
      fetchAllTeams();
      if (selectedTeamId) {
        fetchPerformanceLog(selectedTeamId);
      }
    } catch (error: any) {
      console.error('Error updating modifier:', error);
      toast({
        title: 'Erro',
        description: error.message || 'Erro ao atualizar modificador',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Seção de Ajuste - Equipes Gerenciadas */}
      <Card>
        <CardHeader>
          <CardTitle>Ajustar Performance - Suas Equipes</CardTitle>
          <CardDescription>
            Modifique o multiplicador de XP das equipes sob sua gestão
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="team">Selecionar Equipe</Label>
            <Select value={selectedTeamId} onValueChange={handleTeamChange}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha uma equipe..." />
              </SelectTrigger>
              <SelectContent>
                {managedTeams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name} (Atual: {team.team_modifier}x)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTeamId && (
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-1">Equipe Selecionada:</p>
              <p className="text-2xl font-bold">
                {managedTeams.find(t => t.id === selectedTeamId)?.name}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Modificador atual: {managedTeams.find(t => t.id === selectedTeamId)?.team_modifier}x
              </p>
              {managedTeams.find(t => t.id === selectedTeamId)?.modifier_reason && (
                <p className="text-xs text-muted-foreground mt-2 p-2 bg-background rounded border">
                  Motivo atual: {managedTeams.find(t => t.id === selectedTeamId)?.modifier_reason}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="newModifier">Novo Modificador (0.7 a 1.3)</Label>
            <Input
              id="newModifier"
              type="number"
              step="0.05"
              min="0.7"
              max="1.3"
              value={newModifier}
              onChange={(e) => setNewModifier(e.target.value)}
              placeholder="1.0"
            />
            <p className="text-xs text-muted-foreground">
              Exemplos: 0.8 = -20%, 1.0 = neutro, 1.2 = +20%
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Justificativa (mínimo 20 caracteres)</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo detalhado para o ajuste..."
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {reason.length}/20 caracteres
            </p>
          </div>

          <Button
            onClick={handleUpdateModifier}
            disabled={loading || !selectedTeamId || !newModifier || reason.length < 20}
            className="w-full"
          >
            {loading ? 'Atualizando...' : 'Atualizar Modificador'}
          </Button>
        </CardContent>
      </Card>

      {/* Seção de Visão Geral - Todas as Equipes */}
      <Card>
        <CardHeader>
          <CardTitle>Visão Geral - Ranking de Performance</CardTitle>
          <CardDescription>
            Ranking de todas as equipes por modificador (somente leitura)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {allTeams.map((team, index) => (
              <div 
                key={team.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-muted-foreground w-8">
                    #{index + 1}
                  </span>
                  <div>
                    <p className="font-semibold">{team.name}</p>
                    {team.modifier_reason && (
                      <p className="text-xs text-muted-foreground">{team.modifier_reason}</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold">{team.team_modifier}x</p>
                  {team.last_modifier_update && (
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(team.last_modifier_update), "dd/MM/yyyy")}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedTeamId && performanceLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Histórico de Ajustes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {performanceLog.map((log) => (
                <div
                  key={log.id}
                  className="p-3 border rounded-lg bg-muted/50"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">
                      {log.previous_modifier}x → {log.new_modifier}x
                    </span>
                    <Badge
                      variant={
                        log.new_modifier > log.previous_modifier
                          ? "default"
                          : log.new_modifier < log.previous_modifier
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {log.new_modifier > log.previous_modifier && "+"}
                      {((log.new_modifier - log.previous_modifier) * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  {log.reason && (
                    <p className="text-xs text-muted-foreground mb-2">{log.reason}</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Por: {log.profiles?.name || 'Sistema'}</span>
                    <span>{format(new Date(log.created_at), "dd/MM/yyyy HH:mm")}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
