import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Navigation from '@/components/Navigation';
import { ThemedBackground } from '@/components/ThemedBackground';
import { Trophy, Users, Building2, Award, Shield, Percent } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/contexts/I18nContext';
import { getActiveLocale } from '@/lib/i18n/activeLocale';
import { UserProfilePopover } from '@/components/UserProfilePopover';
import { DJT_TEAM_GROUP_IDS, buildTeamScope, normalizeTeamId } from '@/lib/constants/points';

interface IndividualRanking {
  rank: number;
  userId: string;
  name: string;
  points: number;
  xp: number;
  level: number;
  avatarUrl: string | null;
  tier: string;
  teamName: string;
  teamId: string | null;
  coordId: string | null;
  divisionId: string | null;
  isLeader: boolean;
  isGuest: boolean;
  quizXp: number;
  initiativesXp: number;
  forumXp: number;
  sepbookXp: number;
  evaluationsXp: number;
}

interface TeamRanking {
  rank: number;
  teamId: string;
  teamName: string;
  adherencePct: number; // 0..100
  memberCount: number;
}

interface DivisionRanking {
  order: number; // display order only
  divisionId: string;
  divisionName: string;
  adherencePct: number; // 0..100
  teamCount: number;
}

interface LeaderRanking {
  rank: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  completed: number;
  quizXp: number;
  initiativesXp: number;
  forumXp: number;
  sepbookXp: number;
  baseXp: number;
  score: number;
}

interface XpBreakdown {
  quizXp: number;
  forumPosts: number;
  forumXp: number;
  sepbookPhotoCount: number;
  sepbookPostXp: number;
  sepbookComments: number;
  sepbookCommentXp: number;
  sepbookLikes: number;
  sepbookLikeXp: number;
  campaignsXp: number;
  quizPublishXp: number;
  evaluationsCompleted: number;
  evaluationsXp: number;
}

const GUEST_TEAM_ID = 'CONVIDADOS';
const isGuestTeamId = (id: string | null | undefined) => String(id || '').toUpperCase() === GUEST_TEAM_ID;
const LEADER_EVAL_POINTS = 5;

const computeBaseXpFromBreakdown = (b: any) => {
  const quizXp = Number(b?.quiz_xp || 0);
  const initiativesXp = Number(b?.initiatives_xp || 0);
  const quizPublishXp = Number(b?.quiz_publish_xp || 0);
  const forumXp = Number(b?.forum_posts || 0) * 10;
  const sepbookXp =
    Number(b?.sepbook_photo_count || 0) * 5 +
    Number(b?.sepbook_comments || 0) * 2 +
    Number(b?.sepbook_likes || 0);
  const evaluationsXp = Number(b?.evaluations_completed || 0) * LEADER_EVAL_POINTS;
  return quizXp + initiativesXp + quizPublishXp + forumXp + sepbookXp + evaluationsXp;
};

