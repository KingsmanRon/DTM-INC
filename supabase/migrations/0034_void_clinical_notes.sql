-- 0034_void_clinical_notes.sql
--
-- Adds a controlled, audit-preserving void workflow for finalised clinical
-- notes. Finalised notes remain immutable for content/identity fields and still
-- cannot be deleted; the only permitted post-finalisation update is setting the
-- void metadata exactly once.

begin;

alter table public.clinical_notes
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references public.app_users(id) on delete restrict,
  add column if not exists void_reason text;

create index if not exists clinical_notes_patient_active_idx
  on public.clinical_notes(patient_id, created_at desc)
  where voided_at is null;

create index if not exists clinical_notes_patient_voided_idx
  on public.clinical_notes(patient_id, voided_at desc)
  where voided_at is not null;

comment on column public.clinical_notes.voided_at is
  'Timestamp set when a finalised clinical note is voided. NULL means active/non-voided.';
comment on column public.clinical_notes.voided_by is
  'Authenticated app user who voided the finalised clinical note.';
comment on column public.clinical_notes.void_reason is
  'Mandatory reason captured when a finalised clinical note is voided.';

alter type public.audit_action add value if not exists 'clinical_note_voided';

create or replace function public.prevent_finalised_clinical_note_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_finalised then
      raise exception 'clinical_notes %: finalised notes cannot be deleted (supersede via amendment)', old.id
        using errcode = 'PT409';
    end if;
    return old;
  end if;

  if old.is_finalised = false and new.is_finalised = true then
    if new.encrypted_body is distinct from old.encrypted_body
       or new.nonce is distinct from old.nonce
       or new.encrypted_ink is distinct from old.encrypted_ink
       or new.ink_nonce is distinct from old.ink_nonce
       or new.dek_id is distinct from old.dek_id
       or new.patient_id is distinct from old.patient_id
       or new.author_user_id is distinct from old.author_user_id
       or new.note_date is distinct from old.note_date
       or new.amended_from_note_id is distinct from old.amended_from_note_id
       or new.voided_at is distinct from old.voided_at
       or new.voided_by is distinct from old.voided_by
       or new.void_reason is distinct from old.void_reason
       or new.created_at is distinct from old.created_at then
      raise exception 'clinical_notes %: content, identity, or void metadata cannot be modified while finalising', old.id
        using errcode = 'PT409';
    end if;
    return new;
  end if;

  if old.is_finalised then
    if current_setting('app.void_clinical_note', true) = 'on'
       and old.voided_at is null
       and new.is_finalised is true
       and new.voided_at is not null
       and new.voided_by = auth.uid()
       and length(btrim(coalesce(new.void_reason, ''))) >= 3
       and new.encrypted_body is not distinct from old.encrypted_body
       and new.nonce is not distinct from old.nonce
       and new.encrypted_ink is not distinct from old.encrypted_ink
       and new.ink_nonce is not distinct from old.ink_nonce
       and new.encrypted_ink_png is not distinct from old.encrypted_ink_png
       and new.ink_png_nonce is not distinct from old.ink_png_nonce
       and new.dek_id is not distinct from old.dek_id
       and new.patient_id is not distinct from old.patient_id
       and new.author_user_id is not distinct from old.author_user_id
       and new.note_date is not distinct from old.note_date
       and new.finalised_at is not distinct from old.finalised_at
       and new.amended_from_note_id is not distinct from old.amended_from_note_id
       and new.created_at is not distinct from old.created_at then
      return new;
    end if;

    raise exception 'clinical_notes %: finalised notes are immutable except for controlled voiding', old.id
      using errcode = 'PT409';
  end if;

  return new;
end;
$$;

create or replace function public.void_clinical_note(
  p_note_id uuid,
  p_reason text
)
returns table (
  note_id uuid,
  patient_id uuid,
  voided_at timestamptz,
  voided_by uuid,
  void_reason text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_note public.clinical_notes%rowtype;
begin
  if p_note_id is null then
    raise exception 'note_id is required' using errcode = '22023';
  end if;

  if length(v_reason) < 3 then
    raise exception 'void reason must be at least 3 characters' using errcode = '22023';
  end if;

  if public.current_app_role() is distinct from 'doctor' then
    raise exception 'only doctors can void clinical notes' using errcode = '42501';
  end if;

  select * into v_note
  from public.clinical_notes cn
  where cn.id = p_note_id
  for update;

  if not found then
    raise exception 'clinical note not found' using errcode = 'PT404';
  end if;

  if not v_note.is_finalised then
    raise exception 'only finalised clinical notes can be voided' using errcode = 'PT409';
  end if;

  if v_note.voided_at is not null then
    raise exception 'clinical note is already voided' using errcode = 'PT409';
  end if;

  perform set_config('app.void_clinical_note', 'on', true);

  return query
    update public.clinical_notes cn
       set voided_at = now(),
           voided_by = auth.uid(),
           void_reason = v_reason,
           updated_at = now()
     where cn.id = p_note_id
     returning cn.id, cn.patient_id, cn.voided_at, cn.voided_by, cn.void_reason;
end;
$$;

revoke all on function public.void_clinical_note(uuid, text) from public;
grant execute on function public.void_clinical_note(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- POST-APPLY VERIFICATION:
--   1. Doctor can call public.void_clinical_note(finalised_note_id, 'Entered in error').
--   2. Draft notes are rejected by the RPC.
--   3. Staff are rejected by the RPC/RLS and cannot see note content.
--   4. Direct content updates and deletes of finalised notes still return PT409.
--   5. Direct updates that set void metadata outside public.void_clinical_note are rejected.
