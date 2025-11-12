import { z } from "zod";

export const difficultyLevels = {
  basico: { label: "Básico", xp: 10 },
  intermediario: { label: "Intermediário", xp: 20 },
  avancado: { label: "Avançado", xp: 30 },
  especialista: { label: "Especialista", xp: 50 },
} as const;

export type DifficultyLevel = keyof typeof difficultyLevels;

export const quizOptionSchema = z.object({
  // Permitimos vazio para alternativas erradas; validamos a correta no schema da pergunta
  option_text: z.string().max(200, "Alternativa muito longa").default(""),
  is_correct: z.boolean(),
  explanation: z.string().max(500, "Explicação muito longa").optional(),
});

export const quizQuestionSchema = z.object({
  question_text: z
    .string()
    .min(10, "Pergunta deve ter no mínimo 10 caracteres")
    .max(500, "Pergunta deve ter no máximo 500 caracteres"),
  difficulty_level: z.enum(["basico", "intermediario", "avancado", "especialista"]),
  options: z
    .array(quizOptionSchema)
    .min(1, "Inclua pelo menos a alternativa correta")
    .max(5, "Máximo 5 alternativas")
    .refine(
      (opts) => opts.filter((o) => o.is_correct).length === 1,
      "Deve haver exatamente 1 alternativa correta"
    ),
}).superRefine((data, ctx) => {
  const idx = data.options.findIndex((o) => o.is_correct);
  if (idx < 0) return; // já coberto pelo refine acima
  const txt = (data.options[idx]?.option_text || "").trim();
  if (txt.length < 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.too_small,
      minimum: 5,
      inclusive: true,
      type: 'string',
      path: ['options', idx, 'option_text'],
      message: 'A alternativa correta deve ter pelo menos 5 caracteres',
    } as any);
  }
});

export type QuizQuestionFormData = z.infer<typeof quizQuestionSchema>;
export type QuizOptionFormData = z.infer<typeof quizOptionSchema>;
