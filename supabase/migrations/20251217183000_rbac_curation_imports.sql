-- RBAC + Content Curation workflow + Imports (idempotent)

-- 1) Extend app_role enum in older environments (if present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role' AND typnamespace = 'public'::regnamespace) THEN
    BEGIN
      EXECUTE 'ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS ''content_curator''';
    EXCEPTION WHEN duplicate_object THEN
      -- ignore
    END;
    BEGIN
      EXECUTE 'ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS ''invited''';
    EXCEPTION WHEN duplicate_object THEN
      -- ignore
    END;
  END IF;
END$$;

-- 2) Quiz workflow status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quiz_workflow_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.quiz_workflow_status AS ENUM ('DRAFT','SUBMITTED','APPROVED','REJECTED','PUBLISHED');
  END IF;
END$$;

-- 3) Challenges: add quiz curation columns (do not conflict with existing "status" column used for scheduling)
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS quiz_workflow_status public.quiz_workflow_status,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Default for legacy rows: treat as PUBLISHED (preserves current UX)
DO $$
BEGIN
  -- Only apply default if column exists and has no default yet
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='challenges' AND column_name='quiz_workflow_status'
  ) THEN
    BEGIN
      ALTER TABLE public.challenges
        ALTER COLUMN quiz_workflow_status SET DEFAULT 'PUBLISHED';
    EXCEPTION WHEN others THEN
      -- ignore
    END;
  END IF;
END$$;

-- 4) Helper: can curate content (strict: only content_curator or admin)
CREATE OR REPLACE FUNCTION public.can_curate_content(u uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.has_role(u, 'admin')
    OR public.has_role(u, 'content_curator')
  , false);
$$;

-- 5) Trigger: set quiz defaults for authenticated inserts (owner_id + DRAFT)
CREATE OR REPLACE FUNCTION public.set_quiz_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := auth.uid();

  -- Only for quiz rows created by an authenticated user (avoid altering service_role/system inserts)
  IF NEW.type::text = 'quiz' AND uid IS NOT NULL THEN
    IF NEW.owner_id IS NULL THEN
      NEW.owner_id := uid;
    END IF;
    -- If client didn't explicitly set a workflow status, force DRAFT for user-created quizzes.
    -- (Defaults may pre-fill 'PUBLISHED' before BEFORE triggers run.)
    IF NEW.quiz_workflow_status IS NULL OR NEW.quiz_workflow_status = 'PUBLISHED' THEN
      NEW.quiz_workflow_status := 'DRAFT';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_quiz_defaults ON public.challenges;
CREATE TRIGGER trg_set_quiz_defaults
BEFORE INSERT ON public.challenges
FOR EACH ROW
EXECUTE FUNCTION public.set_quiz_defaults();

-- 6) Trigger: enforce quiz workflow transitions (least privilege)
CREATE OR REPLACE FUNCTION public.enforce_quiz_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  role text;
  is_service boolean;
  is_owner boolean;
  can_curate boolean;
