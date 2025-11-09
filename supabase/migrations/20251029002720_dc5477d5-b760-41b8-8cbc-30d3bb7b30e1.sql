-- Adicionar policy para gerentes DJT criarem eventos globais de equipe
DROP POLICY IF EXISTS "Managers can create global team events" ON public.team_events;
CREATE POLICY "Managers can create global team events"
  ON public.team_events FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'gerente_djt')
  );
