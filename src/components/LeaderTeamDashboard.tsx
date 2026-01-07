import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, TrendingUp, Trophy, Calendar } from 'lucide-react';
import { AvatarDisplay } from './AvatarDisplay';
import { getActiveLocale } from '@/lib/i18n/activeLocale';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  xp: number;
  tier: string;
  avatar_url: string | null;
}

interface TeamEvent {
  id: string;
  event_type: string;
  points: number;
  reason: string;
  created_at: string;
  created_by: string;
  profiles: {
    name: string;
  };
}

interface TeamStats {
  team_name: string;
  collaborator_count: number;
  avg_xp: number;
  total_xp: number;
  max_xp: number;
  min_xp: number;
}

interface TeamXpSummary {
  team_id: string;
  team_name: string;
  collaborator_count: number;
  avg_xp: number;
  total_xp: number;
  max_xp: number;
  min_xp: number;
}

export function LeaderTeamDashboard() {
  const { user, orgScope } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStats | null>(null);
  const [recentEvents, setRecentEvents] = useState<TeamEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadTeamData = async () => {
      if (!user || !orgScope?.teamId) {
        // No team bound yet; avoid infinite loading spinner
        setLoading(false);
        return;
      }

      try {
        // Load team members (only collaborators)
        const { data: membersData } = await supabase
          .from('profiles')
          .select('id, name, email, xp, tier, avatar_url')
          .eq('team_id', orgScope.teamId)
          .eq('is_leader', false)
          .order('xp', { ascending: false });

        if (membersData) {
          setMembers(membersData);
        }

        // Load team stats from view
        const { data: statsData, error: statsError } = await supabase
          .from('team_xp_summary' as any)
          .select('*')
          .eq('team_id', orgScope.teamId)
          .single();

        if (!statsError && statsData) {
          setTeamStats(statsData as any);
        }

        // Load recent team events
        const { data: eventsData, error: eventsError } = await supabase
          .from('team_events' as any)
          .select('*, profiles:created_by(name)')
          .eq('team_id', orgScope.teamId)
          .order('created_at', { ascending: false })
          .limit(5);

        if (!eventsError && eventsData) {
          setRecentEvents(eventsData as any);
        }
      } catch (error) {
        console.error('Error loading team data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTeamData();
  }, [user, orgScope]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <div className="container max-w-6xl mx-auto py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard da Equipe</h1>
          <p className="text-muted-foreground">
            {teamStats?.team_name || 'Sua Equipe'}
          </p>
        </div>

        {/* Team Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Users className="h-8 w-8 text-primary mx-auto mb-2" />
                <p className="text-2xl font-bold">{teamStats?.collaborator_count || 0}</p>
                <p className="text-xs text-muted-foreground">Colaboradores</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <TrendingUp className="h-8 w-8 text-accent mx-auto mb-2" />
                <p className="text-2xl font-bold">{teamStats?.avg_xp || 0}</p>
                <p className="text-xs text-muted-foreground">XP Médio</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Trophy className="h-8 w-8 text-secondary mx-auto mb-2" />
                <p className="text-2xl font-bold">{teamStats?.total_xp || 0}</p>
                <p className="text-xs text-muted-foreground">XP Total</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <Trophy className="h-8 w-8 text-green-600 mx-auto mb-2" />
                <p className="text-2xl font-bold">{teamStats?.max_xp || 0}</p>
                <p className="text-xs text-muted-foreground">Maior XP</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Team Members */}
        <Card>
          <CardHeader>
            <CardTitle>Membros da Equipe</CardTitle>
            <CardDescription>
              Ranking de XP dos colaboradores
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {members.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Nenhum colaborador na equipe ainda
                </p>
              ) : (
                members.map((member, index) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-4 p-4 rounded-lg border hover:bg-accent/50 transition-colors"
                  >
                    <div className="text-2xl font-bold text-muted-foreground w-8">
                      #{index + 1}
                    </div>
                    <AvatarDisplay
                      userId={member.id}
                      avatarUrl={member.avatar_url}
                      name={member.name}
                      size="md"
                    />
                    <div className="flex-1">
                      <p className="font-semibold">{member.name}</p>
                      <p className="text-sm text-muted-foreground">{member.email}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{member.tier}</Badge>
                      <p className="text-lg font-bold mt-1">{member.xp} XP</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Events */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Histórico de Eventos
            </CardTitle>
            <CardDescription>
              Últimos bônus e penalidades aplicados
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentEvents.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Nenhum evento registrado ainda
                </p>
              ) : (
                recentEvents.map((event) => (
                  <div
                    key={event.id}
                    className="p-4 rounded-lg border"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={event.event_type === 'bonus' ? 'default' : 'destructive'}
                        >
                          {event.event_type === 'bonus' ? '+' : '-'}{event.points} XP
                        </Badge>
                        <Badge variant="outline">
                          {event.event_type === 'bonus' ? '🎁 Bônus' : '⚠️ Penalidade'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(event.created_at).toLocaleDateString(getActiveLocale())}
                      </p>
                    </div>
                    <p className="text-sm">{event.reason}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Aplicado por: {event.profiles.name}
                    </p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
