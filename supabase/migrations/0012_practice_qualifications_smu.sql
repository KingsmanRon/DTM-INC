-- Update the practice qualifications text on the singleton settings row.
-- The 0001 schema default already reads "MMed (SMU)", but rows seeded
-- with the older "MMed (SMU)" value need to be corrected so the
-- onboarding PDF letterhead reflects the doctor's current credentials.
update public.practice_settings
   set doctor_qualifications = 'MBBCh, BSc (Lab Med) (WITS), FCS (SA), MMed (SMU)'
 where id = 1
   and doctor_qualifications = 'MBBCh, BSc (Lab Med) (WITS), FCS (SA), MMed (SMU)';
