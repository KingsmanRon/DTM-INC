-- 0049_audit_verify_checkpoint.sql — incremental chain verification (review P2#17).
--
-- The daily verifier walked the ENTIRE audit chain on every run — O(history),
-- forever-growing, and eventually over the serverless time budget. This table
-- stores where the last successful verification stopped so the daily run only
-- walks new rows; a full walk remains available (?full=true on the internal
-- route, or scripts/verify-audit-chain.mjs --full) and is recommended weekly.
--
-- Only the service-role verifier touches this table. RLS enabled with no
-- policies = invisible to anon/authenticated; explicit grant for service_role
-- (Supabase default privileges are not relied upon for migration-created tables).

begin;

create table if not exists public.audit_verify_checkpoints (
  name            text primary key,
  last_position   bigint not null,
  last_entry_hash text not null,
  verified_at     timestamptz not null default now()
);

comment on table public.audit_verify_checkpoints is
  'Progress marker for incremental audit-chain verification. One row per chain '
  '(name = ''audit_chain''). A checkpoint is only advanced after the segment '
  'verified clean; delete the row to force the next run to walk from genesis.';

alter table public.audit_verify_checkpoints enable row level security;

revoke all on public.audit_verify_checkpoints from anon;
revoke all on public.audit_verify_checkpoints from authenticated;
grant select, insert, update, delete on public.audit_verify_checkpoints to service_role;

commit;
