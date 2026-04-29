# Go-Live Owner Checklist

Use this checklist to capture the items that must be provided by Engineering, Operations, and Clinical leadership before DNS cutover.

## Engineering owner inputs
- [ ] Confirm CI `Release Gate` workflow is green on the release commit.
- [ ] Attach build artifact version/tag and commit SHA.
- [ ] Confirm production env vars are set and `CLINICAL_NOTES_KEK_DEV_KEY` is **unset**.
- [ ] Confirm staged smoke test results (auth, patient CRUD/search, notes, document upload/download, admin audit page).

## Operations owner inputs
- [ ] Confirm Supabase PITR is enabled for production project.
- [ ] Attach latest restore drill evidence with RTO/RPO.
- [ ] Confirm daily `npm run db:verify-chain` job is scheduled and alerting.
- [ ] Confirm on-call routing for release window and rollback execution.

## Clinical owner inputs
- [ ] Confirm sign-off on production UAT flow for patient onboarding and record retrieval.
- [ ] Confirm break-glass process was demonstrated and approved.
- [ ] Confirm incident communication path and responsible contacts.

## DNS change controls
- [ ] TTL lowered at least 24h prior.
- [ ] Exact cutover time approved.
- [ ] Rollback thresholds documented (5xx rate, auth failure rate, p95 latency, failed writes).
- [ ] Rollback owner designated.
