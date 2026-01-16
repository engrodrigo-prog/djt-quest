import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Shield, Zap, Trophy, Target, LogOut, Star, Menu, Filter, History, CheckCircle, ListFilter, Trash2, Share2, Bell, MessageSquare, AtSign, ClipboardList } from "lucide-react";
import { AIStatus } from "@/components/AIStatus";
import { useNavigate } from "react-router-dom";
import Navigation from "@/components/Navigation";
import { ThemedBackground } from "@/components/ThemedBackground";
import { TeamPerformanceCard } from "@/components/TeamPerformanceCard";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { getTierInfo, getNextTierLevel } from "@/lib/constants/tiers";
import { fetchTeamNames } from "@/lib/teamLookup";
import { buildAbsoluteAppUrl, openWhatsAppShare } from "@/lib/whatsappShare";
import { useI18n } from "@/contexts/I18nContext";
import { apiFetch } from "@/lib/api";

interface Campaign {
  id: string;
  title: string;
  description: string | null;
  narrative_tag: string | null;
  start_date: string | null;
  end_date: string | null;
  is_active?: boolean | null;
  evidence_challenge_id?: string | null;
  archived_at?: string | null;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  type: string;
  xp_reward: number;
  reward_mode?: string | null;
  reward_tier_steps?: number | null;
  require_two_leader_eval: boolean;
   campaign_id?: string | null;
  status?: string | null;
  created_at?: string;
}

