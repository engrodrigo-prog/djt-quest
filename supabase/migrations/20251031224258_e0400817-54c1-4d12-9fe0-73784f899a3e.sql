-- Drop and recreate foreign keys with ON DELETE CASCADE

-- forum_topics
ALTER TABLE forum_topics 
  DROP CONSTRAINT IF EXISTS forum_topics_created_by_fkey,
  ADD CONSTRAINT forum_topics_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE CASCADE;

-- forum_posts
ALTER TABLE forum_posts 
  DROP CONSTRAINT IF EXISTS forum_posts_author_id_fkey,
  ADD CONSTRAINT forum_posts_author_id_fkey 
    FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE forum_posts 
  DROP CONSTRAINT IF EXISTS forum_posts_reply_to_user_id_fkey,
  ADD CONSTRAINT forum_posts_reply_to_user_id_fkey 
    FOREIGN KEY (reply_to_user_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- forum_mentions
ALTER TABLE forum_mentions 
  DROP CONSTRAINT IF EXISTS forum_mentions_mentioned_user_id_fkey,
  ADD CONSTRAINT forum_mentions_mentioned_user_id_fkey 
    FOREIGN KEY (mentioned_user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE forum_mentions 
  DROP CONSTRAINT IF EXISTS forum_mentions_mentioned_by_fkey,
  ADD CONSTRAINT forum_mentions_mentioned_by_fkey 
    FOREIGN KEY (mentioned_by) REFERENCES profiles(id) ON DELETE CASCADE;

-- forum_likes
ALTER TABLE forum_likes 
  DROP CONSTRAINT IF EXISTS forum_likes_user_id_fkey,
  ADD CONSTRAINT forum_likes_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- forum_subscriptions
ALTER TABLE forum_subscriptions 
  DROP CONSTRAINT IF EXISTS forum_subscriptions_user_id_fkey,
  ADD CONSTRAINT forum_subscriptions_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- events
ALTER TABLE events 
  DROP CONSTRAINT IF EXISTS events_user_id_fkey,
  ADD CONSTRAINT events_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE events 
  DROP CONSTRAINT IF EXISTS events_assigned_evaluator_id_fkey,
  ADD CONSTRAINT events_assigned_evaluator_id_fkey 
    FOREIGN KEY (assigned_evaluator_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- action_evaluations
ALTER TABLE action_evaluations 
  DROP CONSTRAINT IF EXISTS action_evaluations_reviewer_id_fkey,
  ADD CONSTRAINT action_evaluations_reviewer_id_fkey 
    FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- profile_change_requests
ALTER TABLE profile_change_requests 
  DROP CONSTRAINT IF EXISTS profile_change_requests_user_id_fkey,
  ADD CONSTRAINT profile_change_requests_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE profile_change_requests 
  DROP CONSTRAINT IF EXISTS profile_change_requests_requested_by_fkey,
  ADD CONSTRAINT profile_change_requests_requested_by_fkey 
    FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE profile_change_requests 
  DROP CONSTRAINT IF EXISTS profile_change_requests_reviewed_by_fkey,
  ADD CONSTRAINT profile_change_requests_reviewed_by_fkey 
    FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- pending_registrations
ALTER TABLE pending_registrations 
  DROP CONSTRAINT IF EXISTS pending_registrations_reviewed_by_fkey,
  ADD CONSTRAINT pending_registrations_reviewed_by_fkey 
    FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- notifications
ALTER TABLE notifications 
  DROP CONSTRAINT IF EXISTS notifications_user_id_fkey,
  ADD CONSTRAINT notifications_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- user_badges
ALTER TABLE user_badges 
  DROP CONSTRAINT IF EXISTS user_badges_user_id_fkey,
  ADD CONSTRAINT user_badges_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- user_quiz_answers
ALTER TABLE user_quiz_answers 
  DROP CONSTRAINT IF EXISTS user_quiz_answers_user_id_fkey,
  ADD CONSTRAINT user_quiz_answers_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- tier_progression_requests
ALTER TABLE tier_progression_requests 
  DROP CONSTRAINT IF EXISTS tier_progression_requests_user_id_fkey,
  ADD CONSTRAINT tier_progression_requests_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE tier_progression_requests 
  DROP CONSTRAINT IF EXISTS tier_progression_requests_coordinator_id_fkey,
  ADD CONSTRAINT tier_progression_requests_coordinator_id_fkey 
    FOREIGN KEY (coordinator_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- tier_demotion_log
ALTER TABLE tier_demotion_log 
  DROP CONSTRAINT IF EXISTS tier_demotion_log_user_id_fkey,
  ADD CONSTRAINT tier_demotion_log_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE tier_demotion_log 
  DROP CONSTRAINT IF EXISTS tier_demotion_log_demoted_by_fkey,
  ADD CONSTRAINT tier_demotion_log_demoted_by_fkey 
    FOREIGN KEY (demoted_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- safety_incidents
ALTER TABLE safety_incidents 
  DROP CONSTRAINT IF EXISTS safety_incidents_user_id_fkey,
  ADD CONSTRAINT safety_incidents_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE safety_incidents 
  DROP CONSTRAINT IF EXISTS safety_incidents_reported_by_fkey,
  ADD CONSTRAINT safety_incidents_reported_by_fkey 
    FOREIGN KEY (reported_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE safety_incidents 
  DROP CONSTRAINT IF EXISTS safety_incidents_reviewed_by_fkey,
  ADD CONSTRAINT safety_incidents_reviewed_by_fkey 
    FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- team_events
ALTER TABLE team_events 
  DROP CONSTRAINT IF EXISTS team_events_created_by_fkey,
  ADD CONSTRAINT team_events_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- team_performance_log
ALTER TABLE team_performance_log 
  DROP CONSTRAINT IF EXISTS team_performance_log_updated_by_fkey,
  ADD CONSTRAINT team_performance_log_updated_by_fkey 
    FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- evaluation_queue
ALTER TABLE evaluation_queue 
  DROP CONSTRAINT IF EXISTS evaluation_queue_assigned_to_fkey,
  ADD CONSTRAINT evaluation_queue_assigned_to_fkey 
    FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;

-- quiz_questions
ALTER TABLE quiz_questions 
  DROP CONSTRAINT IF EXISTS quiz_questions_created_by_fkey,
  ADD CONSTRAINT quiz_questions_created_by_fkey 
    FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;