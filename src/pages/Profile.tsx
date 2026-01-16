import { useEffect, useState, useCallback, useMemo } from 'react';
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
import { getTierInfo, getNextTierLevel, TIER_CONFIG } from '@/lib/constants/tiers';
import { AvatarCapture } from '@/components/AvatarCapture';
import { ProfileEditor } from '@/components/ProfileEditor';
import { ProfileChangeHistory } from '@/components/profile/ProfileChangeHistory';
import { QuizHistory } from '@/components/profile/QuizHistory';
import { ChangePasswordCard } from '@/components/profile/ChangePasswordCard';
import Navigation from '@/components/Navigation';
import { ForumMentions } from '@/components/profile/ForumMentions';
import { UserFeedbackInbox } from '@/components/profile/UserFeedbackInbox';
import { SepbookPostsCard } from '@/components/profile/SepbookPostsCard';
import { MyCreatedQuizzesCard } from '@/components/profile/MyCreatedQuizzesCard';
import { fetchTeamNames } from '@/lib/teamLookup';
import { apiFetch } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { getActiveLocale } from '@/lib/i18n/activeLocale';

type AvatarVariant = {
  url?: string | null;
  thumbnail_url?: string | null;
  filename?: string | null;
  style?: string | null;
};

interface AvatarMeta {
  provider?: string;
  uploaded_at?: string;
  variants?: {
    original?: AvatarVariant | null;
    stylized?: AvatarVariant | null;
  };
}

interface UserProfile {
  name: string;
  email: string;
  xp: number;
  tier: string;
  demotion_cooldown_until: string | null;
  team: { name: string } | null;
  avatar_url: string | null;
  avatar_thumbnail_url?: string | null;
  avatar_meta: AvatarMeta | null;
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
  const { user, refreshUserSession, profile: authProfile, isLeader, roles } = useAuth();
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

