-- 0048_audit_chain_position.sql — make audit-chain ordering structural.
--
-- PROBLEM (review P0#1): the hash chain links rows in INSERTION order (writers
-- serialise on the advisory lock), but the tail lookup and both verifiers
-- ordered by (created_at, id) — and created_at came from the CALLING SERVERLESS
-- INSTANCE's clock (p_created_at). Two consequences:
--   a. Clock skew between Vercel lambdas can make insertion order disagree with
--      (created_at, id) order -> the daily verifier reports a FALSE "chain
--      broken" with no remediation path.
--   b. Anything holding the service key could pass an arbitrary p_created_at
--      and backdate an entry — the append-only chain did not actually pin time.
--
-- FIX:
--   * chain_position bigint: a monotonically increasing sequence value assigned
--     at insert; the chain's walk order is now explicit and physical.
--   * created_at is stamped INSIDE the function from the database clock
--     (clock_timestamp()), single-clock and monotonic under the advisory lock.
--     Callers can no longer influence it.
--   * occurred_at (new column, OUTSIDE the hash like chain_anchor_id): carries
--     the caller-supplied event time. For synchronous writes it ~equals
--     created_at; for outbox-drained events it preserves the ORIGINAL event
--     time instead of losing it to the drain time (review P0#4).
--
-- BACKFILL ORDER MATTERS: existing rows get chain_position in exactly the
-- (created_at asc, id asc) order the verifier has always walked, so every
-- stored hash remains valid when the walk switches to chain_position.

begin;

alter table public.audit_logs
  add column if not exists chain_position bigint,
  add column if not exists occurred_at timestamptz;

comment on column public.audit_logs.chain_position is
  'Monotonic insertion order of the hash chain. Tail lookup and verification '
  'order by this, never by created_at (clock-skew-proof). Outside the entry hash.';
comment on column public.audit_logs.occurred_at is
  'Caller-supplied event time (p_created_at). Differs from created_at for '
  'outbox-drained events, preserving when the action actually happened. '
  'Outside the entry hash, like chain_anchor_id.';

-- Backfill in the legacy verifier order so the existing chain stays verifiable.
with ordered as (
  select id, row_number() over (order by created_at asc, id asc) as rn
  from public.audit_logs
)
update public.audit_logs a
   set chain_position = o.rn
  from ordered o
 where o.id = a.id
   and a.chain_position is null;

create sequence if not exists public.audit_logs_chain_position_seq;
select setval(
  'public.audit_logs_chain_position_seq',
  coalesce((select max(chain_position) from public.audit_logs), 0) + 1,
  false
);
alter sequence public.audit_logs_chain_position_seq owned by public.audit_logs.chain_position;

alter table public.audit_logs
  alter column chain_position set default nextval('public.audit_logs_chain_position_seq');
alter table public.audit_logs
  alter column chain_position set not null;

create unique index if not exists audit_logs_chain_position_idx
  on public.audit_logs (chain_position);

-- The SECURITY DEFINER writer runs as audit_writer; without USAGE on the
-- sequence every audit insert would fail (and degrade to the outbox).
grant usage on sequence public.audit_logs_chain_position_seq to audit_writer;

-- ── write_audit_entry_atomic v3 ──────────────────────────────────────────────
-- Diff vs 0030: created_at := clock_timestamp() (DB clock, not caller clock);
-- occurred_at := p_created_at; tail selected by chain_position. The hash is
-- computed over the SAME field set as before (created_at it just chose), so
-- verification logic is unchanged apart from walk order. Signature is kept
-- byte-identical so rolling deploys and outbox replays never mismatch.
-- Canonical copy: supabase/functions/write_audit_entry_atomic.sql.
create or replace function public.write_audit_entry_atomic(
  p_actor_user_id uuid,
  p_actor_role    public.role_name,
  p_action        public.audit_action,
  p_entity_type   text,
  p_entity_id     text,
  p_patient_id    uuid,
  p_metadata_json jsonb,
  p_ip_address    inet,
  p_user_agent    text,
  p_created_at    timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tail_hash text;
  v_entry_hash text;
  v_new_id uuid;
  v_entity_uuid uuid;
  v_row_json jsonb;
  v_created_at timestamptz;
begin
  -- Compatibility-critical: same key as legacy write_audit_entry (0030) so
  -- mixed old/new serverless instances cannot append against separate locks.
  if not pg_try_advisory_xact_lock(hashtext('dtm_audit_chain')) then
    raise exception 'audit chain lock busy' using errcode = '40001';
  end if;

  -- Database clock, sampled under the lock. Callers cannot backdate the chain;
  -- their timestamp is preserved separately in occurred_at.
  v_created_at := clock_timestamp();

  select entry_hash into v_tail_hash
    from public.audit_logs
    order by chain_position desc
    limit 1;

  if p_entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_entity_uuid := p_entity_id::uuid;
  else
    v_entity_uuid := null;
  end if;

  v_row_json := jsonb_build_object(
    'actor_user_id', p_actor_user_id,
    'actor_role', p_actor_role,
    'action', p_action,
    'entity_type', p_entity_type,
    'entity_id', v_entity_uuid,
    'patient_id', p_patient_id,
    'metadata_json', coalesce(p_metadata_json, '{}'::jsonb),
    'ip_address', p_ip_address,
    'user_agent', p_user_agent,
    'created_at', public.audit_iso8601_utc(v_created_at),
    'prev_hash', v_tail_hash
  );

  v_entry_hash := encode(
    digest(coalesce(v_tail_hash, '') || '|' || public.audit_canonical_json(v_row_json), 'sha256'),
    'hex'
  );

  insert into public.audit_logs (
    actor_user_id, actor_role, action, entity_type, entity_id,
    patient_id, metadata_json, ip_address, user_agent,
    created_at, occurred_at, prev_hash, entry_hash
  ) values (
    p_actor_user_id, p_actor_role, p_action, p_entity_type, v_entity_uuid,
    p_patient_id, coalesce(p_metadata_json, '{}'::jsonb), p_ip_address, p_user_agent,
    v_created_at, p_created_at, v_tail_hash, v_entry_hash
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

alter function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) owner to audit_writer;

revoke all on function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) from public;

grant execute on function public.write_audit_entry_atomic(
  uuid, public.role_name, public.audit_action, text, text, uuid, jsonb, inet, text, timestamptz
) to service_role;

commit;

-- POST-APPLY VERIFICATION:
--   1. select count(*) from audit_logs where chain_position is null; -> 0.
--   2. Trigger any audited action; new row has chain_position = previous max + 1,
--      created_at from the DB clock, occurred_at ~= request time.
--   3. Run the chain verifier (full walk) -> OK across the legacy/new boundary.
--   4. select * from pg_sequences where sequencename = 'audit_logs_chain_position_seq';
