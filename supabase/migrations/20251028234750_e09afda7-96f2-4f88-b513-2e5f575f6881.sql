-- ============================================
-- QUIZ SYSTEM - Complete Implementation
-- ============================================

-- 1. Create quiz_questions table
CREATE TABLE quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  difficulty_level TEXT NOT NULL CHECK (difficulty_level IN ('basica', 'intermediaria', 'avancada', 'especialista')),
  xp_value INTEGER NOT NULL CHECK (xp_value IN (10, 20, 30, 50)),
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES auth.users(id)
);

CREATE INDEX idx_quiz_questions_challenge ON quiz_questions(challenge_id);
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view quiz questions
CREATE POLICY "Users can view quiz questions"
  ON quiz_questions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM challenges c
      WHERE c.id = quiz_questions.challenge_id
    )
  );

-- RLS: Coordinators can create questions
CREATE POLICY "Coordinators can create questions"
  ON quiz_questions FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt')
  );

-- RLS: Coordinators can update questions
CREATE POLICY "Coordinators can update questions"
  ON quiz_questions FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt')
  );

-- RLS: Coordinators can delete questions
CREATE POLICY "Coordinators can delete questions"
  ON quiz_questions FOR DELETE
  TO authenticated
  USING (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt')
  );

-- 2. Create quiz_options table
CREATE TABLE quiz_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  explanation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quiz_options_question ON quiz_options(question_id);
ALTER TABLE quiz_options ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view options
CREATE POLICY "Users can view options"
  ON quiz_options FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM quiz_questions qq
      WHERE qq.id = quiz_options.question_id
    )
  );

-- RLS: Coordinators can manage options
CREATE POLICY "Coordinators can insert options"
  ON quiz_options FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quiz_questions qq
      WHERE qq.id = quiz_options.question_id
      AND (
        has_role(auth.uid(), 'coordenador_djtx') OR
        has_role(auth.uid(), 'gerente_divisao_djtx') OR
        has_role(auth.uid(), 'gerente_djt')
      )
    )
  );

CREATE POLICY "Coordinators can update options"
  ON quiz_options FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt')
  );

CREATE POLICY "Coordinators can delete options"
  ON quiz_options FOR DELETE
  TO authenticated
  USING (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt')
  );

-- 3. Create user_quiz_answers table
CREATE TABLE user_quiz_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  challenge_id UUID NOT NULL REFERENCES challenges(id),
  question_id UUID NOT NULL REFERENCES quiz_questions(id),
  selected_option_id UUID NOT NULL REFERENCES quiz_options(id),
  is_correct BOOLEAN NOT NULL,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  answered_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, question_id)
);

CREATE INDEX idx_user_quiz_answers_user ON user_quiz_answers(user_id);
CREATE INDEX idx_user_quiz_answers_challenge ON user_quiz_answers(challenge_id);
ALTER TABLE user_quiz_answers ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view own answers
CREATE POLICY "Users can view own answers"
  ON user_quiz_answers FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS: Users can submit answers
CREATE POLICY "Users can submit answers"
  ON user_quiz_answers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS: Leaders can view all answers
CREATE POLICY "Leaders can view all answers"
  ON user_quiz_answers FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'coordenador_djtx') OR
    has_role(auth.uid(), 'gerente_divisao_djtx') OR
    has_role(auth.uid(), 'gerente_djt')
  );

-- 4. Create function to notify users when quiz is published
CREATE OR REPLACE FUNCTION notify_quiz_published()
RETURNS TRIGGER AS $$
DECLARE
  target_user_ids UUID[];
  total_xp INTEGER;
BEGIN
  -- Only notify for quiz type challenges
  IF NEW.type = 'quiz' THEN
    -- Calculate total XP from questions
    SELECT COALESCE(SUM(xp_value), 0) INTO total_xp
    FROM quiz_questions
    WHERE challenge_id = NEW.id;
    
    -- Only notify if there are questions
    IF total_xp > 0 THEN
      -- Get target users based on targeting criteria
      SELECT ARRAY_AGG(DISTINCT id) INTO target_user_ids
      FROM profiles
      WHERE (
        NEW.target_team_ids IS NULL OR team_id = ANY(NEW.target_team_ids)
      ) AND (
        NEW.target_coord_ids IS NULL OR coord_id = ANY(NEW.target_coord_ids)
      ) AND (
        NEW.target_div_ids IS NULL OR division_id = ANY(NEW.target_div_ids)
      ) AND (
        NEW.target_dept_ids IS NULL OR department_id = ANY(NEW.target_dept_ids)
      );
      
      -- Create notifications for all target users
      IF target_user_ids IS NOT NULL THEN
        INSERT INTO notifications (user_id, type, title, message, metadata)
        SELECT 
          unnest(target_user_ids),
          'quiz_available',
          '📝 Novo Quiz Disponível',
          NEW.title || ' - Até ' || total_xp || ' XP disponíveis!',
          jsonb_build_object(
            'challenge_id', NEW.id,
            'total_xp', total_xp,
            'type', 'quiz'
          );
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for quiz publication
CREATE TRIGGER on_quiz_published
  AFTER INSERT ON challenges
  FOR EACH ROW
  EXECUTE FUNCTION notify_quiz_published();