import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Shield, Zap, Trophy, Target, LogOut, Star, Menu } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Navigation from '@/components/Navigation';
import { TeamPerformanceCard } from '@/components/TeamPerformanceCard';

interface Campaign {
  id: string;
  title: string;
  description: string;
  narrative_tag: string;
  start_date: string;
  end_date: string;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  type: string;
  xp_reward: number;
  require_two_leader_eval: boolean;
}

interface Profile {
  name: string;
  xp: number;
  level: number;
}

const Index = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      if (!user) return;

      try {
        // Load profile
        const { data: profileData } = await supabase
          .from('profiles')
          .select('name, xp, level')
          .eq('id', user.id)
          .single();

        if (profileData) {
          setProfile(profileData);
        }

        // Load active campaigns
        const { data: campaignsData } = await supabase
          .from('campaigns')
          .select('*')
          .eq('is_active', true)
          .order('start_date', { ascending: false });

        if (campaignsData) {
          setCampaigns(campaignsData);
        }

        // Load challenges
        const { data: challengesData } = await supabase
          .from('challenges')
          .select('*')
          .limit(6);

        if (challengesData) {
          setChallenges(challengesData);
        }
      } catch (error) {
        console.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  const xpToNextLevel = profile ? profile.level * 1000 : 1000;
  const xpProgress = profile ? (profile.xp % 1000) / 10 : 0;

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
              <p className="text-[10px] text-muted-foreground leading-none">CPFL Subtransmissão</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <p className="font-semibold text-sm">{profile?.name}</p>
              <div className="flex items-center gap-1.5 text-xs justify-end">
                <Star className="h-3 w-3 text-accent" />
                <span>Nível {profile?.level}</span>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 py-4 space-y-6">
        {/* Team Performance Card */}
        <TeamPerformanceCard />

        {/* XP Card */}
        <Card className="bg-gradient-to-r from-primary/10 to-secondary/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trophy className="h-5 w-5 text-accent" />
              Sua Progressão
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-xs sm:text-sm">
              <span>Nível {profile?.level}</span>
              <span className="font-semibold">{profile?.xp} XP</span>
              <span className="text-muted-foreground">Nível {(profile?.level || 1) + 1}</span>
            </div>
            <Progress value={xpProgress} className="h-2.5" />
            <p className="text-xs text-muted-foreground">
              Faltam {xpToNextLevel - (profile?.xp || 0)} XP para o próximo nível
            </p>
          </CardContent>
        </Card>

        {/* Active Campaigns */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold">Campanhas Ativas</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((campaign) => (
              <Card key={campaign.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <Badge className="w-fit mb-2 text-[10px]">{campaign.narrative_tag}</Badge>
                  <CardTitle className="text-base leading-tight">{campaign.title}</CardTitle>
                  <CardDescription className="text-xs line-clamp-2">{campaign.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-[10px] text-muted-foreground mb-2">
                    {new Date(campaign.start_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} - {new Date(campaign.end_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                  </p>
                  <Button className="w-full h-9 text-sm" variant="default" disabled>
                    Campanha Ativa
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Available Challenges */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-5 w-5 text-secondary" />
            <h2 className="text-xl font-bold">Desafios Disponíveis</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {challenges.map((challenge) => (
              <Card key={challenge.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline" className="text-[10px]">{challenge.type}</Badge>
                    <span className="text-xs font-semibold text-accent">+{challenge.xp_reward} XP</span>
                  </div>
                  <CardTitle className="text-base leading-tight">{challenge.title}</CardTitle>
                  <CardDescription className="text-xs line-clamp-2">{challenge.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {challenge.require_two_leader_eval && (
                    <p className="text-[10px] text-muted-foreground mb-2 flex items-center">
                      <Shield className="h-3 w-3 inline mr-1 flex-shrink-0" />
                      <span>Requer avaliação de 2 líderes</span>
                    </p>
                  )}
                  <Button 
                    className="w-full h-9 text-sm" 
                    variant="secondary"
                    onClick={() => navigate(`/challenge/${challenge.id}`)}
                  >
                    Começar
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <Navigation />
    </div>
  );
};

export default Index;
