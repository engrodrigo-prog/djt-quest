import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trophy, Users, TrendingUp, MessageSquare, Target, Award, Shield, Zap, Plus, Minus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TeamTierProgressCard } from "@/components/TeamTierProgressCard";
import { ProfileDropdown } from "@/components/ProfileDropdown";
import { fetchTeamNames } from "@/lib/teamLookup";
import { getActiveLocale } from "@/lib/i18n/activeLocale";
import { DJT_TEAM_GROUP_IDS, isDjtTeamAggregateBaseId } from "@/lib/constants/points";

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

type Scope = 'team' | 'coord' | 'division';
type HierarchySort = 'ranking' | 'name';

type CoordinationRow = { id: string; name: string };
type TeamRow = { id: string; name: string; coordination_id: string };
type MemberRow = { id: string; name: string; xp: number; tier: string; team_id: string | null; coord_id: string | null; sigla_area?: string | null; operational_base?: string | null };
type TeamNode = { id: string; name: string; members: MemberRow[]; totalXp: number };
type CoordinationNode = { id: string; name: string; teams: TeamNode[]; totalXp: number; memberCount: number };
const GUEST_TEAM_ID = "CONVIDADOS";
const isGuestValue = (value?: string | null) => String(value || "").trim().toUpperCase() === GUEST_TEAM_ID;

