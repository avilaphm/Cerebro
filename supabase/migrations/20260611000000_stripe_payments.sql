-- Stripe session payments
-- 1) Stripe customer id + last pack size on pt_clients
-- 2) pt_payments: one row per successful top-up, idempotent on stripe_payment_intent_id

-- ── 1. Client payment columns ───────────────────────────────────────────────
-- stripe_customer_id: the Stripe Customer that holds this client's saved cards.
-- last_pack_size:     the size of the client's most recent pack purchase. Drives
--                     the low-session reminder rule (only 5/10-pack buyers get the
--                     2-left / 1-left / 0 emails; 1/2-pack buyers know they're low).
alter table public.pt_clients
  add column if not exists stripe_customer_id text,
  add column if not exists last_pack_size integer;

-- ── 2. Payments ledger ──────────────────────────────────────────────────────
-- One row per credited purchase. The UNIQUE constraint on stripe_payment_intent_id
-- is the idempotency guard: crediting (webhook + client confirm) inserts here first,
-- so sessions are ever only added once per PaymentIntent.
create table if not exists public.pt_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.pt_clients(id) on delete cascade,
  stripe_payment_intent_id text not null unique,
  pack_size integer not null,
  amount_cents integer not null,
  currency text not null default 'aud',
  status text not null default 'succeeded',
  card_brand text,
  card_last4 text,
  created_at timestamptz not null default now()
);

create index if not exists pt_payments_client_id_idx on public.pt_payments(client_id);

alter table public.pt_payments enable row level security;

create policy "service role full pt payments"
  on public.pt_payments for all
  using (true) with check (true);

create policy "pt admins full pt payments"
  on public.pt_payments for all
  using (
    lower((select auth.jwt() ->> 'email')) = any (array[
      'pedro@meetavila.com', 'pedroavila.phm@gmail.com', 'pedro@cerebroai.au', 'avila.phm@gmail.com'
    ])
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
  );

create policy "clients read own pt payments"
  on public.pt_payments for select
  using (
    exists (
      select 1 from public.pt_clients c
      where c.id = pt_payments.client_id and c.user_id = (select auth.uid())
    )
  );
