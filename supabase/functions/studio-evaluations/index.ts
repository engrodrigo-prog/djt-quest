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

const findImmediateLeaderId = async (supabase: any, params: { submitterId: string; teamId?: string | null }) => {
  const { submitterId, teamId } = params;
  if (!teamId) return null;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('is_leader', true)
      .eq('team_id', teamId)
      .neq('id', submitterId)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.id ? String(data.id) : null;
  } catch {
    return null;
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
      .select('is_leader, coord_id, name')
      .eq('id', user.id)
      .single();

    if (reviewerError || !reviewer?.is_leader) {
      throw new Error('Apenas líderes podem avaliar');
    }

    const body = await req.json();
    const { eventId, action, rating, scores, feedbackPositivo, feedbackConstrutivo } = body;
    if (!eventId) {
      throw new Error('eventId obrigatório');
    }

    // Buscar evento com dados do colaborador
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select(`
        *,
        user:profiles!events_user_id_fkey(id, name, coord_id, team_id, division_id, xp, tier),
        challenge:challenges(id, title, xp_reward, reward_mode, reward_tier_steps, require_two_leader_eval, type)
      `)
      .eq('id', eventId)
      .single();

    if (eventError || !event) {
      throw new Error('Evento não encontrado');
    }

    const challenge = event.challenge;
    const collaborator = event.user;
    const immediateLeaderId = await findImmediateLeaderId(supabase, {
      submitterId: String(event.user_id),
      teamId: collaborator?.team_id ?? null,
    });

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
      if (rating === null || rating === undefined || rating < 0 || rating > 10) {
        throw new Error('Nota deve estar entre 0 e 10');
      }

      if (!feedbackPositivo || feedbackPositivo.trim().length < FEEDBACK_MIN_CHARS) {
        throw new Error(`Feedback positivo deve ter no mínimo ${FEEDBACK_MIN_CHARS} caracteres`);
      }
      if (!feedbackConstrutivo || feedbackConstrutivo.trim().length < FEEDBACK_MIN_CHARS) {
        throw new Error(`Feedback construtivo deve ter no mínimo ${FEEDBACK_MIN_CHARS} caracteres`);
      }

      // Verificar se requer dupla avaliação
      if (challenge.require_two_leader_eval) {
        // Contar avaliações existentes
        const { data: existingEvals, error: evalsError } = await supabase
          .from('action_evaluations')
          .select('*')
          .eq('event_id', eventId)
          .order('created_at');

        if (evalsError) {
          throw new Error('Erro ao buscar avaliações existentes');
        }

        const evalCount = existingEvals?.length || 0;

        if (evalCount === 0) {
          if (immediateLeaderId && String(immediateLeaderId) !== String(user.id)) {
            try {
              const { data: immediateQueue } = await supabase
                .from('evaluation_queue')
                .select('id, completed_at')
                .eq('event_id', eventId)
                .eq('assigned_to', immediateLeaderId)
                .maybeSingle();
              if (immediateQueue?.id && !immediateQueue.completed_at) {
                throw new Error('A 1ª avaliação deve ser feita pelo líder imediato da equipe.');
              }
            } catch (err) {
              if (err instanceof Error) throw err;
            }
          }
          // ✅ PRIMEIRA AVALIAÇÃO
          await supabase
            .from('action_evaluations')
            .insert({
              event_id: eventId,
              reviewer_id: user.id,
              reviewer_level: 'coordenador_djtx',
              evaluation_number: 1,
              rating: rating,
              scores: scores || {},
              feedback_positivo: feedbackPositivo,
              feedback_construtivo: feedbackConstrutivo || ''
            });

          await supabase
            .from('events')
            .update({
              status: 'awaiting_second_evaluation',
              first_evaluator_id: user.id,
              first_evaluation_rating: rating,
              awaiting_second_evaluation: true,
              updated_at: new Date().toISOString()
            })
            .eq('id', eventId);

          // Garantir 2º avaliador (idempotente; baseado na função do banco)
          await supabase.rpc('assign_evaluators_for_event', { _event_id: eventId }).catch(() => {});

          // Notificar colaborador
          await supabase.rpc('create_notification', {
            _user_id: collaborator.id,
            _type: 'evaluation_partial',
            _title: '1ª Avaliação Concluída',
            _message: `Sua ação "${challenge.title}" recebeu a 1ª avaliação: ${rating}/10. Aguardando 2ª avaliação...`,
            _metadata: { 
              event_id: eventId, 
              rating: rating,
              reviewer_name: reviewer.name
            }
          });

          await markEvaluationDone();

          console.log('First evaluation completed:', { eventId, rating });

          return new Response(
            JSON.stringify({
              success: true,
              message: '1ª avaliação registrada com sucesso. Aguardando 2ª avaliação.',
              evaluation_number: 1,
              rating: rating
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
          const avgRating = (firstEval.rating + rating) / 2;
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
          await supabase
            .from('action_evaluations')
            .insert({
              event_id: eventId,
              reviewer_id: user.id,
              reviewer_level: 'coordenador_djtx',
              evaluation_number: 2,
              rating: rating,
              final_rating: avgRating,
              scores: scores || {},
              feedback_positivo: feedbackPositivo,
              feedback_construtivo: feedbackConstrutivo || ''
            });

          // Atualizar evento com status approved
          await supabase
            .from('events')
            .update({
              status: 'approved',
              second_evaluator_id: user.id,
              second_evaluation_rating: rating,
              quality_score: qualityScore,
              final_points: finalXP,
              awaiting_second_evaluation: false,
              updated_at: new Date().toISOString()
            })
            .eq('id', eventId);

          // Incrementar XP do usuário via RPC
          await supabase.rpc('increment_user_xp', {
            _user_id: collaborator.id,
            _xp_to_add: finalXP
          });

          // Notificar colaborador com resultado completo
          await supabase.rpc('create_notification', {
            _user_id: collaborator.id,
            _type: 'evaluation_complete',
            _title: '✅ Ação Aprovada!',
            _message: `Sua ação "${challenge.title}" foi aprovada!\n\n📊 Avaliações:\n1ª: ${firstEval.rating}/10\n2ª: ${rating}/10\n\n⭐ Média Final: ${avgRating.toFixed(1)}/10\n\n🎯 Você ganhou ${finalXP} XP!`,
            _metadata: {
              event_id: eventId,
              first_rating: firstEval.rating,
              second_rating: rating,
              average_rating: avgRating,
              xp_earned: finalXP,
              retry_penalty: retryPenalty
            }
          });

          await markEvaluationDone();

          console.log('Second evaluation completed:', { eventId, avgRating, finalXP });

          return new Response(
            JSON.stringify({
              success: true,
              message: 'Avaliação completa!',
              evaluation_number: 2,
              first_rating: firstEval.rating,
              second_rating: rating,
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
        const qualityScore = rating / 10;
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

        await supabase
          .from('action_evaluations')
          .insert({
            event_id: eventId,
            reviewer_id: user.id,
            reviewer_level: 'coordenador_djtx',
            evaluation_number: 1,
            rating: rating,
            final_rating: rating,
            scores: scores || {},
            feedback_positivo: feedbackPositivo,
            feedback_construtivo: feedbackConstrutivo || ''
          });

        await supabase
          .from('events')
          .update({
            status: 'approved',
            first_evaluator_id: user.id,
            first_evaluation_rating: rating,
            quality_score: qualityScore,
            final_points: finalXP,
            updated_at: new Date().toISOString()
          })
          .eq('id', eventId);

        await supabase.rpc('increment_user_xp', {
          _user_id: collaborator.id,
          _xp_to_add: finalXP
        });

        await supabase.rpc('create_notification', {
          _user_id: collaborator.id,
          _type: 'evaluation_complete',
          _title: '✅ Ação Aprovada!',
          _message: `Sua ação "${challenge.title}" foi aprovada!\n\n⭐ Nota: ${rating}/10\n🎯 Você ganhou ${finalXP} XP!`,
          _metadata: {
            event_id: eventId,
            rating: rating,
            xp_earned: finalXP
          }
        });

        await markEvaluationDone();

        console.log('Simple evaluation completed:', { eventId, rating, finalXP });

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Ação aprovada com sucesso!',
            rating: rating,
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
        _message: `Sua ação "${challenge.title}" foi rejeitada. Veja o feedback para mais detalhes.`,
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
        _message: `Sua ação "${challenge.title}" precisa de ajustes. Veja o feedback e tente novamente.`,
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