  // Abrir/fechar modal conforme query param (?avatar=open)
  useEffect(() => {
    setAvatarDialogOpen(searchParams.get('avatar') === 'open');
  }, [searchParams]);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [xpDialogOpen, setXpDialogOpen] = useState(false);
  const [coordBonus, setCoordBonus] = useState<{
    coordId: string | null;
    coordName: string | null;
    latest: { year: number; month: number; xp: number; position: number } | null;
    graph: { points: Array<{ label: string; xp: number; position: number }> };
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadBonus = async () => {
      try {
        const resp = await apiFetch('/api/coord-ranking');
        const json = await resp.json();
        if (!resp.ok) throw new Error(json?.error || 'Falha ao carregar bonificação de coordenação');
        if (!cancelled) {
          setCoordBonus({
            coordId: json.coordId || null,
            coordName: json.coordName || null,
            latest: json.latest || null,
            graph: json.graph || { points: [] },
          });
        }
      } catch {
        if (!cancelled) setCoordBonus(null);
      }
    };
    loadBonus();
    return () => {
      cancelled = true;
    };
  }, []);

  const tierOffsets = useMemo(() => {
    let acc = 0;
    const map = new Map<string, number>();
    TIER_CONFIG.tiers.forEach((tier) => {
      map.set(tier.slug, acc);
      // Soma até o maior xpMax finito; se não houver, usa o maior xpMin como fallback
      const finiteMax = tier.levels.reduce((max, lvl) => {
        return Number.isFinite(lvl.xpMax) ? Math.max(max, lvl.xpMax as number) : max;
      }, 0);
      const fallbackMax = tier.levels.reduce((max, lvl) => Math.max(max, lvl.xpMin), 0);
      const spanBase = finiteMax > 0 ? finiteMax + 1 : fallbackMax;
      acc += spanBase;
    });
    return map;
  }, []);

  const xpByCategory = useMemo(() => {
    const buckets: Record<string, number> = {};
    events.forEach((e) => {
      const points = Number((e as any)?.final_points ?? e.points_calculated ?? 0);
      if (!points || isNaN(points)) return;
      const type = (e.challenge?.type || '').toLowerCase();
      let key = 'outros';
      if (type.includes('forum')) key = 'fórum';
      else if (type.includes('quiz')) key = 'quiz';
      else if (type.includes('desafio') || type.includes('challenge')) key = 'desafio';
      else if (type.includes('campanha') || type.includes('campaign')) key = 'campanha';
      else if (type.includes('sepbook')) key = 'sepbook';
      buckets[key] = (buckets[key] || 0) + points;
    });
    const entries = Object.entries(buckets)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({ label, value }));
    const total = entries.reduce((acc, cur) => acc + cur.value, 0);
    const max = entries.reduce((acc, cur) => Math.max(acc, cur.value), 0) || 1;
    return { entries, total, max };
  }, [events]);

  // Loader we can reuse (initial + manual retry)
  const loadProfile = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      // Load profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('name, email, xp, tier, avatar_url, avatar_thumbnail_url, avatar_meta, date_of_birth, team_id')
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
          avatar_thumbnail_url: (authProfile as any)?.avatar_thumbnail_url ?? null,
          avatar_meta: (authProfile as any)?.avatar_meta ?? null,
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

  // Removed avatar view mode logic (AI removed)

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

  const resetAvatarFlow = () => {
    setAvatarSaving(false);
  };

  const handleAvatarCaptured = async (imageBase64: string) => {
    // Envia a foto original para gerar automaticamente o avatar estilizado
    await finalizeAvatar(imageBase64);
  };

  // Removed recreate avatar (AI)

  const finalizeAvatar = async (base64ToUse?: string) => {
    if (!user || avatarSaving || !base64ToUse) {
      toast({ title: 'Selecione um avatar para continuar', variant: 'destructive' });
      return;
    }

    try {
      setAvatarSaving(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const resp = await apiFetch('/api/admin?handler=upload-avatar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          userId: user.id,
          imageBase64: base64ToUse,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.error || 'Falha ao salvar');

      await refreshUserSession();
      if (data?.avatarUrl) {
        setProfile((prev) => (
          prev ? { 
            ...prev, 
            avatar_url: data?.avatarUrl ?? prev.avatar_url, 
            avatar_thumbnail_url: data?.avatarUrl ?? prev.avatar_thumbnail_url,
            avatar_meta: null 
          } : prev
        ));
      }
      toast({ title: 'Foto atualizada com sucesso!' });
      setAvatarDialogOpen(false);
      resetAvatarFlow();
    } catch (error) {
      console.error('Error finalizing avatar:', error);
      toast({ title: 'Erro ao salvar avatar', variant: 'destructive' });
    } finally {
      setAvatarSaving(false);
    }
  };

  const canUseFinance = useMemo(() => {
    const list: string[] = Array.isArray(roles) ? roles : [];
    const p = authProfile || {};
    const isGuest =
      list.includes('invited') ||
      String(p?.sigla_area || '').trim().toUpperCase() === 'CONVIDADOS' ||
      String(p?.operational_base || '').trim().toUpperCase() === 'CONVIDADOS';
    return Boolean(user?.id) && !isGuest;
  }, [authProfile, roles, user?.id]);

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

  const activeAvatarUrl = profile.avatar_url || profile.avatar_thumbnail_url || undefined;

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

  if (loading || !profile) {
    return (
      <div className="relative min-h-screen bg-background p-4 pb-40 overflow-hidden">
        <ThemedBackground theme="atitude" />
        <div className="container relative max-w-4xl mx-auto py-8 space-y-4">
          <Card className="bg-gradient-to-r from-primary/10 to-secondary/10">
            <CardHeader>
              <div className="space-y-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-3 w-full" />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background p-4 pb-40 overflow-hidden">
      <ThemedBackground theme="atitude" />
      <div className="container relative max-w-4xl mx-auto py-8 space-y-6">
        {/* Profile Header */}
        <Card className="bg-gradient-to-r from-primary/10 to-secondary/10">
          <CardHeader>
        <div className="grid grid-cols-3 items-start">
          <div className="flex flex-col gap-3 col-span-3">
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center md:items-start gap-3">
                <AvatarDisplay 
                  avatarUrl={activeAvatarUrl}
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
              <div className="flex-1">
                <CardTitle className="text-2xl">{profile.name}</CardTitle>
                <CardDescription className="text-base">{profile.email}</CardDescription>
                {profile.team && (
                  <Badge variant="outline" className="mt-2">{profile.team.name}</Badge>
                )}
              </div>
              <div className="text-right space-y-2">
                <div className="flex items-center gap-2 justify-end mb-1">
                  <Star className="h-5 w-5 text-accent" />
                  <span className="text-2xl font-bold">{tierInfo?.name || profile.tier}</span>
                </div>
                <p className="text-sm text-muted-foreground">{profile.xp} XP Total</p>
                <div>
                  <Button variant="outline" size="sm" onClick={() => navigate('/')}>Voltar à Página Inicial</Button>
                </div>
                {canUseFinance ? (
                  <div>
                    <Button variant="secondary" size="sm" onClick={() => navigate('/finance')}>
                      Solicitar Reembolso/Adiantamento
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Progresso para {nextLevel?.name || 'Nível Máximo'}</span>
                {nextLevel && <span className="font-semibold">{nextLevel.xpNeeded} XP restantes</span>}
              </div>
              <button
                type="button"
                onClick={() => setXpDialogOpen(true)}
                className="w-full text-left space-y-1 group"
              >
                <div className="relative h-4 w-full overflow-hidden rounded-full bg-green-800/50 border border-green-700/60">
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-500/35"
                    style={{ width: '100%' }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-yellow-300 via-orange-400 to-red-500 animate-pulse"
                    style={{ width: `${Math.min(100, Math.max(0, xpProgress))}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Barra única: verde (base), azul (potencial), amarelo→vermelho (atingido)</span>
                  {nextLevel && <span>Próximo: {nextLevel.name}</span>}
                </div>
              </button>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setXpDialogOpen(true)}
                  className="text-[11px] text-muted-foreground underline underline-offset-2"
                >
                  Ver mapa de níveis e ganhos de XP
                </button>
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
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

        {/* Removed AI avatar comparison section */}

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
                            Conquistado em {new Date(userBadge.earned_at).toLocaleDateString(getActiveLocale())}
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

      </CardContent>
    </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <ProfileEditor />
          <ChangePasswordCard />
          <ProfileChangeHistory />
          <QuizHistory />
          <SepbookPostsCard />
          <MyCreatedQuizzesCard />
          <ForumMentions />
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4 text-primary" />
                Feedbacks
              </CardTitle>
              <CardDescription className="text-xs">
                Mensagens privadas enviadas por líderes e administradores.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <UserFeedbackInbox showSent={Boolean(isLeader)} />
            </CardContent>
          </Card>
          {coordBonus && coordBonus.coordId && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Target className="h-4 w-4 text-primary" />
                  Bonificação da Coordenação
                </CardTitle>
                <CardDescription className="text-xs">
                  XP mensal baseado na posição da coordenação no ranking geral.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {coordBonus.latest ? (
                  <>
                    <p className="text-sm">
                      Coordenação: <span className="font-semibold">{coordBonus.coordName}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Último mês registrado ({coordBonus.latest.month}/{coordBonus.latest.year}): posição{' '}
                      <span className="font-semibold">#{coordBonus.latest.position}</span> —{' '}
                      <span className="font-semibold">{coordBonus.latest.xp} XP</span> de bônus.
                    </p>
                    {coordBonus.graph.points.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs font-semibold">Histórico recente</p>
                        <div className="space-y-1">
                          {coordBonus.graph.points.map((p) => (
                            <div key={p.label} className="flex items-center justify-between text-[11px]">
                              <span className="text-muted-foreground">{p.label}</span>
                              <span className="font-mono">
                                {p.xp} XP · #{p.position}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Ainda não há registros de bonificação de coordenação para seu perfil.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Navigation />
    <Dialog open={xpDialogOpen} onOpenChange={setXpDialogOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mapa de Níveis e Trilhas</DialogTitle>
          <DialogDescription>
            Veja onde você está hoje e quais são os próximos degraus nas trilhas Executor, Formador e Guardião.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-auto pr-1">
          {xpByCategory.entries.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">De onde veio seu XP</p>
              <div className="space-y-2">
                {xpByCategory.entries.map((e) => {
                  const pct = Math.max(4, Math.round((e.value / xpByCategory.max) * 100));
                  return (
                    <div key={e.label}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium">{e.label}</span>
                        <span className="text-muted-foreground">{e.value} XP</span>
                      </div>
                      <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-secondary"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {TIER_CONFIG.tiers.map((tier) => {
            const offset = tierOffsets.get(tier.slug) || 0;
            return (
              <div key={tier.slug} className="space-y-2">
                <p className="text-sm font-semibold">
                  {tier.displayName} ({tier.prefix})
                </p>
                <div className="space-y-1">
                  {tier.levels.map((lvl) => {
                    const isCurrent = lvl.code === profile.tier;
                    const dispMin = lvl.xpMin + offset;
                    const dispMax = Number.isFinite(lvl.xpMax) ? (lvl.xpMax as number) + offset : null;
                    return (
                      <div
                        key={lvl.code}
                        className={`flex items-center justify-between rounded-md border px-2 py-1 text-xs ${
                          isCurrent ? 'bg-primary/10 border-primary/60' : 'bg-muted/40'
                        }`}
                      >
                        <span className="font-medium">
                          {lvl.code} — {lvl.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {dispMax !== null ? `${dispMin}–${dispMax} XP` : `${dispMin}+ XP`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
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
        <AvatarCapture
          onCapture={handleAvatarCaptured}
          onSkip={() => {
            if (!avatarSaving) {
              setAvatarDialogOpen(false);
              resetAvatarFlow();
            }
          }}
        />
        <p className="text-sm text-muted-foreground mt-4">A foto será salva no seu perfil.</p>
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
