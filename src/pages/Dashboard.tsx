import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Shield, Zap, Trophy, Target, LogOut, Star, Menu, Filter, History, CheckCircle, ListFilter } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Navigation from "@/components/Navigation";
import { TeamPerformanceCard } from "@/components/TeamPerformanceCard";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { getTierInfo, getNextTierLevel } from "@/lib/constants/tiers";

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
  tier: string;
  avatar_url: string | null;
  team: { name: string } | null;
}

const Dashboard = () => {
  const { user, signOut, isLeader } = useAuth();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [allChallenges, setAllChallenges] = useState<Challenge[]>([]);
  const [userEvents, setUserEvents] = useState<Array<{ id: string; challenge_id: string; status: string; created_at: string }>>([]);
  const [challengeTab, setChallengeTab] = useState<'vigentes' | 'historico'>('vigentes');
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('🏠 Dashboard: user changed', user?.id);
    
    const loadData = async () => {
      if (!user) {
        console.log('🏠 Dashboard: no user, skipping load');
        return;
      }

      console.log('🏠 Dashboard: starting data load');
      
      // Safety timeout - force end loading after 5s
      const timeoutId = setTimeout(() => {
        console.error('⏱️ Dashboard: timeout reached - forcing loading to false');
        setLoading(false);
      }, 5000);

      try {
        // Parallelize all queries for faster loading
        const [profileResult, campaignsResult, challengesResult, eventsResult] = await Promise.all([
          supabase
            .from("profiles")
            .select("name, xp, tier, avatar_url, team:teams(name)")
            .eq("id", user.id)
            .single(),
          
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
            .order('created_at', { ascending: false })
        ]);

        if (profileResult.data) {
          setProfile(profileResult.data);
        }

        if (campaignsResult.data) {
          setCampaigns(campaignsResult.data);
        }

        if (challengesResult.data) {
          setAllChallenges(challengesResult.data);
        }

        if (eventsResult.data) {
          setUserEvents(eventsResult.data as any);
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

  const filteredChallenges = useMemo(() => {
    let base: Challenge[] = [];
    if (challengeTab === 'vigentes') {
      base = allChallenges;
    } else {
      const seen = new Set<string>();
      const ids = userEvents.map(e => e.challenge_id).filter(Boolean);
      base = allChallenges.filter(c => ids.includes(c.id) && (!seen.has(c.id) && seen.add(c.id)));
    }
    if (typeFilters.size === 0) return base;
    return base.filter(c => typeFilters.has((c.type || '').toLowerCase()));
  }, [challengeTab, allChallenges, userEvents, typeFilters]);

  const typeOptions = [
    { key: 'campanha', label: 'Campanha' },
    { key: 'quiz', label: 'Quiz' },
    { key: 'forum', label: 'Fórum' },
    { key: 'desafio', label: 'Desafio' }
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
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
              <p className="text-8px] text-muted-foreground leading-none">
                CPFL Piratininga e Santa Cruz Subtransmissão
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            {tierInfo && (
              <>
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span>{tierInfo.name}</span>
                  <span className="font-semibold">{profile?.xp} XP</span>
                  {nextLevel && <span className="text-muted-foreground">{nextLevel.name}</span>}
                </div>
                <Progress value={xpProgress} className="h-2.5" />
                {nextLevel && (
                  <p className="text-xs text-muted-foreground">
                    Faltam {nextLevel.xpNeeded} XP para o próximo nível
                  </p>
                )}
              </>
            )}
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
                    {new Date(campaign.start_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} -{" "}
                    {new Date(campaign.end_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                  </p>
                  <Button className="w-full h-9 text-sm" variant="default" disabled>
                    Campanha Ativa
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Challenges with filters */}
        <section>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-secondary" />
              <h2 className="text-xl font-bold">Desafios</h2>
            </div>
            <div className="flex items-center gap-2">
              <Button variant={challengeTab === 'vigentes' ? 'default' : 'outline'} size="sm" onClick={() => setChallengeTab('vigentes')} className="gap-2">
                <ListFilter className="h-4 w-4" /> Vigentes
              </Button>
              <Button variant={challengeTab === 'historico' ? 'default' : 'outline'} size="sm" onClick={() => setChallengeTab('historico')} className="gap-2">
                <History className="h-4 w-4" /> Histórico
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {typeOptions.map(opt => (
              <Button key={opt.key} size="sm" variant={typeFilters.has(opt.key) ? 'default' : 'outline'} onClick={() => toggleType(opt.key)}>
                {opt.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredChallenges.map((challenge) => (
              <Card key={challenge.id} className="hover:shadow-lg transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {challenge.type}
                      </Badge>
                      <Badge className="text-[10px]" variant="secondary">{typeDomain(challenge.type)}</Badge>
                    </div>
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
                    {challengeTab === 'historico' ? 'Ver novamente' : 'Começar'}
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

export default Dashboard;
  
