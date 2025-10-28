import { z } from "zod";

export const difficultyLevels = {
  basica: { label: "Básica", xp: 10 },
  intermediaria: { label: "Intermediária", xp: 20 },
  avancada: { label: "Avançada", xp: 30 },
  especialista: { label: "Especialista", xp: 50 },
} as const;

export type DifficultyLevel = keyof typeof difficultyLevels;

export const quizOptionSchema = z.object({
  option_text: z.string().min(1, "Alternativa não pode estar vazia").max(200, "Alternativa muito longa"),
  is_correct: z.boolean(),
  explanation: z.string().max(500, "Explicação muito longa").optional(),
});

export const quizQuestionSchema = z.object({
  question_text: z
    .string()
    .min(10, "Pergunta deve ter no mínimo 10 caracteres")
    .max(500, "Pergunta deve ter no máximo 500 caracteres"),
  difficulty_level: z.enum(["basica", "intermediaria", "avancada", "especialista"]),
  options: z
    .array(quizOptionSchema)
    .min(2, "Mínimo 2 alternativas")
    .max(5, "Máximo 5 alternativas")
    .refine(
      (opts) => opts.filter((o) => o.is_correct).length === 1,
      "Deve haver exatamente 1 alternativa correta"
    ),
});

export type QuizQuestionFormData = z.infer<typeof quizQuestionSchema>;
export type QuizOptionFormData = z.infer<typeof quizOptionSchema>;
