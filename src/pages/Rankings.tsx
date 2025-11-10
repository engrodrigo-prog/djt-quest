import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Navigation from '@/components/Navigation';
import { ThemedBackground } from '@/components/ThemedBackground';
import { Trophy, Users, Building2, Award, Shield, Percent } from 'lucide-react';
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
  adherencePct: number; // 0..100
  memberCount: number;
}

interface DivisionRanking {
  order: number; // display order only
  divisionId: string;
  divisionName: string;
  adherencePct: number; // 0..100
  teamCount: number;
}

export function Rankings() {
  const { orgScope } = useAuth();
  const [individualRankings, setIndividualRankings] = useState<IndividualRanking[]>([]);
  const [myTeamRankings, setMyTeamRankings] = useState<IndividualRanking[]>([]);
  const [teamRankings, setTeamRankings] = useState<TeamRanking[]>([]);
  const [divisionRankings, setDivisionRankings] = useState<DivisionRanking[]>([]);
  const [leaderRankings, setLeaderRankings] = useState<Array<{ rank: number; userId: string; name: string; avatarUrl: string | null; completed: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'individual' | 'myteam' | 'teams' | 'divisions' | 'leaders'>('individual');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const fetchRankings = useCallback(async () => {
    try {
      // Parallelize all queries for faster loading
      const [profilesResult, teamsResult, divisionsResult, coordsResult, eventsResult, challengesResult, evalQueueResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, name, xp, avatar_url, tier, team_id, coord_id, division_id, is_leader')
          .limit(1000),
        supabase
          .from('teams')
          .select('id, name, coord_id'),
        supabase
          .from('divisions')
          .select('id, name'),
        supabase
          .from('coordinations')
          .select('id, division_id'),
        supabase
          .from('events')
          .select('user_id, final_points, created_at'),
        supabase
          .from('challenges')
          .select('id, xp_reward, status, due_date, target_team_ids, target_coord_ids, target_div_ids'),
        supabase
          .from('evaluation_queue')
          .select('assigned_to, completed_at')
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

      const allProfiles = profilesResult.data || [];
      const profilesData = allProfiles.filter((profile) => !profile.is_leader);

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

        // Filter My Team: selected team (if any) or user's team
        const baseTeamId = selectedTeamId || (orgScope?.teamId && (!orgScope.divisionId || orgScope.teamId !== orgScope.divisionId) ? orgScope.teamId : null);
        if (baseTeamId) {
          const myTeam = ranked.filter(p => p.teamId === baseTeamId);
          setMyTeamRankings(myTeam.map((p, i) => ({ ...p, rank: i + 1 })));
        } else {
          setMyTeamRankings([]);
        }
      }

      // Process team rankings
      if (teamsResult.data && coordsResult.data && challengesResult.data && eventsResult.data) {
        const teams = teamsResult.data as Array<{ id: string; name: string; coord_id: string | null }>;
        const coordToDiv = (coordsResult.data as Array<{ id: string; division_id: string | null }>).
          reduce<Record<string, string | null>>((acc, c) => { acc[c.id] = c.division_id; return acc; }, {});

        // Build team members map (exclude leaders)
        const teamMembers = profilesData.reduce<Record<string, string[]>>((acc, p: any) => {
          if (!p.team_id) return acc;
          if (!acc[p.team_id]) acc[p.team_id] = [];
          acc[p.team_id].push(p.id);
          return acc;
        }, {});

        const now = new Date();
        const msBack = 90 * 24 * 60 * 60 * 1000; // janela padrão 90 dias
        const start = new Date(now.getTime() - msBack);
        const startMs = start.getTime();

        // Achieved per team
        const events = (eventsResult.data as Array<{ user_id: string; final_points: number; created_at: string }>);
        const achievedByTeam: Record<string, number> = {};
        const memberTeamByUser: Record<string, string> = {};
        Object.keys(teamMembers).forEach((teamId) => teamMembers[teamId].forEach((uid) => { memberTeamByUser[uid] = teamId; }));
        for (const ev of events) {
          if (!ev.user_id) continue;
          const tId = memberTeamByUser[ev.user_id];
          if (!tId) continue;
          if (new Date(ev.created_at).getTime() < startMs) continue;
          achievedByTeam[tId] = (achievedByTeam[tId] || 0) + (ev.final_points || 0);
        }

        // Possible per team from challenges
        const challenges = (challengesResult.data as Array<any>).filter((c) => {
          const st = (c.status || '').toLowerCase();
          const eligible = st === 'active' || st === 'scheduled';
          if (!eligible) return false;
          if (c.due_date && new Date(c.due_date).getTime() < startMs) return false;
          return true;
        });
        const possibleByTeam: Record<string, number> = {};
        for (const team of teams) {
          const memberCount = (teamMembers[team.id] || []).length;
          const divisionId = team.coord_id ? coordToDiv[team.coord_id] : null;
          let possible = 0;
          for (const ch of challenges) {
            const tTeams: string[] | null = Array.isArray(ch.target_team_ids) ? ch.target_team_ids : null;
            const tCoords: string[] | null = Array.isArray(ch.target_coord_ids) ? ch.target_coord_ids : null;
            const tDivs: string[] | null = Array.isArray(ch.target_div_ids) ? ch.target_div_ids : null;
            const applies =
              (!tTeams && !tCoords && !tDivs) ||
              (tTeams && tTeams.includes(team.id)) ||
              (tCoords && team.coord_id && tCoords.includes(team.coord_id)) ||
              (tDivs && divisionId && tDivs.includes(divisionId));
            if (applies) {
              possible += (ch.xp_reward || 0) * memberCount;
            }
          }
          possibleByTeam[team.id] = possible;
        }

        const teamData = teams
          .filter((t) => t.id !== 'DJT')
          .map((team) => {
            const memberCount = (teamMembers[team.id] || []).length;
            const achieved = achievedByTeam[team.id] || 0;
            const possible = possibleByTeam[team.id] || 0;
            const adherencePct = possible > 0 ? Math.round((achieved / possible) * 100) : 0;
            return { teamId: team.id, teamName: team.name || 'Equipe', adherencePct, memberCount };
          })
          .sort((a, b) => b.adherencePct - a.adherencePct)
          .map((t, i) => ({ ...t, rank: i + 1 }));

        setTeamRankings(teamData);
      }

      // Process division rankings
      if (divisionsResult.data && teamsResult.data && coordsResult.data && challengesResult.data && eventsResult.data) {
        const divisions = divisionsResult.data as Array<{ id: string; name: string }>;
        const teams = teamsResult.data as Array<{ id: string; name: string; coord_id: string | null }>;
        const coordToDiv = (coordsResult.data as Array<{ id: string; division_id: string | null }>).
          reduce<Record<string, string | null>>((acc, c) => { acc[c.id] = c.division_id; return acc; }, {});

        const deriveDivFromTeamId = (teamId: string): string | null => {
          if (!teamId) return null;
          const base = teamId.split('-')[0] || null; // ex.: DJTB-CUB -> DJTB
          return base;
        };

        // Map teams by division (prefer coord->division, fallback por prefixo do teamId)
        const teamsByDivision: Record<string, string[]> = {};
        for (const t of teams) {
          let dId: string | null = null;
          if (t.coord_id && coordToDiv[t.coord_id]) {
            dId = coordToDiv[t.coord_id] as string;
          } else {
            dId = deriveDivFromTeamId(t.id);
          }
          if (!dId) continue;
          if (!teamsByDivision[dId]) teamsByDivision[dId] = [];
          teamsByDivision[dId].push(t.id);
        }

        const now = new Date();
        const msBack = 90 * 24 * 60 * 60 * 1000;
        const start = new Date(now.getTime() - msBack);
        const startMs = start.getTime();

        // Team members and member->team map
        const teamMembers = profilesData.reduce<Record<string, string[]>>((acc, p: any) => {
          if (!p.team_id) return acc;
          if (!acc[p.team_id]) acc[p.team_id] = [];
          acc[p.team_id].push(p.id);
          return acc;
        }, {});
        const memberTeamByUser: Record<string, string> = {};
        Object.keys(teamMembers).forEach((teamId) => teamMembers[teamId].forEach((uid) => { memberTeamByUser[uid] = teamId; }));

        // Achieved per division
        const events = (eventsResult.data as Array<{ user_id: string; final_points: number; created_at: string }>);
        const achievedByDivision: Record<string, number> = {};
        for (const ev of events) {
          if (!ev.user_id) continue;
          if (new Date(ev.created_at).getTime() < startMs) continue;
          const teamId = memberTeamByUser[ev.user_id];
          if (!teamId) continue;
          const team = teams.find((t) => t.id === teamId);
          const dId = (team?.coord_id && coordToDiv[team.coord_id]) ? coordToDiv[team.coord_id] : deriveDivFromTeamId(teamId);
          if (!dId) continue;
          achievedByDivision[dId] = (achievedByDivision[dId] || 0) + (ev.final_points || 0);
        }

        // Possible per division
        const challenges = (challengesResult.data as Array<any>).filter((c) => {
          const st = (c.status || '').toLowerCase();
          const eligible = st === 'active' || st === 'scheduled';
          if (!eligible) return false;
          if (c.due_date && new Date(c.due_date).getTime() < startMs) return false;
          return true;
        });
        const possibleByDivision: Record<string, number> = {};
        for (const d of divisions) {
          const dTeams = teamsByDivision[d.id] || [];
          let memberCount = 0;
          for (const tId of dTeams) memberCount += (teamMembers[tId] || []).length;
          let possible = 0;
          for (const ch of challenges) {
            const tTeams: string[] | null = Array.isArray(ch.target_team_ids) ? ch.target_team_ids : null;
            const tCoords: string[] | null = Array.isArray(ch.target_coord_ids) ? ch.target_coord_ids : null;
            const tDivs: string[] | null = Array.isArray(ch.target_div_ids) ? ch.target_div_ids : null;
            const applies = (!tTeams && !tCoords && !tDivs) || (tDivs && tDivs.includes(d.id));
            if (applies) {
              possible += (ch.xp_reward || 0) * memberCount;
            }
          }
          possibleByDivision[d.id] = possible;
        }

        const divisionData = divisions
          .map((d) => {
            const achieved = achievedByDivision[d.id] || 0;
            const possible = possibleByDivision[d.id] || 0;
            const teamCount = (teamsByDivision[d.id] || []).length;
            const adherencePct = possible > 0 ? Math.round((achieved / possible) * 100) : 0;
            return { divisionId: d.id, divisionName: d.name, adherencePct, teamCount };
          })
          .sort((a, b) => b.adherencePct - a.adherencePct)
          .map((d, i) => ({ ...d, order: i + 1 }));

        // Adicionar linha agregada global DJT (soma de todas as divisões), fora do ranking
        const allAchieved = Object.values(achievedByDivision).reduce((s, v) => s + v, 0);
        const allPossible = Object.values(possibleByDivision).reduce((s, v) => s + v, 0);
        const globalAdherence = allPossible > 0 ? Math.round((allAchieved / allPossible) * 100) : 0;
        const globalTeamCount = Object.values(teamsByDivision).reduce((s, arr) => s + arr.length, 0);
        const globalRow = { divisionId: 'DJT', divisionName: 'Aderência Global (DJT)', adherencePct: globalAdherence, teamCount: globalTeamCount, order: 0 };

        setDivisionRankings([globalRow, ...divisionData]);
      }

      // Leader-only ranking (by completed evaluations)
      if (!evalQueueResult.error) {
        const completedByReviewer = (evalQueueResult.data || []).reduce<Record<string, number>>((acc: any, row: any) => {
          const reviewer = row.assigned_to as string;
          if (!reviewer) return acc;
          const inc = row.completed_at ? 1 : 0;
          acc[reviewer] = (acc[reviewer] || 0) + inc;
          return acc;
        }, {});
        const leaders = allProfiles.filter((p: any) => p.is_leader);
        const sorted = leaders
          .map((p: any) => ({ userId: p.id, name: p.name, avatarUrl: p.avatar_url, completed: completedByReviewer[p.id] || 0 }))
          .sort((a, b) => b.completed - a.completed)
          .map((p, i) => ({ ...p, rank: i + 1 }));
        setLeaderRankings(sorted);
      }
    } catch (error) {
      console.error('Error fetching rankings:', error);
    } finally {
      setLoading(false);
    }
  }, [orgScope?.divisionId, orgScope?.teamId, selectedTeamId]);

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
    <div className="relative min-h-screen pb-40">
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

        <Tabs value={activeTab} onValueChange={(v:any)=>setActiveTab(v)} className="w-full">
          <TabsList className="grid w-full grid-cols-6 mb-6">
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
            <TabsTrigger value="leaders" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Líderes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="individual">
            <Card className="bg-transparent border-transparent shadow-none">
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
                  <div className="space-y-6">
                    {individualRankings.map((ranking) => (
                      <div
                        key={ranking.userId}
                        onClick={()=>setSelectedUserId(ranking.userId)}
                        className={`flex items-center gap-4 p-4 rounded-lg border bg-white/5 hover:bg-white/10 transition-colors cursor-pointer ${selectedUserId===ranking.userId ? 'ring-1 ring-primary/40 bg-white/10' : ''}`}
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
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                {selectedTeamId && (
                  <button onClick={()=>{ setSelectedTeamId(null); }} className="text-xs text-muted-foreground hover:text-foreground mb-2 w-fit">← Voltar</button>
                )}
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
                  <div className="space-y-6">
                    {myTeamRankings.map((ranking) => (
                      <div
                        key={ranking.userId}
                        className="flex items-center gap-4 p-4 rounded-lg bg-transparent transition-colors"
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
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-purple-500" />
                  Ranking de Equipes (adesão %)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">Carregando...</p>
                ) : (
                  <div className="space-y-6">
                    {teamRankings.map((ranking) => (
                      <div
                        key={ranking.teamId}
                        onClick={() => { setSelectedTeamId(ranking.teamId); setActiveTab('myteam'); (window as any).scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="flex items-center gap-4 p-4 rounded-lg border bg-transparent hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">
                          {getMedalEmoji(ranking.rank)}
                        </span>

                        <div className="flex-1">
                          <p className="font-semibold text-lg">{ranking.teamName}</p>
                          <p className="text-sm text-muted-foreground">{ranking.memberCount} membros</p>
                        </div>

                        <div className="text-right">
                          <p className="text-lg font-bold flex items-center justify-end gap-1">
                            <Percent className="h-4 w-4 text-purple-500" /> {ranking.adherencePct}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="divisions">
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-orange-500" />
                  Divisões (monitoramento de adesão %)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">Carregando...</p>
                ) : (
                  <div className="space-y-6">
                    {divisionRankings.map((ranking) => (
                      <div
                        key={ranking.divisionId}
                        className="flex items-center gap-4 p-4 rounded-lg border bg-transparent hover:bg-white/5 transition-colors"
                      >
                        <div className="flex-1">
                          <p className="font-semibold text-lg">{ranking.divisionName}</p>
                          <p className="text-sm text-muted-foreground">{ranking.teamCount} equipes</p>
                        </div>

                        <div className="text-right">
                          <p className="text-lg font-bold flex items-center justify-end gap-1">
                            <Percent className="h-4 w-4 text-orange-500" /> {ranking.adherencePct}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaders">
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-500" />
                  Ranking de Líderes (avaliações concluídas)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">Carregando...</p>
                ) : (
                  <div className="space-y-6">
                    {leaderRankings.map((r) => (
                      <div key={r.userId} className="flex items-center gap-4 p-4 rounded-lg border bg-transparent hover:bg-white/5 transition-colors">
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">{getMedalEmoji(r.rank)}</span>
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={r.avatarUrl || ''} />
                          <AvatarFallback>{r.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="font-semibold">{r.name}</p>
                          <p className="text-xs text-muted-foreground">Avaliações concluídas</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold">{r.completed}</p>
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
