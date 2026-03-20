-- Backfill quiz_questions xp_value and difficulty_level to match the parent
-- challenge's configured xp_reward. This fixes questions imported via the
-- curation path that were hardcoded to basico/5 regardless of the quiz setting.
-- Only applies to standard quizzes (non-milhão) with a recognized xp_reward.

UPDATE quiz_questions q
SET
  xp_value = c.xp_reward,
  difficulty_level = CASE c.xp_reward
    WHEN 50 THEN 'especialista'
    WHEN 20 THEN 'avancado'
    WHEN 10 THEN 'intermediario'
    ELSE 'basico'
  END
FROM challenges c
WHERE q.challenge_id = c.id
  AND c.xp_reward IN (5, 10, 20, 50)
  AND c.type = 'quiz'
  AND c.title NOT ILIKE '%milh%'
  AND q.xp_value != c.xp_reward;
