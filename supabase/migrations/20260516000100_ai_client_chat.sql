-- Add AI handoff flag to pt_messages so clients can trigger Pedro takeover
ALTER TABLE public.pt_messages
  ADD COLUMN IF NOT EXISTS ai_handoff_requested boolean NOT NULL DEFAULT false;

-- Index for PT dashboard to quickly surface handoff requests
CREATE INDEX IF NOT EXISTS pt_messages_handoff_idx
  ON public.pt_messages (client_id, ai_handoff_requested)
  WHERE ai_handoff_requested = true;
