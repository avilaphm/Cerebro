ALTER TABLE public.social_drafts
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS post_type text DEFAULT 'single';