BEGIN
  -- Only applies to quiz rows with the workflow column present
  IF NEW.type::text <> 'quiz' THEN
    RETURN NEW;
  END IF;

  -- service_role bypass (server-side source of truth)
  role := auth.role();
  is_service := (role = 'service_role');
  IF is_service THEN
    RETURN NEW;
  END IF;

  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  is_owner := (COALESCE(NEW.owner_id, OLD.owner_id) = uid) OR (COALESCE(NEW.created_by, OLD.created_by) = uid);
  can_curate := public.can_curate_content(uid);

  -- Lock quiz metadata after DRAFT for non-service clients (edits must go through server for versioning).
  IF COALESCE(OLD.quiz_workflow_status, 'PUBLISHED') <> 'DRAFT' AND NEW.quiz_workflow_status IS NOT DISTINCT FROM OLD.quiz_workflow_status THEN
    RAISE EXCEPTION 'Quiz is locked after submission';
  END IF;

  IF OLD.quiz_workflow_status IS DISTINCT FROM NEW.quiz_workflow_status THEN
    -- Allowed transitions:
    -- Owner: DRAFT -> SUBMITTED
    IF OLD.quiz_workflow_status = 'DRAFT' AND NEW.quiz_workflow_status = 'SUBMITTED' AND is_owner THEN
      NEW.submitted_at := COALESCE(NEW.submitted_at, now());
      RETURN NEW;
    END IF;

    -- Curator/Admin: SUBMITTED -> APPROVED/REJECTED
    IF OLD.quiz_workflow_status = 'SUBMITTED' AND (NEW.quiz_workflow_status = 'APPROVED' OR NEW.quiz_workflow_status = 'REJECTED') AND can_curate THEN
      NEW.approved_at := COALESCE(NEW.approved_at, now());
      NEW.approved_by := COALESCE(NEW.approved_by, uid);
      RETURN NEW;
    END IF;

    -- Curator/Admin: APPROVED -> PUBLISHED
    IF OLD.quiz_workflow_status = 'APPROVED' AND NEW.quiz_workflow_status = 'PUBLISHED' AND can_curate THEN
      NEW.published_at := COALESCE(NEW.published_at, now());
      NEW.published_by := COALESCE(NEW.published_by, uid);
      RETURN NEW;
    END IF;

    -- Owner: REJECTED -> DRAFT (must rework before re-submit)
    IF OLD.quiz_workflow_status = 'REJECTED' AND NEW.quiz_workflow_status = 'DRAFT' AND is_owner THEN
      RETURN NEW;
    END IF;

    -- Otherwise, block
    RAISE EXCEPTION 'Invalid quiz workflow transition (% -> %)', OLD.quiz_workflow_status, NEW.quiz_workflow_status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_quiz_workflow ON public.challenges;
CREATE TRIGGER trg_enforce_quiz_workflow
BEFORE UPDATE ON public.challenges
FOR EACH ROW
EXECUTE FUNCTION public.enforce_quiz_workflow();

-- 6b) RLS: hide non-published quizzes from general app (preserve non-quiz visibility)
DO $$ BEGIN
  -- challenges: SELECT policy
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='challenges' AND policyname='All can view challenges'
  ) THEN
    DROP POLICY "All can view challenges" ON public.challenges;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='challenges' AND policyname='Challenges: published or own or curator read'
  ) THEN
    DROP POLICY "Challenges: published or own or curator read" ON public.challenges;
  END IF;

  CREATE POLICY "Challenges: published or own or curator read"
    ON public.challenges FOR SELECT
    TO authenticated
    USING (
      -- Non-quiz items remain visible as before
      (type::text <> 'quiz')
      OR
      -- Legacy rows (NULL) treated as published; new workflow rows must be PUBLISHED
      (quiz_workflow_status IS NULL OR quiz_workflow_status = 'PUBLISHED')
      OR
      -- Owner/creator always can read their own draft/submission
      (owner_id = auth.uid() OR created_by = auth.uid())
      OR
      -- Curators/admin
      public.can_curate_content(auth.uid())
    );
END $$;

-- Allow content_curator to create quizzes (only quizzes)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='challenges' AND policyname='Admins and leaders can create challenges'
  ) THEN
    DROP POLICY "Admins and leaders can create challenges" ON public.challenges;
  END IF;

  CREATE POLICY "Admins and leaders can create challenges"
    ON public.challenges FOR INSERT
    TO authenticated
    WITH CHECK (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'gerente_djt')
      OR public.has_role(auth.uid(), 'gerente_divisao_djtx')
      OR public.has_role(auth.uid(), 'coordenador_djtx')
      OR (public.has_role(auth.uid(), 'content_curator') AND type::text = 'quiz')
    );
END $$;

