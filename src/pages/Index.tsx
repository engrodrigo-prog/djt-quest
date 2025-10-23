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
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Shield className="h-8 w-8 text-primary" />
              <Zap className="h-8 w-8 text-secondary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                DJT Go
              </h1>
              <p className="text-xs text-muted-foreground">CPFL Subtransmissão</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="font-semibold">{profile?.name}</p>
              <div className="flex items-center gap-2 text-sm">
                <Star className="h-4 w-4 text-accent" />
                <span>Nível {profile?.level}</span>
              </div>
            </div>
            <Button variant="outline" size="icon" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        {/* XP Card */}
        <Card className="bg-gradient-to-r from-primary/10 to-secondary/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-accent" />
              Sua Progressão
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span>Nível {profile?.level}</span>
              <span className="font-semibold">{profile?.xp} XP</span>
              <span className="text-muted-foreground">Nível {(profile?.level || 1) + 1}</span>
            </div>
            <Progress value={xpProgress} className="h-3" />
            <p className="text-sm text-muted-foreground">
              Faltam {xpToNextLevel - (profile?.xp || 0)} XP para o próximo nível
            </p>
          </CardContent>
        </Card>

        {/* Active Campaigns */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-bold">Campanhas Ativas</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((campaign) => (
              <Card key={campaign.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <Badge className="w-fit mb-2">{campaign.narrative_tag}</Badge>
                  <CardTitle className="text-lg">{campaign.title}</CardTitle>
                  <CardDescription>{campaign.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground mb-3">
                    {new Date(campaign.start_date).toLocaleDateString('pt-BR')} - {new Date(campaign.end_date).toLocaleDateString('pt-BR')}
                  </p>
                  <Button className="w-full" variant="default" disabled>
                    Campanha Ativa
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Available Challenges */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-6 w-6 text-secondary" />
            <h2 className="text-2xl font-bold">Desafios Disponíveis</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {challenges.map((challenge) => (
              <Card key={challenge.id} className="hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex items-center justify-between mb-2">
                    <Badge variant="outline">{challenge.type}</Badge>
                    <span className="text-sm font-semibold text-accent">+{challenge.xp_reward} XP</span>
                  </div>
                  <CardTitle className="text-lg">{challenge.title}</CardTitle>
                  <CardDescription>{challenge.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  {challenge.require_two_leader_eval && (
                    <p className="text-xs text-muted-foreground mb-3">
                      <Shield className="h-3 w-3 inline mr-1" />
                      Requer avaliação de 2 líderes
                    </p>
                  )}
                  <Button 
                    className="w-full" 
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
