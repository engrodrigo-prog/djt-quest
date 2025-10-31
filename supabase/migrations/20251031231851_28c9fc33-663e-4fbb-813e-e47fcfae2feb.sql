-- Parte 1: Adicionar novos valores ao enum event_status e criar colunas
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'awaiting_second_evaluation' AND enumtypid = 'event_status'::regtype) THEN
    ALTER TYPE event_status ADD VALUE 'awaiting_second_evaluation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'approved' AND enumtypid = 'event_status'::regtype) THEN
    ALTER TYPE event_status ADD VALUE 'approved';
  END IF;
END $$;

-- Adicionar colunas em action_evaluations
ALTER TABLE action_evaluations 
ADD COLUMN IF NOT EXISTS evaluation_number INTEGER CHECK (evaluation_number IN (1, 2)),
ADD COLUMN IF NOT EXISTS final_rating NUMERIC(4,2);

-- Constraint: máximo 2 avaliações por evento
CREATE UNIQUE INDEX IF NOT EXISTS idx_max_two_evals_per_event 
ON action_evaluations(event_id, evaluation_number);

-- Adicionar colunas em events
ALTER TABLE events
ADD COLUMN IF NOT EXISTS first_evaluator_id UUID REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS second_evaluator_id UUID REFERENCES profiles(id),
ADD COLUMN IF NOT EXISTS first_evaluation_rating NUMERIC(4,2),
ADD COLUMN IF NOT EXISTS second_evaluation_rating NUMERIC(4,2),
ADD COLUMN IF NOT EXISTS awaiting_second_evaluation BOOLEAN DEFAULT FALSE;