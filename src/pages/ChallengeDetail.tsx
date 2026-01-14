import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Shield, BarChart3 } from 'lucide-react';
import { QuizAnalytics } from '@/components/QuizAnalytics';
import { ThemedBackground, domainFromType } from '@/components/ThemedBackground';
import { useToast } from '@/hooks/use-toast';
import { QuizPlayer } from '@/components/QuizPlayer';
import { HelpInfo } from '@/components/HelpInfo';
import { VoiceRecorderButton } from '@/components/VoiceRecorderButton';
import { AttachmentUploader } from '@/components/AttachmentUploader';
import { buildAbsoluteAppUrl, openWhatsAppShare } from '@/lib/whatsappShare';
import { getActiveLocale } from '@/lib/i18n/activeLocale';
import { localeToOpenAiLanguageTag, localeToSpeechLanguage } from '@/lib/i18n/language';
import { apiFetch } from '@/lib/api';

interface Challenge {
  id: string;
  title: string;
  description: string;
  type: string;
  xp_reward: number;
  reward_mode?: string | null;
  reward_tier_steps?: number | null;
  require_two_leader_eval: boolean;
  campaign_id: string;
  evidence_required: boolean;
  status?: string;
  cover_image_url?: string | null;
}

const ChallengeDetail = () => {
  const { id } = useParams();
  const { user, isLeader, studioAccess, userRole, refreshUserSession } = useAuth() as any;
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const retryEventId = searchParams.get('retry');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [description, setDescription] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [previousFeedback, setPreviousFeedback] = useState<{ positive: string | null; constructive: string | null } | null>(null);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [resettingAttempt, setResettingAttempt] = useState(false);
  const [actionDate, setActionDate] = useState<string>('');
  const [actionLocation, setActionLocation] = useState<string>('');
  const [sapNote, setSapNote] = useState<string>('');
  // Participants
  const [allUsers, setAllUsers] = useState<Array<{ id: string; name: string; team_id: string | null }>>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [myTeamId, setMyTeamId] = useState<string | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [reopening, setReopening] = useState(false);

  const reopenMyMilhaoAttempts = async (mode: 'current' | 'latest2') => {
    if (!challenge || !user) return;
    const isMilhao = /milh(ã|a)o/i.test(challenge.title || '');
    if (!isMilhao) {
      toast({ title: 'Ação indisponível', description: 'Este botão é apenas para Quiz do Milhão.', variant: 'destructive' });
      return;
    }

    const ok = window.confirm(
      mode === 'current'
        ? 'Reabrir sua tentativa deste Quiz do Milhão?\n\nIsso zera respostas e libera uma nova tentativa.\nSeu XP NÃO diminui: você só ganha XP extra se bater seu recorde.\n\nConfirmar?'
        : 'Reabrir suas tentativas dos 2 quizzes mais recentes do Milhão?\n\nIsso zera respostas e libera novas tentativas.\nSeu XP NÃO diminui: você só ganha XP extra se bater seu recorde.\n\nConfirmar?',
    );
    if (!ok) return;

    setReopening(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const resp = await fetch('/api/admin?handler=admin-reset-milhao-attempts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          challenge_ids: mode === 'current' ? [challenge.id] : undefined,
          mode: 'best_of',
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao reabrir tentativas');
      const reopened = Array.isArray(json?.reopened) ? json.reopened : [];
      const reopenedIds = new Set(reopened.map((r: any) => String(r?.challenge_id || '').trim()).filter(Boolean));
      const bestKeptMax = reopened.reduce((acc: number, r: any) => Math.max(acc, Number(r?.best_score_kept ?? 0) || 0), 0);

      if (reopenedIds.has(challenge.id)) setQuizCompleted(false);
      toast({ title: 'Pronto', description: `Quizzes reabertos: ${reopened.length} • Recorde preservado (máx): ${bestKeptMax} XP` });
    } catch (e: any) {
      toast({ title: 'Falha ao reabrir', description: e?.message || 'Tente novamente', variant: 'destructive' });
    } finally {
      setReopening(false);
    }
  };

  const resetMyQuizAttempt = async () => {
    if (!challenge || !user) return;
    const status = String(challenge.status || 'active').toLowerCase();
    const isLocked = status === 'closed' || status === 'canceled' || status === 'cancelled';
    if (isLocked) {
      toast({
        title: 'Quiz encerrado',
        description: 'Este quiz está encerrado/cancelado no momento. Peça ao líder para reabrir a coleta.',
        variant: 'destructive',
      });
      return;
    }

    const isMilhao = /milh(ã|a)o/i.test(challenge.title || '');
    const ok = window.confirm(
      isMilhao
        ? 'Jogar novamente o Quiz do Milhão?\n\nIsso vai zerar suas respostas e liberar uma nova tentativa.\nSeu XP NÃO diminui: você só ganha XP extra se bater seu recorde.\n\nConfirmar?'
        : 'Refazer este quiz?\n\nIsso vai zerar suas respostas, reverter o XP ganho neste quiz e permitir responder novamente.\n\nConfirmar?',
    );
    if (!ok) return;

    setResettingAttempt(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error('Não autenticado');

      const resp = await fetch('/api/admin?handler=quiz-reset-attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ challengeId: challenge.id, ...(isMilhao ? { mode: 'best_of' } : {}) }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || 'Falha ao resetar tentativa');

      const reverted = Number(json?.xp_reverted ?? 0) || 0;
      const bestKept = Number(json?.best_score_kept ?? 0) || 0;
      toast({
        title: 'Pronto',
        description: isMilhao
          ? `Nova tentativa liberada. Recorde atual preservado: ${bestKept} XP.`
          : `Tentativa resetada. XP revertido: ${reverted}`,
      });
      setQuizCompleted(false);
      refreshUserSession?.().catch(() => {});
    } catch (e: any) {
      toast({
        title: 'Falha ao refazer',
        description: e?.message || 'Tente novamente',
        variant: 'destructive',
      });
    } finally {
      setResettingAttempt(false);
    }
  };

  useEffect(() => {
    if (!audioFile) {
      setAudioPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(audioFile);
    setAudioPreviewUrl(url);
    return () => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    };
  }, [audioFile]);

  useEffect(() => {
    const loadChallenge = async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from('challenges')
        .select('*, created_by')
        .eq('id', id)
        .single();

      if (error) {
        toast({ title: 'Erro', description: 'Não foi possível carregar o desafio', variant: 'destructive' });
        navigate('/');
        return;
      }

      setChallenge(data as any);

      // Load previous feedback if this is a retry
      if (retryEventId) {
        const { data: retryEvent } = await supabase
          .from('events')
          .select('parent_event_id')
          .eq('id', retryEventId)
          .single();

        if (retryEvent?.parent_event_id) {
          const { data: evaluation } = await supabase
            .from('action_evaluations')
            .select('feedback_positivo, feedback_construtivo')
            .eq('event_id', retryEvent.parent_event_id)
            .maybeSingle();

          if (evaluation) {
            setPreviousFeedback({
              positive: evaluation.feedback_positivo,
              constructive: evaluation.feedback_construtivo
            });
          }
        }
      }

      // Se for quiz, verificar se já foi concluído
      if (data?.type?.toLowerCase?.().includes('quiz') && user) {
        try {
          const { data: attempt } = await supabase
            .from('quiz_attempts')
            .select('submitted_at')
            .eq('user_id', user.id)
            .eq('challenge_id', data.id)
            .maybeSingle();
          if (attempt?.submitted_at) {
            setQuizCompleted(true);
            setLoading(false);
            return;
          }
        } catch {
          // ignore if table not present
        }
        const { count: totalQuestions } = await supabase
          .from('quiz_questions')
          .select('id', { count: 'exact', head: true })
          .eq('challenge_id', data.id);

          const { count: answeredQuestions } = await supabase
            .from('user_quiz_answers')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('challenge_id', data.id);

          const total = totalQuestions || 0;
          const answered = answeredQuestions || 0;
        setQuizCompleted(total > 0 && answered >= total);
      }

      setLoading(false);
    };

    loadChallenge();
  }, [id, retryEventId, navigate, toast, user]);

  // Load participants catalog (alphabetical; same team first)
  useEffect(() => {
    const loadUsers = async () => {
      if (!user) return;
      try {
        // get my team id
        const { data: myProfile } = await supabase
          .from('profiles')
          .select('team_id')
          .eq('id', user.id)
          .maybeSingle();
        const teamId = myProfile?.team_id || null;
        setMyTeamId(teamId);

        const { data: users } = await supabase
          .from('profiles')
          .select('id, name, team_id')
          .order('name');
        const list = (users || []) as Array<{ id: string; name: string; team_id: string | null }>;
        // sort: same team first then by name
        list.sort((a, b) => {
          const aSame = a.team_id && teamId && a.team_id === teamId ? 0 : 1;
          const bSame = b.team_id && teamId && b.team_id === teamId ? 0 : 1;
          if (aSame !== bSame) return aSame - bSame;
          return (a.name || '').localeCompare(b.name || '');
        });
        setAllUsers(list);
        // default select me
        setSelectedParticipants(new Set([user.id]));
      } catch (e) {
        // ignore
      }
    };
    loadUsers();
  }, [user]);

  const handleSubmit = async () => {
    if (!challenge || !user) return;
    
    if (description.length < 50) {
      toast({ title: 'Erro', description: 'Descrição deve ter pelo menos 50 caracteres', variant: 'destructive' });
      return;
    }

    // For non-quiz actions, require date/location/SAP to avoid duplicates
    const isQuiz = (challenge.type || '').toLowerCase().includes('quiz');
    if (!isQuiz) {
      if (!actionDate || !actionLocation || !sapNote) {
        toast({ title: 'Campos obrigatórios', description: 'Informe data, local e nota SAP para registrar a ação', variant: 'destructive' });
        return;
      }
    }

    setSubmitting(true);

    try {
      if (retryEventId) {
        // Update existing retry event
        const { error } = await supabase
          .from('events')
          .update({
            payload: {
              description,
              ...(evidenceUrls.length > 0 ? { evidence_urls: evidenceUrls } : {}),
              action_date: actionDate || null,
              action_location: actionLocation || null,
              sap_service_note: sapNote || null,
            },
            evidence_urls: evidenceUrls.length > 0 ? evidenceUrls : [],
            action_date: actionDate || null,
            action_location: actionLocation || null,
            sap_service_note: sapNote || null,
            status: 'submitted'
          })
          .eq('id', retryEventId);

        if (error) throw error;

        // Upsert participants
        const parts = new Set(selectedParticipants);
        parts.add(user.id);
        const rows = Array.from(parts).map(uid => ({ event_id: retryEventId, user_id: uid }));
        await supabase.from('event_participants').upsert(rows as any, { onConflict: 'event_id,user_id' } as any);

        toast({
          title: 'Sucesso!',
          description: 'Refação submetida! Aguardando nova avaliação.'
        });
      } else {
        // Create new event
        const { data: newEvent, error } = await supabase
          .from('events')
          .insert([{
            user_id: user.id,
            challenge_id: challenge.id,
            payload: {
              description,
              ...(evidenceUrls.length > 0 ? { evidence_urls: evidenceUrls } : {}),
              action_date: actionDate || null,
              action_location: actionLocation || null,
              sap_service_note: sapNote || null,
            },
            evidence_urls: evidenceUrls.length > 0 ? evidenceUrls : [],
            action_date: actionDate || null,
            action_location: actionLocation || null,
            sap_service_note: sapNote || null,
            status: challenge.require_two_leader_eval ? 'submitted' : 'evaluated'
          }])
          .select('id')
          .single();

        if (error) throw error;

        // Upsert participants (include me)
        const newEventId = newEvent?.id as string;
        const parts = new Set(selectedParticipants);
        parts.add(user.id);
        const rows = Array.from(parts).map(uid => ({ event_id: newEventId, user_id: uid }));
        await supabase.from('event_participants').upsert(rows as any, { onConflict: 'event_id,user_id' } as any);

        toast({
          title: 'Sucesso!',
          description: challenge.require_two_leader_eval 
            ? 'Ação submetida! Aguardando avaliação de 2 líderes.' 
            : 'Desafio concluído!'
        });
      }

      navigate('/profile');
    } catch (error) {
      console.error('Error submitting:', error);
      const errAny = error as any;
      const msg = [errAny?.message, errAny?.details, errAny?.hint].filter(Boolean).join(" • ");
      if (msg.includes('uq_events_dedup_meta') || msg.includes('duplicate')) {
        toast({ title: 'Ação duplicada', description: 'Já existe uma ação com este desafio, data, local e nota SAP', variant: 'destructive' });
      } else {
        toast({ title: 'Erro', description: msg || 'Não foi possível submeter a ação', variant: 'destructive' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!challenge) return null;

  const theme = domainFromType(challenge.type);

  return (
    <div className="relative min-h-screen bg-background p-4 pb-40 overflow-hidden">
      <ThemedBackground theme={theme} />
      <HelpInfo kind={challenge.type === 'quiz' ? 'quiz' : 'challenge'} />
      <div className="container max-w-2xl mx-auto py-8 space-y-6 relative">
        <Button variant="ghost" onClick={() => navigate('/profile')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar ao Perfil
        </Button>

        {retryEventId && (
          <Card className="border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20">
            <CardContent className="py-4">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
                🔄 Você está refazendo este desafio
              </p>
              <p className="text-xs text-blue-800 dark:text-blue-200">
                Use o feedback anterior para melhorar sua submissão e demonstrar seu aprendizado!
              </p>
            </CardContent>
          </Card>
        )}

        {previousFeedback && (
          <Card className="border-yellow-200 dark:border-yellow-900">
            <CardHeader>
              <CardTitle className="text-sm">Feedback da Tentativa Anterior</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {previousFeedback.positive && (
                <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                  <p className="text-xs font-semibold text-green-900 dark:text-green-100 mb-1">
                    ✅ Pontos Positivos
                  </p>
                  <p className="text-xs text-green-800 dark:text-green-200">
                    {previousFeedback.positive}
                  </p>
                </div>
              )}
              {previousFeedback.constructive && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg">
                  <p className="text-xs font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
                    💡 Áreas de Melhoria
                  </p>
                  <p className="text-xs text-yellow-800 dark:text-yellow-200">
                    {previousFeedback.constructive}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between mb-2">
              <Badge>{challenge.type}</Badge>
              {challenge.reward_mode === 'tier_steps' ? (
                <span className="text-sm font-semibold text-accent">+{challenge.reward_tier_steps || 1} patamar(es)</span>
              ) : challenge.xp_reward > 0 ? (
                <span className="text-sm font-semibold text-accent">+{challenge.xp_reward} XP</span>
              ) : null}
            </div>
            <CardTitle className="text-2xl">{challenge.title}</CardTitle>
            <CardDescription>{challenge.description}</CardDescription>
            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  const url = buildAbsoluteAppUrl(`/challenge/${encodeURIComponent(challenge.id)}`);
                  openWhatsAppShare({
                    message: challenge.type === 'quiz'
                      ? `Participe deste quiz no DJT Quest:\n${challenge.title}`
                      : `Participe deste desafio no DJT Quest:\n${challenge.title}`,
                    url,
                  });
                }}
              >
                Compartilhar no WhatsApp
              </Button>
            </div>
            {challenge.cover_image_url && (
              <div className="mt-3">
                <img src={challenge.cover_image_url} alt="Capa do desafio" className="w-full max-h-64 object-cover rounded-md border" />
              </div>
            )}
            {challenge.require_two_leader_eval && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4 p-3 bg-muted rounded-lg">
                <Shield className="h-4 w-4" />
                Este desafio requer 3 avaliações: 1 líder imediato, 1 outro líder e 1 gerente.
              </div>
            )}
          </CardHeader>
        </Card>

        {challenge.type === 'quiz' ? (
          quizCompleted ? (
            <Card>
              <CardHeader>
                <CardTitle>{/milh(ã|a)o/i.test(challenge.title || '') ? 'Quiz finalizado' : 'Quiz já concluído'}</CardTitle>
                <CardDescription>
                  {/milh(ã|a)o/i.test(challenge.title || '')
                    ? 'Sua última tentativa do Quiz do Milhão já foi finalizada. Você pode jogar novamente para tentar bater seu recorde.'
                    : 'Você já respondeu este quiz. Consulte o histórico no seu perfil.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={resettingAttempt}
                    onClick={resetMyQuizAttempt}
                    className="w-full"
                    title={
                      /milh(ã|a)o/i.test(challenge.title || '')
                        ? 'Zera respostas e libera nova tentativa (mantém recorde e não reduz XP)'
                        : 'Zera respostas e permite responder novamente (sobrescreve pontuação deste quiz)'
                    }
                  >
                    {resettingAttempt
                      ? 'Preparando...'
                      : /milh(ã|a)o/i.test(challenge.title || '')
                        ? 'Jogar novamente (tentar bater recorde)'
                        : 'Refazer quiz (sobrescrever pontos)'}
                  </Button>
                  <Button onClick={() => navigate('/dashboard')} className="w-full">Voltar</Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <QuizPlayer challengeId={challenge.id} />
          )
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{retryEventId ? 'Refazer Ação' : 'Submeter Ação'}</CardTitle>
              <CardDescription>
                {retryEventId 
                  ? 'Revise e melhore sua resposta com base no feedback recebido' 
                  : 'Descreva como você completou este desafio'}
              </CardDescription>
              {/* Ações de gestão (editar/cancelar) apenas para criador ou liderança superior */}
              {user && studioAccess && (
                (challenge.created_by === user.id || ['coordenador_djtx','gerente_divisao_djtx','gerente_djt','admin'].includes(userRole))
              ) && (
                <div className="flex items-center gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => window.location.href = '/studio'}>
                    Editar no Studio
                  </Button>
                  <Button type="button" variant="destructive" onClick={async () => {
                    if (!confirm('Cancelar este desafio para todos?')) return;
                    try {
                      const { error } = await supabase
                        .from('challenges')
                        .update({ status: 'canceled', canceled_at: new Date().toISOString() })
                        .eq('id', challenge.id);
                      if (error) throw error;
                      toast({ title: 'Desafio cancelado' });
                      navigate('/dashboard');
                    } catch (e: any) {
                      toast({ title: 'Falha ao cancelar', description: e?.message || 'Tente novamente', variant: 'destructive' })
                    }
                  }}>
                    Cancelar desafio
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Participants selector */}
              <div>
                <Label>Participantes</Label>
                <p className="text-xs text-muted-foreground">Selecione quem participou com você nesta ação. Você já está incluído.</p>
                <div className="mt-2 flex items-center gap-2">
                  <Input placeholder="Buscar por nome..." value={participantSearch} onChange={(e)=>setParticipantSearch(e.target.value)} className="max-w-sm" />
                </div>
                <div className="mt-2 max-h-64 overflow-auto rounded-md border p-2 space-y-1 bg-black/20">
                  {allUsers
                    .filter(u => (u.name || '').toLowerCase().includes(participantSearch.toLowerCase()))
                    .map(u => {
                      const checked = selectedParticipants.has(u.id) || u.id === user?.id;
                      const disabled = u.id === user?.id;
                      return (
                        <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer select-none px-2 py-1 rounded hover:bg-white/5">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={(e) => {
                              setSelectedParticipants(prev => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(u.id); else next.delete(u.id);
                                return next;
                              })
                            }}
                          />
                          <span className="flex-1">
                            {u.name}
                            {myTeamId && u.team_id === myTeamId && <span className="text-xs text-primary ml-2">(minha equipe)</span>}
                          </span>
                        </label>
                      )
                    })}
                </div>
              </div>
              {!challenge.type.toLowerCase().includes('quiz') && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="action_date">Data da Ação *</Label>
                    <Input id="action_date" type="date" value={actionDate} onChange={(e)=>setActionDate(e.target.value)} className="mt-1" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="action_location">Local/Subestação *</Label>
                    <Input id="action_location" placeholder="Ex.: Subestação XYZ" value={actionLocation} onChange={(e)=>setActionLocation(e.target.value)} className="mt-1" />
                  </div>
                  <div className="sm:col-span-3">
                    <Label htmlFor="sap_note">Nota de Serviço SAP *</Label>
                    <Input id="sap_note" placeholder="Ex.: 4001234567" value={sapNote} onChange={(e)=>setSapNote(e.target.value)} className="mt-1" />
                  </div>
                </div>
              )}
              <div>
                <Label htmlFor="description">Descrição da Ação *</Label>
                <Textarea
                  id="description"
                  placeholder="Descreva detalhadamente a ação realizada, contexto, resultados e aprendizados... (mínimo 50 caracteres)"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={6}
                  className="mt-2"
                />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-xs text-muted-foreground">
                    Você pode digitar ou falar. Use a varinha para corrigir ortografia e pontuação.
                  </p>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={async () => {
                      const text = description.trim();
                      if (text.length < 3) return;
                      try {
                        const resp = await apiFetch('/api/ai?handler=cleanup-text', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ title: 'Descrição da ação', description: text, language: localeToOpenAiLanguageTag(getActiveLocale()) }),
                        });
                        const json = await resp.json().catch(() => ({}));
                        const usedAI = json?.meta?.usedAI !== false;
                        if (!resp.ok || !json?.cleaned?.description) throw new Error(json?.error || 'Falha na revisão automática');
                        if (!usedAI) {
                          toast({ title: 'Não foi possível revisar agora', description: 'IA indisponível no momento. Tente novamente mais tarde.', variant: 'destructive' });
                          return;
                        }
                        const cleaned = String(json.cleaned.description || text).trim();
                        if (cleaned === text) {
                          toast({ title: 'Nenhuma correção necessária', description: 'Não encontrei ajustes de ortografia/pontuação para fazer.' });
                          return;
                        }
                        setDescription(cleaned);
                        toast({ title: 'Texto revisado', description: 'Ortografia e pontuação ajustadas.' });
                      } catch (e: any) {
                        toast({ title: 'Não foi possível revisar agora', description: e?.message || 'Tente novamente mais tarde.', variant: 'destructive' });
                      }
                    }}
                    title="Revisar ortografia e pontuação (sem mudar conteúdo)"
                  >
                    {/* use same Wand icon from lucide-react already in other files */}
                    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 20 19 6l-1.5-1.5L3.5 18.5 5 20zm11-14 1-4 1 4 4 1-4 1-1 4-1-4-4-1 4-1zM3 9l.5-2L6 6.5 4.5 8 4 10 3 9z" />
                    </svg>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {description.length}/50 caracteres mínimos
                </p>

                {/* Áudio integrado à descrição: gravar/anexar e transcrever para preencher o texto */}
                <div className="mt-3 space-y-2">
                  <Label className="text-xs">Preferir falar? Grave ou anexe um áudio e nós transcrevemos e organizamos com IA.</Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <VoiceRecorderButton
                        size="sm"
                        label="Gravar áudio"
                        onText={(text) => {
                          const merged = [description, text].filter(Boolean).join('\n\n');
                          setDescription(merged);
                        }}
                      />
                      <Input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] || null)} className="sm:max-w-[360px]" />
                      {audioFile && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setAudioFile(null)}>
                          Remover áudio
                        </Button>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!audioFile || transcribing}
                      onClick={async () => {
                        if (!audioFile) return;
                        try {
                          setTranscribing(true);
                          if (audioFile.size > 12 * 1024 * 1024) {
                            throw new Error('Arquivo muito grande. Envie um áudio menor (até 12MB).');
                          }
                          const toBase64 = (f: File) =>
                            new Promise<string>((resolve, reject) => {
                              const reader = new FileReader();
                              reader.onload = () => resolve(String(reader.result));
                              reader.onerror = reject;
                              reader.readAsDataURL(f);
                            });
                          const b64 = await toBase64(audioFile);
                          const resp = await apiFetch('/api/ai?handler=transcribe-audio', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ audioBase64: b64, mode: 'organize', language: localeToSpeechLanguage(getActiveLocale()) })
                          });
                          const json = await resp.json().catch(() => ({}));
                          if (!resp.ok) throw new Error(json?.error || 'Falha na transcrição');
                          const merged = [description, json.text || json.summary || json.transcript].filter(Boolean).join('\n\n');
                          setDescription(merged);
                          toast({ title: 'Áudio organizado', description: 'Texto inserido na descrição' })
                        } catch (e: any) {
                          toast({ title: 'Falha ao transcrever', description: e?.message || 'Tente novamente', variant: 'destructive' })
                        } finally {
                          setTranscribing(false);
                        }
                      }}
                    >
                      {transcribing ? 'Transcrevendo...' : 'Organizar áudio'}
                    </Button>
                  </div>
                  {audioPreviewUrl && (
                    <audio controls src={audioPreviewUrl} className="w-full" />
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    Dica: prefira gravações curtas (20–45s) para melhor qualidade e rapidez na transcrição.
                  </p>
                </div>
              </div>

	              <div className="space-y-2">
	                <Label>Evidências (fotos/vídeos/arquivos — opcional, máximo 5)</Label>
	                <AttachmentUploader
	                  onAttachmentsChange={setEvidenceUrls}
	                  maxFiles={5}
	                  maxImages={3}
	                  maxVideos={2}
	                  maxSizeMB={50}
	                  bucket="evidence"
	                  pathPrefix={`challenge-evidence/${challenge.id}`}
	                  acceptMimeTypes={[
	                    "image/jpeg",
	                    "image/png",
	                    "image/webp",
	                    "image/gif",
	                    "image/heic",
	                    "image/heif",
	                    "image/avif",
	                    "video/mp4",
	                    "video/webm",
	                    "video/quicktime",
	                    "application/pdf",
	                  ]}
	                  capture="environment"
	                  maxVideoSeconds={60}
	                  maxVideoDimension={1920}
	                  maxImageDimension={3840}
	                  imageQuality={0.82}
	                  onUploadingChange={setEvidenceUploading}
	                />
	                <p className="text-[11px] text-muted-foreground">
	                  Se este desafio exigir evidência, anexe ao menos 1 item. Limite padrão: 3 fotos + 2 vídeos.
	                </p>
	              </div>


	              <Button 
	                onClick={handleSubmit} 
	                disabled={submitting || evidenceUploading || description.length < 50 || (challenge.evidence_required && evidenceUrls.length < 1) || evidenceUrls.length > 5}
	                className="w-full"
	              >
                {submitting ? 'Submetendo...' : retryEventId ? 'Submeter Refação' : 'Submeter Ação'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Ações de gerenciamento para QUIZ (apenas líderes com acesso ao Studio) */}
        {challenge.type?.toLowerCase?.().includes('quiz') && user && studioAccess && isLeader && (
          <Card>
            <CardHeader>
              <CardTitle>Gerenciar Quiz</CardTitle>
              <CardDescription>
                Status atual: <strong>{(challenge.status || 'active').toUpperCase()}</strong>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {/milh(ã|a)o/i.test(challenge.title || '') && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reopening}
                    onClick={() => reopenMyMilhaoAttempts('current')}
                    title="Reabre sua tentativa (para re-teste das regras novas)"
                  >
                    {reopening ? 'Reabrindo...' : 'Reabrir minha tentativa'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={reopening}
                    onClick={() => reopenMyMilhaoAttempts('latest2')}
                    title="Reabre as tentativas dos 2 quizzes mais recentes do Milhão"
                  >
                    {reopening ? 'Reabrindo...' : 'Reabrir 2 últimos do Milhão'}
                  </Button>
                </>
              )}
              <Button type="button" variant="outline" onClick={async () => {
                try {
                  // Try API route first, fallback to direct update
                  try {
                    const { data: session } = await supabase.auth.getSession();
                    const token = session.session?.access_token;
                    const resp = await fetch('/api/admin?handler=challenges-update-status', {
                      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                      body: JSON.stringify({ id: challenge.id, status: 'active' })
                    });
                    if (!resp.ok) {
                      const j = await resp.json().catch(()=>({}));
                      throw new Error(j?.error || 'Falha ao reabrir');
                    }
                  } catch (e) {
                    const { error } = await supabase.from('challenges').update({ status: 'active' }).eq('id', challenge.id);
                    if (error) throw error;
                  }
                  toast({ title: 'Quiz reaberto para coleta' });
                  setChallenge({ ...challenge, status: 'active' });
                } catch (e: any) {
                  toast({ title: 'Falha ao reabrir', description: e?.message || 'Tente novamente', variant: 'destructive' })
                }
              }}>Reabrir Coleta</Button>

              <Button type="button" variant="secondary" onClick={async () => {
                try {
                  try {
                    const { data: session } = await supabase.auth.getSession();
                    const token = session.session?.access_token;
                    const resp = await fetch('/api/admin?handler=challenges-update-status', {
                      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                      body: JSON.stringify({ id: challenge.id, status: 'closed' })
                    });
                    if (!resp.ok) {
                      const j = await resp.json().catch(()=>({}));
                      throw new Error(j?.error || 'Falha ao encerrar');
                    }
                  } catch (e) {
                    const { error } = await supabase.from('challenges').update({ status: 'closed' }).eq('id', challenge.id);
                    if (error) throw error;
                  }
                  toast({ title: 'Coleta encerrada' });
                  setChallenge({ ...challenge, status: 'closed' });
                } catch (e: any) {
                  toast({ title: 'Falha ao encerrar', description: e?.message || 'Tente novamente', variant: 'destructive' })
                }
              }}>Encerrar Coleta</Button>

              <Button type="button" variant="destructive" onClick={async () => {
                if (!confirm('Cancelar este quiz? Os usuários não poderão mais responder.')) return;
                try {
                  const { error } = await supabase.from('challenges').update({ status: 'canceled' }).eq('id', challenge.id);
                  if (error) throw error;
                  toast({ title: 'Quiz cancelado' });
                  setChallenge({ ...challenge, status: 'canceled' });
                } catch (e: any) {
                  toast({ title: 'Falha ao cancelar', description: e?.message || 'Tente novamente', variant: 'destructive' })
                }
              }}>Cancelar Quiz</Button>

              <Button type="button" variant="destructive" onClick={async () => {
                if (!confirm('Excluir este quiz definitivamente? Esta ação não poderá ser desfeita.')) return;
                try {
                  // Try service API first, fallback to direct delete
                  try {
                    const { data: session } = await supabase.auth.getSession();
                    const token = session.session?.access_token;
                    const resp = await fetch('/api/admin?handler=challenges-delete', {
                      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                      body: JSON.stringify({ id: challenge.id })
                    });
                    const j = await resp.json().catch(()=>({}));
                    if (!resp.ok) throw new Error(j?.error || 'Falha ao excluir');
                  } catch (e) {
                    const { error } = await supabase.from('challenges').delete().eq('id', challenge.id);
                    if (error) throw error;
                  }
                  toast({ title: 'Quiz excluído' });
                  navigate('/studio');
                } catch (e: any) {
                  toast({ title: 'Falha ao excluir', description: e?.message || 'Tente novamente', variant: 'destructive' })
                }
              }}>Excluir Quiz</Button>
              <Button type="button" variant="outline" onClick={() => setShowAnalytics((v)=>!v)}>
                <BarChart3 className="h-4 w-4 mr-2" /> Histórico
              </Button>
            </CardContent>
          </Card>
        )}

        {showAnalytics && challenge.type?.toLowerCase?.() === 'quiz' && (
          <QuizAnalytics challengeId={challenge.id} />
        )}
      </div>
    </div>
  );
};

export default ChallengeDetail;
