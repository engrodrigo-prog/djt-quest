-- Allow operational updates (status/scheduling) on quizzes after submission/publish.
-- Fixes client-side "PATCH challenges ... 400" when reopening/closing a quiz collection.

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
  old_locked jsonb;
  new_locked jsonb;
BEGIN
  -- Only applies to quiz rows
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

  -- After DRAFT, lock quiz metadata/content edits from non-service clients.
  -- But allow operational fields to change (used by LiveOps / "reabrir coleta"):
  -- status, canceled_at, start_date, due_date, allow_early, allow_late, updated_at
  IF COALESCE(OLD.quiz_workflow_status, 'PUBLISHED') <> 'DRAFT'
     AND NEW.quiz_workflow_status IS NOT DISTINCT FROM OLD.quiz_workflow_status THEN
    old_locked :=
      to_jsonb(OLD)
      - 'status'
      - 'canceled_at'
      - 'start_date'
      - 'due_date'
      - 'allow_early'
      - 'allow_late'
      - 'updated_at';
    new_locked :=
      to_jsonb(NEW)
      - 'status'
      - 'canceled_at'
      - 'start_date'
      - 'due_date'
      - 'allow_early'
      - 'allow_late'
      - 'updated_at';

    IF old_locked <> new_locked THEN
      RAISE EXCEPTION 'Quiz is locked after submission';
    END IF;

    RETURN NEW;
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

