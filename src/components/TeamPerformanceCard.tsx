import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getActiveLocale } from "@/lib/i18n/activeLocale";

interface TeamModifier {
  team_modifier: number;
  last_modifier_update: string | null;
  modifier_reason: string | null;
  name: string;
}

export const TeamPerformanceCard = () => {
  const { orgScope } = useAuth();
  const [teamData, setTeamData] = useState<TeamModifier | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTeamModifier = async () => {
      const teamId = orgScope?.teamId;
      
      if (!teamId) {
        setLoading(false);
        return;
      }

      const { data: team } = await supabase
        .from("teams")
        .select("name, team_modifier, last_modifier_update, modifier_reason")
        .eq("id", teamId)
        .maybeSingle();

      if (team) {
        setTeamData(team);
      }
      setLoading(false);
    };

    fetchTeamModifier();
  }, [orgScope]);

  if (loading) return null;
  if (!teamData) return null;

  const modifier = teamData.team_modifier || 1.0;
  const percentage = ((modifier - 1.0) * 100).toFixed(0);
  const isPositive = modifier > 1.0;
  const isNegative = modifier < 1.0;

  return (
    <Card className="relative overflow-hidden p-6 bg-white/5 border border-white/20 text-white shadow-xl backdrop-blur-md">
      <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-primary/20 via-primary/25 to-primary/30" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-black/20 to-transparent" />
      <div className="relative">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-white">Performance da Equipe</h3>
          <p className="text-sm text-white/70">{teamData.name}</p>
        </div>
        {isPositive && <TrendingUp className="w-6 h-6 text-emerald-300" />}
        {isNegative && <TrendingDown className="w-6 h-6 text-rose-300" />}
        {!isPositive && !isNegative && <Minus className="w-6 h-6 text-white/60" />}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
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
          <p className="text-sm text-white/80 border-l-2 border-white/30 pl-3">
            {teamData.modifier_reason}
          </p>
        )}

        {teamData.last_modifier_update && (
          <p className="text-xs text-white/70">
            Última atualização:{" "}
            {new Date(teamData.last_modifier_update).toLocaleDateString(getActiveLocale())}
          </p>
        )}

        <div className="pt-3 border-t border-white/30">
          <p className="text-xs text-white/75">
            {isPositive && "🚀 Sua equipe está acima da média! Continue assim!"}
            {isNegative && "⚠️ Sua equipe precisa melhorar. Vamos juntos!"}
            {!isPositive && !isNegative && "✅ Sua equipe está na média esperada."}
          </p>
        </div>
      </div>
      </div>
    </Card>
  );
};
