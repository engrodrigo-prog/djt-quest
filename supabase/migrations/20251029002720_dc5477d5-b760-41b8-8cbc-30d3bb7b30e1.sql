-- Adicionar policy para gerentes DJT criarem eventos globais de equipe
CREATE POLICY "Managers can create global team events"
  ON team_events FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'gerente_djt'::app_role)
  );