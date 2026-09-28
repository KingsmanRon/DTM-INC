# Practice acceptance record

Record the new Supabase reference, new Vercel project, deployed commit, date, operator and practice owner in the private operations register. Each item needs evidence and an owner; a local unit test is not hosted acceptance.

1. Confirm one legal practice per deployment and dedicated Database/Auth/Storage/Vault. Confirm production and preview isolation.
2. Approve practice identity, all facilities, prefixes, sort order and initial sequences. Check a generated number against the approved convention.
3. Verify empty database migration replay and matching canonical function definitions. Keep logs.
4. Review Supabase Security Advisors and the function grant inventory. Resolve unexpected findings; do not expand execution grants to silence errors.
5. Confirm leaked password protection, password policy, SMTP, redirect allowlist, closed signup and TOTP enrolment for doctor, staff and admin.
6. Confirm all roles are denied protected API/data access at AAL1. Check deactivated users, anon requests and direct RPC calls.
7. Verify private patient storage, supported MIME formats/content sniffing, hashes, size limits, short signed URLs, rename and archive events. Upload pathology, imaging and referral reports using the existing categories.
8. Onboard a synthetic patient through all seven sections, including minor/guardian, private payer, medical aid, referral, dependants and current consent. Reject duplicates and stale consent.
9. Search by name, identity and file number. Archive/unarchive. Reassign facility with a reason and find the patient using the retired number. Confirm the retired number cannot be reissued.
10. Generate the onboarding PDF and inspect identity, logo, all sections and consent. Obtain owner approval of the letterhead.
11. Doctor: create/read typed notes, finalise, amend with history and void. Confirm Vault roundtrip, per patient DEKs and no plaintext in logs or browser storage.
12. Staff and admin: no ordinary clinical notes tab, counts, API content or direct database rows. Check 404 on forbidden clinical APIs. Exercise audited break glass with its 48 hour cooldown and 24 hour window. Obtain owner approval for manual doctor notification and review: automated notification and a doctor approval step are not implemented. Confirm direct profile and break glass writes are denied.
13. If enabled, test Apple Pencil/stylus capture, readback, finalisation and clinical PDF on the actual device. Keep feature flags off until accepted.
14. Stage medical aid and private payer billing in each facility/month. Verify outgoing/returned dates, statuses, XLSX content and audit events. No claims submission or payments are provided.
15. Confirm patient access, onboarding, documents, clinical notes, user/permission changes, settings and billing events. Verify IP/user agent metadata where applicable.
16. Run full audit hash verification. Confirm outbox drain and verifier crons authenticate, execute and report failures; inspect dead letters. Test maintenance lease behaviour.
17. Inspect manifest, standalone launch, correct practice icons, Apple touch icon and Add to Home Screen on iPhone/iPad. Check 390 px phone, 768/1024 px tablet and 1440 px desktop layouts, landscape and on screen keyboard behaviour.
18. Go offline after using a synthetic patient. Only a generic offline screen may display; no cached patient pages, documents or clinical notes. Inspect browser storage and Cache Storage.
19. Confirm privacy notice and Information Officer details without signing in. Confirm all login, installation, PDF and PWA branding belongs to this practice.
20. Approve the existing report set: onboarding PDF, uploaded patient reports, optional clinical PDF, monthly billing XLSX and audit administration. Record any requested future report separately.
21. Restore a backup in an isolated environment, including the required encrypted key material and private storage. Record recovery time and ownership. Do not print KEKs.
22. Confirm support, incident response, access revocation, retention, processor agreements, domain ownership and renewal responsibilities.
23. Run the production smoke test using synthetic data in the new project, inspect errors, then record owner/operator sign off before the first real patient.

Owner sign off: pending. Operator sign off: pending. Hosted acceptance evidence: pending until the new project and approved information exist.
