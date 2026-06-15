-- 0058_responsible_party_nullable_for_us.sql
--
-- Make US onboarding actually possible. patient_account_responsible carried
-- three NOT NULL columns that are SA assumptions: id_number, date_of_birth, and
-- marital_status. A US patient has no national ID, an adult is often their own
-- account-responsible party, and marital status is optional — so onboard_patient
-- (0057) would have failed at this insert for a 'us' practice. Relax them.
--
-- Safe and additive: every existing SA row already has these populated, and the
-- SA path (locale 'za' zod + onboard_patient) still supplies them, so this only
-- WIDENS what the database accepts — SA behaviour is unchanged. (Same approach
-- as 0017, which dropped patients.id_number NOT NULL and moved enforcement to
-- the identity CHECK / RPC.)

alter table public.patient_account_responsible
  alter column id_number drop not null,
  alter column date_of_birth drop not null,
  alter column marital_status drop not null;
