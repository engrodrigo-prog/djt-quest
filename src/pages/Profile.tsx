import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { User, Trophy, Star, Target, CheckCircle, Clock } from 'lucide-react';

interface UserProfile {
  name: string;
  email: string;
  xp: number;
  level: number;
  team: { name: string } | null;
}

interface UserEvent {
  id: string;
  created_at: string;
  status: string;
  points_calculated: number;
  challenge: {
    title: string;
    type: string;
    xp_reward: number;
  };
}

interface UserBadge {
  id: string;
  earned_at: string;
  badge: {
    name: string;
    description: string;
    icon_url: string | null;
  };
}

const Profile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [events, setEvents] = useState<UserEvent[]>([]);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;

      try {
        // Load profile
        const { data: profileData } = await supabase
          .from('profiles')
          .select('name, email, xp, level, team:teams(name)')
          .eq('id', user.id)
          .single();

        if (profileData) {
          setProfile(profileData as any);
        }

        // Load events
        const { data: eventsData } = await supabase
          .from('events')
          .select(`
            id,
            created_at,
            status,
            points_calculated,
            challenge:challenges(title, type, xp_reward)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (eventsData) {
          setEvents(eventsData as any);
        }

        // Load badges
        const { data: badgesData } = await supabase
          .from('user_badges')
          .select(`
            id,
            earned_at,
            badge:badges(name, description, icon_url)
          `)
          .eq('user_id', user.id)
          .order('earned_at', { ascending: false });

        if (badgesData) {
          setBadges(badgesData as any);
        }
      } catch (error) {
        console.error('Error loading profile:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!profile) return null;

  const xpToNextLevel = profile.level * 1000;
  const xpProgress = (profile.xp % 1000) / 10;
  const completedEvents = events.filter(e => e.status === 'approved').length;
  const pendingEvents = events.filter(e => e.status === 'submitted').length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <div className="container max-w-4xl mx-auto py-8 space-y-6">
        {/* Profile Header */}
        <Card className="bg-gradient-to-r from-primary/10 to-secondary/10">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                  <User className="h-10 w-10 text-white" />
                </div>
                <div>
                  <CardTitle className="text-2xl">{profile.name}</CardTitle>
                  <CardDescription className="text-base">{profile.email}</CardDescription>
                  {profile.team && (
                    <Badge variant="outline" className="mt-2">{profile.team.name}</Badge>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-2 justify-end mb-1">
                  <Star className="h-5 w-5 text-accent" />
                  <span className="text-2xl font-bold">Nível {profile.level}</span>
                </div>
                <p className="text-sm text-muted-foreground">{profile.xp} XP Total</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Progresso para Nível {profile.level + 1}</span>
                <span className="font-semibold">{profile.xp % 1000} / {xpToNextLevel} XP</span>
              </div>
              <Progress value={xpProgress} className="h-3" />
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <CheckCircle className="h-8 w-8 text-accent mx-auto mb-2" />
                <p className="text-2xl font-bold">{completedEvents}</p>
                <p className="text-xs text-muted-foreground">Ações Concluídas</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Clock className="h-8 w-8 text-secondary mx-auto mb-2" />
                <p className="text-2xl font-bold">{pendingEvents}</p>
                <p className="text-xs text-muted-foreground">Em Avaliação</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Trophy className="h-8 w-8 text-primary mx-auto mb-2" />
                <p className="text-2xl font-bold">{badges.length}</p>
                <p className="text-xs text-muted-foreground">Badges Conquistados</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="history" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="history">
              <Target className="h-4 w-4 mr-2" />
              Histórico
            </TabsTrigger>
            <TabsTrigger value="badges">
              <Trophy className="h-4 w-4 mr-2" />
              Badges
            </TabsTrigger>
          </TabsList>

          <TabsContent value="history" className="space-y-3">
            {events.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Nenhuma ação registrada ainda
                </CardContent>
              </Card>
            ) : (
              events.map((event) => (
                <Card key={event.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline">{event.challenge.type}</Badge>
                          <Badge variant={
                            event.status === 'approved' ? 'default' : 
                            event.status === 'submitted' ? 'secondary' : 'outline'
                          }>
                            {event.status === 'approved' ? 'Aprovado' : 
                             event.status === 'submitted' ? 'Em Avaliação' : event.status}
                          </Badge>
                        </div>
                        <CardTitle className="text-base">{event.challenge.title}</CardTitle>
                        <CardDescription className="text-xs">
                          {new Date(event.created_at).toLocaleDateString('pt-BR', { 
                            day: '2-digit', 
                            month: 'short', 
                            year: 'numeric' 
                          })}
                        </CardDescription>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-accent">
                          +{event.points_calculated || event.challenge.xp_reward} XP
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="badges" className="space-y-3">
            {badges.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Nenhum badge conquistado ainda
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {badges.map((userBadge) => (
                  <Card key={userBadge.id}>
                    <CardHeader>
                      <div className="flex items-start gap-3">
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-accent to-primary flex items-center justify-center flex-shrink-0">
                          <Trophy className="h-6 w-6 text-white" />
                        </div>
                        <div className="flex-1">
                          <CardTitle className="text-base">{userBadge.badge.name}</CardTitle>
                          <CardDescription className="text-xs">
                            {userBadge.badge.description}
                          </CardDescription>
                          <p className="text-xs text-muted-foreground mt-2">
                            Conquistado em {new Date(userBadge.earned_at).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Profile;
