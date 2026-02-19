import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.90.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TierPrefix = 'EX' | 'FO' | 'GU';
const TIER_THRESHOLDS: Record<TierPrefix, number[]> = {
  EX: [0, 300, 700, 1200, 1800],
  FO: [0, 400, 900, 1500, 2200],
  GU: [0, 500, 1100, 1800, 2600],
};

const parseTier = (tierRaw: unknown): { prefix: TierPrefix; level: number } | null => {
  const tier = (tierRaw ?? '').toString().trim().toUpperCase();
  const match = tier.match(/^(EX|FO|GU)\s*-\s*([1-5])$/);
  if (!match) return null;
  const prefix = match[1] as TierPrefix;
  const level = Number(match[2]);
  if (!Number.isFinite(level) || level < 1 || level > 5) return null;
  return { prefix, level };
};

const clampInt = (n: number, min: number, max: number) => {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
};

const FEEDBACK_MIN_CHARS = 10;

const normalizeTeamId = (raw: unknown) => String(raw ?? '').trim().toUpperCase();
const isGuestTeamId = (raw: unknown) => {
  const id = normalizeTeamId(raw);
  return id === 'CONVIDADOS' || id === 'EXTERNO';
};

const scoreToRating10 = (scoresRaw: unknown) => {
  if (!scoresRaw || typeof scoresRaw !== 'object') return null;
  const values = Object.values(scoresRaw as Record<string, unknown>)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  if (!values.length) return null;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.max(0, Math.min(10, Math.round(avg * 2 * 10) / 10));
};

const ensureOk = (result: { error?: any }, message: string) => {
  if (result?.error) {
    const detail = result.error?.message || String(result.error);
    throw new Error(`${message}: ${detail}`);
  }
};

