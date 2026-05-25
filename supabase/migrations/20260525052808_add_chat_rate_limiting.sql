-- Fixed-window per-IP rate limiting for the public chat bot.
create table if not exists public.chat_rate_limits (
  ip text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (ip, window_start)
);

alter table public.chat_rate_limits enable row level security;

-- Service role only (the chat edge function writes via the service role).
drop policy if exists "service role only chat_rate_limits" on public.chat_rate_limits;
create policy "service role only chat_rate_limits"
  on public.chat_rate_limits for all to service_role using (true) with check (true);

-- Atomic increment + check. Returns true if the request is allowed.
create or replace function public.check_chat_rate_limit(p_ip text, p_limit int default 30, p_window_seconds int default 600)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into public.chat_rate_limits (ip, window_start, count)
  values (p_ip, v_window, 1)
  on conflict (ip, window_start) do update set count = chat_rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- Lock execution to service_role only (never anon/authenticated/PUBLIC).
revoke execute on function public.check_chat_rate_limit(text, int, int) from public;
revoke execute on function public.check_chat_rate_limit(text, int, int) from anon, authenticated;
grant execute on function public.check_chat_rate_limit(text, int, int) to service_role;