const Dashboard = () => {
  const { user, signOut, isLeader, studioAccess, userRole, profile: authProfile } = useAuth() as any;
  const navigate = useNavigate();
  const { locale, t: tr } = useI18n();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignStats, setCampaignStats] = useState<Record<string, { total: number; approved: number; last_event_at: string | null }>>({});
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignTag, setCampaignTag] = useState("");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState<"active" | "closed" | "all">("active");
  const [campaignDateStart, setCampaignDateStart] = useState("");
  const [campaignDateEnd, setCampaignDateEnd] = useState("");
  const [allChallenges, setAllChallenges] = useState<Challenge[]>([]);
  const [quizQuestionCounts, setQuizQuestionCounts] = useState<Record<string, number>>({});
  const [userEvents, setUserEvents] = useState<Array<{ id: string; challenge_id: string; status: string; created_at: string }>>([]);
  const [challengeTab, setChallengeTab] = useState<'vigentes' | 'historico'>('vigentes');
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<{ name: string; xp: number; tier: string; avatar_url: string | null; team: { name: string } | null } | null>(null);
  const [completedQuizIds, setCompletedQuizIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [openForums, setOpenForums] = useState<Array<{ id: string; title: string; description?: string | null; posts_count?: number | null; last_post_at?: string | null; created_at?: string | null; is_locked?: boolean | null }>>([]);
  const [pendingCounts, setPendingCounts] = useState({
    forumMentions: 0,
    evaluations: 0,
    leadershipAssignments: 0,
    campaigns: 0,
    challengesActive: 0,
    quizzesPending: 0,
  });
  const [sepbookSummary, setSepbookSummary] = useState({ new_posts: 0, mentions: 0 });
  // Desafios passam a ser conduzidos via campanhas e fóruns; seção dedicada de desafios fica oculta.
  const showChallengesSection = false;

  const loadedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        return;
      }

      // Avoid double load in React StrictMode/dev
      if (loadedForUserRef.current === user.id) {
        return;
      }
      loadedForUserRef.current = user.id;

      const isDev = typeof import.meta !== 'undefined' && Boolean((import.meta as any)?.env?.DEV);
      // Safety timeout - avoid infinite loading on flaky networks.
      const timeoutId = setTimeout(() => {
        if (isDev) console.warn('⏱️ Dashboard: timeout reached - forcing loading to false');
        setLoading(false);
      }, 15000);

      try {
        // Parallelize all queries for faster loading
        const [profileResult, campaignsResult, challengesResult, eventsResult, userAnswersResult, quizAttemptsResult, forumsResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("name, xp, tier, avatar_url, team_id")
            .eq("id", user.id)
            .maybeSingle(),
          
          supabase
            .from("campaigns")
            .select("*")
            .order("is_active", { ascending: false })
            .order("start_date", { ascending: false })
            .limit(120),
          
          supabase
            .from("challenges")
            .select("*")
            .order("created_at", { ascending: false })
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
          // Tentativas finalizadas (ex.: Quiz do Milhão encerra ao errar)
          supabase
            .from('quiz_attempts')
            .select('challenge_id, submitted_at')
            .eq('user_id', user.id)
            .not('submitted_at', 'is', null),
          supabase
            .from('forum_topics')
            .select('id,title,description,posts_count,last_post_at,created_at,is_locked,is_active,title_translations,description_translations')
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

        // Contagem de perguntas por quiz (para exibir "Quiz do Milhão" e também calcular conclusão)
        const countsObj: Record<string, number> = {};
        try {
          const list = (challengesResult.data || []) as any[];
          const quizIds = list
            .filter((c) => (c.type || '').toLowerCase().includes('quiz'))
            .map((c) => c.id)
            .filter(Boolean);
          if (quizIds.length) {
            const { data: quizQuestions, error: quizQuestionsError } = await supabase
              .from('quiz_questions')
              .select('challenge_id')
              .in('challenge_id', quizIds);
            if (quizQuestionsError) {
              console.warn('Dashboard: quiz_questions indisponível', quizQuestionsError.message);
            } else {
              (quizQuestions || []).forEach((q: any) => {
                const cid = q.challenge_id;
                if (!cid) return;
                countsObj[cid] = (countsObj[cid] || 0) + 1;
              });
            }
          }
        } catch (e: any) {
          console.warn('Dashboard: falha ao contar perguntas de quizzes', e?.message || e);
        } finally {
          setQuizQuestionCounts(countsObj);
        }

        // Calcular quizzes concluídos: respostas >= total de perguntas OU tentativa finalizada
        if (userAnswersResult.error) {
          console.warn('Dashboard: respostas de quiz indisponíveis', userAnswersResult.error.message);
        } else if (userAnswersResult.data && challengesResult.data) {
          const quizChallenges = (challengesResult.data as Challenge[]).filter((c) =>
            (c.type || '').toLowerCase().includes('quiz'),
          );

          const attemptCompleted = new Set<string>();
          if (quizAttemptsResult?.error) {
            console.warn('Dashboard: quiz_attempts indisponível', quizAttemptsResult.error.message);
          } else if (quizAttemptsResult?.data) {
            (quizAttemptsResult.data as any[]).forEach((row: any) => {
              const cid = String(row?.challenge_id || '');
              if (!cid) return;
              if (row?.submitted_at) attemptCompleted.add(cid);
            });
          }

          const answeredCounts = new Map<string, number>();
          (userAnswersResult.data as { challenge_id: string }[]).forEach((row) => {
            answeredCounts.set(row.challenge_id, (answeredCounts.get(row.challenge_id) || 0) + 1);
          });

          const completed = new Set<string>();
          quizChallenges.forEach((q) => {
            const total = countsObj[q.id] || 0;
            const answered = answeredCounts.get(q.id) || 0;
            if (total > 0 && answered >= total) completed.add(q.id);
          });
          attemptCompleted.forEach((cid) => completed.add(cid));
          setCompletedQuizIds(completed);
        }
        
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      if (!campaigns || campaigns.length === 0) {
        setCampaignStats({});
        return;
      }
      const ids = campaigns
        .map((c) => String(c?.id || "").trim())
        .filter(Boolean)
        .slice(0, 60);
      if (!ids.length) {
        setCampaignStats({});
        return;
      }
      try {
        const resp = await apiFetch(`/api/campaign-stats?campaign_ids=${encodeURIComponent(ids.join(","))}`);
        const json = await resp.json().catch(() => ({}));
        if (!active) return;
        const stats = json?.stats && typeof json.stats === "object" ? json.stats : {};
        setCampaignStats(stats);
      } catch {
        if (!active) return;
        setCampaignStats({});
      }
    })();
    return () => {
      active = false;
    };
  }, [campaigns, user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    let timer: any;

    const fetchCounts = async () => {
      if (!active) return;
      let directEvalCount: number | null = null;
      try {
        const { count, error } = await supabase
          .from('evaluation_queue')
          .select('id', { count: 'exact', head: true })
          .eq('assigned_to', user.id)
          .is('completed_at', null);
        if (!error) directEvalCount = count || 0;
      } catch {
        directEvalCount = null;
      }

      try {
        const resp = await apiFetch('/api/admin?handler=studio-pending-counts');
        const json = await resp.json().catch(() => ({}));
        if (resp.ok) {
          setPendingCounts({
            forumMentions: Number(json?.forumMentions || 0),
            evaluations: directEvalCount ?? Number(json?.evaluations || 0),
            leadershipAssignments: Number(json?.leadershipAssignments || 0),
            campaigns: Number(json?.campaigns || 0),
            challengesActive: Number(json?.challengesActive || 0),
            quizzesPending: Number(json?.quizzesPending || 0),
          });
        }
      } catch {
        setPendingCounts({
          forumMentions: 0,
          evaluations: directEvalCount ?? 0,
          leadershipAssignments: 0,
          campaigns: 0,
          challengesActive: 0,
          quizzesPending: 0,
        });
      }

      try {
        const resp2 = await apiFetch('/api/sepbook-summary');
        const json2 = await resp2.json().catch(() => ({}));
        if (resp2.ok) {
          setSepbookSummary({
            new_posts: Number(json2?.new_posts || 0),
            mentions: Number(json2?.mentions || 0),
          });
        }
      } catch {
        setSepbookSummary({ new_posts: 0, mentions: 0 });
      }
    };

    fetchCounts();
    timer = setInterval(fetchCounts, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
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

  const evalTotal = pendingCounts.evaluations + pendingCounts.leadershipAssignments;
  const showEvaluations = Boolean(studioAccess || evalTotal > 0);
  const notificationItems = [
    {
      key: "forumMentions",
      label: tr("dashboard.notifications.forumMentions"),
      count: pendingCounts.forumMentions,
      icon: MessageSquare,
      action: () => navigate("/forums"),
    },
    {
      key: "sepbookMentions",
      label: tr("dashboard.notifications.sepbookMentions"),
      count: sepbookSummary.mentions,
      icon: AtSign,
      action: () => navigate("/sepbook"),
    },
    {
      key: "sepbookNew",
      label: tr("dashboard.notifications.sepbookNew"),
      count: sepbookSummary.new_posts,
      icon: Bell,
      action: () => navigate("/sepbook"),
    },
    {
      key: "evaluations",
      label: tr("dashboard.notifications.evaluations"),
      count: evalTotal,
      icon: ClipboardList,
      action: () => navigate("/evaluations"),
      hidden: !showEvaluations,
    },
    {
      key: "campaigns",
      label: tr("dashboard.notifications.campaigns"),
      count: pendingCounts.campaigns,
      icon: Target,
      action: () => navigate("/dashboard"),
    },
    {
      key: "challengesActive",
      label: tr("dashboard.notifications.challengesActive"),
      count: pendingCounts.challengesActive,
      icon: Target,
      action: () => navigate("/dashboard"),
    },
    {
      key: "quizzesPending",
      label: tr("dashboard.notifications.quizzesPending"),
      count: pendingCounts.quizzesPending,
      icon: Trophy,
      action: () => navigate("/study"),
    },
  ].filter((item) => !item.hidden);

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

  const isChallengeOpen = (ch: Challenge) => {
    const status = String(ch?.status || 'active').toLowerCase();
    return !['closed', 'canceled', 'cancelled'].includes(status);
  };

  const isChallengeVigente = (ch: Challenge) => {
    if (!ch.campaign_id) return true;
    const camp = campaigns.find((c) => c.id === ch.campaign_id);
    if (!camp || !camp.end_date) return true;
    try {
      const end = new Date(camp.end_date);
      // Considera vigente até o fim do dia de término
      end.setHours(23, 59, 59, 999);
      return end >= new Date();
    } catch {
      return true;
    }
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
    let base: Challenge[] = [];
    if (challengeTab === 'vigentes') {
      // Mostrar apenas desafios ainda não concluídos e dentro da janela de campanha (quando houver)
      base = allChallenges.filter((ch) => !completedChallengeIds.has(ch.id) && isChallengeOpen(ch) && isChallengeVigente(ch));
    } else {
      // Histórico: desafios concluídos OU cuja campanha já terminou
      const seen = new Set<string>();
      base = allChallenges.filter((c) => {
        const expired = !isChallengeOpen(c) || !isChallengeVigente(c);
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
  const forumPotentialXp = useMemo(() => openForums.length * 500, [openForums]);

  const getCampaignStatus = useCallback((c: Campaign): "active" | "closed" => {
    const now = Date.now();
    const start = c?.start_date ? Date.parse(String(c.start_date)) : null;
    const end = c?.end_date ? Date.parse(String(c.end_date)) : null;
    const withinPeriod = (!start || start <= now) && (!end || end >= now);
    return c?.is_active !== false && withinPeriod ? "active" : "closed";
  }, []);

  const filteredCampaigns = useMemo(() => {
    const q = campaignSearch.trim().toLowerCase();
    const tagQ = campaignTag.trim().toLowerCase().replace(/^#/, "");
    const from = campaignDateStart ? new Date(`${campaignDateStart}T00:00:00`) : null;
    const to = campaignDateEnd ? new Date(`${campaignDateEnd}T23:59:59`) : null;

    const overlapsPeriod = (c: Campaign) => {
      if (!from && !to) return true;
      const s = c?.start_date ? new Date(String(c.start_date)) : null;
      const e = c?.end_date ? new Date(String(c.end_date)) : null;
      const startOk = !to || !s || s <= to;
      const endOk = !from || !e || e >= from;
      return startOk && endOk;
    };

    return (campaigns || [])
      .filter((c) => {
        if ((c as any)?.archived_at) return false;
        const status = getCampaignStatus(c);
        if (campaignStatusFilter !== "all" && status !== campaignStatusFilter) return false;

        const hay = `${c?.title || ""} ${(c as any)?.description || ""} ${(c as any)?.narrative_tag || ""}`.toLowerCase();
        if (q && !hay.includes(q)) return false;

        const normalizedTag = String((c as any)?.narrative_tag || "")
          .trim()
          .toLowerCase()
          .replace(/^#/, "");
        if (tagQ && !normalizedTag.includes(tagQ)) return false;

        if (!overlapsPeriod(c)) return false;
        return true;
      })
      .sort((a, b) => {
        const aRank = getCampaignStatus(a) === "active" ? 0 : 1;
        const bRank = getCampaignStatus(b) === "active" ? 0 : 1;
        if (aRank !== bRank) return aRank - bRank;
        const ad = a?.start_date ? Date.parse(String(a.start_date)) : 0;
        const bd = b?.start_date ? Date.parse(String(b.start_date)) : 0;
        if (bd !== ad) return bd - ad;
        return String(a?.title || "").localeCompare(String(b?.title || ""), locale);
      });
  }, [campaignDateEnd, campaignDateStart, campaignSearch, campaignStatusFilter, campaignTag, campaigns, getCampaignStatus, locale]);

  const featuredMilhao = useMemo(() => {
    const isMilhao = (t: string) => /milh(ã|a)o/i.test(t || '');
    // allChallenges já vem ordenado por created_at desc
    return (allChallenges || []).find((c) => {
      if (!c) return false;
      if ((c.type || '').toLowerCase() !== 'quiz') return false;
      if (!isMilhao(String(c.title || ''))) return false;
      if ((c.reward_mode || '') !== 'tier_steps' && (c.xp_reward || 0) <= 0) return false;
      // Evita mostrar tentativas antigas que falharam e ficaram sem perguntas
      const total = quizQuestionCounts[c.id] || 0;
      return total >= 10;
    }) || null;
  }, [allChallenges, quizQuestionCounts]);

  const activeQuizzes = useMemo(() => {
    const list = (allChallenges || []).filter((ch) => {
      const isQuiz = (ch.type || '').toLowerCase() === 'quiz';
      if (!isQuiz) return false;
      if (!isChallengeOpen(ch)) return false;
      if (!isChallengeVigente(ch)) return false;
      return true;
    });
    if (!featuredMilhao) return list;
    return list.filter((q) => q.id !== featuredMilhao.id);
  }, [allChallenges, campaigns, featuredMilhao]);

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
      alert(String(e?.message || tr("dashboard.deleteForumErrorTitle")));
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
    <div className="relative min-h-screen bg-background pb-40 overflow-x-hidden">
      <ThemedBackground theme="habilidades" />
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0b2a34]/85 text-blue-50 border-b border-cyan-700/30">
        <div className="container mx-auto px-3 py-3 grid grid-cols-3 items-center">
          <div className="flex items-center gap-2 justify-self-start">
            {isLeader ? (
              <button
                type="button"
                onClick={() => navigate('/leader-dashboard')}
                className="flex items-center gap-2 text-left hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md px-1 -mx-1"
                aria-label={tr("dashboard.leaderAria")}
                title={tr("dashboard.leaderTitle")}
              >
                <div className="flex items-center gap-1.5">
                  <Shield className="h-6 w-6 text-primary" />
                  <Zap className="h-6 w-6 text-secondary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-blue-50">DJT - Quest</h1>
                  <p className="text-[10px] text-blue-100/80 leading-none">
                    {tr("dashboard.leaderHint")}
                  </p>
                </div>
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Shield className="h-6 w-6 text-primary" />
                  <Zap className="h-6 w-6 text-secondary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-blue-50">DJT - Quest</h1>
                  <p className="text-[10px] text-blue-100/80 leading-none">
                    CPFL Piratininga e Santa Cruz Subtransmissão
                  </p>
                </div>
              </>
            )}
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
                  avatar_thumbnail_url: (profile as any)?.avatar_thumbnail_url || null,
                  team: profile.team,
                  tier: profile.tier,
                  matricula: (profile as any)?.matricula || null,
                  email: (profile as any)?.email || null
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
              {tr("dashboard.progressTitle")}
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
                      {tr("dashboard.progressRemaining", { xp: Math.max(0, nextLevel.xpNeeded), next: nextLevel.name })}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/profile')}
                  className="w-full text-left space-y-1 group"
                  aria-label={tr("dashboard.progressViewLevels")}
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
                    <span>{tr("dashboard.progressBarLegend")}</span>
                    {nextLevel && <span>{tr("dashboard.nextLevelLabel", { name: nextLevel.name })}</span>}
                  </div>
                </button>
                {forumPotentialXp > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {tr("dashboard.forumPotentialPrefix", { count: openForums.length })}{" "}
                    <strong>500 XP</strong>{" "}
                    {tr("dashboard.forumPotentialSuffix")}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-white">
              <Bell className="h-5 w-5 text-white" />
              {tr("dashboard.notifications.title")}
            </CardTitle>
            <CardDescription className="text-white/80">{tr("dashboard.notifications.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {notificationItems.filter((item) => item.count > 0).length === 0 ? (
              <p className="text-sm text-white/70">{tr("dashboard.notifications.empty")}</p>
            ) : (
              notificationItems
                .filter((item) => item.count > 0)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={item.action}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-white" />
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      <Badge variant="outline" className="border-white/60 text-white">
                        {item.count > 99 ? "99+" : item.count}
                      </Badge>
                    </button>
                  );
                })
            )}
          </CardContent>
        </Card>

        {/* Team Performance Card */}
        <TeamPerformanceCard />

        {/* Open Forums */}
        {openForums.length > 0 && (
          <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg text-white">
                <Target className="h-5 w-5 text-white" />
                {tr("dashboard.openForumsTitle")}
              </CardTitle>
              <CardDescription className="text-white/80">{tr("dashboard.openForumsDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {openForums.slice(0,4).map((topic) => {
                const displayTitle = (topic as any)?.title_translations?.[locale] || topic.title;
                const displayDesc = (topic as any)?.description_translations?.[locale] || topic.description;
                return (
                  <div
                    key={topic.id}
                    className="flex items-center justify-between p-3 border border-white/30 rounded-lg hover:bg-white/10 cursor-pointer gap-3"
                    onClick={() => navigate(`/forum/${topic.id}`)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate text-white">{displayTitle}</p>
                      <p className="text-xs text-white/70 truncate">{displayDesc}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="border-white/50 text-white">
                        {tr("dashboard.forumsPosts", { count: topic.posts_count || 0 })}
                      </Badge>
                      <button
                        type="button"
                        className="p-1 rounded-full hover:bg-white/10 text-white/90"
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = buildAbsoluteAppUrl(`/forum/${encodeURIComponent(topic.id)}`);
                          openWhatsAppShare({
                            message: tr("dashboard.forumShareMessage", { title: displayTitle }),
                            url,
                          });
                        }}
                        aria-label={tr("dashboard.forumShareAria")}
                        title={tr("dashboard.shareWhatsApp")}
                      >
                        <Share2 className="h-4 w-4" />
                      </button>
                      {canDeleteContent && (
                        <button
                          type="button"
                          className="p-1 rounded-full hover:bg-destructive/20 text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteForumFromDashboard(topic.id, displayTitle);
                          }}
                          aria-label={tr("dashboard.forumDeleteAria")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 flex justify-end">
                <Button variant="ghost" size="sm" onClick={() => navigate('/forums')}>{tr("dashboard.forumsViewAll")}</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active Campaigns */}
        {featuredMilhao && (
          <section>
            <div className="flex items-center gap-2 mb-3 text-foreground">
              <Trophy className="h-5 w-5 text-amber-300" />
              <h2 className="text-2xl font-semibold leading-tight">{tr("dashboard.featuredQuizTitle")}</h2>
            </div>
            <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="w-fit text-[11px] uppercase tracking-wide border-white/50 text-white">
                    {featuredMilhao.reward_mode === 'tier_steps'
                      ? tr("dashboard.levelsBadgeTier", { steps: featuredMilhao.reward_tier_steps || 1 })
                      : tr("dashboard.levelsBadgeXp", { xp: featuredMilhao.xp_reward })}
                  </Badge>
                  <div className="flex items-center gap-2">
                    {completedChallengeIds.has(featuredMilhao.id) && (
                      <Badge variant="secondary" className="text-[11px]">
                        {tr("dashboard.quizCompleted")}
                      </Badge>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-white/90 hover:text-white"
                      onClick={() => {
                        const url = buildAbsoluteAppUrl(`/challenge/${encodeURIComponent(featuredMilhao.id)}`);
                        openWhatsAppShare({
                          message: tr("dashboard.quizShareMessage", { title: featuredMilhao.title }),
                          url,
                        });
                      }}
                      title={tr("dashboard.shareWhatsApp")}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CardTitle className="text-lg leading-tight text-white">{featuredMilhao.title}</CardTitle>
                <CardDescription className="text-sm text-white/75 line-clamp-2">
                  {featuredMilhao.description || tr("dashboard.quizFallbackDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button
                  className="w-full h-9 text-sm"
                  variant="secondary"
                  onClick={() => navigate(`/challenge/${featuredMilhao.id}`)}
                >
                  {completedChallengeIds.has(featuredMilhao.id) ? tr("dashboard.quizViewAgain") : tr("dashboard.quizStartNow")}
                </Button>
              </CardContent>
            </Card>
          </section>
        )}

        {activeQuizzes.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3 text-foreground">
              <Zap className="h-5 w-5 text-blue-300" />
              <h2 className="text-2xl font-semibold leading-tight">Quizzes vigentes</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeQuizzes.map((quiz) => {
                const completed = completedChallengeIds.has(quiz.id);
                const totalQuestions = quizQuestionCounts[quiz.id] || 0;
                return (
                  <Card key={quiz.id} className="hover:shadow-lg transition-shadow">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">Quiz</Badge>
                          <Badge className="text-[10px]" variant="secondary">{typeDomain(quiz.type)}</Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {completed && (
                            <Badge variant="secondary" className="text-[10px]">
                              {tr("dashboard.quizCompleted")}
                            </Badge>
                          )}
                          <span className="text-xs font-semibold text-accent">
                            {quiz.reward_mode === 'tier_steps'
                              ? `+${quiz.reward_tier_steps || 1} patamar(es)`
                              : `+${quiz.xp_reward} XP`}
                          </span>
                        </div>
                      </div>
                      <CardTitle className="text-base leading-tight">{quiz.title}</CardTitle>
                      <CardDescription className="text-xs line-clamp-2">{quiz.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      {totalQuestions > 0 && (
                        <p className="text-[10px] text-muted-foreground mb-2">
                          {totalQuestions} perguntas
                        </p>
                      )}
                      <Button
                        className="w-full h-9 text-sm"
                        variant="game"
                        onClick={() => navigate(`/challenge/${quiz.id}`)}
                      >
                        {completed ? tr("dashboard.quizViewAgain") : tr("dashboard.quizStartNow")}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

	        <section>
	          <div className="flex items-center gap-2 mb-3 text-foreground">
	            <Target className="h-5 w-5 text-primary" />
	            <h2 className="text-2xl font-semibold leading-tight">{tr("dashboard.campaignsTitle")}</h2>
	          </div>
	          <div className="mb-3 space-y-2">
	            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
	              <Input
	                placeholder="Buscar campanha (nome/objetivo)…"
	                value={campaignSearch}
	                onChange={(e) => setCampaignSearch(e.target.value)}
	                className="sm:max-w-md"
	              />
	              <div className="flex flex-wrap items-center gap-2">
	                <Button
	                  type="button"
	                  size="sm"
	                  variant={campaignStatusFilter === "active" ? "secondary" : "outline"}
	                  onClick={() => setCampaignStatusFilter("active")}
	                >
	                  Ativas
	                </Button>
	                <Button
	                  type="button"
	                  size="sm"
	                  variant={campaignStatusFilter === "closed" ? "secondary" : "outline"}
	                  onClick={() => setCampaignStatusFilter("closed")}
	                >
	                  Encerradas
	                </Button>
	                <Button
	                  type="button"
	                  size="sm"
	                  variant={campaignStatusFilter === "all" ? "secondary" : "outline"}
	                  onClick={() => setCampaignStatusFilter("all")}
	                >
	                  Todas
	                </Button>
	              </div>
	            </div>
	            <div className="grid gap-2 sm:grid-cols-3">
	              <Input
	                placeholder="Filtrar por tag…"
	                value={campaignTag}
	                onChange={(e) => setCampaignTag(e.target.value)}
	              />
	              <Input type="date" value={campaignDateStart} onChange={(e) => setCampaignDateStart(e.target.value)} />
	              <Input type="date" value={campaignDateEnd} onChange={(e) => setCampaignDateEnd(e.target.value)} />
	            </div>
	            <div className="text-[11px] text-muted-foreground">
	              {filteredCampaigns.length} campanha(s)
	            </div>
	          </div>
	          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
	            {filteredCampaigns.map((campaign) => {
	              const status = getCampaignStatus(campaign);
	              const stats = campaignStats?.[campaign.id];
	              const totalActions = Number(stats?.total || 0);
	              const approvedActions = Number(stats?.approved || 0);
	              const lastAt = stats?.last_event_at ? new Date(stats.last_event_at) : null;
	              const lastLabel = lastAt ? lastAt.toLocaleDateString(locale, { day: "2-digit", month: "short" }) : "—";
	              const start = campaign.start_date ? new Date(campaign.start_date) : null;
	              const end = campaign.end_date ? new Date(campaign.end_date) : null;
	              const periodLabel =
	                start && end
	                  ? `${start.toLocaleDateString(locale, { day: "2-digit", month: "short" })} - ${end.toLocaleDateString(locale, { day: "2-digit", month: "short" })}`
	                  : start
	                    ? `${start.toLocaleDateString(locale, { day: "2-digit", month: "short" })} - —`
	                    : end
	                      ? `— - ${end.toLocaleDateString(locale, { day: "2-digit", month: "short" })}`
	                      : "Período não informado";

	              return (
	              <Card
	                key={campaign.id}
	                className="hover:shadow-lg transition-shadow bg-white/5 border border-white/20 text-white backdrop-blur-md"
	              >
	                <CardHeader className="pb-3 space-y-2">
	                  <div className="flex items-center justify-between gap-2">
	                    <div className="flex flex-wrap items-center gap-2">
	                      <Badge variant="outline" className="w-fit text-[11px] uppercase tracking-wide border-white/50 text-white">
	                        {campaign.narrative_tag || "Campanha"}
	                      </Badge>
	                      <Badge
	                        variant={status === "active" ? "secondary" : "outline"}
	                        className="w-fit text-[10px] uppercase tracking-wide"
	                      >
	                        {status === "active" ? "Ativa" : "Encerrada"}
	                      </Badge>
	                    </div>
	                    <Button
	                      size="icon"
	                      variant="ghost"
	                      className="h-8 w-8 text-white/90 hover:text-white"
	                      onClick={() => {
                        const url = buildAbsoluteAppUrl(`/campaign/${encodeURIComponent(campaign.id)}`);
                        openWhatsAppShare({
                          message: tr("dashboard.campaignShareMessage", { title: campaign.title }),
                          url,
                        });
                      }}
                      title={tr("dashboard.shareWhatsApp")}
	                    >
	                      <Share2 className="h-4 w-4" />
	                    </Button>
	                  </div>
	                  <CardTitle className="text-lg leading-tight text-white">{campaign.title}</CardTitle>
	                  <CardDescription className="text-sm text-white/75 line-clamp-2">{campaign.description || "—"}</CardDescription>
	                </CardHeader>
	                <CardContent className="pt-0">
	                  <p className="text-xs text-white/70">{periodLabel}</p>
	                  <p className="text-[11px] text-white/70 mt-1 mb-2">
	                    Ações: {totalActions} • Aprovadas: {approvedActions} • Última: {lastLabel}
	                  </p>
	                  <Button
	                    className="w-full h-9 text-sm"
	                    variant="secondary"
	                    onClick={() => navigate(`/campaign/${campaign.id}`)}
	                  >
	                    {tr("dashboard.campaignDetails")}
	                  </Button>
	                </CardContent>
	              </Card>
	              );
	            })}
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
                      <span className="text-xs font-semibold text-accent">
                        {challenge.reward_mode === 'tier_steps'
                          ? `+${challenge.reward_tier_steps || 1} patamar(es)`
                          : `+${challenge.xp_reward} XP`}
                      </span>
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
  
