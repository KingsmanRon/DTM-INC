-- 0015_appointments_queue_and_sync.sql
-- Adds appointment scheduling + queue tracking + optional offline sync dedupe.
-- Additive-only migration; preserves existing auth/RLS model.

set statement_timeout = 0;
set lock_timeout = 0;
set idle_in_transaction_session_timeout = 0;

-- ═══════════════════════════════════════════════════════════════════════════
-- STATUS ENUMS
-- ═══════════════════════════════════════════════════════════════════════════

create type appointment_status as enum (
  'scheduled',
  'confirmed',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'no_show'
);

create type appointment_queue_status as enum (
  'queued',
  'called',
  'in_room',
  'completed',
  'cancelled',
  'removed'
);

create type offline_sync_event_status as enum (
  'pending',
  'processed',
  'failed',
  'ignored_duplicate'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- APPOINTMENTS
-- ═══════════════════════════════════════════════════════════════════════════

create table appointments (
  id                   uuid primary key default gen_random_uuid(),
  patient_id           uuid not null references patients(id) on delete restrict,
  doctor_id            uuid not null references app_users(id) on delete restrict,
  scheduled_at         timestamptz not null,
  duration_minutes     integer not null default 30,
  reason               text,
  notes                text,
  status               appointment_status not null default 'scheduled',
  checked_in_at        timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references app_users(id),
  updated_by           uuid references app_users(id),
  constraint appointments_duration_positive check (duration_minutes > 0),
  constraint appointments_doctor_role check (
    exists (
      select 1
      from app_users u
      join roles r on r.id = u.role_id
      where u.id = doctor_id and r.name = 'doctor'
    )
  ),
  constraint appointments_checked_in_requires_arrival check (
    checked_in_at is null or status in ('arrived', 'in_progress', 'completed')
  ),
  constraint appointments_completed_requires_timestamp check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

-- Day/doctor/status filters for operational views.
create index appointments_scheduled_at_idx on appointments (scheduled_at);
create index appointments_doctor_day_idx on appointments (doctor_id, scheduled_at);
create index appointments_status_day_idx on appointments (status, scheduled_at);
create index appointments_patient_scheduled_idx on appointments (patient_id, scheduled_at desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- APPOINTMENT QUEUE
-- ═══════════════════════════════════════════════════════════════════════════

create table appointment_queue (
  id                   uuid primary key default gen_random_uuid(),
  appointment_id       uuid not null unique references appointments(id) on delete restrict,
  patient_id           uuid not null references patients(id) on delete restrict,
  doctor_id            uuid not null references app_users(id) on delete restrict,
  queue_date           date not null default current_date,
  queue_number         integer not null,
  status               appointment_queue_status not null default 'queued',
  queued_at            timestamptz not null default now(),
  called_at            timestamptz,
  in_room_at           timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  removed_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references app_users(id),
  updated_by           uuid references app_users(id),
  constraint appointment_queue_number_positive check (queue_number > 0),
  constraint appointment_queue_unique_slot unique (doctor_id, queue_date, queue_number),
  constraint appointment_queue_terminal_timestamps check (
    (status <> 'completed' or completed_at is not null) and
    (status <> 'cancelled' or cancelled_at is not null) and
    (status <> 'removed' or removed_at is not null)
  )
);

create index appointment_queue_date_status_idx on appointment_queue (queue_date, status);
create index appointment_queue_doctor_date_idx on appointment_queue (doctor_id, queue_date, queue_number);
create index appointment_queue_patient_date_idx on appointment_queue (patient_id, queue_date desc);

-- ═══════════════════════════════════════════════════════════════════════════
-- OPTIONAL OFFLINE SYNC DEDUPE / IDEMPOTENCY
-- ═══════════════════════════════════════════════════════════════════════════

create table offline_sync_events (
  id                   uuid primary key default gen_random_uuid(),
  client_action_id     text not null unique,
  actor_user_id        uuid not null references app_users(id) on delete restrict,
  target_table         text not null,
  target_id            uuid,
  action_name          text not null,
  request_payload      jsonb,
  response_payload     jsonb,
  status               offline_sync_event_status not null default 'pending',
  processed_at         timestamptz,
  error_message        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references app_users(id),
  updated_by           uuid references app_users(id),
  constraint offline_sync_events_processed_at_consistency check (
    (status in ('processed', 'failed', 'ignored_duplicate') and processed_at is not null)
    or (status = 'pending' and processed_at is null)
  )
);

create index offline_sync_events_status_created_idx on offline_sync_events (status, created_at);
create index offline_sync_events_actor_created_idx on offline_sync_events (actor_user_id, created_at desc);

-- updated_at triggers for additive tables.
create trigger trg_set_updated_at_appointments
before update on appointments
for each row execute function set_updated_at();

create trigger trg_set_updated_at_appointment_queue
before update on appointment_queue
for each row execute function set_updated_at();

create trigger trg_set_updated_at_offline_sync_events
before update on offline_sync_events
for each row execute function set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS + GRANTS
-- ═══════════════════════════════════════════════════════════════════════════

alter table appointments enable row level security;
alter table appointment_queue enable row level security;
alter table offline_sync_events enable row level security;

create policy appointments_clinical_read on appointments
  for select to authenticated using (is_doctor() or is_staff());
create policy appointments_clinical_insert on appointments
  for insert to authenticated with check (is_doctor() or is_staff());
create policy appointments_clinical_update on appointments
  for update to authenticated using (is_doctor() or is_staff())
  with check (is_doctor() or is_staff());

create policy appointment_queue_clinical_read on appointment_queue
  for select to authenticated using (is_doctor() or is_staff());
create policy appointment_queue_clinical_insert on appointment_queue
  for insert to authenticated with check (is_doctor() or is_staff());
create policy appointment_queue_clinical_update on appointment_queue
  for update to authenticated using (is_doctor() or is_staff())
  with check (is_doctor() or is_staff());

-- Offline sync events are operational metadata. Allow staff/doctor to view and
-- write only their own actor rows; admins can view all for support/debugging.
create policy offline_sync_events_actor_read on offline_sync_events
  for select to authenticated using (
    is_admin() or (is_doctor() or is_staff()) and actor_user_id = auth.uid()
  );
create policy offline_sync_events_actor_insert on offline_sync_events
  for insert to authenticated with check (
    (is_doctor() or is_staff()) and actor_user_id = auth.uid()
  );
create policy offline_sync_events_actor_update on offline_sync_events
  for update to authenticated using (
    (is_doctor() or is_staff()) and actor_user_id = auth.uid()
  )
  with check ((is_doctor() or is_staff()) and actor_user_id = auth.uid());

grant select, insert, update on
  appointments,
  appointment_queue,
  offline_sync_events
to authenticated;
