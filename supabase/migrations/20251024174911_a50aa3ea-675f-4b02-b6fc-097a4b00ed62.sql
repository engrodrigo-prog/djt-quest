-- Dropar policies que dependem do enum
DROP POLICY IF EXISTS "Admins can manage all roles" ON user_roles;
DROP POLICY IF EXISTS "UserRoles: admin manage" ON public.user_roles;
DROP POLICY IF EXISTS "Admins and gerentes can manage campaigns" ON campaigns;
DROP POLICY IF EXISTS "Admins and leaders can create challenges" ON challenges;
DROP POLICY IF EXISTS "Leaders can view events in their area" ON events;
DROP POLICY IF EXISTS "Leaders can view evaluations" ON action_evaluations;
DROP POLICY IF EXISTS "Leaders can create evaluations" ON action_evaluations;
DROP POLICY IF EXISTS "Leaders can log performance changes" ON team_performance_log;
DROP POLICY IF EXISTS "Leaders can view evaluation queue" ON evaluation_queue;
DROP POLICY IF EXISTS "System can manage evaluation queue" ON evaluation_queue;
DROP POLICY IF EXISTS "Leaders can view all incidents" ON safety_incidents;
DROP POLICY IF EXISTS "Leaders can create incidents" ON safety_incidents;
DROP POLICY IF EXISTS "Leaders can view all progression requests" ON tier_progression_requests;
DROP POLICY IF EXISTS "System can manage progression requests" ON tier_progression_requests;

-- Policies criadas em bootstrap que dependem de is_staff/has_role e do tipo de user_roles.role
DROP POLICY IF EXISTS "Pending: staff read/update" ON public.pending_registrations;

/*
  Skipping enum transition and has_role redefinition:
  - Existing environments already use app_role and a compatible has_role(u uuid, r text) exists.
  - Dropping the old function/type causes dependency churn with existing policies.
*/

-- Recriar policies
CREATE POLICY "Admins can manage all roles"
ON user_roles FOR ALL
TO authenticated
USING (has_role((select auth.uid()), 'gerente_djt'));

CREATE POLICY "Admins and gerentes can manage campaigns"
ON campaigns FOR ALL
TO authenticated
USING (has_role((select auth.uid()), 'gerente_djt'));

CREATE POLICY "Admins and leaders can create challenges"
ON challenges FOR INSERT
TO authenticated
WITH CHECK (
  has_role((select auth.uid()), 'gerente_djt') OR 
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'coordenador_djtx')
);

CREATE POLICY "Leaders can view events in their area"
ON events FOR SELECT
TO authenticated
USING (
  has_role((select auth.uid()), 'gerente_djt') OR 
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'coordenador_djtx')
);

CREATE POLICY "Leaders can view evaluations"
ON action_evaluations FOR SELECT
TO authenticated
USING (
  has_role((select auth.uid()), 'gerente_djt') OR 
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'coordenador_djtx')
);

CREATE POLICY "Leaders can create evaluations"
ON action_evaluations FOR INSERT
TO authenticated
WITH CHECK (
  (select auth.uid()) = reviewer_id AND (
    has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
    has_role((select auth.uid()), 'coordenador_djtx')
  )
);

CREATE POLICY "Leaders can log performance changes"
ON team_performance_log FOR INSERT
TO authenticated
WITH CHECK (
  has_role((select auth.uid()), 'coordenador_djtx') OR 
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'gerente_djt')
);

CREATE POLICY "Leaders can view evaluation queue"
ON evaluation_queue FOR SELECT
TO authenticated
USING (
  has_role((select auth.uid()), 'coordenador_djtx') OR 
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'gerente_djt')
);

CREATE POLICY "System can manage evaluation queue"
ON evaluation_queue FOR ALL
TO authenticated
USING (
  has_role((select auth.uid()), 'gerente_djt')
);

CREATE POLICY "Leaders can view all incidents"
ON safety_incidents FOR SELECT
TO authenticated
USING (
  has_role((select auth.uid()), 'gerente_djt') OR 
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'coordenador_djtx')
);

CREATE POLICY "Leaders can create incidents"
ON safety_incidents FOR INSERT
TO authenticated
WITH CHECK (
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'coordenador_djtx') OR 
  has_role((select auth.uid()), 'gerente_djt')
);

CREATE POLICY "Leaders can view all progression requests"
ON tier_progression_requests FOR SELECT
TO authenticated
USING (
  has_role((select auth.uid()), 'gerente_djt') OR 
  has_role((select auth.uid()), 'gerente_divisao_djtx') OR 
  has_role((select auth.uid()), 'coordenador_djtx')
);

CREATE POLICY "System can manage progression requests"
ON tier_progression_requests FOR ALL
TO authenticated
USING (
  has_role((select auth.uid()), 'gerente_djt') OR 
  has_role((select auth.uid()), 'coordenador_djtx')
);
