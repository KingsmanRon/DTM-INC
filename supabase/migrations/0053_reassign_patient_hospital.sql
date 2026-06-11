-- 0053_reassign_patient_hospital.sql — correct a patient onboarded at the
-- wrong hospital.
--
-- INCIDENT DRIVER (2026-06-11): a patient was onboarded under Nkanyezi (NKA
-- file number) but actually belongs to Fountain (FOU). Hospital was made
-- immutable in demographics editing (0047) precisely because the file number
-- carries the hospital prefix — so the correction needs a deliberate,
-- first-class workflow, not an inline edit or SQL surgery.
--
-- INVARIANTS THIS DESIGN PROTECTS:
--   1. File numbers are NEVER reused. The patient gets a NEW number allocated
--      under the correct prefix via allocate_file_number() (which consults
--      reservations, 0040). The retired number is recorded in
--      patient_file_number_history AND poison-pilled into
--      file_number_reservations as already-consumed, so even a manual
--      reservation can never re-issue it to another patient.
--   2. The old number stays FINDABLE: reception holding the old paper file can
--      still search it (the search route reads the history table).
--   3. Billing coherence: PENDING (never-exported) billing rows under the old
--      hospital are removed in the same transaction — they snapshot a file
--      number and hospital that are now wrong. EXPORTED/RETURNED rows are
--      disclosure history and are never touched.
--   4. Everything happens in ONE transaction, serialised on the patient row.

begin;

create table if not exists public.patient_file_number_history (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients(id) on delete restrict,
  old_file_number text not null unique,
  old_hospital    text not null,
  new_file_number text not null,
  new_hospital    text not null,
  reason          text not null,
  changed_by      uuid not null references public.app_users(id),
  created_at      timestamptz not null default now()
);

create index if not exists patient_file_number_history_patient_idx
  on public.patient_file_number_history (patient_id, created_at desc);

comment on table public.patient_file_number_history is
  'Retired file numbers from hospital reassignments (0053). Search resolves '
  'old numbers through this table so paper files labelled with a retired '
  'number still find the patient. Rows are written ONLY by '
  'reassign_patient_hospital(); old numbers are never reissued.';

-- Doctor + staff may read (search + "formerly" display). No INSERT/UPDATE/
-- DELETE policies: writes happen inside the SECURITY DEFINER RPC only.
alter table public.patient_file_number_history enable row level security;

create policy patient_file_number_history_clinical_read on public.patient_file_number_history
  for select to authenticated
  using ((select public.current_app_role()) in ('doctor'::public.role_name, 'staff'::public.role_name));

revoke all on public.patient_file_number_history from anon;
grant select on public.patient_file_number_history to authenticated;

-- ── The reassignment RPC ─────────────────────────────────────────────────────
-- SECURITY DEFINER: it must write the history table and the reservations
-- poison pill, which have no authenticated write path by design. The caller's
-- app role is re-checked in-function (0034/0036/0045 pattern).
create or replace function public.reassign_patient_hospital(
  p_patient_id   uuid,
  p_new_hospital text,
  p_reason       text
)
returns table (
  old_file_number text,
  new_file_number text,
  old_hospital    text,
  new_hospital    text,
  removed_pending_billing int
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.role_name;
  v_patient public.patients%rowtype;
  v_new_prefix text;
  v_new_number text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_removed int := 0;
  v_old_prefix text;
  v_old_year int;
  v_old_seq bigint;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  v_role := (select public.current_app_role());
  if v_role is null or v_role not in ('doctor', 'staff') then
    raise exception 'file reassignment is restricted to staff and doctor'
      using errcode = '42501';
  end if;

  if length(v_reason) < 10 then
    raise exception 'a reason of at least 10 characters is required'
      using errcode = '22023';
  end if;

  select * into v_patient
    from public.patients
    where id = p_patient_id
    for update;
  if not found then
    raise exception 'patient not found' using errcode = 'PT404';
  end if;

  if v_patient.hospital = p_new_hospital then
    raise exception 'patient is already filed under %', p_new_hospital
      using errcode = 'PT409';
  end if;

  select h.file_prefix into v_new_prefix
    from public.hospitals h
    where h.name = p_new_hospital
      and h.active;
  if v_new_prefix is null then
    raise exception 'Invalid or inactive hospital value: %', coalesce(p_new_hospital, 'null')
      using errcode = '22023';
  end if;

  -- New number under the correct prefix (consults reservations per 0040).
  v_new_number := public.allocate_file_number(null, v_new_prefix);

  -- Retire the old number: history row (search + traceability)…
  insert into public.patient_file_number_history (
    patient_id, old_file_number, old_hospital,
    new_file_number, new_hospital, reason, changed_by
  ) values (
    p_patient_id, v_patient.file_number, v_patient.hospital,
    v_new_number, p_new_hospital, v_reason, v_actor
  );

  -- …and a poison pill so the retired slot can never be re-issued through the
  -- reservations path. Parsed from the {PREFIX}-{YYYY}-{SEQ} format; a legacy
  -- number that does not parse simply skips this guard (the sequence counter
  -- is already past it and patients.file_number uniqueness still holds).
  if v_patient.file_number ~ '^[A-Z]{2,5}-\d{4}-\d+$' then
    v_old_prefix := split_part(v_patient.file_number, '-', 1);
    v_old_year   := split_part(v_patient.file_number, '-', 2)::int;
    v_old_seq    := split_part(v_patient.file_number, '-', 3)::bigint;
    insert into public.file_number_reservations (prefix, year, seq, reason, consumed_at)
    values (v_old_prefix, v_old_year, v_old_seq,
            'retired by hospital reassignment of patient ' || p_patient_id, now())
    on conflict (prefix, year, seq) do update
      set consumed_at = coalesce(public.file_number_reservations.consumed_at, now());
  end if;

  update public.patients
     set hospital = p_new_hospital,
         file_number = v_new_number,
         updated_by = v_actor
   where id = p_patient_id;

  -- Drop PENDING billing rows snapshotted under the wrong hospital. Exported
  -- and returned rows are part of the disclosure record and stay untouched.
  delete from public.billing_export_items b
   where b.patient_id = p_patient_id
     and b.hospital = v_patient.hospital
     and b.status = 'pending';
  get diagnostics v_removed = row_count;

  old_file_number := v_patient.file_number;
  new_file_number := v_new_number;
  old_hospital := v_patient.hospital;
  new_hospital := p_new_hospital;
  removed_pending_billing := v_removed;
  return next;
end;
$$;

revoke all on function public.reassign_patient_hospital(uuid, text, text) from public;
grant execute on function public.reassign_patient_hospital(uuid, text, text) to authenticated;

commit;

-- POST-APPLY VERIFICATION:
--   1. As staff: reassign a test patient NKA -> FOU; new number is FOU-…;
--      history row exists; old (prefix,year,seq) sits consumed in
--      file_number_reservations; pending billing rows under NKA are gone.
--   2. Search by the OLD number still finds the patient (after code deploy).
--   3. As admin: rpc -> 42501. Same-hospital reassign -> PT409.
--   4. Reassigning twice chains correctly (second history row).
