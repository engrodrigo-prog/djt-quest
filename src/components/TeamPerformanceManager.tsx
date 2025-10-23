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

interface Team {
  id: string;
  name: string;
  team_modifier: number;
  last_modifier_update: string | null;
  modifier_reason: string | null;
}

interface PerformanceLog {
  id: string;
  previous_modifier: number;
  new_modifier: number;
  reason: string | null;
  created_at: string;
  profiles: {
    name: string;
  };
}

export const TeamPerformanceManager = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [newModifier, setNewModifier] = useState<string>("1.0");
  const [reason, setReason] = useState<string>("");
  const [performanceLog, setPerformanceLog] = useState<PerformanceLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTeams();
  }, []);

  useEffect(() => {
    if (selectedTeamId) {
      fetchPerformanceLog(selectedTeamId);
    }
  }, [selectedTeamId]);

  const fetchTeams = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("teams")
      .select("id, name, team_modifier, last_modifier_update, modifier_reason")
      .order("name");

    if (data) {
      setTeams(data);
    }
    setLoading(false);
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

  const handleUpdateModifier = async () => {
    if (!selectedTeamId) {
      toast({
        title: "Erro",
        description: "Selecione uma equipe",
        variant: "destructive",
      });
      return;
    }

    const modifierValue = parseFloat(newModifier);
    if (isNaN(modifierValue) || modifierValue < 0.7 || modifierValue > 1.3) {
      toast({
        title: "Erro",
        description: "O modificador deve estar entre 0.7 e 1.3",
        variant: "destructive",
      });
      return;
    }

    if (!reason.trim()) {
      toast({
        title: "Erro",
        description: "Forneça uma justificativa para o ajuste",
        variant: "destructive",
      });
      return;
    }

    try {
      // Get current modifier
      const { data: team } = await supabase
        .from("teams")
        .select("team_modifier")
        .eq("id", selectedTeamId)
        .single();

      const previousModifier = team?.team_modifier || 1.0;

      // Log the change
      const { error: logError } = await supabase.from("team_performance_log").insert({
        team_id: selectedTeamId,
        previous_modifier: previousModifier,
        new_modifier: modifierValue,
        reason: reason,
        updated_by: user?.id,
      });

      if (logError) throw logError;

      // Update team modifier
      const { error: updateError } = await supabase
        .from("teams")
        .update({
          team_modifier: modifierValue,
          modifier_reason: reason,
        })
        .eq("id", selectedTeamId);

      if (updateError) throw updateError;

      toast({
        title: "Sucesso!",
        description: "Modificador de performance atualizado",
      });

      // Reset form
      setReason("");
      fetchTeams();
      fetchPerformanceLog(selectedTeamId);
    } catch (error) {
      console.error("Error updating modifier:", error);
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o modificador",
        variant: "destructive",
      });
    }
  };

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);
  const currentModifier = selectedTeam?.team_modifier || 1.0;
  const currentPercentage = ((currentModifier - 1.0) * 100).toFixed(0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Ajustar Performance de Equipe</CardTitle>
          <CardDescription>
            Modificadores entre -30% e +30% (0.7x a 1.3x) afetam a pontuação final dos colaboradores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="team-select">Selecionar Equipe</Label>
            <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
              <SelectTrigger id="team-select">
                <SelectValue placeholder="Escolha uma equipe" />
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

          {selectedTeam && (
            <div className="p-4 bg-secondary/20 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">Modificador Atual:</span>
                <div className="flex items-center gap-2">
                  {currentModifier > 1.0 && <TrendingUp className="w-4 h-4 text-green-500" />}
                  {currentModifier < 1.0 && <TrendingDown className="w-4 h-4 text-red-500" />}
                  {currentModifier === 1.0 && <Minus className="w-4 h-4 text-muted-foreground" />}
                  <Badge
                    variant={
                      currentModifier > 1.0
                        ? "default"
                        : currentModifier < 1.0
                        ? "destructive"
                        : "secondary"
                    }
                  >
                    {currentModifier > 1.0 && "+"}
                    {currentPercentage}% ({currentModifier.toFixed(2)}x)
                  </Badge>
                </div>
              </div>
              {selectedTeam.modifier_reason && (
                <p className="text-xs text-muted-foreground mt-2 border-l-2 border-primary pl-2">
                  {selectedTeam.modifier_reason}
                </p>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="new-modifier">Novo Modificador (0.7 a 1.3)</Label>
            <Input
              id="new-modifier"
              type="number"
              min="0.7"
              max="1.3"
              step="0.05"
              value={newModifier}
              onChange={(e) => setNewModifier(e.target.value)}
              placeholder="1.0"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Exemplos: 0.8 = -20%, 1.0 = neutro, 1.2 = +20%
            </p>
          </div>

          <div>
            <Label htmlFor="reason">Justificativa *</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explique o motivo do ajuste (ex: Equipe superou metas de segurança, redução de incidentes, etc.)"
              rows={3}
            />
          </div>

          <Button onClick={handleUpdateModifier} className="w-full" disabled={!selectedTeamId}>
            Atualizar Modificador
          </Button>
        </CardContent>
      </Card>

      {selectedTeam && performanceLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Histórico de Ajustes - {selectedTeam.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {performanceLog.map((log) => (
                <div
                  key={log.id}
                  className="p-3 border rounded-lg bg-secondary/10 hover:bg-secondary/20 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">
                      {log.previous_modifier.toFixed(2)}x → {log.new_modifier.toFixed(2)}x
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
                    <span>Por: {log.profiles.name}</span>
                    <span>{new Date(log.created_at).toLocaleString("pt-BR")}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};