-- Durable outbox for audit events when synchronous writes degrade.
begin;

create table if not exists public.audit_log_outbox (
  id uuid primary key default gen_random_uuid(),
  payload_json jsonb not null,
  reason text not null,
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_outbox_ready_idx
  on public.audit_log_outbox (processed_at, available_at, created_at);

grant select, insert, update on table public.audit_log_outbox to service_role;

commit;
