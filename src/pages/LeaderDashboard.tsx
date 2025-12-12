import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trophy, Users, TrendingUp, MessageSquare, Target, Award, Shield, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TeamTierProgressCard } from "@/components/TeamTierProgressCard";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { fetchTeamNames } from "@/lib/teamLookup";

interface TeamStats {
  total_members: number;
  avg_xp: number;
  total_xp: number;
  engagement_rate: number;
  rank_position: number;
}

interface CampaignPerformance {
  campaign_id: string;
  campaign_title: string;
  adhesion_percentage: number;
  completion_percentage: number;
  participants_count: number;
  total_members: number;
}

interface ChallengePerformance {
  challenge_id: string;
  challenge_title: string;
  challenge_type: string;
  adhesion_percentage: number;
  completion_percentage: number;
  participants_count: number;
  total_members: number;
  avg_xp_earned: number;
}

interface ForumTopic {
  id: string;
  title: string;
  posts_count: number;
  last_post_at: string;
}

interface TeamMember {
  id: string;
  name: string;
  xp: number;
  tier: string;
}

type Scope = 'team' | 'coord' | 'division';

export default function LeaderDashboard() {
  const { user, profile, orgScope, signOut } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [teamStats, setTeamStats] = useState<TeamStats | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [challenges, setChallenges] = useState<ChallengePerformance[]>([]);
  // Desafios agora são tratados via campanhas/fóruns; aba de desafios fica oculta na UI.
  const showChallengesTab = false;
  const [forums, setForums] = useState<ForumTopic[]>([]);
  const [topMembers, setTopMembers] = useState<TeamMember[]>([]);
  const [userProfile, setUserProfile] = useState<{ name: string; avatar_url: string | null; team: { name: string } | null; tier: string; matricula?: string | null; email?: string | null } | null>(null);
  const [scope, setScope] = useState<Scope>('team');
  const [windowSel, setWindowSel] = useState<'30d' | '90d' | '365d'>('30d');
  const [xpPossible, setXpPossible] = useState<number>(0);
  const [xpAchieved, setXpAchieved] = useState<number>(0);
  const teamId = orgScope?.teamId;
  const coordId = orgScope?.coordId;
  const divisionId = orgScope?.divisionId;

  const loadUserProfile = useCallback(async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from("profiles")
      .select("name, tier, avatar_url, team_id, matricula, email")
      .eq("id", user.id)
      .single();
    
    if (error) {
      console.warn('LeaderDashboard: perfil indisponível', error.message);
    }

    if (data) {
      let teamName: string | null = null;
      if (data.team_id) {
        const map = await fetchTeamNames([data.team_id]);
        teamName = map[data.team_id] || null;
      }
      setUserProfile({
        ...data,
        team: teamName ? { name: teamName } : null,
      } as any);
    }
  }, [user]);

  const loadTeamStats = useCallback(async () => {
    const scopeFilter = scope === 'team' ? { col: 'team_id', val: teamId }
      : scope === 'coord' ? { col: 'coord_id', val: coordId }
      : { col: 'division_id', val: divisionId };

    if (!scopeFilter.val) {
      setTeamStats(null);
      return;
    }

    const { data: members } = await (supabase as any)
      .from('profiles')
      .select('xp, id')
      .eq(scopeFilter.col as any, scopeFilter.val as any)
      .eq('is_leader', false);

    if (members) {
      const totalMembers = members.length;
      const totalXP = members.reduce((sum, m) => sum + (m.xp || 0), 0);
      const avgXP = totalMembers > 0 ? Math.floor(totalXP / totalMembers) : 0;

      const engagementRate = 85;

      let rankPosition = 0;
      if (scope === 'team' && teamId) {
        const { data: rankings } = await supabase
          .from('team_xp_summary')
          .select('*')
          .order('total_xp', { ascending: false });
        rankPosition = (rankings?.findIndex(r => r.team_id === teamId) ?? -1) + 1 || 0;
      }

      setTeamStats({
        total_members: totalMembers,
        avg_xp: avgXP,
        total_xp: totalXP,
        engagement_rate: engagementRate,
        rank_position: rankPosition
      });
    }
  }, [coordId, divisionId, scope, teamId]);

  const loadCampaigns = useCallback(async () => {
    if (!teamId) {
      setCampaigns([]);
      return;
    }

    const { data } = await supabase
      .from('team_campaign_performance')
      .select('*')
      .eq('team_id', teamId);

    if (data) {
      setCampaigns(data);
    }
  }, [teamId]);

  const loadChallenges = useCallback(async () => {
    if (!teamId) {
      setChallenges([]);
      return;
    }

    const { data } = await supabase
      .from('team_challenge_performance')
      .select('*')
      .eq('team_id', teamId)
      .order('adhesion_percentage', { ascending: false })
      .limit(5);

    if (data) {
      setChallenges(data);
    }
  }, [teamId]);

  const loadForums = useCallback(async () => {
    if (!teamId) {
      setForums([]);
      return;
    }

    const { data: memberIds } = await supabase
      .from('profiles')
      .select('id')
      .eq('team_id', teamId);

    if (memberIds && memberIds.length > 0) {
      const { data } = await supabase
        .from('forum_topics')
        .select('id, title, posts_count, last_post_at')
        .eq('is_active', true)
        .order('last_post_at', { ascending: false })
        .limit(5);

      if (data) {
        setForums(data);
      }
    } else {
      setForums([]);
    }
  }, [teamId]);

  const loadTopMembers = useCallback(async () => {
    const scopeFilter = scope === 'team' ? { col: 'team_id', val: teamId }
      : scope === 'coord' ? { col: 'coord_id', val: coordId }
      : { col: 'division_id', val: divisionId };

    if (!scopeFilter.val) {
      setTopMembers([]);
      return;
    }

    const { data } = await (supabase as any)
      .from('profiles')
      .select('id, name, xp, tier')
      .eq(scopeFilter.col as any, scopeFilter.val as any)
      .eq('is_leader', false)
      .order('xp', { ascending: false })
      .limit(5);

    if (data) {
      setTopMembers(data);
    }
  }, [coordId, divisionId, scope, teamId]);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const requiredVal = scope === 'team' ? teamId : scope === 'coord' ? coordId : divisionId;
      if (!requiredVal) {
        setTeamStats(null);
        setCampaigns([]);
        setChallenges([]);
        setForums([]);
        setTopMembers([]);
        return;
      }

      const jobs: Promise<any>[] = [loadTeamStats(), loadForums(), loadTopMembers()];
      if (scope === 'team') {
        // Apenas no escopo de equipe fazem sentido os painéis por time
        jobs.push(loadCampaigns());
        jobs.push(loadChallenges());
      }
      await Promise.all(jobs);

      // XP possível vs atingido (janela temporal)
      const now = new Date();
      const msBack = windowSel === '30d' ? 30*24*60*60*1000 : windowSel === '90d' ? 90*24*60*60*1000 : 365*24*60*60*1000;
      const start = new Date(now.getTime() - msBack);

      // Desafios válidos na janela
      const { data: chs } = await supabase
        .from('challenges')
        .select('id, xp_reward, target_div_ids, target_coord_ids, target_team_ids, status, due_date, audience')
        .or('status.eq.active,status.eq.scheduled')
        .gte('due_date', start.toISOString());

      const sFilter = (c: any) => {
        // Filtra por escopo do líder
        const tOk = !c.target_team_ids || (teamId && (c.target_team_ids as string[]).includes(teamId));
        const cOk = !c.target_coord_ids || (coordId && (c.target_coord_ids as string[]).includes(coordId));
        const dOk = !c.target_div_ids || (divisionId && (c.target_div_ids as string[]).includes(divisionId));
        if (scope === 'team') return tOk || cOk || dOk;
        if (scope === 'coord') return cOk || dOk;
        return dOk;
      };

      const xpPos = (chs || []).filter(sFilter).reduce((sum, c: any) => sum + (c.xp_reward || 0), 0);
      setXpPossible(xpPos);

      // XP atingido: soma de final_points dos colaboradores no escopo e janela
      const idFilter = scope === 'team' ? teamId : scope === 'coord' ? coordId : divisionId;
      let members: Array<{ id: string }> = [];
      if (idFilter) {
        const { data: m } = await (supabase as any)
          .from('profiles')
          .select('id')
          .eq(scope === 'team' ? 'team_id' : scope === 'coord' ? 'coord_id' : 'division_id', idFilter)
          .eq('is_leader', false);
        members = m || [];
      }
      let xpAch = 0;
      if (members.length) {
        const ids = members.map((m) => m.id);
        const { data: evs } = await supabase
          .from('events')
          .select('final_points, created_at, user_id')
          .gte('created_at', start.toISOString())
          .in('user_id', ids);
        xpAch = (evs || []).reduce((sum, e: any) => sum + (e.final_points || 0), 0);
      }
      setXpAchieved(xpAch);
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setLoading(false);
    }
  }, [coordId, divisionId, loadCampaigns, loadChallenges, loadForums, loadTeamStats, loadTopMembers, scope, teamId, windowSel]);

  useEffect(() => {
    loadDashboardData();
    loadUserProfile();
  }, [loadDashboardData, loadUserProfile]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-40 md:pb-20">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0b2a34]/85 text-blue-50 border-b border-cyan-700/30 backdrop-blur">
        <div className="container mx-auto px-3 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/leader-dashboard')}
            className="flex items-center gap-2 group focus:outline-none"
          >
            <div className="flex items-center gap-1.5">
              <Shield className="h-6 w-6 text-primary" />
              <Zap className="h-6 w-6 text-secondary" />
            </div>
            <div className="text-left">
              <p className="text-xl font-semibold leading-tight text-blue-50 group-hover:text-white">
                DJT - Quest
              </p>
              <p className="text-[10px] text-blue-100/80 leading-none">
                CPFL Piratininga e Santa Cruz Subtransmissão
              </p>
            </div>
          </button>
          <div className="flex items-center gap-2">
            {userProfile && (
              <ProfileDropdown
                profile={userProfile}
                isLeader={true}
                onSignOut={handleSignOut}
              />
            )}
            <Button onClick={() => navigate('/dashboard')} variant="ghost" size="sm" aria-label="Entrar">
              Entrar
            </Button>
            <Button onClick={() => navigate('/studio')} variant="ghost" size="sm">
              <Award className="h-4 w-4 mr-2" />
              Studio
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 py-4 space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold leading-tight">Dashboard de Liderança</h2>
            <p className="text-sm text-muted-foreground">
              XP agregado do seu escopo ({scope === 'team' ? 'Equipe' : scope === 'coord' ? 'Coordenação' : 'Divisão'})
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Atuando como: {orgScope?.divisionName || '—'}{orgScope?.coordName ? ` • ${orgScope.coordName}` : ''}{orgScope?.teamName ? ` • ${orgScope.teamName}` : ''}
            </p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <div className="w-full md:w-48">
              <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                <SelectTrigger aria-label="Selecionar Escopo">
                  <SelectValue placeholder="Selecionar escopo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Minha Equipe</SelectItem>
                  <SelectItem value="coord">Minha Coordenação</SelectItem>
                  <SelectItem value="division">Minha Divisão</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full md:w-40">
              <Select value={windowSel} onValueChange={(v) => setWindowSel(v as any)}>
                <SelectTrigger aria-label="Janela de tempo">
                  <SelectValue placeholder="Janela" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30d">30 dias</SelectItem>
                  <SelectItem value="90d">Trimestre</SelectItem>
                  <SelectItem value="365d">Ano</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

      {/* XP Possível x Atingido */}
        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold leading-tight text-white">XP possível vs XP atingido</CardTitle>
            <CardDescription className="text-white/80">
              Janela: {windowSel === '30d' ? 'últimos 30 dias' : windowSel === '90d' ? 'últimos 90 dias' : 'últimos 12 meses'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2 text-sm">
              <span className="text-white/70">Possível</span>
              <span className="font-semibold text-white">{xpPossible} XP</span>
            </div>
            <Progress value={xpPossible ? Math.min(100, Math.round((xpAchieved / Math.max(1, xpPossible)) * 100)) : 0} className="h-2" />
            <div className="flex items-center justify-between mt-2 text-sm">
              <span className="text-white/70">Atingido</span>
              <span className="font-semibold text-white">{xpAchieved} XP</span>
            </div>
          </CardContent>
        </Card>

        {/* Estatísticas Gerais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold leading-tight text-white">Colaboradores ({scope === 'team' ? 'Equipe' : scope === 'coord' ? 'Coord.' : 'Div.'})</CardTitle>
            <Users className="h-4 w-4 text-white/70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{teamStats?.total_members || 0}</div>
            <p className="text-xs text-white/70">
              Membros da equipe
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold leading-tight text-white">Ranking (Equipe)</CardTitle>
            <Trophy className="h-4 w-4 text-white/70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{scope === 'team' && teamStats?.rank_position ? `#${teamStats.rank_position}` : '-'}</div>
            <p className="text-xs text-white/70">
              {scope === 'team' ? 'Posição geral' : 'Não aplicável neste escopo'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold leading-tight text-white">Engajamento</CardTitle>
            <Target className="h-4 w-4 text-white/70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{teamStats?.engagement_rate || 0}%</div>
            <p className="text-xs text-white/70">
              Últimos 7 dias
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Progressão da Equipe */}
      {teamStats && (
        <TeamTierProgressCard 
          avgXp={teamStats.avg_xp} 
          totalMembers={teamStats.total_members}
          totalXp={teamStats.total_xp}
        />
      )}

      <Tabs defaultValue="campaigns" className="space-y-4">
        <TabsList>
          <TabsTrigger value="campaigns">Campanhas</TabsTrigger>
          {showChallengesTab && <TabsTrigger value="challenges">Desafios</TabsTrigger>}
          <TabsTrigger value="forums">Fóruns</TabsTrigger>
          <TabsTrigger value="team">Top 5 da Equipe</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="space-y-4">
          <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
            <CardHeader>
              <CardTitle className="text-white">Campanhas Vigentes</CardTitle>
              <CardDescription className="text-white/80">
                Acompanhe a adesão e conclusão das campanhas ativas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {campaigns.length === 0 ? (
                <p className="text-white/70 text-center py-8">
                  Nenhuma campanha ativa no momento
                </p>
              ) : (
                campaigns.map((campaign) => (
                  <div key={campaign.campaign_id} className="space-y-2 p-4 border border-white/30 rounded-lg bg-white/5">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-white">{campaign.campaign_title}</h3>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="border-white/50 text-white">
                          Adesão: {campaign.adhesion_percentage?.toFixed(0) || 0}%
                        </Badge>
                        <Badge variant="outline" className="border-white/50 text-white">
                          Conclusão: {campaign.completion_percentage?.toFixed(0) || 0}%
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-white/70">
                        <span>Adesão</span>
                        <span>{campaign.participants_count} / {campaign.total_members}</span>
                      </div>
                      <Progress value={campaign.adhesion_percentage || 0} />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {showChallengesTab && (
          <TabsContent value="challenges" className="space-y-4">
            <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
              <CardHeader>
                <CardTitle className="text-white">Desafios Vigentes</CardTitle>
                <CardDescription className="text-white/80">
                  Performance da equipe nos desafios ativos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {challenges.length === 0 ? (
                  <p className="text-white/70 text-center py-8">
                    Nenhum desafio ativo no momento
                  </p>
                ) : (
                  challenges.map((challenge) => (
                    <div key={challenge.challenge_id} className="space-y-2 p-4 border border-white/30 rounded-lg bg-white/5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-white">{challenge.challenge_title}</h3>
                          <p className="text-sm text-white/70 capitalize">
                            {challenge.challenge_type}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="border-white/50 text-white">
                            {challenge.adhesion_percentage?.toFixed(0) || 0}% adesão
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm text-white/80">
                          <span>Participantes: {challenge.participants_count}</span>
                          <span>Concluíram: {challenge.completion_percentage?.toFixed(0) || 0}%</span>
                        </div>
                        <Progress value={challenge.adhesion_percentage || 0} />
                        {challenge.avg_xp_earned > 0 && (
                          <p className="text-sm text-white/70">
                            XP médio conquistado: {Math.floor(challenge.avg_xp_earned)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="forums" className="space-y-4">
          <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
            <CardHeader>
              <CardTitle className="text-white">Fóruns Ativos</CardTitle>
              <CardDescription className="text-white/80">
                Últimos tópicos com atividade
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {forums.length === 0 ? (
                <p className="text-white/70 text-center py-8">
                  Nenhum fórum ativo
                </p>
              ) : (
                forums.map((forum) => (
                  <div 
                    key={forum.id} 
                    className="flex items-center justify-between p-3 border border-white/30 rounded-lg hover:bg-white/10 cursor-pointer transition-colors"
                    onClick={() => navigate(`/forum/${forum.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <MessageSquare className="h-4 w-4 text-white/70" />
                      <div>
                        <p className="font-medium text-white">{forum.title}</p>
                        <p className="text-sm text-white/70">
                          {forum.posts_count} posts
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-white/50 text-white">
                      {new Date(forum.last_post_at).toLocaleDateString('pt-BR')}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4">
          <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
            <CardHeader>
              <CardTitle className="text-white">Top 5 da Equipe</CardTitle>
              <CardDescription className="text-white/80">
                Colaboradores com maior XP
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {topMembers.length === 0 ? (
                <p className="text-white/70 text-center py-8">
                  Nenhum membro cadastrado
                </p>
              ) : (
                topMembers.map((member, index) => (
                  <div key={member.id} className="flex items-center justify-between p-3 border border-white/30 rounded-lg bg-white/5">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-white">{member.name}</p>
                        <p className="text-sm text-white/70">{member.tier}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-white/50 text-white">{member.xp} XP</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </main>
    </div>
  );
}
