import { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, Zap, Trophy, Target, LogOut, Star, Menu, Filter, History, CheckCircle, ListFilter, Trash2 } from "lucide-react";
import { AIStatus } from "@/components/AIStatus";
import { useNavigate } from "react-router-dom";
import Navigation from "@/components/Navigation";
import { ThemedBackground } from "@/components/ThemedBackground";
import { TeamPerformanceCard } from "@/components/TeamPerformanceCard";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { getTierInfo, getNextTierLevel } from "@/lib/constants/tiers";
import { fetchTeamNames } from "@/lib/teamLookup";

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
   campaign_id?: string | null;
}

const Dashboard = () => {
  const { user, signOut, isLeader, userRole, profile: authProfile } = useAuth() as any;
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [allChallenges, setAllChallenges] = useState<Challenge[]>([]);
  const [userEvents, setUserEvents] = useState<Array<{ id: string; challenge_id: string; status: string; created_at: string }>>([]);
  const [challengeTab, setChallengeTab] = useState<'vigentes' | 'historico'>('vigentes');
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<{ name: string; xp: number; tier: string; avatar_url: string | null; team: { name: string } | null } | null>(null);
  const [completedQuizIds, setCompletedQuizIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [openForums, setOpenForums] = useState<Array<{ id: string; title: string; description?: string | null; posts_count?: number | null; last_post_at?: string | null; created_at?: string | null; is_locked?: boolean | null }>>([]);
  // Desafios passam a ser conduzidos via campanhas e fóruns; seção dedicada de desafios fica oculta.
  const showChallengesSection = false;

  const loadedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    console.log('🏠 Dashboard: user changed', user?.id);
    
    const loadData = async () => {
      if (!user) {
        console.log('🏠 Dashboard: no user, skipping load');
        return;
      }

      // Avoid double load in React StrictMode/dev
      if (loadedForUserRef.current === user.id) {
        console.log('🏠 Dashboard: already loaded for user, skipping');
        return;
      }
      loadedForUserRef.current = user.id;

      console.log('🏠 Dashboard: starting data load');
      
      // Safety timeout - force end loading after 5s
      const timeoutId = setTimeout(() => {
        console.error('⏱️ Dashboard: timeout reached - forcing loading to false');
        setLoading(false);
      }, 5000);

      try {
        // Parallelize all queries for faster loading
        const [profileResult, campaignsResult, challengesResult, eventsResult, userAnswersResult, forumsResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("name, xp, tier, avatar_url, team_id")
            .eq("id", user.id)
            .maybeSingle(),
          
          supabase
            .from("campaigns")
            .select("*")
            .eq("is_active", true)
            .order("start_date", { ascending: false }),
          
          supabase
            .from("challenges")
            .select("*")
            .limit(100),

          supabase
            .from('events')
            .select('id, challenge_id, status, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),

          // Todas as respostas de quiz para determinar conclusão por desafio
          supabase
            .from('user_quiz_answers')
            .select('challenge_id')
            .eq('user_id', user.id)
          ,
          supabase
            .from('forum_topics')
            .select('id,title,description,posts_count,last_post_at,created_at,is_locked,is_active')
            .eq('is_active', true)
            .order('last_post_at', { ascending: false })
            .limit(6)
        ]);

        if (profileResult.error) {
          console.warn('Dashboard: erro carregando perfil', profileResult.error.message);
        }

        if (profileResult.data) {
          let teamName: string | null = null;
          if (profileResult.data.team_id) {
            const teamMap = await fetchTeamNames([profileResult.data.team_id]);
            teamName = teamMap[profileResult.data.team_id] || null;
          }
          setProfile({
            ...profileResult.data,
            team: teamName ? { name: teamName } : null,
          } as any);
        } else if (authProfile) {
          setProfile({
            name: authProfile.name,
            xp: authProfile.xp ?? 0,
            tier: authProfile.tier ?? 'novato',
            avatar_url: authProfile.avatar_url ?? null,
            team: authProfile.team ? { name: authProfile.team.name } : null,
          });
        }

        if (campaignsResult.data) {
          setCampaigns(campaignsResult.data);
        }

        if (challengesResult.data) {
          setAllChallenges(challengesResult.data);
        }

        if (forumsResult?.data) {
          setOpenForums(forumsResult.data as any);
        }

        if (eventsResult.error) {
          console.warn('Dashboard: eventos indisponíveis', eventsResult.error.message);
        } else if (eventsResult.data) {
          setUserEvents(eventsResult.data as any);
        }

        // Calcular quizzes concluídos: respostas >= total de perguntas
        if (userAnswersResult.error) {
          console.warn('Dashboard: respostas de quiz indisponíveis', userAnswersResult.error.message);
        } else if (userAnswersResult.data && challengesResult.data) {
          const quizChallenges = (challengesResult.data as Challenge[]).filter(c => (c.type || '').toLowerCase().includes('quiz'));
          const questionCounts = new Map<string, number>();
          // Buscar contagem de perguntas por desafio (apenas para quizzes)
          const { data: quizQuestions, error: quizQuestionsError } = await supabase
            .from('quiz_questions')
            .select('challenge_id');

          if (quizQuestionsError) {
            console.warn('Dashboard: quiz_questions indisponível', quizQuestionsError.message);
          }
          (quizQuestions || []).forEach((q: any) => {
            questionCounts.set(q.challenge_id, (questionCounts.get(q.challenge_id) || 0) + 1);
          });

          const answeredCounts = new Map<string, number>();
          (userAnswersResult.data as { challenge_id: string }[]).forEach(row => {
            answeredCounts.set(row.challenge_id, (answeredCounts.get(row.challenge_id) || 0) + 1);
          });

          const completed = new Set<string>();
          quizChallenges.forEach(q => {
            const total = questionCounts.get(q.id) || 0;
            const answered = answeredCounts.get(q.id) || 0;
            if (total > 0 && answered >= total) completed.add(q.id);
          });
          setCompletedQuizIds(completed);
        }
        
        console.log('🏠 Dashboard: data loaded successfully');
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  // Memoize calculations to prevent unnecessary recalculations (must be before any conditional returns)
  const tierInfo = useMemo(() => 
    profile ? getTierInfo(profile.tier) : null, 
    [profile]
  );
  
  const nextLevel = useMemo(() => 
    profile && tierInfo ? getNextTierLevel(profile.tier, profile.xp) : null,
    [profile, tierInfo]
  );
  
  const xpProgress = useMemo(() => 
    profile && tierInfo 
      ? ((profile.xp - tierInfo.xpMin) / (tierInfo.xpMax - tierInfo.xpMin)) * 100 
      : 0,
    [profile, tierInfo]
  );

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  // Filters and helpers for challenges
  const typeDomain = (type: string) => {
    const t = (type || '').toLowerCase();
    if (t.includes('quiz')) return 'Conhecimento';
    if (t.includes('forum') || t.includes('mento') || t.includes('atitude')) return 'Atitude';
    if (t.includes('desafio') || t.includes('inspe') || t.includes('pratic')) return 'Habilidades';
    if (t.includes('safety') || t.includes('segur')) return 'Segurança';
    return 'Conhecimento';
  };

  const toggleType = (t: string) => {
    setTypeFilters(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  // Map latest status per challenge (events already sorted desc)
  const latestStatusByChallenge = useMemo(() => {
    const map = new Map<string, string>();
    userEvents.forEach((e) => {
      if (e.challenge_id && !map.has(e.challenge_id)) {
        map.set(e.challenge_id, e.status);
      }
    });
    return map;
  }, [userEvents]);

  // Completed non-quiz challenges: any event with terminal-ish status
  const completedNonQuizIds = useMemo(() => {
    const set = new Set<string>();
    userEvents.forEach((e) => {
      const s = (e.status || '').toLowerCase();
      if (['approved', 'evaluated', 'rejected'].includes(s)) {
        if (e.challenge_id) set.add(e.challenge_id);
      }
    });
    return set;
  }, [userEvents]);

  const completedChallengeIds = useMemo(() => {
    const u = new Set<string>([...completedNonQuizIds, ...completedQuizIds]);
    return u;
  }, [completedNonQuizIds, completedQuizIds]);

  const filteredChallenges = useMemo(() => {
    const now = new Date();

    const isVigente = (ch: Challenge): boolean => {
      if (!ch.campaign_id) return true;
      const camp = campaigns.find((c) => c.id === ch.campaign_id);
      if (!camp || !camp.end_date) return true;
      try {
        const end = new Date(camp.end_date);
        // Considera vigente até o fim do dia de término
        end.setHours(23, 59, 59, 999);
        return end >= now;
      } catch {
        return true;
      }
    };

    let base: Challenge[] = [];
    if (challengeTab === 'vigentes') {
      // Mostrar apenas desafios ainda não concluídos e dentro da janela de campanha (quando houver)
      base = allChallenges.filter((ch) => !completedChallengeIds.has(ch.id) && isVigente(ch));
    } else {
      // Histórico: desafios concluídos OU cuja campanha já terminou
      const seen = new Set<string>();
      base = allChallenges.filter((c) => {
        const expired = !isVigente(c);
        const completed = completedChallengeIds.has(c.id);
        if (!(expired || completed)) return false;
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
    }
    if (typeFilters.size === 0) return base;
    return base.filter((c) => typeFilters.has((c.type || '').toLowerCase()));
  }, [challengeTab, allChallenges, typeFilters, completedChallengeIds, campaigns]);

  // Opções de filtro derivadas dos tipos presentes nos desafios (evita exibir tipos inexistentes)
  const typeOptions = useMemo(() => {
    const labelMap: Record<string, string> = {
      quiz: 'Quiz',
      forum: 'Fórum',
      atitude: 'Atitude',
      mentoria: 'Mentoria',
      inspecao: 'Inspeção',
    };
    const present = new Set<string>();
    (allChallenges || []).forEach((c) => {
      const t = (c.type || '').toLowerCase();
      if (labelMap[t]) present.add(t);
    });
    return Array.from(present).map((t) => ({ key: t, label: labelMap[t] }));
  }, [allChallenges]);

  const isTopLeader = authProfile?.matricula === '601555';
  const canDeleteContent = Boolean(isLeader || (userRole && (userRole.includes('gerente') || userRole.includes('coordenador'))));

  const handleDeleteChallenge = async (challenge: Challenge) => {
    if (!user) return;
    const baseMsg = `Esta ação vai excluir permanentemente o desafio/quiz "${challenge.title}" e remover TODO o XP acumulado por quaisquer usuários ligado a ele.`;
    const approvalMsg = isTopLeader
      ? `${baseMsg}\n\nVocê é o líder máximo, esta exclusão será aplicada imediatamente. Confirmar?`
      : `${baseMsg}\n\nO pedido será registrado para ciência do seu líder imediato. Confirmar exclusão agora?`;
    if (!window.confirm(approvalMsg)) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const resp = await fetch('/api/admin?handler=challenges-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ id: challenge.id }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao excluir desafio');
      setAllChallenges(prev => prev.filter(c => c.id !== challenge.id));
      alert('Desafio/quiz excluído e XP associado revertido para os usuários impactados.');
    } catch (e: any) {
      console.error('Erro ao excluir desafio:', e);
      alert(String(e?.message || 'Erro ao excluir desafio'));
    }
  };

  const handleDeleteForumFromDashboard = async (topicId: string, title: string) => {
    const baseMsg = `Esta ação vai excluir permanentemente o fórum "${title}". Respostas marcadas como solução terão o XP bônus revertido.`;
    const approvalMsg = isTopLeader
      ? `${baseMsg}\n\nVocê é o líder máximo, esta exclusão será aplicada imediatamente. Confirmar?`
      : `${baseMsg}\n\nO pedido será registrado para ciência do seu líder imediato. Confirmar exclusão agora?`;
    if (!window.confirm(approvalMsg)) return;
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Não autenticado');
      const resp = await fetch('/api/forum?handler=moderate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'delete_topic', topic_id: topicId }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao excluir fórum');
      setOpenForums(prev => prev.filter(t => t.id !== topicId));
      alert('Fórum excluído; XP de soluções foi revertido quando aplicável.');
    } catch (e: any) {
      console.error('Erro ao excluir fórum:', e);
      alert(String(e?.message || 'Erro ao excluir fórum'));
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background pb-40 md:pb-20 overflow-hidden">
      <ThemedBackground theme="habilidades" />
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0b2a34]/85 text-blue-50 border-b border-cyan-700/30">
        <div className="container mx-auto px-3 py-3 grid grid-cols-3 items-center">
          <div className="flex items-center gap-2 justify-self-start">
            <div className="flex items-center gap-1.5">
              <Shield className="h-6 w-6 text-primary" />
              <Zap className="h-6 w-6 text-secondary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-blue-50">DJT - Quest</h1>
              <p className="text-[10px] text-blue-100/80 leading-none">CPFL Piratininga e Santa Cruz Subtransmissão</p>
            </div>
          </div>
          <div className="flex items-center justify-center">
            <AIStatus />
          </div>
          <div className="flex items-center gap-2 justify-self-end">
            <div className="text-right hidden sm:block">
              <p className="font-semibold text-sm">{profile?.name}</p>
              {tierInfo && (
                <div className="flex items-center gap-1.5 text-xs justify-end">
                  <Star className="h-3 w-3 text-accent" />
                  <span>{tierInfo.name}</span>
                </div>
              )}
            </div>
            {profile && (
              <ProfileDropdown
                profile={{
                  name: profile.name,
                  avatar_url: profile.avatar_url,
                  team: profile.team,
                  tier: profile.tier
                }}
                isLeader={isLeader || false}
                onSignOut={handleSignOut}
              />
            )}
          </div>
        </div>
      </header>

      <main className="container relative mx-auto px-3 py-4 space-y-6">
        {/* Barra de progressão sempre no topo */}
        <Card className="bg-gradient-to-r from-primary/10 to-secondary/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Trophy className="h-5 w-5 text-accent" />
              Sua Progressão
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tierInfo && profile && (
              <>
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span>{tierInfo.name}</span>
                  <span className="font-semibold">{profile.xp} XP</span>
                  {nextLevel && (
                    <span className="text-muted-foreground">
                      Faltam {Math.max(0, nextLevel.xpNeeded)} XP para {nextLevel.name}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/profile')}
                  className="w-full text-left space-y-1 group"
                  aria-label="Ver todos os níveis e pontos"
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
              </>
            )}
          </CardContent>
        </Card>

        {/* Team Performance Card */}
        <TeamPerformanceCard />

        {/* Open Forums */}
        {openForums.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Target className="h-5 w-5 text-secondary" />
                Fóruns Abertos
              </CardTitle>
              <CardDescription>Participe das discussões em andamento</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {openForums.slice(0,4).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/10 cursor-pointer gap-3"
                  onClick={() => navigate(`/forum/${t.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{t.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{t.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{t.posts_count || 0} posts</Badge>
                    {canDeleteContent && (
                      <button
                        type="button"
                        className="p-1 rounded-full hover:bg-destructive/10 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteForumFromDashboard(t.id, t.title);
                        }}
                        aria-label="Excluir fórum e reverter XP relacionado"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="pt-2 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => navigate('/forums')}>Ver todos</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active Campaigns */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Target className="h-5 w-5 text-blue-300" />
            <h2 className="text-xl font-bold text-blue-50">Campanhas Ativas</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((campaign) => (
              <Card key={campaign.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <Badge className="w-fit mb-2 text-[10px] bg-cyan-700/60 text-blue-50 border-cyan-500/50">{campaign.narrative_tag}</Badge>
                  <CardTitle className="text-base leading-tight text-blue-50">{campaign.title}</CardTitle>
                  <CardDescription className="text-xs line-clamp-2 text-blue-100/80">{campaign.description}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-[10px] text-blue-200/80 mb-2">
                    {new Date(campaign.start_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} -{" "}
                    {new Date(campaign.end_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                  </p>
                  <Button
                    className="w-full h-9 text-sm"
                    variant="default"
                    onClick={() => navigate(`/campaign/${campaign.id}`)}
                  >
                    Ver detalhes & engajar
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Challenges with filters (desativados da home; desafios agora via campanhas/fóruns) */}
        {showChallengesSection && (
        <section>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-blue-300" />
              <h2 className="text-xl font-bold text-blue-50">Desafios</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button variant={challengeTab === 'vigentes' ? 'secondary' : 'outline'} size="sm" onClick={() => setChallengeTab('vigentes')} className="gap-2">
                <ListFilter className="h-4 w-4" /> Vigentes
              </Button>
              <Button variant={challengeTab === 'historico' ? 'secondary' : 'outline'} size="sm" onClick={() => setChallengeTab('historico')} className="gap-2">
                <History className="h-4 w-4" /> Histórico
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {typeOptions.map(opt => (
              <Button key={opt.key} size="sm" variant={typeFilters.has(opt.key) ? 'secondary' : 'outline'} onClick={() => toggleType(opt.key)}>
                {opt.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredChallenges.map((challenge) => (
              <Card key={challenge.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {challenge.type}
                      </Badge>
                      <Badge className="text-[10px]" variant="secondary">{typeDomain(challenge.type)}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-accent">+{challenge.xp_reward} XP</span>
                      {canDeleteContent && (
                        <button
                          type="button"
                          className="p-1 rounded-full hover:bg-destructive/10 text-destructive"
                          onClick={() => handleDeleteChallenge(challenge)}
                          aria-label="Excluir desafio/quiz e reverter XP"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
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
                  {challengeTab === 'historico' && (
                    <div className="mb-2">
                      <Badge variant="secondary" className="text-[10px]">{(latestStatusByChallenge.get(challenge.id) || 'concluído').toString()}</Badge>
                    </div>
                  )}
                  <Button
                    className="w-full h-9 text-sm"
                    variant="game"
                    onClick={() => navigate(`/challenge/${challenge.id}`)}
                  >
                    {challengeTab === 'historico' ? 'Ver novamente' : 'Começar'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        )}
      </main>

      <Navigation />
    </div>
  );
};

export default Dashboard;
  
