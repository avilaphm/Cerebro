-- PT Dashboard Revamp: new columns, messages, groups, storage bucket

-- Extend pt_clients with new fields
ALTER TABLE public.pt_clients
  ADD COLUMN IF NOT EXISTS sessions_remaining int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_url text,
  ADD COLUMN IF NOT EXISTS password_created_at timestamptz;

-- Messages table
CREATE TABLE IF NOT EXISTS public.pt_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.pt_clients(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('pt', 'client')),
  content text NOT NULL,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.pt_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pt admins full messages"
  ON public.pt_messages
  FOR ALL
  TO authenticated
  USING (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  WITH CHECK (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

CREATE POLICY "clients read own messages"
  ON public.pt_messages
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (SELECT id FROM public.pt_clients WHERE user_id = (select auth.uid()))
  );

CREATE POLICY "clients insert own messages"
  ON public.pt_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id IN (SELECT id FROM public.pt_clients WHERE user_id = (select auth.uid()))
    AND sender = 'client'
  );

-- Groups tables
CREATE TABLE IF NOT EXISTS public.pt_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text DEFAULT '#000000',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.pt_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pt admins full groups"
  ON public.pt_groups
  FOR ALL
  TO authenticated
  USING (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  WITH CHECK (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

CREATE TABLE IF NOT EXISTS public.pt_group_members (
  group_id uuid NOT NULL REFERENCES public.pt_groups(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.pt_clients(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, client_id)
);

ALTER TABLE public.pt_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pt admins full group members"
  ON public.pt_group_members
  FOR ALL
  TO authenticated
  USING (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  )
  WITH CHECK (
    lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
    OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

-- Storage bucket for client profile documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pt-client-docs',
  'pt-client-docs',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "admins upload client docs"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pt-client-docs'
    AND (
      lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
      OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    )
  );

CREATE POLICY "admins read client docs"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pt-client-docs'
    AND (
      lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
      OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    )
  );

CREATE POLICY "admins delete client docs"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pt-client-docs'
    AND (
      lower((select auth.jwt() ->> 'email')) in ('pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au')
      OR exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
    )
  );
