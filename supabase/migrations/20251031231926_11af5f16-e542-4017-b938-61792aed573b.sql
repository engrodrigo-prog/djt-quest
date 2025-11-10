-- Parte 2: Criar RPCs e Views

-- Criar RPC para incrementar XP de forma segura
CREATE OR REPLACE FUNCTION increment_user_xp(_user_id uuid, _xp_to_add integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE profiles
  SET xp = xp + _xp_to_add,
      tier = calculate_tier_from_xp(xp + _xp_to_add, tier),
      updated_at = now()
  WHERE id = _user_id;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'team_campaign_performance'
  ) THEN
    EXECUTE 'DROP MATERIALIZED VIEW public.team_campaign_performance';
  ELSIF EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'team_campaign_performance'
  ) THEN
    EXECUTE 'DROP VIEW public.team_campaign_performance';
  END IF;
END $$;

CREATE MATERIALIZED VIEW team_campaign_performance AS
SELECT 
  t.id as team_id,
  t.name as team_name,
  c.id as campaign_id,
  c.title as campaign_title,
  COUNT(DISTINCT e.user_id) as participants_count,
  (SELECT COUNT(*) FROM profiles WHERE team_id = t.id AND is_leader = false) as total_members,
  ROUND(COUNT(DISTINCT e.user_id)::numeric / NULLIF((SELECT COUNT(*) FROM profiles WHERE team_id = t.id AND is_leader = false), 0) * 100, 2) as adhesion_percentage,
  COUNT(DISTINCT CASE WHEN e.status = 'approved' THEN e.user_id END) as completed_count,
  ROUND(COUNT(DISTINCT CASE WHEN e.status = 'approved' THEN e.user_id END)::numeric / NULLIF(COUNT(DISTINCT e.user_id), 0) * 100, 2) as completion_percentage
FROM teams t
CROSS JOIN campaigns c
LEFT JOIN challenges ch ON ch.campaign_id = c.id
LEFT JOIN events e ON e.challenge_id = ch.id AND e.user_id IN (
  SELECT id FROM profiles WHERE team_id = t.id AND is_leader = false
)
WHERE c.is_active = true
  AND NOW() BETWEEN c.start_date AND c.end_date
GROUP BY t.id, t.name, c.id, c.title;

-- Criar função para refresh da view materializada
CREATE OR REPLACE FUNCTION refresh_team_performance()
RETURNS void 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW team_campaign_performance;
END;
$$;

DROP VIEW IF EXISTS team_challenge_performance;
CREATE OR REPLACE VIEW team_challenge_performance AS
SELECT 
  t.id as team_id,
  t.name as team_name,
  ch.id as challenge_id,
  ch.title as challenge_title,
  ch.type as challenge_type,
  COUNT(DISTINCT e.user_id) as participants_count,
  (SELECT COUNT(*) FROM profiles WHERE team_id = t.id AND is_leader = false) as total_members,
  ROUND(COUNT(DISTINCT e.user_id)::numeric / NULLIF((SELECT COUNT(*) FROM profiles WHERE team_id = t.id AND is_leader = false), 0) * 100, 2) as adhesion_percentage,
  COUNT(DISTINCT CASE WHEN e.status = 'approved' THEN e.user_id END) as completed_count,
  ROUND(COUNT(DISTINCT CASE WHEN e.status = 'approved' THEN e.user_id END)::numeric / NULLIF(COUNT(DISTINCT e.user_id), 0) * 100, 2) as completion_percentage,
  COALESCE(AVG(e.final_points), 0) as avg_xp_earned
FROM teams t
CROSS JOIN challenges ch
LEFT JOIN events e ON e.challenge_id = ch.id AND e.user_id IN (
  SELECT id FROM profiles WHERE team_id = t.id AND is_leader = false
)
GROUP BY t.id, t.name, ch.id, ch.title, ch.type;
