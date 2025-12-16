-- Ensure only one pending registration per email (case-insensitive)
-- This prevents duplicate "pending" requests when backend falls back to anon/RLS.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_registrations_email_pending
  ON public.pending_registrations (lower(email))
  WHERE status = 'pending';

