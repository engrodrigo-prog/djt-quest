import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Users, TrendingUp, MessageSquare, Target, Award, Shield, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TeamTierProgressCard } from "@/components/TeamTierProgressCard";
import { ProfileDropdown } from "@/components/ProfileDropdown";

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

export default function LeaderDashboard() {
  const { user, profile, orgScope, signOut } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [teamStats, setTeamStats] = useState<TeamStats | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [challenges, setChallenges] = useState<ChallengePerformance[]>([]);
  const [forums, setForums] = useState<ForumTopic[]>([]);
  const [topMembers, setTopMembers] = useState<TeamMember[]>([]);
  const [userProfile, setUserProfile] = useState<{ name: string; avatar_url: string | null; team: { name: string } | null; tier: string } | null>(null);

  useEffect(() => {
    loadDashboardData();
    loadUserProfile();
  }, [orgScope, user]);

  const loadUserProfile = async () => {
    if (!user) return;
    
    const { data } = await supabase
      .from("profiles")
      .select("name, tier, avatar_url, team:teams(name)")
      .eq("id", user.id)
      .single();
    
    if (data) {
      setUserProfile(data);
    }
  };

  const loadDashboardData = async () => {
    if (!orgScope?.teamId) return;
    
    setLoading(true);
    try {
      await Promise.all([
        loadTeamStats(),
        loadCampaigns(),
        loadChallenges(),
        loadForums(),
        loadTopMembers()
      ]);
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const loadTeamStats = async () => {
    const { data: members } = await supabase
      .from('profiles')
      .select('xp, id')
      .eq('team_id', orgScope?.teamId)
      .eq('is_leader', false);

    if (members) {
      const totalMembers = members.length;
      const totalXP = members.reduce((sum, m) => sum + (m.xp || 0), 0);
      const avgXP = totalMembers > 0 ? Math.floor(totalXP / totalMembers) : 0;

      // Calcular engajamento (últimos 7 dias - simulado com base no XP)
      const engagementRate = 85; // TODO: calcular baseado em login real

      // Buscar posição no ranking
      const { data: rankings } = await supabase
        .from('team_xp_summary')
        .select('*')
        .order('total_xp', { ascending: false });

      const rankPosition = rankings?.findIndex(r => r.team_id === orgScope?.teamId) + 1 || 0;

      setTeamStats({
        total_members: totalMembers,
        avg_xp: avgXP,
        total_xp: totalXP,
        engagement_rate: engagementRate,
        rank_position: rankPosition
      });
    }
  };

  const loadCampaigns = async () => {
    const { data } = await supabase
      .from('team_campaign_performance')
      .select('*')
      .eq('team_id', orgScope?.teamId);

    if (data) {
      setCampaigns(data);
    }
  };

  const loadChallenges = async () => {
    const { data } = await supabase
      .from('team_challenge_performance')
      .select('*')
      .eq('team_id', orgScope?.teamId)
      .order('adhesion_percentage', { ascending: false })
      .limit(5);

    if (data) {
      setChallenges(data);
    }
  };

  const loadForums = async () => {
    // Buscar tópicos com posts recentes da equipe
    const { data: memberIds } = await supabase
      .from('profiles')
      .select('id')
      .eq('team_id', orgScope?.teamId);

    if (memberIds && memberIds.length > 0) {
      const ids = memberIds.map(m => m.id);
      
      const { data } = await supabase
        .from('forum_topics')
        .select('id, title, posts_count, last_post_at')
        .eq('is_active', true)
        .order('last_post_at', { ascending: false })
        .limit(5);

      if (data) {
        setForums(data);
      }
    }
  };

  const loadTopMembers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, xp, tier')
      .eq('team_id', orgScope?.teamId)
      .eq('is_leader', false)
      .order('xp', { ascending: false })
      .limit(5);

    if (data) {
      setTopMembers(data);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 pb-20 md:pb-8">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-3 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Shield className="h-6 w-6 text-primary" />
              <Zap className="h-6 w-6 text-secondary" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                DJT Go
              </h1>
              <p className="text-[8px] text-muted-foreground leading-none">
                CPFL Piratininga e Santa Cruz Subtransmissão
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {userProfile && (
              <ProfileDropdown
                profile={userProfile}
                isLeader={true}
                onSignOut={handleSignOut}
              />
            )}
            <Button onClick={() => navigate('/studio')} variant="ghost" size="sm">
              <Award className="h-4 w-4 mr-2" />
              Studio
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 py-4 space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Dashboard de Liderança</h2>
          <p className="text-muted-foreground text-sm">
            Visão completa do desempenho da sua equipe
          </p>
        </div>

      {/* Estatísticas Gerais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Colaboradores</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teamStats?.total_members || 0}</div>
            <p className="text-xs text-muted-foreground">
              Membros da equipe
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ranking</CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">#{teamStats?.rank_position || '-'}</div>
            <p className="text-xs text-muted-foreground">
              Posição geral
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Engajamento</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teamStats?.engagement_rate || 0}%</div>
            <p className="text-xs text-muted-foreground">
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
          <TabsTrigger value="challenges">Desafios</TabsTrigger>
          <TabsTrigger value="forums">Fóruns</TabsTrigger>
          <TabsTrigger value="team">Top 5 da Equipe</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Campanhas Vigentes</CardTitle>
              <CardDescription>
                Acompanhe a adesão e conclusão das campanhas ativas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {campaigns.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Nenhuma campanha ativa no momento
                </p>
              ) : (
                campaigns.map((campaign) => (
                  <div key={campaign.campaign_id} className="space-y-2 p-4 border rounded-lg">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{campaign.campaign_title}</h3>
                      <div className="flex gap-2">
                        <Badge variant="outline">
                          Adesão: {campaign.adhesion_percentage?.toFixed(0) || 0}%
                        </Badge>
                        <Badge variant="secondary">
                          Conclusão: {campaign.completion_percentage?.toFixed(0) || 0}%
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-muted-foreground">
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

        <TabsContent value="challenges" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Desafios Vigentes</CardTitle>
              <CardDescription>
                Performance da equipe nos desafios ativos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {challenges.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Nenhum desafio ativo no momento
                </p>
              ) : (
                challenges.map((challenge) => (
                  <div key={challenge.challenge_id} className="space-y-2 p-4 border rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{challenge.challenge_title}</h3>
                        <p className="text-sm text-muted-foreground capitalize">
                          {challenge.challenge_type}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="outline">
                          {challenge.adhesion_percentage?.toFixed(0) || 0}% adesão
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Participantes: {challenge.participants_count}</span>
                        <span>Concluíram: {challenge.completion_percentage?.toFixed(0) || 0}%</span>
                      </div>
                      <Progress value={challenge.adhesion_percentage || 0} />
                      {challenge.avg_xp_earned > 0 && (
                        <p className="text-sm text-muted-foreground">
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

        <TabsContent value="forums" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Fóruns Ativos</CardTitle>
              <CardDescription>
                Últimos tópicos com atividade
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {forums.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Nenhum fórum ativo
                </p>
              ) : (
                forums.map((forum) => (
                  <div 
                    key={forum.id} 
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                    onClick={() => navigate(`/forums/${forum.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="font-medium">{forum.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {forum.posts_count} posts
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline">
                      {new Date(forum.last_post_at).toLocaleDateString('pt-BR')}
                    </Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Top 5 da Equipe</CardTitle>
              <CardDescription>
                Colaboradores com maior XP
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {topMembers.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Nenhum membro cadastrado
                </p>
              ) : (
                topMembers.map((member, index) => (
                  <div key={member.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium">{member.name}</p>
                        <p className="text-sm text-muted-foreground">{member.tier}</p>
                      </div>
                    </div>
                    <Badge variant="secondary">{member.xp} XP</Badge>
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
