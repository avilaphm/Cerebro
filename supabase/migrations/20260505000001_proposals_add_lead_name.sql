-- Add lead_name to proposals so the table editor shows who the proposal belongs to
-- without having to click through the lead_id UUID.
alter table public.proposals add column if not exists lead_name text;
