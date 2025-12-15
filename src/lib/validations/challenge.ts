import { z } from "zod";

export const challengeSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "O título deve ter no mínimo 3 caracteres")
    .max(100, "O título deve ter no máximo 100 caracteres"),
  description: z
    .string()
    .trim()
    .max(1000, "A descrição deve ter no máximo 1000 caracteres")
    .optional(),
  type: z.enum(["quiz", "forum", "mentoria", "inspecao", "atitude"]),
  reward_mode: z.enum(["fixed_xp", "tier_steps"]).optional().default("fixed_xp"),
  reward_tier_steps: z.coerce.number().int().min(1).max(5).optional().nullable(),
  xp_reward: z.coerce
    .number()
    .int("XP deve ser um número inteiro")
    .min(0, "XP inválido"),
  campaign_id: z.string().uuid().optional().nullable(),
  require_two_leader_eval: z.boolean().default(false),
  evidence_required: z.boolean().default(false),
  theme: z
    .string()
    .trim()
    .min(3, "Informe um tema (mín. 3 caracteres)")
    .max(100, "Tema muito longo"),
  target_dept_ids: z.array(z.string()).optional().nullable(),
  target_div_ids: z.array(z.string()).optional().nullable(),
  target_coord_ids: z.array(z.string()).optional().nullable(),
  target_team_ids: z.array(z.string()).optional().nullable(),
}).superRefine((data, ctx) => {
  // Para tipos diferentes de 'quiz', campanha é obrigatória
  if (data.type !== 'quiz' && !data.campaign_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['campaign_id'], message: 'Selecione uma campanha' });
  }

  if (data.type !== 'quiz') {
    const mode = data.reward_mode || 'fixed_xp';
    if (mode === 'tier_steps') {
      if (!data.reward_tier_steps || data.reward_tier_steps < 1 || data.reward_tier_steps > 5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reward_tier_steps'],
          message: 'Informe quantos patamares (1 a 5)',
        });
      }
    } else {
      const allowed = [10, 20, 30, 50];
      if (!allowed.includes(Number(data.xp_reward))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['xp_reward'],
          message: 'XP deve ser 10 (Básico), 20 (Intermediário), 30 (Avançado) ou 50 (Especialista)',
        });
      }
    }
  }
});

export type ChallengeFormData = z.infer<typeof challengeSchema>;

export const campaignSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, "O título deve ter no mínimo 3 caracteres")
    .max(100, "O título deve ter no máximo 100 caracteres"),
  description: z
    .string()
    .trim()
    .max(1000, "A descrição deve ter no máximo 1000 caracteres")
    .optional(),
  narrative_tag: z
    .string()
    .trim()
    .max(50, "A tag deve ter no máximo 50 caracteres")
    .optional(),
  start_date: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Data de início inválida",
  }),
  end_date: z.string().refine((val) => !isNaN(Date.parse(val)), {
    message: "Data de término inválida",
  }),
});

export type CampaignFormData = z.infer<typeof campaignSchema>;