function Rankings() {
  const { orgScope } = useAuth();
  const { t: tr } = useI18n();
  const [individualRankings, setIndividualRankings] = useState<IndividualRanking[]>([]);
  const [guestRankings, setGuestRankings] = useState<IndividualRanking[]>([]);
  const [myTeamRankings, setMyTeamRankings] = useState<IndividualRanking[]>([]);
  const [teamRankings, setTeamRankings] = useState<TeamRanking[]>([]);
  const [divisionRankings, setDivisionRankings] = useState<DivisionRanking[]>([]);
  const [leaderRankings, setLeaderRankings] = useState<LeaderRanking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'individual' | 'guests' | 'myteam' | 'teams' | 'divisions' | 'leaders'>('individual');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [selectedBreakdown, setSelectedBreakdown] = useState<XpBreakdown | null>(null);

  const fetchRankings = useCallback(async () => {
    try {
      // Parallelize all queries for faster loading
      const [profilesResult, teamsResult, divisionsResult, coordsResult, eventsResult, challengesResult, evalQueueResult] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, name, xp, avatar_url, tier, team_id, coord_id, division_id, sigla_area, operational_base, is_leader, studio_access')
          .limit(1000),
        supabase
          .from('teams')
          .select('id, name, coord_id'),
        supabase
          .from('divisions')
          .select('id, name'),
        supabase
          .from('coordinations')
          .select('id, division_id'),
        supabase
          .from('events')
          .select('user_id, final_points, created_at')
          .limit(50000),
        supabase
          .from('challenges')
          .select('id, xp_reward, status, due_date, target_team_ids, target_coord_ids, target_div_ids')
          .limit(50000),
        supabase
          .from('evaluation_queue')
          .select('assigned_to, completed_at')
          .limit(50000),
      ]);

      // Process individual rankings
      if (profilesResult.error) {
        console.warn('Rankings: erro ao carregar perfis', profilesResult.error.message);
      }
      if (teamsResult.error) {
        console.warn('Rankings: erro ao carregar equipes', teamsResult.error.message);
      }
      if (divisionsResult.error) {
        console.warn('Rankings: erro ao carregar divisões', divisionsResult.error.message);
      }

      const allProfiles = profilesResult.data || [];
      const isLeaderProfile = (p: any) => Boolean(p?.is_leader || p?.studio_access);
      const isGuestProfile = (p: any) =>
        isGuestTeamId(p?.team_id) ||
        isGuestTeamId(p?.sigla_area) ||
        isGuestTeamId(p?.operational_base);

      const profilesData = allProfiles.filter((profile: any) => !isLeaderProfile(profile));
      const visibleProfiles = profilesData; // Overall rankings: include guests (filter via tab)
      let breakdownByUserId: Record<string, any> = {};
      try {
        const ids = visibleProfiles.map((p: any) => p?.id).filter(Boolean);
        const { data: rows, error: brErr } = await supabase.rpc('user_points_breakdown', { _user_ids: ids } as any);
        if (!brErr && Array.isArray(rows)) {
          breakdownByUserId = rows.reduce<Record<string, any>>((acc, r: any) => {
            const uid = String(r?.user_id || '');
            if (!uid) return acc;
            acc[uid] = r;
            return acc;
          }, {});
        }
      } catch {
        breakdownByUserId = {};
      }

      if (visibleProfiles.length) {
        const teamMap = (teamsResult.data || []).reduce<Record<string, string>>((acc, team) => {
          acc[team.id] = team.name;
          return acc;
        }, {});

        const ranked = [...visibleProfiles]
          .map((profile: any) => {
            const isLeader = isLeaderProfile(profile);
            const isGuest = isGuestProfile(profile);
            const breakdown = breakdownByUserId[String(profile.id)];
            const baseXp = breakdown ? computeBaseXpFromBreakdown(breakdown) : Number(profile.xp ?? 0);
            const points = baseXp;
            const xp = Number(profile.xp ?? 0);
            const quizXp = Number(breakdown?.quiz_xp || 0);
            const initiativesXp = Number(breakdown?.initiatives_xp || 0);
            const forumXp = Number(breakdown?.forum_posts || 0) * 10;
            const sepbookXp =
              Number(breakdown?.sepbook_photo_count || 0) * 5 +
              Number(breakdown?.sepbook_comments || 0) * 2 +
              Number(breakdown?.sepbook_likes || 0);
            const evaluationsXp = Number(breakdown?.evaluations_completed || 0) * LEADER_EVAL_POINTS;
            return {
              ...profile,
              __points: points,
              __xp: xp,
              __isLeader: isLeader,
              __isGuest: isGuest,
              __quizXp: quizXp,
              __initiativesXp: initiativesXp,
              __forumXp: forumXp,
              __sepbookXp: sepbookXp,
              __evaluationsXp: evaluationsXp,
            };
          })
          .sort((a: any, b: any) => (b.__points || 0) - (a.__points || 0) || String(a.name).localeCompare(String(b.name), getActiveLocale()))
          .map((profile, index) => {
            const points = Number((profile as any).__points ?? 0);
            const xp = Number((profile as any).__xp ?? 0);
            return {
              rank: index + 1,
              userId: profile.id,
              name: profile.name,
              points,
              xp,
              level: Math.floor(points / 100),
              avatarUrl: profile.avatar_url,
              tier: profile.tier,
              teamName: (profile as any).__isGuest
                ? 'Convidados'
                : profile.team_id
                  ? (teamMap[profile.team_id] || String(profile.team_id))
                  : 'Sem equipe',
              coordId: profile.coord_id,
              divisionId: profile.division_id,
              teamId: profile.team_id,
              isLeader: Boolean((profile as any).__isLeader),
              isGuest: Boolean((profile as any).__isGuest),
              quizXp: Number((profile as any).__quizXp ?? 0),
              initiativesXp: Number((profile as any).__initiativesXp ?? 0),
              forumXp: Number((profile as any).__forumXp ?? 0),
              sepbookXp: Number((profile as any).__sepbookXp ?? 0),
              evaluationsXp: Number((profile as any).__evaluationsXp ?? 0),
            };
          });
        setIndividualRankings(ranked);
        setGuestRankings(ranked.filter((r) => r.isGuest).map((r, i) => ({ ...r, rank: i + 1 })));

        // Filter My Team: selected team (if any) or user's team
        const baseTeamId =
          selectedTeamId ||
          (orgScope?.teamId && (!orgScope.divisionId || orgScope.teamId !== orgScope.divisionId) ? orgScope.teamId : null);
        if (baseTeamId) {
          const allTeamIds = (teamsResult.data || []).map((t: any) => String(t?.id || '')).filter(Boolean);
          const scope = buildTeamScope(baseTeamId, allTeamIds);
          // Keep the DJT special grouping (DJT + PLAN + legacy IDs) even if teams list is partial.
          if (normalizeTeamId(baseTeamId) === 'DJT') {
            Array.from(DJT_TEAM_GROUP_IDS).forEach((id) => scope.add(normalizeTeamId(id)));
          }
          const myTeam = ranked.filter((p) => {
            const tId = normalizeTeamId(p.teamId);
            return Boolean(tId) && scope.has(tId);
          });
          setMyTeamRankings(myTeam.map((p, i) => ({ ...p, rank: i + 1 })));
        } else {
          setMyTeamRankings([]);
        }
      }

      // Process team rankings
      if (teamsResult.data && coordsResult.data && challengesResult.data && eventsResult.data) {
        const teams = (teamsResult.data as Array<{ id: string; name: string; coord_id: string | null }>).filter((t) => !isGuestTeamId(t.id));
        const coordToDiv = (coordsResult.data as Array<{ id: string; division_id: string | null }>).
          reduce<Record<string, string | null>>((acc, c) => { acc[c.id] = c.division_id; return acc; }, {});

        // Build team members map (exclude leaders)
        const teamMembers = profilesData.reduce<Record<string, string[]>>((acc, p: any) => {
          const isGuest = isGuestProfile(p);
          if (isGuest) {
            if (!acc[GUEST_TEAM_ID]) acc[GUEST_TEAM_ID] = [];
            acc[GUEST_TEAM_ID].push(p.id);
            return acc;
          }
          if (!p.team_id || isGuestTeamId(p.team_id)) return acc;
          if (!acc[p.team_id]) acc[p.team_id] = [];
          acc[p.team_id].push(p.id);
          return acc;
        }, {});
        const teamsWithMembers = teams.filter((team) => (teamMembers[team.id] || []).length > 0);
        if ((teamMembers[GUEST_TEAM_ID] || []).length > 0) {
          teamsWithMembers.push({ id: GUEST_TEAM_ID, name: "Convidados", coord_id: null });
        }

        const now = new Date();
        const msBack = 90 * 24 * 60 * 60 * 1000; // janela padrão 90 dias
        const start = new Date(now.getTime() - msBack);
        const startMs = start.getTime();

        // Achieved per team
        const events = (eventsResult.data as Array<{ user_id: string; final_points: number; created_at: string }>);
        const achievedByTeam: Record<string, number> = {};
        const memberTeamByUser: Record<string, string> = {};
        Object.keys(teamMembers).forEach((teamId) =>
          teamMembers[teamId].forEach((uid) => {
            memberTeamByUser[uid] = teamId;
          }),
        );
        for (const ev of events) {
          if (!ev.user_id) continue;
          const tId = memberTeamByUser[ev.user_id];
          if (!tId) continue;
          if (new Date(ev.created_at).getTime() < startMs) continue;
          achievedByTeam[tId] = (achievedByTeam[tId] || 0) + (ev.final_points || 0);
        }

        // Possible per team from challenges
        const challenges = (challengesResult.data as Array<any>).filter((c) => {
          const st = (c.status || '').toLowerCase();
          const eligible = st === 'active' || st === 'scheduled';
          if (!eligible) return false;
          if (c.due_date && new Date(c.due_date).getTime() < startMs) return false;
          return true;
        });
        const possibleByTeam: Record<string, number> = {};
        for (const team of teamsWithMembers) {
          const memberCount = (teamMembers[team.id] || []).length;
            const divisionId = team.coord_id ? coordToDiv[team.coord_id] : null;
          let possible = 0;
          for (const ch of challenges) {
            const tTeams: string[] | null = Array.isArray(ch.target_team_ids) ? ch.target_team_ids : null;
            const tCoords: string[] | null = Array.isArray(ch.target_coord_ids) ? ch.target_coord_ids : null;
            const tDivs: string[] | null = Array.isArray(ch.target_div_ids) ? ch.target_div_ids : null;
            const applies =
              (!tTeams && !tCoords && !tDivs) ||
              (tTeams && tTeams.includes(team.id)) ||
              (tCoords && team.coord_id && tCoords.includes(team.coord_id)) ||
              (tDivs && divisionId && tDivs.includes(divisionId));
            if (applies) {
              possible += (ch.xp_reward || 0) * memberCount;
            }
          }
          possibleByTeam[team.id] = possible;
        }

        const teamData = teamsWithMembers
          .filter((t) => t.id !== 'DJT')
          .map((team) => {
            const memberCount = (teamMembers[team.id] || []).length;
            const achieved = achievedByTeam[team.id] || 0;
            const possible = possibleByTeam[team.id] || 0;
            const adherencePct = possible > 0 ? Math.round((achieved / possible) * 100) : 0;
            return { teamId: team.id, teamName: team.name || 'Equipe', adherencePct, memberCount };
          })
          .sort((a, b) => b.adherencePct - a.adherencePct)
          .map((t, i) => ({ ...t, rank: i + 1 }));

        setTeamRankings(teamData);
      }

      // Process division rankings
      if (divisionsResult.data && teamsResult.data && coordsResult.data && challengesResult.data && eventsResult.data) {
        const divisions = divisionsResult.data as Array<{ id: string; name: string }>;
        const teams = (teamsResult.data as Array<{ id: string; name: string; coord_id: string | null }>).filter((t) => !isGuestTeamId(t.id));
        const coordToDiv = (coordsResult.data as Array<{ id: string; division_id: string | null }>).
          reduce<Record<string, string | null>>((acc, c) => { acc[c.id] = c.division_id; return acc; }, {});

        const deriveDivFromTeamId = (teamId: string): string | null => {
          if (!teamId) return null;
          const base = teamId.split('-')[0] || null; // ex.: DJTB-CUB -> DJTB
          return base;
        };

        // Team members and member->team map
        const teamMembers = profilesData.reduce<Record<string, string[]>>((acc, p: any) => {
          const isGuest = isGuestProfile(p);
          if (isGuest) {
            if (!acc[GUEST_TEAM_ID]) acc[GUEST_TEAM_ID] = [];
            acc[GUEST_TEAM_ID].push(p.id);
            return acc;
          }
          if (!p.team_id || isGuestTeamId(p.team_id)) return acc;
          if (!acc[p.team_id]) acc[p.team_id] = [];
          acc[p.team_id].push(p.id);
          return acc;
        }, {});
        const memberTeamByUser: Record<string, string> = {};
        Object.keys(teamMembers).forEach((teamId) => teamMembers[teamId].forEach((uid) => { memberTeamByUser[uid] = teamId; }));

        // Map teams by division (prefer coord->division, fallback por prefixo do teamId)
        const teamsByDivision: Record<string, string[]> = {};
        for (const t of teams) {
          if ((teamMembers[t.id] || []).length === 0) continue;
          let dId: string | null = null;
          if (t.coord_id && coordToDiv[t.coord_id]) {
            dId = coordToDiv[t.coord_id] as string;
          } else {
            dId = deriveDivFromTeamId(t.id);
          }
          if (!dId) continue;
          if (!teamsByDivision[dId]) teamsByDivision[dId] = [];
          teamsByDivision[dId].push(t.id);
        }

        const now = new Date();
        const msBack = 90 * 24 * 60 * 60 * 1000;
        const start = new Date(now.getTime() - msBack);
        const startMs = start.getTime();

        // Achieved per division
        const events = (eventsResult.data as Array<{ user_id: string; final_points: number; created_at: string }>);
        const achievedByDivision: Record<string, number> = {};
        for (const ev of events) {
          if (!ev.user_id) continue;
          if (new Date(ev.created_at).getTime() < startMs) continue;
          const teamId = memberTeamByUser[ev.user_id];
          if (!teamId) continue;
          const team = teams.find((t) => t.id === teamId);
          const dId = (team?.coord_id && coordToDiv[team.coord_id]) ? coordToDiv[team.coord_id] : deriveDivFromTeamId(teamId);
          if (!dId) continue;
          achievedByDivision[dId] = (achievedByDivision[dId] || 0) + (ev.final_points || 0);
        }

        // Possible per division
        const challenges = (challengesResult.data as Array<any>).filter((c) => {
          const st = (c.status || '').toLowerCase();
          const eligible = st === 'active' || st === 'scheduled';
          if (!eligible) return false;
          if (c.due_date && new Date(c.due_date).getTime() < startMs) return false;
          return true;
        });
        const possibleByDivision: Record<string, number> = {};
        for (const d of divisions) {
          const dTeams = teamsByDivision[d.id] || [];
          let memberCount = 0;
          for (const tId of dTeams) memberCount += (teamMembers[tId] || []).length;
          let possible = 0;
          for (const ch of challenges) {
            const tTeams: string[] | null = Array.isArray(ch.target_team_ids) ? ch.target_team_ids : null;
            const tCoords: string[] | null = Array.isArray(ch.target_coord_ids) ? ch.target_coord_ids : null;
            const tDivs: string[] | null = Array.isArray(ch.target_div_ids) ? ch.target_div_ids : null;
            const applies = (!tTeams && !tCoords && !tDivs) || (tDivs && tDivs.includes(d.id));
            if (applies) {
              possible += (ch.xp_reward || 0) * memberCount;
            }
          }
          possibleByDivision[d.id] = possible;
        }

        const divisionData = divisions
          .map((d) => {
            const achieved = achievedByDivision[d.id] || 0;
            const possible = possibleByDivision[d.id] || 0;
            const teamCount = (teamsByDivision[d.id] || []).length;
            const adherencePct = possible > 0 ? Math.round((achieved / possible) * 100) : 0;
            return { divisionId: d.id, divisionName: d.name, adherencePct, teamCount };
          })
          .sort((a, b) => b.adherencePct - a.adherencePct)
          .map((d, i) => ({ ...d, order: i + 1 }));

        // Adicionar linha agregada global DJT (soma de todas as divisões), fora do ranking
        const allAchieved = Object.values(achievedByDivision).reduce((s, v) => s + v, 0);
        const allPossible = Object.values(possibleByDivision).reduce((s, v) => s + v, 0);
        const globalAdherence = allPossible > 0 ? Math.round((allAchieved / allPossible) * 100) : 0;
        const globalTeamCount = Object.values(teamsByDivision).reduce((s, arr) => s + arr.length, 0);
        const globalRow = { divisionId: 'DJT_GLOBAL', divisionName: 'Aderência Global (DJT)', adherencePct: globalAdherence, teamCount: globalTeamCount, order: 0 };

        setDivisionRankings([globalRow, ...divisionData]);
      }

      // Prefer DB adherence v2 to avoid pagination/RLS mismatches.
      try {
        const now = new Date();
        const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        const leaderMult = 1;
        const [teamRpc, divRpc] = await Promise.all([
          supabase.rpc('team_adherence_window_v2', { _start: start.toISOString(), _end: now.toISOString(), _leader_multiplier: leaderMult } as any),
          supabase.rpc('division_adherence_window_v2', { _start: start.toISOString(), _end: now.toISOString(), _leader_multiplier: leaderMult } as any),
        ]);

        if (!teamRpc.error && Array.isArray(teamRpc.data)) {
          const teamNameById = (teamsResult.data || []).reduce<Record<string, string>>((acc: any, t: any) => {
            acc[String(t.id)] = String(t.name || t.id);
            return acc;
          }, {});

          const raw = teamRpc.data as any[];
          const groupSet = new Set<string>(Array.from(DJT_TEAM_GROUP_IDS));
          const groupRows = raw.filter((r) => groupSet.has(String(r?.team_id || '')));
          const nonGroupRows = raw.filter((r) => !groupSet.has(String(r?.team_id || '')));

          const merged = groupRows.length
            ? (() => {
                const memberCount = groupRows.reduce((s, r) => s + (Number(r?.member_count || 0) || 0), 0);
                const possible = groupRows.reduce((s, r) => s + (Number(r?.possible || 0) || 0), 0);
                const achieved = groupRows.reduce((s, r) => s + (Number(r?.achieved || 0) || 0), 0);
                const adherencePct = possible > 0 ? Math.round((achieved / possible) * 100) : 0;
                return { team_id: 'DJT', member_count: memberCount, possible, achieved, adherence_pct: adherencePct, __merged: true };
              })()
            : null;

          const next = [...nonGroupRows, ...(merged ? [merged] : [])]
            .filter((r) => Number(r?.member_count || 0) > 0)
            .map((r) => ({
              teamId: String(r.team_id),
              teamName: String(r.team_id) === 'DJT' && (r as any).__merged ? 'DJT (inclui PLA)' : (teamNameById[String(r.team_id)] || String(r.team_id)),
              adherencePct: Number(r.adherence_pct || 0),
              memberCount: Number(r.member_count || 0),
              rank: 0,
            }))
            .sort((a, b) => b.adherencePct - a.adherencePct || b.memberCount - a.memberCount || a.teamName.localeCompare(b.teamName, getActiveLocale()))
            .map((t, i) => ({ ...t, rank: i + 1 }));

          setTeamRankings(next);
        }

        if (!divRpc.error && Array.isArray(divRpc.data)) {
          const divisionNameById = (divisionsResult.data || []).reduce<Record<string, string>>((acc: any, d: any) => {
            acc[String(d.id)] = String(d.name || d.id);
            return acc;
          }, {});

          const rows = divRpc.data as any[];
          const global = rows.find((r) => String(r?.division_id) === 'DJT_GLOBAL');
          const others = rows.filter((r) => String(r?.division_id) !== 'DJT_GLOBAL');

          const divisionData = others
            .map((r) => ({
              divisionId: String(r.division_id),
              divisionName: divisionNameById[String(r.division_id)] || String(r.division_id),
              adherencePct: Number(r.adherence_pct || 0),
              teamCount: Number(r.team_count || 0),
              order: 0,
            }))
            .sort((a, b) => b.adherencePct - a.adherencePct)
            .map((d, i) => ({ ...d, order: i + 1 }));

          const globalRow = global
            ? {
                divisionId: 'DJT_GLOBAL',
                divisionName: 'Aderência Global (DJT)',
                adherencePct: Number((global as any).adherence_pct || 0),
                teamCount: Number((global as any).team_count || 0),
                order: 0,
              }
            : { divisionId: 'DJT_GLOBAL', divisionName: 'Aderência Global (DJT)', adherencePct: 0, teamCount: 0, order: 0 };

          setDivisionRankings([globalRow, ...divisionData]);
        }
      } catch { /* noop */ }

      // Leader ranking: total XP across initiatives/quizzes/forum/SEPBook/evaluations (historical breakdown via RPC).
      const completedByReviewer = !evalQueueResult.error
        ? (evalQueueResult.data || []).reduce<Record<string, number>>((acc: any, row: any) => {
            const reviewer = row.assigned_to as string;
            if (!reviewer) return acc;
            const inc = row.completed_at ? 1 : 0;
            acc[reviewer] = (acc[reviewer] || 0) + inc;
            return acc;
          }, {})
        : {};

      const leaders = allProfiles.filter((p: any) => isLeaderProfile(p));
      const leaderIds = leaders.map((l: any) => l.id).filter(Boolean);

      // Fallback: quiz XP for leaders (sum xp_earned)
      let quizXpByLeader: Record<string, number> = {};
      if (leaderIds.length) {
        try {
          const { data: quizRows, error: quizErr } = await supabase
            .from('user_quiz_answers')
            .select('user_id, xp_earned')
            .in('user_id', leaderIds)
            .limit(50000);
          if (!quizErr && Array.isArray(quizRows)) {
            quizXpByLeader = quizRows.reduce<Record<string, number>>((acc, r: any) => {
              const uid = String(r?.user_id || '');
              if (!uid) return acc;
              acc[uid] = (acc[uid] || 0) + (Number(r?.xp_earned) || 0);
              return acc;
            }, {});
          }
        } catch (e) {
          console.warn('Rankings: erro ao carregar quiz points dos líderes (fallback)', e);
          quizXpByLeader = {};
        }
      }

      let breakdownByLeader: Record<string, any> = {};
      if (leaderIds.length) {
        try {
          const { data: rows, error: brErr } = await supabase.rpc('user_points_breakdown', { _user_ids: leaderIds } as any);
          if (brErr) throw brErr;
          breakdownByLeader = (Array.isArray(rows) ? rows : []).reduce<Record<string, any>>((acc, r: any) => {
            const uid = String(r?.user_id || '');
            if (!uid) return acc;
            acc[uid] = r;
            return acc;
          }, {});
        } catch (e) {
          console.warn('Rankings: erro ao carregar breakdown de pontos dos líderes', e);
          breakdownByLeader = {};
        }
      }

      const sorted = leaders
        .map((p: any) => {
          const b = breakdownByLeader[p.id];
          const completed = b ? Number(b.evaluations_completed || 0) : (completedByReviewer[p.id] || 0);
          const quizXp = b ? Number(b.quiz_xp || 0) : (quizXpByLeader[p.id] || 0);
          const initiativesXp = b ? Number(b.initiatives_xp || 0) : 0;
          const forumXp = b ? Number(b.forum_posts || 0) * 10 : 0;
          const sepbookXp = b
            ? Number(b.sepbook_photo_count || 0) * 5 + Number(b.sepbook_comments || 0) * 2 + Number(b.sepbook_likes || 0)
            : 0;
          const evaluationsXp = completed * LEADER_EVAL_POINTS;
          const baseXp = quizXp + initiativesXp + forumXp + sepbookXp + evaluationsXp;
          const score = baseXp;
          return {
            userId: p.id,
            name: p.name,
            avatarUrl: p.avatar_url,
            completed,
            quizXp,
            initiativesXp,
            forumXp,
            sepbookXp,
            baseXp,
            score,
          } as LeaderRanking;
        })
        .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name), getActiveLocale()))
        .map((p, i) => ({ ...p, rank: i + 1 }));
      setLeaderRankings(sorted);
    } catch (error) {
      console.error('Error fetching rankings:', error);
    } finally {
      setLoading(false);
    }
  }, [orgScope?.divisionId, orgScope?.teamId, selectedTeamId]);

  useEffect(() => {
    fetchRankings();
  }, [fetchRankings]);

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedBreakdown(null);
      return;
    }
    let cancelled = false;
    setBreakdownLoading(true);
    (async () => {
      try {
        const userId = selectedUserId;
        const { data: rows, error } = await supabase.rpc('user_points_breakdown', { _user_ids: [userId] } as any);
        if (error) throw error;
        const b = Array.isArray(rows) ? rows[0] : null;

        const quizXp = Number(b?.quiz_xp || 0);
        const forumPosts = Number(b?.forum_posts || 0);
        const forumXp = forumPosts * 10;
        const sepbookPhotoCount = Number(b?.sepbook_photo_count || 0);
        const sepbookPostXp = sepbookPhotoCount * 5;
        const sepbookComments = Number(b?.sepbook_comments || 0);
        const sepbookCommentXp = sepbookComments * 2;
        const sepbookLikes = Number(b?.sepbook_likes || 0);
        const sepbookLikeXp = sepbookLikes;
        const campaignsXp = Number(b?.initiatives_xp || 0);
        const quizPublishXp = Number(b?.quiz_publish_xp || 0);
        const evaluationsCompleted = Number(b?.evaluations_completed || 0);
        const evaluationsXp = evaluationsCompleted * LEADER_EVAL_POINTS;

        if (!cancelled) {
          setSelectedBreakdown({
            quizXp,
            forumPosts,
            forumXp,
            sepbookPhotoCount,
            sepbookPostXp,
            sepbookComments,
            sepbookCommentXp,
            sepbookLikes,
            sepbookLikeXp,
            campaignsXp,
            quizPublishXp,
            evaluationsCompleted,
            evaluationsXp,
          });
        }
      } finally {
        if (!cancelled) setBreakdownLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedUserId]);

  const getMedalEmoji = (position: number) => {
    if (position === 1) return '🥇';
    if (position === 2) return '🥈';
    if (position === 3) return '🥉';
    return `#${position}`;
  };

  return (
    <div className="relative min-h-screen pb-40">
      <ThemedBackground theme="conhecimento" />
      <Navigation />
      <div className="container relative mx-auto p-4 md:p-6 max-w-6xl">
        <div className="mb-6">
          <h1 className="text-3xl md:text-4xl font-bold flex items-center gap-2">
            <Trophy className="h-8 w-8 text-primary" />
            {tr("rankings.title")}
          </h1>
          <p className="text-muted-foreground mt-2">
            {tr("rankings.subtitle")}
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={(v:any)=>setActiveTab(v)} className="w-full">
          <TabsList className="grid w-full grid-cols-6 mb-6">
            <TabsTrigger value="individual" className="flex items-center gap-2 min-w-0" title={tr("rankings.tabs.overall")}>
              <Trophy className="h-4 w-4" />
              <span className="truncate">{tr("rankings.tabs.overall")}</span>
            </TabsTrigger>
            <TabsTrigger value="guests" className="flex items-center gap-2 min-w-0" title={tr("rankings.tabs.guests")}>
              <Award className="h-4 w-4" />
              <span className="truncate">{tr("rankings.tabs.guests")}</span>
            </TabsTrigger>
            <TabsTrigger value="myteam" className="flex items-center gap-2 min-w-0" title={tr("rankings.tabs.myTeam")}>
              <Users className="h-4 w-4" />
              <span className="truncate">{tr("rankings.tabs.myTeam")}</span>
            </TabsTrigger>
            <TabsTrigger value="teams" className="flex items-center gap-2 min-w-0" title={tr("rankings.tabs.teams")}>
              <Users className="h-4 w-4" />
              <span className="truncate">{tr("rankings.tabs.teams")}</span>
            </TabsTrigger>
            <TabsTrigger value="divisions" className="flex items-center gap-2 min-w-0" title={tr("rankings.tabs.divisions")}>
              <Building2 className="h-4 w-4" />
              <span className="truncate">{tr("rankings.tabs.divisions")}</span>
            </TabsTrigger>
            <TabsTrigger value="leaders" className="flex items-center gap-2 min-w-0" title={tr("rankings.tabs.leaders")}>
              <Shield className="h-4 w-4" />
              <span className="truncate">{tr("rankings.tabs.leaders")}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="individual">
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  {tr("rankings.overallTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">{tr("common.loading")}</p>
                ) : (
                  <div className="space-y-6">
                    <div className="space-y-6">
                      {individualRankings.map((ranking) => (
                        <div
                          key={ranking.userId}
                          onClick={() => setSelectedUserId(ranking.userId)}
                          className={`flex items-center gap-4 p-4 rounded-lg border bg-white/5 hover:bg-white/10 transition-colors cursor-pointer ${selectedUserId===ranking.userId ? 'ring-1 ring-primary/40 bg-white/10' : ''}`}
                        >
                          <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">
                            {getMedalEmoji(ranking.rank)}
                          </span>
                          
                          <UserProfilePopover userId={ranking.userId} name={ranking.name} avatarUrl={ranking.avatarUrl}>
                            <button
                              type="button"
                              className="flex items-center gap-4 min-w-0 flex-1 text-left p-0 bg-transparent border-0"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Avatar className="h-12 w-12">
                                <AvatarImage src={ranking.avatarUrl || ''} />
                                <AvatarFallback>{ranking.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <p className="font-semibold truncate">{ranking.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {tr("rankings.inlineBreakdown", {
                                    quizXp: ranking.quizXp.toLocaleString(),
                                    initiativesXp: ranking.initiativesXp.toLocaleString(),
                                    forumXp: ranking.forumXp.toLocaleString(),
                                    sepbookXp: ranking.sepbookXp.toLocaleString(),
                                    evaluationsXp: ranking.evaluationsXp.toLocaleString(),
                                  })}
                                </p>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Badge variant="outline" className="text-xs">
                                    {ranking.tier}
                                  </Badge>
                                  {ranking.isGuest && (
                                    <Badge variant="secondary" className="text-xs">
                                      {tr("rankings.guestBadge")}
                                    </Badge>
                                  )}
                                  <span className="truncate">{ranking.teamName}</span>
                                </div>
                              </div>
                            </button>
                          </UserProfilePopover>

                          <div className="text-right">
                            <p className="text-lg font-bold">{ranking.points.toLocaleString()} {tr("rankings.pointsLabel")}</p>
                            <p className="text-sm text-muted-foreground">{tr("rankings.levelLabel", { level: ranking.level })}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    {selectedUserId && (
                      <div className="rounded-lg border bg-white/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold">{tr("rankings.breakdownTitle")}</p>
                            <p className="text-xs text-muted-foreground">{tr("rankings.breakdownSubtitle")}</p>
                          </div>
                          {breakdownLoading && (
                            <span className="text-xs text-muted-foreground">{tr("rankings.breakdownLoading")}</span>
                          )}
                        </div>
                        {selectedBreakdown && (
                          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                            <div>
                              {tr("rankings.breakdown.quiz")}:{" "}
                              <span className="font-semibold">{selectedBreakdown.quizXp.toLocaleString()}</span> XP
                            </div>
                            <div>
                              {tr("rankings.breakdown.forum")}:{" "}
                              <span className="font-semibold">{selectedBreakdown.forumPosts}</span>{" "}
                              → {selectedBreakdown.forumXp.toLocaleString()} XP
                            </div>
                            <div>
                              {tr("rankings.breakdown.sepbookPhotos")}:{" "}
                              <span className="font-semibold">{selectedBreakdown.sepbookPhotoCount}</span>{" "}
                              → {selectedBreakdown.sepbookPostXp.toLocaleString()} XP
                            </div>
                            <div>
                              {tr("rankings.breakdown.sepbookComments")}:{" "}
                              <span className="font-semibold">{selectedBreakdown.sepbookComments}</span>{" "}
                              → {selectedBreakdown.sepbookCommentXp.toLocaleString()} XP
                            </div>
                            <div>
                              {tr("rankings.breakdown.sepbookLikes")}:{" "}
                              <span className="font-semibold">{selectedBreakdown.sepbookLikes}</span>{" "}
                              → {selectedBreakdown.sepbookLikeXp.toLocaleString()} XP
                            </div>
                            <div>
                              {tr("rankings.breakdown.campaigns")}:{" "}
                              <span className="font-semibold">{selectedBreakdown.campaignsXp.toLocaleString()}</span> XP
                            </div>
                            <div>
                              Publicação de quizzes:{" "}
                              <span className="font-semibold">{selectedBreakdown.quizPublishXp.toLocaleString()}</span> XP
                            </div>
                            <div>
                              {tr("rankings.breakdown.evaluations")}:{" "}
                              <span className="font-semibold">{selectedBreakdown.evaluationsCompleted}</span>{" "}
                              → {selectedBreakdown.evaluationsXp.toLocaleString()} XP
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="guests">
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="h-5 w-5 text-primary" />
                  {tr("rankings.guestsTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">{tr("common.loading")}</p>
                ) : guestRankings.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">{tr("rankings.guestsEmpty")}</p>
                ) : (
                  <div className="space-y-6">
                    {guestRankings.map((ranking) => (
                      <div
                        key={ranking.userId}
                        onClick={() => setSelectedUserId(ranking.userId)}
                        className={`flex items-center gap-4 p-4 rounded-lg border bg-white/5 hover:bg-white/10 transition-colors cursor-pointer ${selectedUserId===ranking.userId ? 'ring-1 ring-primary/40 bg-white/10' : ''}`}
                      >
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">
                          {getMedalEmoji(ranking.rank)}
                        </span>

                        <UserProfilePopover userId={ranking.userId} name={ranking.name} avatarUrl={ranking.avatarUrl}>
                          <button
                            type="button"
                            className="flex items-center gap-4 min-w-0 flex-1 text-left p-0 bg-transparent border-0"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Avatar className="h-12 w-12">
                              <AvatarImage src={ranking.avatarUrl || ''} />
                              <AvatarFallback>{ranking.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{ranking.name}</p>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Badge variant="outline" className="text-xs">
                                  {ranking.tier}
                                </Badge>
                                <Badge variant="secondary" className="text-xs">
                                  {tr("rankings.guestBadge")}
                                </Badge>
                              </div>
                            </div>
                          </button>
                        </UserProfilePopover>

                        <div className="text-right">
                          <p className="text-lg font-bold">{ranking.points.toLocaleString()} {tr("rankings.pointsLabel")}</p>
                          <p className="text-sm text-muted-foreground">{tr("rankings.levelLabel", { level: ranking.level })}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="myteam">
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                {selectedTeamId && (
                  <button onClick={()=>{ setSelectedTeamId(null); }} className="text-xs text-muted-foreground hover:text-foreground mb-2 w-fit">← {tr("common.back")}</button>
                )}
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-green-500" />
                  {tr("rankings.myTeamTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">{tr("common.loading")}</p>
                ) : myTeamRankings.length === 0 ? (
                  <p className="text-center py-8 text-muted-foreground">{tr("rankings.myTeamEmpty")}</p>
                ) : (
                  <div className="space-y-6">
                    {myTeamRankings.map((ranking) => (
                      <div
                        key={ranking.userId}
                        className="flex items-center gap-4 p-4 rounded-lg bg-transparent transition-colors"
                      >
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">
                          {getMedalEmoji(ranking.rank)}
                        </span>
                        
                        <UserProfilePopover userId={ranking.userId} name={ranking.name} avatarUrl={ranking.avatarUrl}>
                          <button type="button" className="flex items-center gap-4 min-w-0 flex-1 text-left p-0 bg-transparent border-0">
                            <Avatar className="h-12 w-12">
                              <AvatarImage src={ranking.avatarUrl || ''} />
                              <AvatarFallback>{ranking.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{ranking.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {tr("rankings.inlineBreakdown", {
                                  quizXp: ranking.quizXp.toLocaleString(),
                                  initiativesXp: ranking.initiativesXp.toLocaleString(),
                                  forumXp: ranking.forumXp.toLocaleString(),
                                  sepbookXp: ranking.sepbookXp.toLocaleString(),
                                  evaluationsXp: ranking.evaluationsXp.toLocaleString(),
                                })}
                              </p>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Badge variant="outline" className="text-xs">
                                  {ranking.tier}
                                </Badge>
                              </div>
                            </div>
                          </button>
                        </UserProfilePopover>

                        <div className="text-right">
                          <p className="text-lg font-bold">{ranking.points.toLocaleString()} {tr("rankings.pointsLabel")}</p>
                          <p className="text-sm text-muted-foreground">{tr("rankings.levelLabel", { level: ranking.level })}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="teams">
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-purple-500" />
                  {tr("rankings.teamsTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">{tr("common.loading")}</p>
                ) : (
                  <div className="space-y-6">
                    {teamRankings.map((ranking) => (
                      <div
                        key={ranking.teamId}
                        onClick={() => { setSelectedTeamId(ranking.teamId); setActiveTab('myteam'); (window as any).scrollTo({ top: 0, behavior: 'smooth' }); }}
                        className="flex items-center gap-4 p-4 rounded-lg border bg-transparent hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">
                          {getMedalEmoji(ranking.rank)}
                        </span>

                        <div className="flex-1">
                          <p className="font-semibold text-lg">{ranking.teamName}</p>
                          <p className="text-sm text-muted-foreground">{tr("rankings.membersLabel", { count: ranking.memberCount })}</p>
                        </div>

                        <div className="text-right">
                          <p className="text-lg font-bold flex items-center justify-end gap-1">
                            <Percent className="h-4 w-4 text-purple-500" /> {ranking.adherencePct}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="divisions">
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-orange-500" />
                  {tr("rankings.divisionsTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">{tr("common.loading")}</p>
                ) : (
                  <div className="space-y-6">
                    {divisionRankings.map((ranking) => (
                      <div
                        key={`${ranking.divisionId || 'global'}-${ranking.order}`}
                        className="flex items-center gap-4 p-4 rounded-lg border bg-transparent hover:bg-white/5 transition-colors"
                      >
                        <div className="flex-1">
                          <p className="font-semibold text-lg">{ranking.divisionName}</p>
                          <p className="text-sm text-muted-foreground">{tr("rankings.teamsCountLabel", { count: ranking.teamCount })}</p>
                        </div>

                        <div className="text-right">
                          <p className="text-lg font-bold flex items-center justify-end gap-1">
                            <Percent className="h-4 w-4 text-orange-500" /> {ranking.adherencePct}%
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaders">
            <Card className="bg-transparent border-transparent shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-blue-500" />
                  {tr("rankings.leadersTitle")}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {tr("rankings.leadersFormula", { points: LEADER_EVAL_POINTS })}
                </p>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-center py-8 text-muted-foreground">{tr("common.loading")}</p>
                ) : (
                  <div className="space-y-6">
                    {leaderRankings.length === 0 && (
                      <p className="text-center py-8 text-muted-foreground">
                        {tr("rankings.leadersEmpty")}
                      </p>
                    )}
                    {leaderRankings.map((r) => (
                      <div key={r.userId} className="flex items-center gap-4 p-4 rounded-lg border bg-transparent hover:bg-white/5 transition-colors">
                        <span className="text-2xl font-bold text-muted-foreground min-w-[3rem]">{getMedalEmoji(r.rank)}</span>
                        <UserProfilePopover userId={r.userId} name={r.name} avatarUrl={r.avatarUrl}>
                          <button type="button" className="flex items-center gap-4 min-w-0 flex-1 text-left p-0 bg-transparent border-0">
                            <Avatar className="h-12 w-12">
                              <AvatarImage src={r.avatarUrl || ''} />
                              <AvatarFallback>{r.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{r.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {tr("rankings.leadersStats", {
                                  completed: r.completed,
                                  quizXp: r.quizXp.toLocaleString(),
                                  initiativesXp: r.initiativesXp.toLocaleString(),
                                  forumXp: r.forumXp.toLocaleString(),
                                  sepbookXp: r.sepbookXp.toLocaleString(),
                                })}
                              </p>
                            </div>
                          </button>
                        </UserProfilePopover>
                        <div className="text-right">
                          <p className="text-lg font-bold">{r.score.toLocaleString()}</p>
                          <p className="text-xs text-muted-foreground">{tr("rankings.pointsLabel")}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default Rankings;