-- 6c) quiz_questions / quiz_options: restrict SELECT to published or authorized
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_questions' AND policyname='Users can view quiz questions'
  ) THEN
    DROP POLICY "Users can view quiz questions" ON public.quiz_questions;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_questions' AND policyname='QuizQuestions: published or own or curator read'
  ) THEN
    DROP POLICY "QuizQuestions: published or own or curator read" ON public.quiz_questions;
  END IF;

  CREATE POLICY "QuizQuestions: published or own or curator read"
    ON public.quiz_questions FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.challenges c
        WHERE c.id = quiz_questions.challenge_id
          AND (
            (c.type::text <> 'quiz')
            OR (c.quiz_workflow_status IS NULL OR c.quiz_workflow_status = 'PUBLISHED')
            OR (c.owner_id = auth.uid() OR c.created_by = auth.uid())
            OR public.can_curate_content(auth.uid())
          )
      )
    );
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_options' AND policyname='Users can view options'
  ) THEN
    DROP POLICY "Users can view options" ON public.quiz_options;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_options' AND policyname='QuizOptions: published or own or curator read'
  ) THEN
    DROP POLICY "QuizOptions: published or own or curator read" ON public.quiz_options;
  END IF;

  CREATE POLICY "QuizOptions: published or own or curator read"
    ON public.quiz_options FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.quiz_questions qq
        JOIN public.challenges c ON c.id = qq.challenge_id
        WHERE qq.id = quiz_options.question_id
          AND (
            (c.type::text <> 'quiz')
            OR (c.quiz_workflow_status IS NULL OR c.quiz_workflow_status = 'PUBLISHED')
            OR (c.owner_id = auth.uid() OR c.created_by = auth.uid())
            OR public.can_curate_content(auth.uid())
          )
      )
    );
END $$;

-- 7) Prevent editing quiz content after submission from the client (must go through server/service_role for versioning)
CREATE OR REPLACE FUNCTION public.enforce_quiz_content_edit_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_status public.quiz_workflow_status;
  role text;
  cid uuid;
BEGIN
  role := auth.role();
  IF role = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  cid := COALESCE(NEW.challenge_id, OLD.challenge_id);
  IF cid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT c.quiz_workflow_status INTO parent_status
  FROM public.challenges c
  WHERE c.id = cid;

  IF parent_status IS NULL THEN
    -- Legacy/unknown: allow (keeps compatibility)
    RETURN NEW;
  END IF;

  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Quiz content is locked after submission';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- quiz_questions has challenge_id (easy)
DROP TRIGGER IF EXISTS trg_enforce_quiz_question_edit_stage ON public.quiz_questions;
CREATE TRIGGER trg_enforce_quiz_question_edit_stage
BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_questions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_quiz_content_edit_stage();

-- quiz_options does not have challenge_id; enforce through join
CREATE OR REPLACE FUNCTION public.enforce_quiz_option_edit_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_status public.quiz_workflow_status;
  role text;
  qid uuid;
  cid uuid;
BEGIN
  role := auth.role();
  IF role = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  qid := COALESCE(NEW.question_id, OLD.question_id);
  IF qid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT qq.challenge_id INTO cid
  FROM public.quiz_questions qq
  WHERE qq.id = qid;

  IF cid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.quiz_workflow_status INTO parent_status
  FROM public.challenges c
  WHERE c.id = cid;

  IF parent_status IS NULL THEN
    RETURN NEW;
  END IF;

  IF parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Quiz content is locked after submission';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_quiz_option_edit_stage ON public.quiz_options;
CREATE TRIGGER trg_enforce_quiz_option_edit_stage
BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_options
FOR EACH ROW
EXECUTE FUNCTION public.enforce_quiz_option_edit_stage();

-- 8) Protect answer key at the database level (column-level privilege)
REVOKE SELECT (is_correct) ON TABLE public.quiz_options FROM anon;
REVOKE SELECT (is_correct) ON TABLE public.quiz_options FROM authenticated;
GRANT SELECT (is_correct) ON TABLE public.quiz_options TO service_role;

-- 9) Quiz version snapshots (append-only; created via server)
CREATE TABLE IF NOT EXISTS public.quiz_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  snapshot_json jsonb NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  UNIQUE (challenge_id, version_number)
);

ALTER TABLE public.quiz_versions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_versions' AND policyname='QuizVersions: owner read'
  ) THEN
    CREATE POLICY "QuizVersions: owner read"
      ON public.quiz_versions FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.challenges c
          WHERE c.id = quiz_versions.challenge_id
            AND (c.owner_id = auth.uid() OR c.created_by = auth.uid())
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_versions' AND policyname='QuizVersions: curator read'
  ) THEN
    CREATE POLICY "QuizVersions: curator read"
      ON public.quiz_versions FOR SELECT
      TO authenticated
      USING (public.can_curate_content(auth.uid()));
  END IF;
