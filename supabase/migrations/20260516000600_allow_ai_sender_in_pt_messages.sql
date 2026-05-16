-- Allow 'ai' as a valid sender in pt_messages so the ai-client-chat edge function
-- can insert AI coach responses (was only 'pt' and 'client' before).
ALTER TABLE public.pt_messages
  DROP CONSTRAINT pt_messages_sender_check,
  ADD CONSTRAINT pt_messages_sender_check CHECK (sender = ANY (ARRAY['pt'::text, 'client'::text, 'ai'::text]));
