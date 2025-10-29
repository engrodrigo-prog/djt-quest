-- Add database indexes for performance optimization

-- profiles.team_id (used in team queries)
CREATE INDEX IF NOT EXISTS idx_profiles_team_id ON profiles(team_id);

-- campaigns.is_active (Dashboard filters always)
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns(is_active) WHERE is_active = true;

-- profiles.xp (Rankings orders always)
CREATE INDEX IF NOT EXISTS idx_profiles_xp ON profiles(xp DESC);

-- team_events.team_id (used in LeaderTeamDashboard)
CREATE INDEX IF NOT EXISTS idx_team_events_team_id ON team_events(team_id);