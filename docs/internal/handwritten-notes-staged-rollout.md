# Handwritten clinical notes staged rollout

Handwritten ink remains on `clinical_notes.encrypted_ink` with its AES-GCM nonce in
`clinical_notes.ink_nonce`. Migration `0027` adds no child table and does not
change RLS. The application encrypts ink app-side with the same patient DEK path
as typed notes, using a separate nonce.

## Release gates

Keep the following production defaults until each prior gate has passed:

```text
FEATURE_HANDWRITTEN_NOTES=false
FEATURE_HANDWRITTEN_NOTES_DOCTOR_IDS=
FEATURE_HANDWRITTEN_NOTES_FINALISE=false
FEATURE_HANDWRITTEN_NOTES_PDF=false
```

1. Deploy the null-safe reads and flags.
2. Apply `0027_clinical_notes_handwritten_ink.sql` on staging first.
3. Run all eight post-apply checks below. Use real doctor, staff, and admin test
   sessions and a staging patient. Check 7 and check 8 must exercise the real
   HTTP routes rather than direct database updates.
4. Deploy API ink round-trip support and verify byte-identical ink output before
   enabling any doctor ID.
5. Add one staging doctor UUID to `FEATURE_HANDWRITTEN_NOTES_DOCTOR_IDS`, set
   `FEATURE_HANDWRITTEN_NOTES=true`, and verify draft-only canvas behavior.
6. Keep `FEATURE_HANDWRITTEN_NOTES_FINALISE=false` and
   `FEATURE_HANDWRITTEN_NOTES_PDF=false` after Release 4.

## Eight post-apply checks

- [ ] 1. Confirm `encrypted_ink` and `ink_nonce` exist on `clinical_notes`; confirm no ink child table exists.
- [ ] 2. Confirm the clinical-note RLS policies are unchanged and staff/admin ordinary note queries return zero rows.
- [ ] 3. Confirm a typed-only draft can be created and read.
- [ ] 4. Confirm an ink-only draft can be created and read byte-identically through POST then GET.
- [ ] 5. Confirm a body-plus-ink draft can be created and read byte-identically through POST then GET.
- [ ] 6. Confirm empty notes and over-limit ink payloads are rejected.
- [ ] 7. Call the real finalise route for a typed draft; then confirm attempts to alter content, `note_date`, `amended_from_note_id`, or `created_at`, and attempts to delete the row, fail with conflict responses.
- [ ] 8. Call the real amend route for a typed note; confirm the original is finalised and the replacement draft links through `amended_from_note_id`; confirm ordinary staff/admin selects still return zero rows.

## Read-path audit and cleanup tooling

A repository-wide search for `encrypted_body`, `nonce`, and `decryptNoteBody`
found two decrypting read paths: the doctor clinical-notes GET route and the
audited admin break-glass route. Both are null-safe and both now decrypt and
return handwritten ink, so an emergency read of an ink-only note is not silently
blank. This repository does not currently include a clinical-note
patient-export decrypt path. Re-run that search whenever an export route is
introduced.

Migration `0027` deliberately blocks deletion of finalised notes. The existing
non-production `hard_delete_patient_data` helper must not bypass that lock; use
disposable test patients or remove draft-only fixtures before finalising them.
