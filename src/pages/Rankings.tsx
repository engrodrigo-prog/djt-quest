import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Navigation from '@/components/Navigation';
import { ThemedBackground } from '@/components/ThemedBackground';
import { Trophy, Users, Building2, Award } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

interface IndividualRanking {
  rank: number;
  userId: string;
  name: string;
  xp: number;
  level: number;
  avatarUrl: string | null;
  tier: string;
  teamName: string;
  teamId: string | null;
  coordId: string | null;
  divisionId: string;
}

interface TeamRanking {
  rank: number;
  teamId: string;
  teamName: string;
  totalXp: number;
  memberCount: number;
  teamModifier: number;
}

interface DivisionRanking {
  rank: number;
  divisionId: string;
  divisionName: string;
  totalXp: number;
  teamCount: number;
}

export function Rankings() {
  const { orgScope } = useAuth();
  const [individualRankings, setIndividualRankings] = useState<IndividualRanking[]>([]);
  const [myTeamRankings, setMyTeamRankings] = useState<IndividualRanking[]>([]);
  const [teamRankings, setTeamRankings] = useState<TeamRanking[]>([]);
  const [divisionRankings, setDivisionRankings] = useState<DivisionRanking[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRankings = useCallback(async () => {
    try {
      // Parallelize all queries for faster loading
      const [profilesResult, teamsResult, divisionsResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, name, xp, avatar_url, tier, team_id, coord_id, division_id, is_leader')
          .limit(1000),
        supabase
          .from('teams')
          .select('id, name, team_modifier'),
        supabase
          .from('divisions')
          .select('id, name')
      ]);

      // Process individual rankings
      if (profilesResult.error) {
        console.warn('Rankings: erro ao carregar perfis', profilesResult.error.message);
      }
      if (teamsResult.error) {
        console.warn('Rankings: erro ao carregar equipes', teamsResult.error.message);
      }
      if (divisionsResult.error) {
        console.warn('Rankings: erro ao carregar divisões', divisionsResult.error.message);
      }

      const profilesData = (profilesResult.data || []).filter((profile) => !profile.is_leader);

      if (profilesData.length) {
        const teamMap = (teamsResult.data || []).reduce<Record<string, string>>((acc, team) => {
          acc[team.id] = team.name;
          return acc;
        }, {});

        const ranked = [...profilesData]
          .sort((a, b) => (b.xp || 0) - (a.xp || 0))
          .map((profile, index) => {
            const xp = Number(profile.xp ?? 0);
            return {
              rank: index + 1,
              userId: profile.id,
              name: profile.name,
              xp,
              level: Math.floor(xp / 100),
              avatarUrl: profile.avatar_url,
              tier: profile.tier,
              teamName: profile.team_id ? (teamMap[profile.team_id] || 'Sem equipe') : 'Sem equipe',
              coordId: profile.coord_id,
              divisionId: profile.division_id,
              teamId: profile.team_id
            };
          });
        setIndividualRankings(ranked);

        // Filter for "My Team"
        if (orgScope?.teamId && (!orgScope.divisionId || orgScope.teamId !== orgScope.divisionId)) {
          const myTeam = ranked.filter(p => p.teamId === orgScope.teamId);
          setMyTeamRankings(myTeam.map((p, i) => ({ ...p, rank: i + 1 })));
        } else {
          setMyTeamRankings([]);
        }
      }

      // Process team rankings
      if (teamsResult.data) {
        const membersByTeam = profilesData.reduce<Record<string, { count: number; xp: number }>>((acc, profile) => {
          if (!profile.team_id) return acc;
          if (!acc[profile.team_id]) acc[profile.team_id] = { count: 0, xp: 0 };
          acc[profile.team_id].count += 1;
          acc[profile.team_id].xp += profile.xp || 0;
          return acc;
        }, {});

        const teamData = teamsResult.data.map((team: any) => {
          const stats = membersByTeam[team.id] || { count: 0, xp: 0 };
          const baseTeamName = team.name || 'Equipe';
          const isBaseMarker = baseTeamName.toLowerCase().includes('base');
          const displayName = isBaseMarker ? `Base ${baseTeamName.replace(/base/i, '').trim()}` : baseTeamName;
          return {
            teamId: team.id,
            teamName: displayName,
            isBase: isBaseMarker,
            totalXp: stats.xp,
            memberCount: stats.count,
            teamModifier: team.team_modifier || 1.0
          };
        }).sort((a, b) => b.totalXp - a.totalXp);

        setTeamRankings(teamData.map((t, i) => ({ ...t, rank: i + 1 })));
      }

      // Process division rankings
      if (divisionsResult.data) {
        const divisionTotals = divisionsResult.data.map((division: any) => {
          const members = profilesData.filter((profile) => profile.division_id === division.id);
          const totalXp = members.reduce((sum, member) => sum + (member.xp || 0), 0);
          const teamCount = new Set(members.map((member) => member.team_id).filter(Boolean)).size;
          return {
            divisionId: division.id,
            divisionName: division.name,
            totalXp,
            teamCount
          };
        }).sort((a, b) => b.totalXp - a.totalXp);

        setDivisionRankings(divisionTotals.map((d, i) => ({ ...d, rank: i + 1 })));
      }
    } catch (error) {
      console.error('Error fetching rankings:', error);
    } finally {
      setLoading(false);
    }
  }, [orgScope?.divisionId, orgScope?.teamId]);

  useEffect(() => {
    fetchRankings();
  }, [fetchRankings]);

  const getMedalEmoji = (position: number) => {
    if (position === 1) return '🥇';
    if (position === 2) return '🥈';
    if (position === 3) return '🥉';
    return `#${position}`;
  };

  return (
    <div className="relative min-h-screen bg-background overflow-hidden">
      <ThemedBackground theme="conhecimento" />
      <Navigation />
      <div className="container relative mx-auto p-4 md:p-6 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-3xl md:text-4xl font-bold flex items-center gap-2">
            <Trophy className="h-8 w-8 text-primary" />
            Rankings DJT Quest
          </h1>
          <p className="text-muted-foreground mt-2">
            Acompanhe o desempenho individual, das equipes e divisões
          </p>
        </div>

        <Tabs defaultValue="individual" className="w-full">
          <TabsList className="grid w-full grid-cols-5 mb-6">
            <TabsTrigger value="individual" className="flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              Geral
            </TabsTrigger>
            <TabsTrigger value="myteam" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Minha Equipe
            </TabsTrigger>
            <TabsTrigger value="teams" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Equipes
            </TabsTrigger>
            <TabsTrigger value="divisions" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Divisões
            </TabsTrigger>
          </TabsList>

          <TabsContent value="individual">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Ranking Geral
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">Carregando...</p>
                ) : (
                  <div className="space-y-3">
                    {individualRankings.map((ranking) => (
                      <div
                        key={ranking.userId}
                        className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                      >
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">
                          {getMedalEmoji(ranking.rank)}
                        </span>
                        
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={ranking.avatarUrl || ''} />
                          <AvatarFallback>{ranking.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                        </Avatar>

                        <div className="flex-1">
                          <p className="font-semibold">{ranking.name}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Badge variant="outline" className="text-xs">
                              {ranking.tier}
                            </Badge>
                            <span>{ranking.teamName}</span>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="text-lg font-bold">{ranking.xp.toLocaleString()} XP</p>
                          <p className="text-sm text-muted-foreground">Nível {ranking.level}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="myteam">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-green-500" />
                  Ranking da Minha Equipe
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">Carregando...</p>
                ) : myTeamRankings.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">Nenhum colaborador encontrado na sua equipe.</p>
                ) : (
                  <div className="space-y-3">
                    {myTeamRankings.map((ranking) => (
                      <div
                        key={ranking.userId}
                        className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                      >
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">
                          {getMedalEmoji(ranking.rank)}
                        </span>
                        
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={ranking.avatarUrl || ''} />
                          <AvatarFallback>{ranking.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                        </Avatar>

                        <div className="flex-1">
                          <p className="font-semibold">{ranking.name}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Badge variant="outline" className="text-xs">
                              {ranking.tier}
                            </Badge>
                          </div>
                        </div>

                        <div className="text-right">
                          <p className="text-lg font-bold">{ranking.xp.toLocaleString()} XP</p>
                          <p className="text-sm text-muted-foreground">Nível {ranking.level}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="teams">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-purple-500" />
                  Ranking de Equipes
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">Carregando...</p>
                ) : (
                  <div className="space-y-3">
                    {teamRankings.map((ranking) => (
                      <div
                        key={ranking.teamId}
                        className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                      >
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">
                          {getMedalEmoji(ranking.rank)}
                        </span>

                        <div className="flex-1">
                          <p className="font-semibold text-lg">{ranking.teamName}</p>
                          <p className="text-sm text-muted-foreground">{ranking.memberCount} membros</p>
                        </div>

                        <div className="text-right">
                          <p className="text-lg font-bold">{ranking.totalXp.toLocaleString()} XP</p>
                          <Badge
                            variant={
                              ranking.teamModifier > 1.0
                                ? 'default'
                                : ranking.teamModifier < 1.0
                                ? 'destructive'
                                : 'secondary'
                            }
                          >
                            {ranking.teamModifier}x
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="divisions">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-orange-500" />
                  Ranking de Divisões
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">Carregando...</p>
                ) : (
                  <div className="space-y-3">
                    {divisionRankings.map((ranking) => (
                      <div
                        key={ranking.divisionId}
                        className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                      >
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">
                          {getMedalEmoji(ranking.rank)}
                        </span>

                        <div className="flex-1">
                          <p className="font-semibold text-lg">{ranking.divisionName}</p>
                          <p className="text-sm text-muted-foreground">{ranking.teamCount} equipes</p>
                        </div>

                        <div className="text-right">
                          <p className="text-lg font-bold">{ranking.totalXp.toLocaleString()} XP</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default Rankings;
