-- 0042_file_number_reservations_table.sql — bring the reservations table into the repo.
--
-- WHY: 0040 taught allocate_file_number() to consume rows from
-- public.file_number_reservations, but that table was created OUT-OF-BAND on the
-- live database and never captured as a migration. That broke the invariant that
-- a fresh database can be rebuilt from this directory alone (disaster recovery,
-- and the v2 repackaging deployments for new practices).
--
-- On the EXISTING production DB this migration is a no-op (CREATE TABLE IF NOT
-- EXISTS finds the table). On a FRESH database it creates the table 0040 needs.
--
-- !! VERIFY BEFORE FIRST USE ON A FRESH DB !!
-- This definition is reconstructed from 0040's usage (prefix/year/seq/consumed_at,
-- lowest-seq-first consumption, consumed_by intentionally unset). Before relying
-- on it, diff against the live definition:
--   select column_name, data_type, is_nullable
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'file_number_reservations'
--    order by ordinal_position;
-- and adjust this file if prod differs (then re-verify the no-op property).
--
-- Security posture: no RLS policies and no grants to anon/authenticated — the
-- ONLY reader/writer is allocate_file_number() (SECURITY DEFINER). Operators
-- insert reservations via the SQL editor / service connection deliberately.

create table if not exists public.file_number_reservations (
  prefix      text        not null,
  year        int         not null,
  seq         bigint      not null,
  reason      text,                          -- why this slot was reserved (operator note)
  consumed_at timestamptz,                   -- set by allocate_file_number() on consumption
  consumed_by uuid,                          -- reserved for future linking; 0040 leaves unset
  created_at  timestamptz not null default now(),
  constraint file_number_reservations_pkey primary key (prefix, year, seq),
  constraint file_number_reservations_seq_positive check (seq > 0)
);

comment on table public.file_number_reservations is
  'Pre-approved one-off file-number slots consumed lowest-seq-first by '
  'allocate_file_number() (0040) before the (year, prefix) counter is touched. '
  'Created out-of-band originally; captured in-repo by 0042 for rebuildability. '
  'Operator-managed; no app-facing grants.';

alter table public.file_number_reservations enable row level security;

-- No policies on purpose: under RLS with no policies, anon/authenticated see and
-- touch nothing. allocate_file_number() is SECURITY DEFINER and bypasses RLS.
revoke all on public.file_number_reservations from anon;
revoke all on public.file_number_reservations from authenticated;
