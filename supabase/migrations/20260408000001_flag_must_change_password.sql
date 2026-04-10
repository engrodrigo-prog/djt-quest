-- Flag all users who were provisioned with default password and haven't changed it
-- must_change_password = true means they need to change on next login
-- must_change_password = false means they already changed it
-- must_change_password = null means it was never set (old users) - treat as needing change if they have a default pattern

-- For safety, only flag users where the field is explicitly null AND were created before this fix was deployed
-- Admins can manually unset this for users they've confirmed have changed passwords
UPDATE profiles
SET must_change_password = true
WHERE must_change_password IS NULL
  AND created_at < NOW();
