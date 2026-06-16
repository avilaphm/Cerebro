-- Per-client pricing tier for session packs.
-- Tier 1 is the standard rate; tier 2 is the higher rate. Defaults to tier 1.
alter table pt_clients
  add column if not exists price_tier smallint not null default 1;

alter table pt_clients
  drop constraint if exists pt_clients_price_tier_check;

alter table pt_clients
  add constraint pt_clients_price_tier_check check (price_tier in (1, 2));
