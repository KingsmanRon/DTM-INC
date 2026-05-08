-- Fix the practice qualifications text on the singleton settings row.
-- A previous edit saved "MMed (Sx2)" instead of the correct "MMed (SMU)",
-- which then surfaced on the onboarding PDF letterhead. Migration 0012
-- was intended to repair this but was written as a no-op (SMU -> SMU),
-- so the typo is corrected here.
update public.practice_settings
   set doctor_qualifications = replace(doctor_qualifications, 'MMed (Sx2)', 'MMed (SMU)')
 where id = 1
   and doctor_qualifications like '%MMed (Sx2)%';
