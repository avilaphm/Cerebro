-- Add X posting fields to social_drafts
alter table public.social_drafts
  add column if not exists tweet_id   text,
  add column if not exists posted_at  timestamptz;