const xpNeededToAdvanceTierSteps = (params: { currentXp: number; currentTier: unknown; steps: number }) => {
  const { currentXp, currentTier, steps } = params;
  const parsed = parseTier(currentTier);
  if (!parsed) return 0;

  const { prefix, level } = parsed;
  const thresholds = TIER_THRESHOLDS[prefix];
  const targetLevel = clampInt(level + steps, 1, 5);
  const targetThreshold = thresholds[targetLevel - 1] ?? thresholds[thresholds.length - 1] ?? 0;
  const needed = Math.max(0, targetThreshold - (Number(currentXp) || 0));
  return Math.floor(needed);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Verificar que o usuário é líder
    const { data: reviewer, error: reviewerError } = await supabase
      .from('profiles')
      .select('is_leader, studio_access, coord_id, name')
      .eq('id', user.id)
      .single();

    const { data: rolesData } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
    const roleSet = new Set((rolesData || []).map((r: any) => String(r?.role || '')));
    const isStaff =
      roleSet.has('admin') ||
      roleSet.has('gerente_djt') ||
      roleSet.has('gerente_divisao_djtx') ||
      roleSet.has('coordenador_djtx');
    const reviewerLevel = roleSet.has('coordenador_djtx') ? 'coordenacao' : 'divisao';

    if (reviewerError || (!reviewer?.is_leader && !reviewer?.studio_access && !isStaff)) {
      throw new Error('Apenas líderes podem avaliar');
    }

    const body = await req.json();
    const { eventId, scores, feedbackPositivo, feedbackConstrutivo } = body;
    let action = (body?.action ?? '').toString().trim().toLowerCase();
    let rating = body?.rating;

    // Backwards compatibility: older clients may omit action/rating and only send scores.
    if (!action && scores) action = 'approve';
    if ((rating === null || rating === undefined || !Number.isFinite(Number(rating))) && action === 'approve') {
      const computed = scoreToRating10(scores);
      if (computed !== null) rating = computed;
    }

    if (!eventId) {
      throw new Error('eventId obrigatório');
    }

    // Buscar evento com dados do colaborador
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        *,
        user:profiles!events_user_id_fkey(id, name, coord_id, team_id, division_id, sigla_area, operational_base, xp, tier),
        challenge:challenges(id, campaign_id, title, xp_reward, reward_mode, reward_tier_steps, require_two_leader_eval, type)
      `)
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      throw new Error('Evento não encontrado');
    }

    const challenge = event.challenge ?? {
      id: null,
      campaign_id: null,
      title: 'Evidência de campanha',
      xp_reward: 0,
      reward_mode: null,
      reward_tier_steps: null,
      require_two_leader_eval: true,
      type: 'campaign_evidence',
    };
    const challengeTitle = String((challenge as any)?.title || 'Evidência de campanha');
    const collaborator = event.user;
    const isCampaignEvidence = String((event as any)?.payload?.source || '').trim() === 'campaign_evidence';
    const isCampaignEvent = isCampaignEvidence || Boolean((challenge as any)?.campaign_id);

    // Guest override: campaign actions from guests are evaluated by Rodrigo Nascimento only (single eval).
    let collaboratorRoles: string[] = [];
    try {
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', collaborator.id);
      collaboratorRoles = Array.isArray(data) ? data.map((r: any) => String(r?.role || '')).filter(Boolean) : [];
    } catch {
      collaboratorRoles = [];
    }
    const isGuestCollaborator =
      collaboratorRoles.includes('invited') ||
      isGuestTeamId((collaborator as any)?.team_id) ||
      isGuestTeamId((collaborator as any)?.sigla_area) ||
      isGuestTeamId((collaborator as any)?.operational_base) ||
      isGuestTeamId((collaborator as any)?.coord_id) ||
      isGuestTeamId((collaborator as any)?.division_id);

    const guestCampaignOverride = isGuestCollaborator && isCampaignEvent;
    let rodrigoAdminId: string | null = null;

    if (guestCampaignOverride) {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id')
          .ilike('email', 'rodrigonasc@cpfl.com.br')
          .limit(1)
          .maybeSingle();
        rodrigoAdminId = data?.id ? String(data.id) : null;
      } catch {
        rodrigoAdminId = null;
      }

      if (!rodrigoAdminId) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('id')
            .ilike('name', 'rodrigo% nascimento%')
            .limit(1)
            .maybeSingle();
          rodrigoAdminId = data?.id ? String(data.id) : null;
        } catch {
          rodrigoAdminId = null;
        }
      }

      // Best-effort: ensure evaluation queue is reassigned according to business rule.
      try {
        await supabase.rpc('assign_evaluators_for_event', { _event_id: eventId });
      } catch {
        /* ignore */
      }

      if (rodrigoAdminId && user.id !== rodrigoAdminId) {
        throw new Error('Ações de convidados em campanhas são avaliadas somente por Rodrigo Nascimento.');
      }
      if (!rodrigoAdminId) {
        throw new Error('Configuração inválida: avaliador admin (Rodrigo) não encontrado.');
      }
    }

    // Garantir que o líder está atribuído na fila (regra de negócio: líder imediato + líder randômico)
    const { data: queueRow } = await supabase
      .from('evaluation_queue')
      .select('id, completed_at')
      .eq('event_id', eventId)
      .eq('assigned_to', user.id)
      .is('completed_at', null)
      .maybeSingle();

    if (!queueRow?.id) {
      throw new Error('Você não está atribuído para avaliar esta ação (fila de avaliações).');
    }

    const markEvaluationDone = async () => {
      const nowIso = new Date().toISOString();
      try {
        await supabase
          .from('evaluation_queue')
          .update({ completed_at: nowIso })
          .eq('event_id', eventId)
          .eq('assigned_to', user.id)
          .is('completed_at', null);
      } catch {
        /* ignore */
      }

      // Best-effort: mark the assignment notification as read once evaluated
      try {
        await supabase
          .from('notifications')
          .update({ read: true, read_at: nowIso })
          .eq('user_id', user.id)
          .eq('type', 'evaluation_assigned')
          .eq('metadata->>event_id', String(eventId))
          .eq('read', false);
      } catch {
        /* ignore */
      }
    };

    // **APROVAR AÇÃO**
    if (action === 'approve') {
      const ratingNumber = rating === null || rating === undefined ? Number.NaN : Number(rating);
      if (!Number.isFinite(ratingNumber) || ratingNumber < 0 || ratingNumber > 10) {
        throw new Error('Nota deve estar entre 0 e 10');
      }

      if (!feedbackPositivo || feedbackPositivo.trim().length < FEEDBACK_MIN_CHARS) {
        throw new Error(`Feedback positivo deve ter no mínimo ${FEEDBACK_MIN_CHARS} caracteres`);
      }
      if (!feedbackConstrutivo || feedbackConstrutivo.trim().length < FEEDBACK_MIN_CHARS) {
        throw new Error(`Feedback construtivo deve ter no mínimo ${FEEDBACK_MIN_CHARS} caracteres`);
      }

      // Verificar se requer dupla avaliação
      const requiresTwoBase = Boolean((challenge as any)?.require_two_leader_eval);
      let existingEvals: any[] = [];
      let evalCount = 0;
      if (requiresTwoBase || guestCampaignOverride) {
        const { data, error: evalsError } = await supabase
          .from('action_evaluations')
          .select('*')
          .eq('event_id', eventId)
          .order('created_at');
        ensureOk({ error: evalsError }, 'Erro ao buscar avaliações existentes');
        existingEvals = Array.isArray(data) ? data : [];
        evalCount = existingEvals.length || 0;
      }

      if (guestCampaignOverride && existingEvals.some((e: any) => String(e?.reviewer_id || '') === user.id)) {
        throw new Error('Esta ação já foi avaliada.');
      }

      const requiresTwo = requiresTwoBase && !guestCampaignOverride;

      if (requiresTwo) {
        // Contar avaliações existentes
        if (evalCount === 0) {
          // ✅ PRIMEIRA AVALIAÇÃO
          const insertEval = await supabase
            .from('action_evaluations')
            .insert({
              event_id: eventId,
              reviewer_id: user.id,
              reviewer_level: reviewerLevel,
              evaluation_number: 1,
              rating: ratingNumber,
              scores: scores || {},
              feedback_positivo: feedbackPositivo,
              feedback_construtivo: feedbackConstrutivo || ''
            });
          ensureOk(insertEval, 'Falha ao registrar 1ª avaliação');

          const updateEvent = await supabase
            .from('events')
            .update({
              status: 'awaiting_second_evaluation',
              first_evaluator_id: user.id,
              first_evaluation_rating: ratingNumber,
              awaiting_second_evaluation: true,
              updated_at: new Date().toISOString()
          })
            .eq('id', eventId)
            .neq('status', 'approved');
          ensureOk(updateEvent, 'Falha ao atualizar evento para 2ª avaliação');

          // Garantir 2º avaliador (idempotente; baseado na função do banco)
          try {
            const { error: assignError } = await supabase.rpc('assign_evaluators_for_event', { _event_id: eventId });
            if (assignError) {
              console.warn('assign_evaluators_for_event falhou (best-effort):', assignError.message || assignError);
            }
          } catch (err) {
            console.warn('assign_evaluators_for_event falhou (best-effort):', err);
          }

          // Notificar colaborador
          await supabase.rpc('create_notification', {
            _user_id: collaborator.id,
            _type: 'evaluation_partial',
            _title: '1ª Avaliação Concluída',
            _message: `Sua ação "${challengeTitle}" recebeu a 1ª avaliação: ${ratingNumber}/10. Aguardando 2ª avaliação...`,
            _metadata: { 
              event_id: eventId, 
              rating: ratingNumber,
              reviewer_name: reviewer.name
            }
          });

          await markEvaluationDone();

          console.log('First evaluation completed:', { eventId, rating: ratingNumber });

          return new Response(
            JSON.stringify({
              success: true,
              message: '1ª avaliação registrada com sucesso. Aguardando 2ª avaliação.',
              evaluation_number: 1,
              rating: ratingNumber
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );

        } else if (evalCount === 1) {
          // ✅ SEGUNDA AVALIAÇÃO
          const firstEval = existingEvals[0];
          if (firstEval?.reviewer_id === user.id) {
            throw new Error('O 2º avaliador deve ser diferente do 1º avaliador');
          }

          // Validar que é de coordenação diferente do 1º avaliador
          const { data: firstReviewer } = await supabase
            .from('profiles')
            .select('coord_id')
            .eq('id', firstEval.reviewer_id)
            .single();

          if (firstReviewer && reviewer.coord_id === firstReviewer.coord_id) {
            throw new Error('2º avaliador deve ser de coordenação diferente do 1º avaliador');
          }

          // Calcular média e XP final
          const avgRating = (firstEval.rating + ratingNumber) / 2;
          const qualityScore = avgRating / 10;

          // Aplicar penalidade de retry
          const retryPenalty = event.retry_count === 0 ? 1.0 :
                               event.retry_count === 1 ? 0.8 :
                               event.retry_count === 2 ? 0.6 : 0.4;

          const teamModifier = event.team_modifier_applied || 1.0;
          const rewardMode = String((challenge as any)?.reward_mode || '').trim();
          let baseRewardXp = Number((challenge as any)?.xp_reward || 0);
          if (rewardMode === 'tier_steps') {
            const steps = clampInt(Number((challenge as any)?.reward_tier_steps || 1), 1, 5);
            baseRewardXp = xpNeededToAdvanceTierSteps({
              currentXp: Number((collaborator as any)?.xp) || 0,
              currentTier: (collaborator as any)?.tier,
              steps,
            });
          }
          const finalXP = Math.floor(
            baseRewardXp * qualityScore * retryPenalty * teamModifier
          );

          // Inserir 2ª avaliação
          const insertEval2 = await supabase
            .from('action_evaluations')
            .insert({
              event_id: eventId,
              reviewer_id: user.id,
              reviewer_level: reviewerLevel,
              evaluation_number: 2,
              rating: ratingNumber,
              final_rating: avgRating,
              scores: scores || {},
              feedback_positivo: feedbackPositivo,
              feedback_construtivo: feedbackConstrutivo || ''
            });
          ensureOk(insertEval2, 'Falha ao registrar 2ª avaliação');

          // Atualizar evento com status approved
          const updateEvent2 = await supabase
            .from('events')
            .update({
              status: 'approved',
              first_evaluator_id: firstEval.reviewer_id,
              first_evaluation_rating: firstEval.rating,
              second_evaluator_id: user.id,
              second_evaluation_rating: ratingNumber,
              quality_score: qualityScore,
              final_points: finalXP,
              points_calculated: finalXP,
              awaiting_second_evaluation: false,
              updated_at: new Date().toISOString()
            })
            .eq('id', eventId);
          ensureOk(updateEvent2, 'Falha ao concluir avaliação (evento)');

          // Incrementar XP do usuário via RPC
          const inc = await supabase.rpc('increment_user_xp', {
            _user_id: collaborator.id,
            _xp_to_add: finalXP
          });
          ensureOk(inc, 'Falha ao aplicar XP');

          // Notificar colaborador com resultado completo
          try {
            await supabase.rpc('create_notification', {
              _user_id: collaborator.id,
              _type: 'evaluation_complete',
              _title: '✅ Ação Aprovada!',
              _message: `Sua ação "${challengeTitle}" foi aprovada!\n\n📊 Avaliações:\n1ª: ${firstEval.rating}/10\n2ª: ${ratingNumber}/10\n\n⭐ Média Final: ${avgRating.toFixed(1)}/10\n\n🎯 Você ganhou ${finalXP} XP!`,
              _metadata: {
                event_id: eventId,
                first_rating: firstEval.rating,
                second_rating: ratingNumber,
                average_rating: avgRating,
                xp_earned: finalXP,
                retry_penalty: retryPenalty
              }
            });
          } catch {
            // best-effort
          }

          await markEvaluationDone();

          console.log('Second evaluation completed:', { eventId, avgRating, finalXP, rating: ratingNumber });

          return new Response(
            JSON.stringify({
              success: true,
              message: 'Avaliação completa!',
              evaluation_number: 2,
              first_rating: firstEval.rating,
              second_rating: ratingNumber,
              average_rating: avgRating,
              final_xp: finalXP
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );

        } else {
          throw new Error('Evento já possui 2 avaliações');
        }

      } else {
        // ✅ AVALIAÇÃO SIMPLES (não requer dupla)
        const qualityScore = ratingNumber / 10;
        const retryPenalty = event.retry_count === 0 ? 1.0 :
                             event.retry_count === 1 ? 0.8 :
                             event.retry_count === 2 ? 0.6 : 0.4;
        const teamModifier = event.team_modifier_applied || 1.0;
        const rewardMode = String((challenge as any)?.reward_mode || '').trim();
        let baseRewardXp = Number((challenge as any)?.xp_reward || 0);
        if (rewardMode === 'tier_steps') {
          const steps = clampInt(Number((challenge as any)?.reward_tier_steps || 1), 1, 5);
          baseRewardXp = xpNeededToAdvanceTierSteps({
            currentXp: Number((collaborator as any)?.xp) || 0,
            currentTier: (collaborator as any)?.tier,
            steps,
          });
        }
        const finalXP = Math.floor(
          baseRewardXp * qualityScore * retryPenalty * teamModifier
        );

        const ins1 = await supabase
          .from('action_evaluations')
          .insert({
            event_id: eventId,
            reviewer_id: user.id,
            reviewer_level: reviewerLevel,
            evaluation_number: 1,
            rating: ratingNumber,
            final_rating: ratingNumber,
            scores: scores || {},
            feedback_positivo: feedbackPositivo,
            feedback_construtivo: feedbackConstrutivo || ''
          });
        ensureOk(ins1, 'Falha ao registrar avaliação');

        const upd = await supabase
          .from('events')
          .update({
            status: 'approved',
            first_evaluator_id: user.id,
            first_evaluation_rating: ratingNumber,
            quality_score: qualityScore,
            final_points: finalXP,
            points_calculated: finalXP,
            updated_at: new Date().toISOString()
          })
          .eq('id', eventId);
        ensureOk(upd, 'Falha ao aprovar evento');

        const inc2 = await supabase.rpc('increment_user_xp', {
          _user_id: collaborator.id,
          _xp_to_add: finalXP
        });
        ensureOk(inc2, 'Falha ao aplicar XP');

        try {
          await supabase.rpc('create_notification', {
            _user_id: collaborator.id,
            _type: 'evaluation_complete',
            _title: '✅ Ação Aprovada!',
            _message: `Sua ação "${challengeTitle}" foi aprovada!\n\n⭐ Nota: ${ratingNumber}/10\n🎯 Você ganhou ${finalXP} XP!`,
            _metadata: {
              event_id: eventId,
              rating: ratingNumber,
              xp_earned: finalXP
            }
          });
        } catch {
          // best-effort
        }

        await markEvaluationDone();

        console.log('Simple evaluation completed:', { eventId, rating: ratingNumber, finalXP });

        return new Response(
            JSON.stringify({
              success: true,
              message: 'Ação aprovada com sucesso!',
              rating: ratingNumber,
              final_xp: finalXP
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
      }
    }

    // **REJEITAR AÇÃO**
    if (action === 'reject') {
      if (!feedbackConstrutivo || feedbackConstrutivo.trim().length < FEEDBACK_MIN_CHARS) {
        throw new Error(`Feedback construtivo deve ter no mínimo ${FEEDBACK_MIN_CHARS} caracteres para rejeição`);
      }

      await supabase
        .from('events')
        .update({
          status: 'rejected',
          updated_at: new Date().toISOString()
        })
        .eq('id', eventId);

      await supabase.rpc('create_notification', {
        _user_id: collaborator.id,
        _type: 'evaluation_rejected',
        _title: '❌ Ação Rejeitada',
        _message: `Sua ação "${challengeTitle}" foi rejeitada. Veja o feedback para mais detalhes.`,
        _metadata: {
          event_id: eventId,
          feedback: feedbackConstrutivo
        }
      });

      await markEvaluationDone();

      console.log('Action rejected:', { eventId });

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Ação rejeitada'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // **SOLICITAR RETRY**
    if (action === 'retry') {
      if (!feedbackConstrutivo || feedbackConstrutivo.trim().length < FEEDBACK_MIN_CHARS) {
        throw new Error(`Feedback construtivo deve ter no mínimo ${FEEDBACK_MIN_CHARS} caracteres para retry`);
      }

      await supabase
        .from('events')
        .update({
          status: 'retry_pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', eventId);

      await supabase.rpc('create_notification', {
        _user_id: collaborator.id,
        _type: 'evaluation_retry',
        _title: '🔄 Retry Solicitado',
        _message: `Sua ação "${challengeTitle}" precisa de ajustes. Veja o feedback e tente novamente.`,
        _metadata: {
          event_id: eventId,
          feedback: feedbackConstrutivo
        }
      });

      await markEvaluationDone();

      console.log('Retry requested:', { eventId });

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Retry solicitado'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('Ação inválida');

  } catch (error: any) {
    console.error('Error in studio-evaluations:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