export default function LeaderDashboard() {
  const { user, profile, orgScope, signOut } = useAuth() as any;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [teamStats, setTeamStats] = useState<TeamStats | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignPerformance[]>([]);
  const [challenges, setChallenges] = useState<ChallengePerformance[]>([]);
  // Desafios agora são tratados via campanhas/fóruns; aba de desafios fica oculta na UI.
  const showChallengesTab = false;
  const [forums, setForums] = useState<ForumTopic[]>([]);
  const [topMembers, setTopMembers] = useState<TeamMember[]>([]);
  const [userProfile, setUserProfile] = useState<{
    name: string;
    avatar_url: string | null;
    avatar_thumbnail_url?: string | null;
    team: { name: string } | null;
    tier: string;
    matricula?: string | null;
    email?: string | null;
  } | null>(null);
  // Por padrão, líder não entra na soma do time (regras do jogo).
  // Para testes do admin (601555), é possível incluir o líder nos cálculos localmente.
  const [includeLeadersInTeamStats, setIncludeLeadersInTeamStats] = useState<boolean>(() => {
    try {
      return localStorage.getItem('team_stats_include_leaders') === '1';
    } catch {
      return false;
    }
  });
  const [scope, setScope] = useState<Scope>('team');
  const [windowSel, setWindowSel] = useState<'30d' | '90d' | '365d'>('30d');
  const [xpPossible, setXpPossible] = useState<number>(0);
  const [xpAchieved, setXpAchieved] = useState<number>(0);
  const [hierarchySort, setHierarchySort] = useState<HierarchySort>('ranking');
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [hierarchy, setHierarchy] = useState<CoordinationNode[]>([]);
  const [expandedCoordIds, setExpandedCoordIds] = useState<Record<string, boolean>>({});
  const teamId = orgScope?.teamId;
  const coordId = orgScope?.coordId;
  const divisionId = orgScope?.divisionId;
  const canSeeHierarchy = Boolean(divisionId);

  const loadUserProfile = useCallback(async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from("profiles")
      .select("name, tier, avatar_url, avatar_thumbnail_url, team_id, matricula, email")
      .eq("id", user.id)
      .single();
    
    if (error) {
      console.warn('LeaderDashboard: perfil indisponível', error.message);
    }

    if (data) {
      let teamName: string | null = null;
      if (data.team_id) {
        const map = await fetchTeamNames([data.team_id]);
        teamName = map[data.team_id] || null;
      }
      setUserProfile({
        ...data,
        avatar_thumbnail_url: (data as any)?.avatar_thumbnail_url || null,
        team: teamName ? { name: teamName } : null,
      } as any);
    }
  }, [user]);

  const loadTeamStats = useCallback(async () => {
    const scopeFilter = scope === 'team' ? { col: 'team_id', val: teamId }
      : scope === 'coord' ? { col: 'coord_id', val: coordId }
      : { col: 'division_id', val: divisionId };

    if (!scopeFilter.val) {
      setTeamStats(null);
      return;
    }

    let membersQuery = (supabase as any)
      .from('profiles')
      .select('xp, id')
      .eq(scopeFilter.col as any, scopeFilter.val as any);
    if (!includeLeadersInTeamStats) {
      membersQuery = membersQuery.eq('is_leader', false);
    }

    const { data: members } = await membersQuery;

    if (members) {
      const totalMembers = members.length;
      const totalXP = members.reduce((sum, m) => sum + (m.xp || 0), 0);
      const avgXP = totalMembers > 0 ? Math.floor(totalXP / totalMembers) : 0;

      const engagementRate = 85;

      let rankPosition = 0;
      if (scope === 'team' && teamId) {
        const { data: rankings } = await supabase
          .from('team_xp_summary')
          .select('*')
          .order('total_xp', { ascending: false });
        rankPosition = (rankings?.findIndex(r => r.team_id === teamId) ?? -1) + 1 || 0;
      }

      setTeamStats({
        total_members: totalMembers,
        avg_xp: avgXP,
        total_xp: totalXP,
        engagement_rate: engagementRate,
        rank_position: rankPosition
      });
    }
  }, [coordId, divisionId, scope, teamId, includeLeadersInTeamStats]);

  const loadCampaigns = useCallback(async () => {
    if (!teamId) {
      setCampaigns([]);
      return;
    }

    const { data } = await supabase
      .from('team_campaign_performance')
      .select('*')
      .eq('team_id', teamId);

    if (data) {
      setCampaigns(data);
    }
  }, [teamId]);

  const loadChallenges = useCallback(async () => {
    if (!teamId) {
      setChallenges([]);
      return;
    }

    const { data } = await supabase
      .from('team_challenge_performance')
      .select('*')
      .eq('team_id', teamId)
      .order('adhesion_percentage', { ascending: false })
      .limit(5);

    if (data) {
      setChallenges(data);
    }
  }, [teamId]);

  const loadForums = useCallback(async () => {
    if (!teamId) {
      setForums([]);
      return;
    }

    const { data: memberIds } = await supabase
      .from('profiles')
      .select('id')
      .eq('team_id', teamId);

    if (memberIds && memberIds.length > 0) {
      const { data } = await supabase
        .from('forum_topics')
        .select('id, title, posts_count, last_post_at, title_translations')
        .eq('is_active', true)
        .order('last_post_at', { ascending: false })
        .limit(5);

      if (data) {
        setForums(data);
      }
    } else {
      setForums([]);
    }
  }, [teamId]);

  const loadTopMembers = useCallback(async () => {
    const scopeCol = scope === "team" ? "team_id" : scope === "coord" ? "coord_id" : "division_id";
    const scopeVal = scope === "team" ? teamId : scope === "coord" ? coordId : divisionId;

    if (!scopeVal) {
      setTopMembers([]);
      return;
    }

    const isLeaderProfile = (p: any) => Boolean(p?.is_leader) || Boolean(p?.studio_access);
    const computeBaseXp = (b: any) => {
      const quizXp = Number(b?.quiz_xp || 0);
      const initiativesXp = Number(b?.initiatives_xp || 0);
      const quizPublishXp = Number(b?.quiz_publish_xp || 0);
      const forumXp = Number(b?.forum_posts || 0) * 10;
      const sepbookXp =
        Number(b?.sepbook_photo_count || 0) * 5 +
        Number(b?.sepbook_comments || 0) * 2 +
        Number(b?.sepbook_likes || 0);
      const evalXp = Number(b?.evaluations_completed || 0) * 5;
      return quizXp + initiativesXp + quizPublishXp + forumXp + sepbookXp + evalXp;
    };

    const baseQuery = (supabase as any)
      .from("profiles")
      .select("id, name, xp, tier, is_leader, studio_access, team_id, coord_id, division_id");

    let q = baseQuery;
    if (scope === "team" && isDjtTeamAggregateBaseId(teamId)) {
      q = q.in("team_id", Array.from(DJT_TEAM_GROUP_IDS));
    } else {
      q = q.eq(scopeCol as any, scopeVal as any);
    }
    if (!includeLeadersInTeamStats) {
      q = q.eq("is_leader", false);
    }

    // When leaders are included, rank by computed total XP instead of raw profiles.xp.
    if (includeLeadersInTeamStats) {
      const { data } = await q.limit(2000);
      const rows = Array.isArray(data) ? data : [];
      const ids = rows.map((r: any) => r?.id).filter(Boolean);
      let breakdownById: Record<string, any> = {};
      try {
        const { data: br, error } = await supabase.rpc("user_points_breakdown", { _user_ids: ids } as any);
        if (error) throw error;
        breakdownById = (Array.isArray(br) ? br : []).reduce<Record<string, any>>((acc, b: any) => {
          const uid = String(b?.user_id || "");
          if (!uid) return acc;
          acc[uid] = b;
          return acc;
        }, {});
      } catch {
        breakdownById = {};
      }

      const scored = rows
        .map((p: any) => {
          const isLeader = isLeaderProfile(p);
          const b = breakdownById[String(p.id)];
          const baseXp = b ? computeBaseXp(b) : Number(p?.xp || 0);
          const points = baseXp;
          return { ...p, xp: points, is_leader: isLeader };
        })
        .sort((a: any, b: any) => (b.xp || 0) - (a.xp || 0) || String(a.name || "").localeCompare(String(b.name || "")));
      setTopMembers(scored.slice(0, 5));
      return;
    }

    const { data } = await q.order("xp", { ascending: false }).limit(5);
    if (data) setTopMembers(data);
  }, [coordId, divisionId, scope, teamId, includeLeadersInTeamStats]);

  const loadDivisionHierarchy = useCallback(async () => {
    if (!divisionId) {
      setHierarchy([]);
      return;
    }

    setHierarchyLoading(true);
    setHierarchyError(null);

    try {
      const { data: coordRows, error: coordErr } = await supabase
        .from("coordinations")
        .select("id, name")
        .eq("division_id", divisionId)
        .order("name", { ascending: true });
      if (coordErr) throw coordErr;

      const coordList = (coordRows || []) as CoordinationRow[];
      const coordIds = coordList.map((c) => String(c.id));

      const { data: teamRows, error: teamErr } = await supabase
        .from("teams")
        .select("id, name, coordination_id")
        .in("coordination_id", coordIds.length ? coordIds : ["00000000-0000-0000-0000-000000000000"])
        .order("name", { ascending: true });
      if (teamErr) throw teamErr;

      const teamList = (teamRows || []) as TeamRow[];
      const teamById = new Map<string, TeamRow>();
      for (const t of teamList) teamById.set(String(t.id), t);

      const { data: memberRows, error: memberErr } = await (supabase as any)
        .from("profiles")
        .select("id, name, xp, tier, team_id, coord_id, sigla_area, operational_base")
        .eq("division_id", divisionId)
        .eq("is_leader", false);
      if (memberErr) throw memberErr;

      const members = (memberRows || []) as MemberRow[];

      const nodeByCoord = new Map<string, CoordinationNode>();
      for (const c of coordList) {
        nodeByCoord.set(String(c.id), {
          id: String(c.id),
          name: String(c.name || "").trim() || "Coordenação",
          teams: [],
          totalXp: 0,
          memberCount: 0,
        });
      }

      const unknownCoordId = "unknown";
      nodeByCoord.set(unknownCoordId, {
        id: unknownCoordId,
        name: "Sem coordenação",
        teams: [],
        totalXp: 0,
        memberCount: 0,
      });

      const guestCoordId = "guest";
      nodeByCoord.set(guestCoordId, {
        id: guestCoordId,
        name: "Convidados",
        teams: [],
        totalXp: 0,
        memberCount: 0,
      });

      const ensureTeamNode = (coordNode: CoordinationNode, teamId: string, teamName: string) => {
        const existing = coordNode.teams.find((t) => t.id === teamId);
        if (existing) return existing;
        const next: TeamNode = { id: teamId, name: teamName, members: [], totalXp: 0 };
        coordNode.teams.push(next);
        return next;
      };

      for (const m of members) {
        const id = String((m as any)?.id);
        const name = String((m as any)?.name || "").trim() || "Sem nome";
        const xp = Number((m as any)?.xp || 0);
        const tier = String((m as any)?.tier || "").trim() || "";
        const team_id = (m as any)?.team_id ? String((m as any).team_id) : null;
        const coord_id = (m as any)?.coord_id ? String((m as any).coord_id) : null;
        const isGuest = isGuestValue((m as any)?.sigla_area) || isGuestValue((m as any)?.operational_base) || isGuestValue(team_id);

        const fallbackCoord = team_id ? String(teamById.get(team_id)?.coordination_id || "") : "";
        const resolvedCoordId = isGuest ? guestCoordId : (coord_id || fallbackCoord || unknownCoordId);
        const coordNode = nodeByCoord.get(resolvedCoordId) || nodeByCoord.get(unknownCoordId)!;

        const resolvedTeamName = (() => {
          if (isGuest) return "Convidados";
          if (!team_id) return "Sem equipe";
          const t = teamById.get(team_id);
          return String(t?.name || "").trim() || "Equipe";
        })();

        const teamNode = ensureTeamNode(coordNode, isGuest ? GUEST_TEAM_ID : (team_id || "none"), resolvedTeamName);
        teamNode.members.push({ id, name, xp, tier, team_id, coord_id });
        teamNode.totalXp += xp;
        coordNode.totalXp += xp;
        coordNode.memberCount += 1;
      }

      const nodes = Array.from(nodeByCoord.values())
        .filter((c) => c.memberCount > 0)
        .sort((a, b) => a.name.localeCompare(b.name));

      setHierarchy(nodes);
    } catch (e: any) {
      setHierarchy([]);
      setHierarchyError(e?.message || "Não foi possível carregar a hierarquia.");
    } finally {
      setHierarchyLoading(false);
    }
  }, [divisionId]);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const requiredVal = scope === 'team' ? teamId : scope === 'coord' ? coordId : divisionId;
      if (!requiredVal) {
        setTeamStats(null);
        setCampaigns([]);
        setChallenges([]);
        setForums([]);
        setTopMembers([]);
        return;
      }

      const jobs: Promise<any>[] = [loadTeamStats(), loadForums(), loadTopMembers()];
      if (scope === 'team') {
        // Apenas no escopo de equipe fazem sentido os painéis por time
        jobs.push(loadCampaigns());
        jobs.push(loadChallenges());
      }
      await Promise.all(jobs);

      // XP possível vs atingido (janela temporal) — calculado no DB para evitar divergências/paginação.
      const now = new Date();
      const msBack = windowSel === '30d' ? 30*24*60*60*1000 : windowSel === '90d' ? 90*24*60*60*1000 : 365*24*60*60*1000;
      const start = new Date(now.getTime() - msBack);
      const startIso = start.toISOString();
      const endIso = now.toISOString();
      const leaderMult = includeLeadersInTeamStats ? 1 : 0;

      try {
	        if (scope === 'team' && teamId) {
	          const { data, error } = await supabase.rpc('team_adherence_window_v2', { _start: startIso, _end: endIso, _leader_multiplier: leaderMult } as any);
	          if (error) throw error;
	          const rows = Array.isArray(data) ? data : [];
	          const teamIds = isDjtTeamAggregateBaseId(teamId) ? Array.from(DJT_TEAM_GROUP_IDS) : [String(teamId)];
	          const picked = rows.filter((r: any) => teamIds.includes(String(r?.team_id || "")));
	          const possible = picked.reduce((s: number, r: any) => s + (Number(r?.possible || 0) || 0), 0);
	          const achieved = picked.reduce((s: number, r: any) => s + (Number(r?.achieved || 0) || 0), 0);
	          setXpPossible(possible);
	          setXpAchieved(achieved);
	        } else if (scope === 'coord' && coordId) {
          const { data, error } = await supabase.rpc('coord_adherence_window_v2', { _start: startIso, _end: endIso, _coord_id: coordId, _leader_multiplier: leaderMult } as any);
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : null;
          setXpPossible(Number(row?.possible || 0));
          setXpAchieved(Number(row?.achieved || 0));
        } else if (scope === 'division' && divisionId) {
          const { data, error } = await supabase.rpc('division_adherence_window_v2', { _start: startIso, _end: endIso, _leader_multiplier: leaderMult } as any);
          if (error) throw error;
          const row = (Array.isArray(data) ? data : []).find((r: any) => String(r?.division_id) === String(divisionId));
          setXpPossible(Number(row?.possible || 0));
          setXpAchieved(Number(row?.achieved || 0));
        } else {
          setXpPossible(0);
          setXpAchieved(0);
        }
      } catch (e) {
        console.warn('LeaderDashboard: falha ao carregar XP possível/atingido via RPC', e);
        setXpPossible(0);
        setXpAchieved(0);
      }
    } catch (error) {
      console.error("Error loading dashboard:", error);
    } finally {
      setLoading(false);
    }
  }, [coordId, divisionId, loadCampaigns, loadChallenges, loadForums, loadTeamStats, loadTopMembers, scope, teamId, windowSel, includeLeadersInTeamStats]);

  useEffect(() => {
    try {
      localStorage.setItem('team_stats_include_leaders', includeLeadersInTeamStats ? '1' : '0');
    } catch {
      // ignore
    }
  }, [includeLeadersInTeamStats]);

  useEffect(() => {
    loadDashboardData();
    loadUserProfile();
  }, [loadDashboardData, loadUserProfile]);

  useEffect(() => {
    if (!canSeeHierarchy) return;
    loadDivisionHierarchy();
  }, [canSeeHierarchy, loadDivisionHierarchy]);

  const sortedHierarchy = useMemo(() => {
    const sortMembers = (a: MemberRow, b: MemberRow) => {
      if (hierarchySort === "name") {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        return b.xp - a.xp;
      }
      const byXp = b.xp - a.xp;
      if (byXp !== 0) return byXp;
      return a.name.localeCompare(b.name);
    };

    return hierarchy.map((coord) => {
      const teams = coord.teams
        .map((t) => ({
          ...t,
          members: [...t.members].sort(sortMembers),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ...coord, teams };
    });
  }, [hierarchy, hierarchySort]);

  const toggleCoordExpanded = (coordId: string) => {
    setExpandedCoordIds((prev) => ({ ...prev, [coordId]: !prev?.[coordId] }));
  };

  const expandAllCoordinations = () => {
    const next: Record<string, boolean> = {};
    for (const c of sortedHierarchy) next[c.id] = true;
    setExpandedCoordIds(next);
  };

  const collapseAllCoordinations = () => {
    setExpandedCoordIds({});
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-40">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-[#0b2a34]/85 text-blue-50 border-b border-cyan-700/30 backdrop-blur">
        <div className="container mx-auto px-3 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/leader-dashboard')}
            className="flex items-center gap-2 group focus:outline-none"
          >
            <div className="flex items-center gap-1.5">
              <Shield className="h-6 w-6 text-primary" />
              <Zap className="h-6 w-6 text-secondary" />
            </div>
            <div className="text-left">
              <p className="text-xl font-semibold leading-tight text-blue-50 group-hover:text-white">
                DJT - Quest
              </p>
              <p className="text-[10px] text-blue-100/80 leading-none">
                CPFL Piratininga e Santa Cruz Subtransmissão
              </p>
            </div>
          </button>
          <div className="flex items-center gap-2">
            {userProfile && (
              <ProfileDropdown
                profile={userProfile}
                isLeader={true}
                onSignOut={handleSignOut}
              />
            )}
            <Button onClick={() => navigate('/dashboard')} variant="ghost" size="sm" aria-label="Entrar">
              Entrar
            </Button>
            <Button onClick={() => navigate('/studio')} variant="ghost" size="sm">
              <Award className="h-4 w-4 mr-2" />
              Studio
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 py-4 space-y-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-3xl font-semibold leading-tight">Dashboard de Liderança</h2>
            <p className="text-sm text-muted-foreground">
              XP agregado do seu escopo ({scope === 'team' ? 'Equipe' : scope === 'coord' ? 'Coordenação' : 'Divisão'})
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Atuando como: {orgScope?.divisionName || '—'}{orgScope?.coordName ? ` • ${orgScope.coordName}` : ''}{orgScope?.teamName ? ` • ${orgScope.teamName}` : ''}
            </p>
          </div>
          <div className="flex gap-2 w-full md:w-auto">
            <div className="w-full md:w-48">
              <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
                <SelectTrigger aria-label="Selecionar Escopo">
                  <SelectValue placeholder="Selecionar escopo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Minha Equipe</SelectItem>
                  <SelectItem value="coord">Minha Coordenação</SelectItem>
                  <SelectItem value="division">Minha Divisão</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full md:w-40">
              <Select value={windowSel} onValueChange={(v) => setWindowSel(v as any)}>
                <SelectTrigger aria-label="Janela de tempo">
                  <SelectValue placeholder="Janela" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30d">30 dias</SelectItem>
                  <SelectItem value="90d">Trimestre</SelectItem>
                  <SelectItem value="365d">Ano</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(userProfile?.matricula === '601555' ||
              (userProfile?.email || '').toLowerCase() === 'rodrigonasc@cpfl.com.br') && (
              <Button
                type="button"
                size="sm"
                variant={includeLeadersInTeamStats ? 'secondary' : 'outline'}
                onClick={() => setIncludeLeadersInTeamStats((v) => !v)}
                className="gap-2"
              >
                {includeLeadersInTeamStats ? 'Teste: líder conta' : 'Teste: líder não conta'}
              </Button>
            )}
          </div>
        </div>

      {/* XP Possível x Atingido */}
        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold leading-tight text-white">XP possível vs XP atingido</CardTitle>
            <CardDescription className="text-white/80">
              Janela: {windowSel === '30d' ? 'últimos 30 dias' : windowSel === '90d' ? 'últimos 90 dias' : 'últimos 12 meses'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-2 text-sm">
              <span className="text-white/70">Possível</span>
              <span className="font-semibold text-white">{xpPossible} XP</span>
            </div>
            <Progress value={xpPossible ? Math.min(100, Math.round((xpAchieved / Math.max(1, xpPossible)) * 100)) : 0} className="h-2" />
            <div className="flex items-center justify-between mt-2 text-sm">
              <span className="text-white/70">Atingido</span>
              <span className="font-semibold text-white">{xpAchieved} XP</span>
            </div>
          </CardContent>
        </Card>

        {/* Estatísticas Gerais */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold leading-tight text-white">Colaboradores ({scope === 'team' ? 'Equipe' : scope === 'coord' ? 'Coord.' : 'Div.'})</CardTitle>
            <Users className="h-4 w-4 text-white/70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{teamStats?.total_members || 0}</div>
            <p className="text-xs text-white/70">
              Membros da equipe
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold leading-tight text-white">Ranking (Equipe)</CardTitle>
            <Trophy className="h-4 w-4 text-white/70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{scope === 'team' && teamStats?.rank_position ? `#${teamStats.rank_position}` : '-'}</div>
            <p className="text-xs text-white/70">
              {scope === 'team' ? 'Posição geral' : 'Não aplicável neste escopo'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-lg font-semibold leading-tight text-white">Engajamento</CardTitle>
            <Target className="h-4 w-4 text-white/70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{teamStats?.engagement_rate || 0}%</div>
            <p className="text-xs text-white/70">
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
          {showChallengesTab && <TabsTrigger value="challenges">Desafios</TabsTrigger>}
          <TabsTrigger value="forums">Fóruns</TabsTrigger>
          <TabsTrigger value="team">Top 5 da Equipe</TabsTrigger>
          {canSeeHierarchy && <TabsTrigger value="hierarchy">Hierarquia</TabsTrigger>}
        </TabsList>

        <TabsContent value="campaigns" className="space-y-4">
          <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
            <CardHeader>
              <CardTitle className="text-white">Campanhas Vigentes</CardTitle>
              <CardDescription className="text-white/80">
                Acompanhe a adesão e conclusão das campanhas ativas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {campaigns.length === 0 ? (
                <p className="text-white/70 text-center py-8">
                  Nenhuma campanha ativa no momento
                </p>
              ) : (
                campaigns.map((campaign) => (
                  <div key={campaign.campaign_id} className="space-y-2 p-4 border border-white/30 rounded-lg bg-white/5">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-white">{campaign.campaign_title}</h3>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="border-white/50 text-white">
                          Adesão: {campaign.adhesion_percentage?.toFixed(0) || 0}%
                        </Badge>
                        <Badge variant="outline" className="border-white/50 text-white">
                          Conclusão: {campaign.completion_percentage?.toFixed(0) || 0}%
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-white/70">
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

        {showChallengesTab && (
          <TabsContent value="challenges" className="space-y-4">
            <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
              <CardHeader>
                <CardTitle className="text-white">Desafios Vigentes</CardTitle>
                <CardDescription className="text-white/80">
                  Performance da equipe nos desafios ativos
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {challenges.length === 0 ? (
                  <p className="text-white/70 text-center py-8">
                    Nenhum desafio ativo no momento
                  </p>
                ) : (
                  challenges.map((challenge) => (
                    <div key={challenge.challenge_id} className="space-y-2 p-4 border border-white/30 rounded-lg bg-white/5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-white">{challenge.challenge_title}</h3>
                          <p className="text-sm text-white/70 capitalize">
                            {challenge.challenge_type}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="border-white/50 text-white">
                            {challenge.adhesion_percentage?.toFixed(0) || 0}% adesão
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm text-white/80">
                          <span>Participantes: {challenge.participants_count}</span>
                          <span>Concluíram: {challenge.completion_percentage?.toFixed(0) || 0}%</span>
                        </div>
                        <Progress value={challenge.adhesion_percentage || 0} />
                        {challenge.avg_xp_earned > 0 && (
                          <p className="text-sm text-white/70">
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
        )}

        <TabsContent value="forums" className="space-y-4">
          <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
            <CardHeader>
              <CardTitle className="text-white">Fóruns Ativos</CardTitle>
              <CardDescription className="text-white/80">
                Últimos tópicos com atividade
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {forums.length === 0 ? (
                <p className="text-white/70 text-center py-8">
                  Nenhum fórum ativo
                </p>
              ) : (
                forums.map((forum) => {
                  const displayTitle = (forum as any)?.title_translations?.[getActiveLocale()] || forum.title;
                  return (
                    <div 
                      key={forum.id} 
                      className="flex items-center justify-between p-3 border border-white/30 rounded-lg hover:bg-white/10 cursor-pointer transition-colors"
                      onClick={() => navigate(`/forum/${forum.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <MessageSquare className="h-4 w-4 text-white/70" />
                        <div>
                          <p className="font-medium text-white">{displayTitle}</p>
                          <p className="text-sm text-white/70">
                            {forum.posts_count} posts
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className="border-white/50 text-white">
                        {new Date(forum.last_post_at).toLocaleDateString(getActiveLocale())}
                      </Badge>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="space-y-4">
          <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
            <CardHeader>
              <CardTitle className="text-white">Top 5 da Equipe</CardTitle>
              <CardDescription className="text-white/80">
                Colaboradores com maior XP
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {topMembers.length === 0 ? (
                <p className="text-white/70 text-center py-8">
                  Nenhum membro cadastrado
                </p>
              ) : (
                topMembers.map((member, index) => (
                  <div key={member.id} className="flex items-center justify-between p-3 border border-white/30 rounded-lg bg-white/5">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium text-white">{member.name}</p>
                        <p className="text-sm text-white/70">{member.tier}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="border-white/50 text-white">{member.xp} XP</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {canSeeHierarchy && (
          <TabsContent value="hierarchy" className="space-y-4">
            <Card className="bg-white/5 border border-white/20 text-white backdrop-blur-md shadow-lg">
              <CardHeader className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-white">Hierarquia da Divisão</CardTitle>
                    <CardDescription className="text-white/80">
                      Coordenações e colaboradores (exclui líderes) • expanda com “+”
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={hierarchySort} onValueChange={(v) => setHierarchySort(v as any)}>
                      <SelectTrigger className="h-9 w-[160px] bg-white/5 border-white/20 text-white">
                        <SelectValue placeholder="Ordenar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ranking">Ordenar por ranking</SelectItem>
                        <SelectItem value="name">Ordenar por nome</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-9 border-white/30 text-white" onClick={expandAllCoordinations}>
                      Expandir tudo
                    </Button>
                    <Button size="sm" variant="outline" className="h-9 border-white/30 text-white" onClick={collapseAllCoordinations}>
                      Recolher
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {hierarchyLoading ? (
                  <p className="text-white/70">Carregando…</p>
                ) : hierarchyError ? (
                  <p className="text-white/70">{hierarchyError}</p>
                ) : sortedHierarchy.length === 0 ? (
                  <p className="text-white/70">Nenhuma coordenação encontrada para esta divisão.</p>
                ) : (
                  <div className="space-y-3">
                    {sortedHierarchy.map((coord) => {
                      const open = Boolean(expandedCoordIds?.[coord.id]);
                      return (
                        <div key={coord.id} className="rounded-lg border border-white/20 bg-white/5">
                          <button
                            type="button"
                            className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/10 transition-colors"
                            onClick={() => toggleCoordExpanded(coord.id)}
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-white truncate">{coord.name}</p>
                              <p className="text-xs text-white/70">
                                {coord.memberCount} colaboradores • {coord.totalXp} XP
                              </p>
                            </div>
                            <div className="shrink-0">
                              {open ? <Minus className="h-5 w-5 text-white/80" /> : <Plus className="h-5 w-5 text-white/80" />}
                            </div>
                          </button>

                          {open && (
                            <div className="px-3 pb-3 space-y-3">
                              {coord.teams.length === 0 ? (
                                <p className="text-sm text-white/70">Sem equipes cadastradas.</p>
                              ) : (
                                coord.teams.map((team) => (
                                  <div key={team.id} className="rounded-md border border-white/10 bg-black/20">
                                    <div className="flex items-center justify-between px-3 py-2">
                                      <p className="text-sm font-semibold text-white truncate">{team.name}</p>
                                      <Badge variant="outline" className="border-white/30 text-white">
                                        {team.members.length} • {team.totalXp} XP
                                      </Badge>
                                    </div>
                                    <div className="px-3 pb-2 space-y-1">
                                      {team.members.slice(0, 60).map((m, idx) => (
                                        <div key={m.id} className="flex items-center justify-between gap-3 text-sm text-white/90">
                                          <div className="min-w-0 flex items-center gap-2">
                                            <span className="text-xs text-white/50 w-6">{hierarchySort === "ranking" ? `#${idx + 1}` : ""}</span>
                                            <span className="truncate">{m.name}</span>
                                            {m.tier ? (
                                              <span className="text-[11px] text-white/60 truncate">{m.tier}</span>
                                            ) : null}
                                          </div>
                                          <span className="shrink-0 text-xs text-white/70">{m.xp} XP</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
      </main>
    </div>
  );
}