END $$;

-- 9b) Curadoria: comentários/decisões (feedback)
CREATE TABLE IF NOT EXISTS public.quiz_curation_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','decision')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_curation_comments_challenge ON public.quiz_curation_comments(challenge_id);
ALTER TABLE public.quiz_curation_comments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_curation_comments' AND policyname='QuizCurationComments: read'
  ) THEN
    DROP POLICY "QuizCurationComments: read" ON public.quiz_curation_comments;
  END IF;
  CREATE POLICY "QuizCurationComments: read"
    ON public.quiz_curation_comments FOR SELECT
    TO authenticated
    USING (
      public.can_curate_content(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.challenges c
        WHERE c.id = quiz_curation_comments.challenge_id
          AND (c.owner_id = auth.uid() OR c.created_by = auth.uid())
      )
    );

  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='quiz_curation_comments' AND policyname='QuizCurationComments: insert'
  ) THEN
    DROP POLICY "QuizCurationComments: insert" ON public.quiz_curation_comments;
  END IF;
  CREATE POLICY "QuizCurationComments: insert"
    ON public.quiz_curation_comments FOR INSERT
    TO authenticated
    WITH CHECK (
      author_id = auth.uid()
      AND (
        public.can_curate_content(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.challenges c
          WHERE c.id = quiz_curation_comments.challenge_id
            AND (c.owner_id = auth.uid() OR c.created_by = auth.uid())
        )
      )
    );
END $$;

-- 10) Audit log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log' AND policyname='AuditLog: admin read'
  ) THEN
    CREATE POLICY "AuditLog: admin read"
      ON public.audit_log FOR SELECT
      TO authenticated
      USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

-- 11) Imports for curation pipeline
CREATE TABLE IF NOT EXISTS public.content_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_bucket text NOT NULL,
  source_path text NOT NULL,
  source_mime text,
  status text NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED','EXTRACTED','AI_SUGGESTED','FINAL_APPROVED')),
  raw_extract jsonb,
  ai_suggested jsonb,
  final_approved jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_imports_created_by ON public.content_imports(created_by);
CREATE INDEX IF NOT EXISTS idx_content_imports_status ON public.content_imports(status);

ALTER TABLE public.content_imports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_imports' AND policyname='ContentImports: creator read'
  ) THEN
    CREATE POLICY "ContentImports: creator read"
      ON public.content_imports FOR SELECT
      TO authenticated
      USING (created_by = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_imports' AND policyname='ContentImports: curator read'
  ) THEN
    CREATE POLICY "ContentImports: curator read"
      ON public.content_imports FOR SELECT
      TO authenticated
      USING (public.can_curate_content(auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_imports' AND policyname='ContentImports: creator insert'
  ) THEN
    CREATE POLICY "ContentImports: creator insert"
      ON public.content_imports FOR INSERT
      TO authenticated
      WITH CHECK (created_by = auth.uid());
  END IF;
END $$;

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_content_imports_updated_at ON public.content_imports;
CREATE TRIGGER trg_touch_content_imports_updated_at
BEFORE UPDATE ON public.content_imports
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at();

-- 12) Storage bucket for quiz imports (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quiz-imports',
  'quiz-imports',
  false,
  52428800,
  ARRAY[
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage RLS for quiz-imports: only owner folder or curator/admin
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='QuizImports: upload own'
  ) THEN
    CREATE POLICY "QuizImports: upload own"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
      bucket_id = 'quiz-imports' AND
      (select auth.uid())::text = (storage.foldername(name))[1]
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='QuizImports: read own or curator'
  ) THEN
    CREATE POLICY "QuizImports: read own or curator"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'quiz-imports' AND
      (owner = (select auth.uid()) OR public.can_curate_content((select auth.uid())))
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='QuizImports: delete own or curator'
  ) THEN
    CREATE POLICY "QuizImports: delete own or curator"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
      bucket_id = 'quiz-imports' AND
      (owner = (select auth.uid()) OR public.can_curate_content((select auth.uid())))
    );
  END IF;
END $$;
