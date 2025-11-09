import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ThemedBackground } from '@/components/ThemedBackground';
import { User, Trophy, Star, Target, CheckCircle, Clock, GraduationCap, Filter } from 'lucide-react';
import { AvatarDisplay } from '@/components/AvatarDisplay';
import { ActionReviewCard } from '@/components/profile/ActionReviewCard';
import { RetryModal } from '@/components/profile/RetryModal';
import { LearningDashboard } from '@/components/profile/LearningDashboard';
import { LeaderTeamDashboard } from '@/components/LeaderTeamDashboard';
import { useToast } from '@/hooks/use-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTierInfo, getNextTierLevel } from '@/lib/constants/tiers';
import { AvatarCapture } from '@/components/AvatarCapture';
import { ProfileEditor } from '@/components/ProfileEditor';
import { ProfileChangeHistory } from '@/components/profile/ProfileChangeHistory';
import { QuizHistory } from '@/components/profile/QuizHistory';
import { ChangePasswordCard } from '@/components/profile/ChangePasswordCard';
import Navigation from '@/components/Navigation';
import { fetchTeamNames } from '@/lib/teamLookup';
import { apiFetch } from '@/lib/api';

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
  const { user, refreshUserSession, profile: authProfile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [events, setEvents] = useState<UserEvent[]>([]);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryModalOpen, setRetryModalOpen] = useState(false);
  const [selectedEventForRetry, setSelectedEventForRetry] = useState<{ eventId: string; challengeId: string; challengeTitle: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(searchParams.get('avatar') === 'open');
  const [avatarOptions, setAvatarOptions] = useState<string[]>([]);
  const [selectedAvatarOption, setSelectedAvatarOption] = useState<string | null>(null);
  const [avatarSourceImage, setAvatarSourceImage] = useState<string | null>(null);
  const [avatarGenerating, setAvatarGenerating] = useState(false);

  // Abrir/fechar modal conforme query param (?avatar=open)
  useEffect(() => {
    setAvatarDialogOpen(searchParams.get('avatar') === 'open');
  }, [searchParams]);
  const [avatarSaving, setAvatarSaving] = useState(false);

  // Loader we can reuse (initial + manual retry)
  const loadProfile = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      // Load profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('name, email, xp, tier, avatar_url, date_of_birth, team_id')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        console.warn('Erro ao carregar perfil (profiles table):', profileError.message);
      }

      if (profileData) {
        let teamName: string | null = null;
        if (profileData.team_id) {
          const map = await fetchTeamNames([profileData.team_id]);
          teamName = map[profileData.team_id] || null;
        }
        setProfile({
          ...profileData,
          team: teamName ? { name: teamName } : null,
        } as any);
      } else if (authProfile) {
        // Fallback to auth profile minimal info to avoid blank screen
        setProfile({
          name: authProfile.name,
          email: authProfile.email,
          xp: authProfile.xp ?? 0,
          tier: authProfile.tier ?? 'novato',
          demotion_cooldown_until: authProfile.demotion_cooldown_until ?? null,
          team: authProfile.team ? { name: authProfile.team.name } : null,
          avatar_url: authProfile.avatar_url ?? null,
        } as any);
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
  }, [authProfile, user]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

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

  const generateAvatarOptions = async (imageBase64: string) => {
    if (!imageBase64) return;
    setAvatarGenerating(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const resp = await apiFetch('/api/process-avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          mode: 'preview',
          imageBase64,
          useAiStyle: true,
          style: 'game-hero',
          variationCount: 3,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Falha na IA');
      if (data?.previews?.length) {
        setAvatarOptions(data.previews as string[]);
        setSelectedAvatarOption(data.previews[0]);
      } else {
        toast({ title: 'Não foi possível gerar opções com IA', variant: 'destructive' });
      }
    } catch (err) {
      console.error('Erro ao gerar opções de avatar:', err);
      toast({ title: 'Erro ao gerar opções com IA', description: 'Verifique sua conexão ou tente novamente.', variant: 'destructive' });
    } finally {
      setAvatarGenerating(false);
    }
  };

  const resetAvatarFlow = () => {
    setAvatarOptions([]);
    setSelectedAvatarOption(null);
    setAvatarSourceImage(null);
    setAvatarGenerating(false);
    setAvatarSaving(false);
  };

  const handleAvatarCaptured = async (imageBase64: string) => {
    // Salva diretamente a foto enviada, sem IA/previews
    setSelectedAvatarOption(imageBase64);
    await finalizeAvatar(imageBase64);
  };

  const finalizeAvatar = async (overrideBase64?: string) => {
    const base64ToUse = overrideBase64 || selectedAvatarOption;
    if (!user || avatarSaving || !base64ToUse) {
      toast({ title: 'Selecione um avatar para continuar', variant: 'destructive' });
      return;
    }

    try {
      setAvatarSaving(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const resp = await apiFetch('/api/process-avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          userId: user.id,
          imageBase64: base64ToUse,
          useAiStyle: false,
          alreadyStylized: true,
          mode: 'final',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Falha ao salvar');

      await refreshUserSession();
      if (data?.avatarUrl) {
        setProfile((prev) => (prev ? { ...prev, avatar_url: data.avatarUrl } : prev));
      }

      toast({ title: 'Avatar atualizado com sucesso!' });
      setAvatarDialogOpen(false);
      resetAvatarFlow();
    } catch (error) {
      console.error('Error finalizing avatar:', error);
      toast({ title: 'Erro ao salvar avatar', variant: 'destructive' });
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

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Perfil não encontrado</CardTitle>
            <CardDescription>
              Não conseguimos carregar seus dados agora. Atualize sua sessão ou complete seu perfil.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={loadProfile}>Tentar novamente</Button>
            <Button variant="outline" className="w-full" onClick={() => navigate('/user-setup')}>
              Completar Perfil
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
    <div className="relative min-h-screen bg-background p-4 overflow-hidden">
      <ThemedBackground theme="atitude" />
      <div className="container relative max-w-4xl mx-auto py-8 space-y-6">
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
                    variant="gameGhost"
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

      <Navigation />
    <Dialog
      open={avatarDialogOpen}
      onOpenChange={(open) => {
        if (avatarSaving) return;
        setAvatarDialogOpen(open);
        const p = new URLSearchParams(searchParams);
        if (open) {
          p.set('avatar', 'open');
        } else {
          p.delete('avatar');
          resetAvatarFlow();
        }
        setSearchParams(p, { replace: true });
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Atualizar avatar</DialogTitle>
          <DialogDescription>
            Capture ou envie uma foto e confirme para atualizar seu avatar. Você poderá trocá-la quando quiser.
          </DialogDescription>
        </DialogHeader>
        {avatarOptions.length === 0 ? (
          <>
            <AvatarCapture
              onCapture={handleAvatarCaptured}
              onSkip={() => {
                if (!avatarSaving) {
                  setAvatarDialogOpen(false);
                  resetAvatarFlow();
                }
              }}
            />
            {avatarGenerating && (
              <p className="text-sm text-muted-foreground text-center mt-2">
                Processando imagem...
              </p>
            )}
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Escolha o melhor enquadramento e confirme para usar como seu avatar.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {avatarOptions.map((option, index) => {
                const isSelected = selectedAvatarOption === option;
                return (
                  <button
                    key={option + index}
                    type="button"
                    onClick={() => setSelectedAvatarOption(option)}
                    className={`relative rounded-lg overflow-hidden border-2 ${
                      isSelected ? 'border-primary ring-2 ring-primary/50' : 'border-border'
                    }`}
                  >
                    <img src={option} alt={`Opção IA ${index + 1}`} className="w-full h-40 object-cover" />
                    {isSelected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 text-white font-semibold">
                        Selecionado
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="gameGhost"
                onClick={() => {
                  resetAvatarFlow();
                }}
                disabled={avatarGenerating}
              >
                Capturar outra foto
              </Button>
              <Button
                type="button"
                onClick={() => finalizeAvatar()}
                variant="game"
                disabled={!selectedAvatarOption || avatarSaving}
                className="flex-1"
              >
                {avatarSaving ? 'Salvando...' : 'Usar este Avatar'}
              </Button>
            </div>
          </div>
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
  // Sempre renderiza o Perfil do usuário aqui;
  // líderes seguem acessando o dashboard dedicado via /leader-dashboard
  return <ProfileContent />;
};

export default Profile;
