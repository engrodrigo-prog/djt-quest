import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { User, Trophy, Star, Target, CheckCircle, Clock, GraduationCap, Filter } from 'lucide-react';
import { AvatarDisplay } from '@/components/AvatarDisplay';
import { ActionReviewCard } from '@/components/profile/ActionReviewCard';
import { RetryModal } from '@/components/profile/RetryModal';
import { LearningDashboard } from '@/components/profile/LearningDashboard';
import { LeaderTeamDashboard } from '@/components/LeaderTeamDashboard';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTierInfo, getNextTierLevel } from '@/lib/constants/tiers';
import { AvatarCapture } from '@/components/AvatarCapture';
import { ProfileEditor } from '@/components/ProfileEditor';
import { ProfileChangeHistory } from '@/components/profile/ProfileChangeHistory';
import { QuizHistory } from '@/components/profile/QuizHistory';
import { ChangePasswordCard } from '@/components/profile/ChangePasswordCard';

interface UserProfile {
  name: string;
  email: string;
  xp: number;
  tier: string;
  demotion_cooldown_until: string | null;
  team: { name: string } | null;
  avatar_url: string | null;
}

interface UserEvent {
  id: string;
  created_at: string;
  status: string;
  points_calculated: number;
  retry_count: number;
  parent_event_id: string | null;
  challenge: {
    id: string;
    title: string;
    type: string;
    xp_reward: number;
  };
  evaluation?: {
    rating: number;
    feedback_positivo: string | null;
    feedback_construtivo: string | null;
    scores: any;
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

function ProfileContent() {
  const { user, refreshUserSession } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [events, setEvents] = useState<UserEvent[]>([]);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryModalOpen, setRetryModalOpen] = useState(false);
  const [selectedEventForRetry, setSelectedEventForRetry] = useState<{ eventId: string; challengeId: string; challengeTitle: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;

      try {
        // Load profile
        const { data: profileData } = await supabase
          .from('profiles')
          .select('name, email, xp, tier, demotion_cooldown_until, avatar_url, team:teams(name)')
          .eq('id', user.id)
          .single();

        if (profileData) {
          setProfile(profileData as any);
        }

        // Load events with evaluations
        const { data: eventsData } = await supabase
          .from('events')
          .select(`
            id,
            created_at,
            status,
            points_calculated,
            retry_count,
            parent_event_id,
            challenge_id,
            challenge:challenges(id, title, type, xp_reward)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (eventsData) {
          // Load evaluations for each event
          const eventsWithEval = await Promise.all(
            eventsData.map(async (event: any) => {
              const { data: evalData } = await supabase
                .from('action_evaluations')
                .select('rating, feedback_positivo, feedback_construtivo, scores')
                .eq('event_id', event.id)
                .maybeSingle();

              return {
                ...event,
                evaluation: evalData || undefined
              };
            })
          );
          
          setEvents(eventsWithEval as any);
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

  const handleRetryClick = (eventId: string, challengeTitle: string) => {
    const event = events.find(e => e.id === eventId);
    if (!event) return;

    setSelectedEventForRetry({
      eventId,
      challengeId: event.challenge.id,
      challengeTitle
    });
    setRetryModalOpen(true);
  };

  const handleRetryConfirm = async () => {
    if (!selectedEventForRetry || !user) return;

    try {
      const originalEvent = events.find(e => e.id === selectedEventForRetry.eventId);
      if (!originalEvent) return;

      // Create new retry event
      const { data: newEvent, error } = await supabase
        .from('events')
        .insert([{
          user_id: user.id,
          challenge_id: selectedEventForRetry.challengeId,
          parent_event_id: selectedEventForRetry.eventId,
          retry_count: originalEvent.retry_count + 1,
          status: 'retry_in_progress',
          payload: {}
        }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Sucesso!',
        description: 'Você será redirecionado para refazer o desafio.'
      });

      // Navigate to challenge page with retry context
      navigate(`/challenge/${selectedEventForRetry.challengeId}?retry=${newEvent.id}`);
    } catch (error) {
      console.error('Error creating retry event:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível iniciar a refação do desafio',
        variant: 'destructive'
      });
    } finally {
      setRetryModalOpen(false);
      setSelectedEventForRetry(null);
    }
  };

  const handleAvatarCaptured = async (imageBase64: string) => {
    if (!user || avatarSaving) return;

    try {
      setAvatarSaving(true);
      const { data, error } = await supabase.functions.invoke('process-avatar', {
        body: {
          userId: user.id,
          imageBase64,
        },
      });

      if (error) {
        throw error;
      }

      await refreshUserSession();
      if (data?.avatarUrl) {
        setProfile((prev) => (prev ? { ...prev, avatar_url: data.avatarUrl } : prev));
      }

      toast({
        title: 'Avatar atualizado com sucesso!',
        description: 'Sua foto já aparece para toda a equipe.',
      });
      setAvatarDialogOpen(false);
    } catch (error) {
      console.error('Error updating avatar:', error);
      toast({
        title: 'Erro ao atualizar avatar',
        description: error instanceof Error ? error.message : 'Tente novamente em instantes.',
        variant: 'destructive',
      });
    } finally {
      setAvatarSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!profile) return null;

  const tierInfo = getTierInfo(profile.tier);
  const nextLevel = getNextTierLevel(profile.tier, profile.xp);
  const xpProgress = tierInfo ? ((profile.xp - tierInfo.xpMin) / (tierInfo.xpMax - tierInfo.xpMin)) * 100 : 0;
  const completedEvents = events.filter(e => e.status === 'approved').length;
  const pendingEvents = events.filter(e => e.status === 'submitted').length;

  // Calculate learning stats
  const evaluatedEvents = events.filter(e => e.evaluation && (e.status === 'approved' || e.status === 'rejected'));
  const averageRating = evaluatedEvents.length > 0
    ? evaluatedEvents.reduce((sum, e) => sum + (e.evaluation?.rating || 0), 0) / evaluatedEvents.length
    : 0;
  const lowScoreEvents = evaluatedEvents.filter(e => (e.evaluation?.rating || 0) < 3.5);
  const improvementOpportunities = evaluatedEvents.filter(e => 
    (e.evaluation?.rating || 0) < 4.0 && 
    e.status !== 'retry_in_progress'
  ).length;

  // Find top strength and weakness from scores
  const allScores: Record<string, number[]> = {};
  evaluatedEvents.forEach(e => {
    if (e.evaluation?.scores) {
      Object.entries(e.evaluation.scores).forEach(([key, value]) => {
        if (!allScores[key]) allScores[key] = [];
        allScores[key].push(value as number);
      });
    }
  });

  const criteriaAverages = Object.entries(allScores).map(([key, values]) => ({
    criteria: key,
    average: values.reduce((a, b) => a + b, 0) / values.length
  }));

  const topStrength = criteriaAverages.length > 0 
    ? criteriaAverages.sort((a, b) => b.average - a.average)[0]
    : null;
  const topWeakness = criteriaAverages.length > 0
    ? criteriaAverages.sort((a, b) => a.average - b.average)[0]
    : null;

  const learningStats = {
    totalEvaluated: evaluatedEvents.length,
    averageRating,
    lowScoreCount: lowScoreEvents.length,
    improvementOpportunities,
    topStrength: topStrength ? `${topStrength.criteria}: ${topStrength.average.toFixed(1)}/5.0` : null,
    topWeakness: topWeakness ? `${topWeakness.criteria}: ${topWeakness.average.toFixed(1)}/5.0` : null
  };

  // Filter events
  const filteredEvents = statusFilter === 'all' 
    ? events 
    : events.filter(e => e.status === statusFilter);

  const feedbackEvents = events.filter(e => e.evaluation);
  const opportunityEvents = events.filter(e => 
    e.evaluation && 
    e.evaluation.rating < 3.5 && 
    e.status !== 'retry_in_progress'
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <div className="container max-w-4xl mx-auto py-8 space-y-6">
        {/* Profile Header */}
        <Card className="bg-gradient-to-r from-primary/10 to-secondary/10">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center md:items-start gap-3">
                  <AvatarDisplay 
                    avatarUrl={profile.avatar_url}
                    name={profile.name}
                    size="xl"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAvatarDialogOpen(true)}
                    disabled={avatarSaving}
                  >
                    Atualizar foto
                  </Button>
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
                  <span className="text-2xl font-bold">{tierInfo?.name || profile.tier}</span>
                </div>
                <p className="text-sm text-muted-foreground">{profile.xp} XP Total</p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Progresso para {nextLevel?.name || 'Nível Máximo'}</span>
                {nextLevel && <span className="font-semibold">{nextLevel.xpNeeded} XP restantes</span>}
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
        <Tabs defaultValue="learning" className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-3">
            <TabsTrigger value="learning">
              <GraduationCap className="h-4 w-4 mr-2" />
              Aprendizado
            </TabsTrigger>
            <TabsTrigger value="history">
              <Target className="h-4 w-4 mr-2" />
              Histórico
            </TabsTrigger>
            <TabsTrigger value="badges">
              <Trophy className="h-4 w-4 mr-2" />
              Badges
            </TabsTrigger>
          </TabsList>

          <TabsContent value="learning" className="space-y-6">
            <Tabs defaultValue="dashboard" className="w-full">
              <TabsList className="grid w-full max-w-2xl grid-cols-3">
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="feedback">
                  Feedback ({feedbackEvents.length})
                </TabsTrigger>
                <TabsTrigger value="opportunities">
                  Oportunidades ({opportunityEvents.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="dashboard">
                <LearningDashboard stats={learningStats} />
              </TabsContent>

              <TabsContent value="feedback" className="space-y-3">
                {feedbackEvents.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      Nenhuma avaliação recebida ainda
                    </CardContent>
                  </Card>
                ) : (
                  feedbackEvents.map((event) => (
                    <ActionReviewCard 
                      key={event.id} 
                      eventId={event.id}
                    />
                  ))
                )}
              </TabsContent>

              <TabsContent value="opportunities" className="space-y-3">
                {opportunityEvents.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      🎉 Parabéns! Nenhuma oportunidade de melhoria no momento.
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    <Card className="bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900">
                      <CardContent className="py-4">
                        <p className="text-sm text-orange-900 dark:text-orange-100">
                          💡 Estas ações tiveram avaliação abaixo de 3.5. Considere refazê-las para reforçar o aprendizado!
                        </p>
                      </CardContent>
                    </Card>
                    {opportunityEvents.map((event) => (
                      <ActionReviewCard 
                        key={event.id} 
                        eventId={event.id}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="history" className="space-y-3">
            <div className="flex items-center gap-2 mb-4">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Filtrar por status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="approved">Aprovados</SelectItem>
                  <SelectItem value="rejected">Rejeitados</SelectItem>
                  <SelectItem value="submitted">Em Avaliação</SelectItem>
                  <SelectItem value="retry_in_progress">Refazendo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {filteredEvents.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  Nenhuma ação registrada ainda
                </CardContent>
              </Card>
            ) : (
              filteredEvents.map((event) => (
                <ActionReviewCard 
                  key={event.id} 
                  eventId={event.id}
                />
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

        <div className="grid gap-6 lg:grid-cols-2">
          <ProfileEditor />
          <ChangePasswordCard />
          <ProfileChangeHistory />
          <QuizHistory />
        </div>
      </div>

      <Dialog
      open={avatarDialogOpen}
      onOpenChange={(open) => {
        if (!avatarSaving) {
          setAvatarDialogOpen(open);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Atualizar avatar</DialogTitle>
        </DialogHeader>
        <AvatarCapture
          onCapture={handleAvatarCaptured}
          onSkip={() => {
            if (!avatarSaving) {
              setAvatarDialogOpen(false);
            }
          }}
        />
        {avatarSaving && (
          <p className="text-sm text-muted-foreground text-center mt-2">
            Processando foto...
          </p>
        )}
      </DialogContent>
    </Dialog>

    <RetryModal 
      isOpen={retryModalOpen}
      onClose={() => {
        setRetryModalOpen(false);
        setSelectedEventForRetry(null);
        }}
        onConfirm={handleRetryConfirm}
        challengeTitle={selectedEventForRetry?.challengeTitle || ''}
        retryCount={events.find(e => e.id === selectedEventForRetry?.eventId)?.retry_count || 0}
        feedback={events.find(e => e.id === selectedEventForRetry?.eventId)?.evaluation}
      />
    </div>
  );
}

const Profile = () => {
  const { isLeader } = useAuth();
  return isLeader ? <LeaderTeamDashboard /> : <ProfileContent />;
};

export default Profile;
