import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface TeamModifier {
  team_modifier: number;
  last_modifier_update: string | null;
  modifier_reason: string | null;
  name: string;
}

export const TeamPerformanceCard = () => {
  const { user } = useAuth();
  const [teamData, setTeamData] = useState<TeamModifier | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTeamModifier = async () => {
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("team_id")
        .eq("id", user.id)
        .single();

      if (!profile?.team_id) {
        setLoading(false);
        return;
      }

      const { data: team } = await supabase
        .from("teams")
        .select("name, team_modifier, last_modifier_update, modifier_reason")
        .eq("id", profile.team_id)
        .single();

      if (team) {
        setTeamData(team);
      }
      setLoading(false);
    };

    fetchTeamModifier();
  }, [user]);

  if (loading) return null;
  if (!teamData) return null;

  const modifier = teamData.team_modifier || 1.0;
  const percentage = ((modifier - 1.0) * 100).toFixed(0);
  const isPositive = modifier > 1.0;
  const isNegative = modifier < 1.0;

  return (
    <Card className="p-6 bg-gradient-to-br from-primary/5 to-primary/10">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Performance da Equipe</h3>
          <p className="text-sm text-muted-foreground">{teamData.name}</p>
        </div>
        {isPositive && <TrendingUp className="w-6 h-6 text-green-500" />}
        {isNegative && <TrendingDown className="w-6 h-6 text-red-500" />}
        {!isPositive && !isNegative && <Minus className="w-6 h-6 text-muted-foreground" />}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold text-foreground">
            {isPositive && "+"}
            {percentage}%
          </span>
          <Badge
            variant={isPositive ? "default" : isNegative ? "destructive" : "secondary"}
            className="text-xs"
          >
            Modificador: {modifier.toFixed(2)}x
          </Badge>
        </div>

        {teamData.modifier_reason && (
          <p className="text-sm text-muted-foreground border-l-2 border-primary pl-3">
            {teamData.modifier_reason}
          </p>
        )}

        {teamData.last_modifier_update && (
          <p className="text-xs text-muted-foreground">
            Última atualização:{" "}
            {new Date(teamData.last_modifier_update).toLocaleDateString("pt-BR")}
          </p>
        )}

        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {isPositive && "🚀 Sua equipe está acima da média! Continue assim!"}
            {isNegative && "⚠️ Sua equipe precisa melhorar. Vamos juntos!"}
            {!isPositive && !isNegative && "✅ Sua equipe está na média esperada."}
          </p>
        </div>
      </div>
    </Card>
  );
};