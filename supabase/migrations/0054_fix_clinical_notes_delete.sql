-- Allow authenticated doctors to reach the clinical_notes DELETE path so the
-- finalised-note immutability trigger can raise PT409. RLS still limits DELETE
-- visibility to doctors via clinical_notes_doctor_only; staff/admin deletes are
-- not permitted by policy, and draft notes remain deletable by doctors.
grant delete on table public.clinical_notes to authenticated;
