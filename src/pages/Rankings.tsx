import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Users, Building, Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

interface IndividualRanking {
  id: string;
  name: string;
  xp: number;
  level: number;
  avatar_url: string | null;
  team_name: string;
}

interface TeamRanking {
  id: string;
  name: string;
  total_xp: number;
  member_count: number;
  team_modifier: number;
}

interface DivisionRanking {
  id: string;
  name: string;
  total_xp: number;
  team_count: number;
}

export default function Rankings() {
  const [individualRanking, setIndividualRanking] = useState<IndividualRanking[]>([]);
  const [teamRanking, setTeamRanking] = useState<TeamRanking[]>([]);
  const [divisionRanking, setDivisionRanking] = useState<DivisionRanking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRankings();
  }, []);

  const fetchRankings = async () => {
    setLoading(true);

    // Individual ranking
    const { data: individuals } = await supabase
      .from("profiles")
      .select(`
        id,
        name,
        xp,
        level,
        avatar_url,
        teams(name)
      `)
      .order("xp", { ascending: false })
      .limit(100);

    if (individuals) {
      setIndividualRanking(
        individuals.map((p: any) => ({
          id: p.id,
          name: p.name,
          xp: p.xp || 0,
          level: p.level || 1,
          avatar_url: p.avatar_url,
          team_name: p.teams?.name || "Sem equipe",
        }))
      );
    }

    // Team ranking
    const { data: teams } = await supabase
      .from("teams")
      .select(`
        id,
        name,
        team_modifier,
        profiles(xp)
      `)
      .order("name");

    if (teams) {
      const teamRankings = teams.map((team: any) => {
        const totalXp = team.profiles?.reduce((sum: number, p: any) => sum + (p.xp || 0), 0) || 0;
        return {
          id: team.id,
          name: team.name,
          total_xp: totalXp,
          member_count: team.profiles?.length || 0,
          team_modifier: team.team_modifier || 1.0,
        };
      });
      setTeamRanking(teamRankings.sort((a, b) => b.total_xp - a.total_xp));
    }

    // Division ranking
    const { data: divisions } = await supabase
      .from("divisions")
      .select(`
        id,
        name,
        coordinations(
          teams(
            profiles(xp)
          )
        )
      `)
      .order("name");

    if (divisions) {
      const divisionRankings = divisions.map((div: any) => {
        let totalXp = 0;
        let teamCount = 0;
        div.coordinations?.forEach((coord: any) => {
          coord.teams?.forEach((team: any) => {
            teamCount++;
            team.profiles?.forEach((p: any) => {
              totalXp += p.xp || 0;
            });
          });
        });
        return {
          id: div.id,
          name: div.name,
          total_xp: totalXp,
          team_count: teamCount,
        };
      });
      setDivisionRanking(divisionRankings.sort((a, b) => b.total_xp - a.total_xp));
    }

    setLoading(false);
  };

  const getMedalEmoji = (position: number) => {
    switch (position) {
      case 1:
        return "🥇";
      case 2:
        return "🥈";
      case 3:
        return "🥉";
      default:
        return `#${position}`;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <main className="container mx-auto p-4 md:p-6 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-2">
            <Trophy className="inline-block w-8 h-8 mr-2 text-primary" />
            Rankings DJT Go
          </h1>
          <p className="text-muted-foreground">
            Acompanhe o desempenho individual, das equipes e divisões
          </p>
        </div>

        <Tabs defaultValue="individual" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="individual">
              <Users className="w-4 h-4 mr-2" />
              Individual
            </TabsTrigger>
            <TabsTrigger value="teams">
              <Building className="w-4 h-4 mr-2" />
              Equipes
            </TabsTrigger>
            <TabsTrigger value="divisions">
              <Building2 className="w-4 h-4 mr-2" />
              Divisões
            </TabsTrigger>
          </TabsList>

          <TabsContent value="individual">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Ranking Individual</h2>
              {loading ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : (
                <div className="space-y-3">
                  {individualRanking.map((player, index) => (
                    <div
                      key={player.id}
                      className="flex items-center gap-4 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                    >
                      <span className="text-2xl font-bold w-12 text-center">
                        {getMedalEmoji(index + 1)}
                      </span>
                      <Avatar className="w-12 h-12">
                        <AvatarImage src={player.avatar_url || undefined} />
                        <AvatarFallback>{player.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-semibold text-foreground">{player.name}</p>
                        <p className="text-sm text-muted-foreground">{player.team_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg text-primary">{player.xp} XP</p>
                        <Badge variant="outline">Nível {player.level}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="teams">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Ranking de Equipes</h2>
              {loading ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : (
                <div className="space-y-3">
                  {teamRanking.map((team, index) => (
                    <div
                      key={team.id}
                      className="flex items-center gap-4 p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                    >
                      <span className="text-2xl font-bold w-12 text-center">
                        {getMedalEmoji(index + 1)}
                      </span>
                      <div className="flex-1">
                        <p className="font-semibold text-foreground text-lg">{team.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {team.member_count} membros
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-xl text-primary">{team.total_xp} XP</p>
                        <Badge
                          variant={
                            team.team_modifier > 1.0
                              ? "default"
                              : team.team_modifier < 1.0
                              ? "destructive"
                              : "secondary"
                          }
                        >
                          Modificador: {team.team_modifier.toFixed(2)}x
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="divisions">
            <Card className="p-6">
              <h2 className="text-xl font-semibold mb-4">Ranking de Divisões</h2>
              {loading ? (
                <p className="text-muted-foreground">Carregando...</p>
              ) : (
                <div className="space-y-3">
                  {divisionRanking.map((division, index) => (
                    <div
                      key={division.id}
                      className="flex items-center gap-4 p-4 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                    >
                      <span className="text-2xl font-bold w-12 text-center">
                        {getMedalEmoji(index + 1)}
                      </span>
                      <div className="flex-1">
                        <p className="font-semibold text-foreground text-lg">{division.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {division.team_count} equipes
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-xl text-primary">{division.total_xp} XP</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}