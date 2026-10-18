# DTM protected patient and document writes

Scope: security findings 1–3, based on `f227423c5a4371e04b0095d391d65ce1dbf0661c`.
This branch is for review. It does not authorise a production deployment or migration.

## Changes and invariants

- Upload initiation creates a server-only intent bound to actor, patient, object,
  original display filename, category, MIME and expected size before signing.
- Finalisation checks the intent and actual bytes. A service-only RPC locks the
  intent, inserts exactly one document, consumes the intent and persists an audit
  event in one transaction. Retries return the registered document. Archived
  documents cannot be resurrected. Current and retained-original object references
  cannot be registered again.
- Finalisation never deletes Storage objects, including when the database outcome
  is uncertain. Rejected/abandoned uploads can remain in Storage. No automatic
  orphan cleanup is introduced: a future cleanup must account for both current
  and original references, outstanding signed URLs and concurrent finalisation.
- Browser roles lose direct patient/document INSERT, UPDATE and DELETE, including
  any independently granted column privileges. Read policies remain unchanged.
  Onboarding still uses its existing controlled function. Demographics and
  reassignment use role-checked functions; protected patient fields cannot be
  changed through the demographics function.
- Patient archive/unarchive and document rename/archive use service-only narrow
  operations. Route authentication/MFA remains in place; the database rechecks the
  actor's active role. Server credentials remain a trusted boundary.
- Changed operations enqueue events in the existing audit outbox in the same
  transaction. The existing cron drains the outbox into the hash chain. Audit-page
  visibility can therefore lag until the next drain. If persistence fails, the
  associated mutation rolls back. No historic dead letters are changed or replayed.
- Compression, backup and cleanup service grants are unchanged. The existing
  disposable-test-patient deletion helper additionally removes upload intents;
  its operator-only grants and existing consent/note immutability checks remain.

DTM staff MFA, doctor/admin MFA, session durations, clinical notes and billing
business rules are unchanged. Break-glass audit, login lockout, session-age
findings, cumulative-read limits and key-service redesign are outside this patch.

## Staged release order (after review and approval)

Use an isolated Supabase environment with synthetic data first. Never point test
fixtures at the production project. A Vercel preview must not inherit production
write credentials for these tests.

1. Apply `20261016071255_protected_record_operations.sql`. It adds the intent
   table and controlled operations and updates the two existing patient RPCs.
   Their additional audit-context arguments have defaults, so existing callers
   remain compatible. Replacing the exact old signatures deliberately prevents
   leaving an unprotected overload. Review any external SQL dependencies before
   applying; PostgreSQL will refuse a dependent DROP rather than cascade it.
2. Deploy this branch's application, then confirm old server instances have
   drained and refresh browser clients. The original and optimised upload
   filenames are now both supplied at initiation. Uploads initiated before the
   change have no intent: they fail safely and must be uploaded again. During the
   short old/new overlap, old patient routes may add a second audit event because
   the database now audits them too.
3. Apply `20261016071633_restrict_direct_record_writes.sql`. Until this step,
   direct table-write findings remain open. Applying it before the application
   update breaks old document write handlers. A controlled maintenance window is
   appropriate if an overlap cannot be managed.
4. Refresh PostgREST's schema cache if the platform has not picked up the RPCs.
   Confirm both migration versions and the deployed application commit.
5. Exercise onboarding, ordinary edits, hospital reassignment, patient
   archive/unarchive, document upload/retry/rename/archive/open, patient PDFs and
   billing exports with synthetic fixtures. Verify audit events reach the chain
   and backup/compression jobs retain access. Test staff without MFA and the
   existing doctor/admin MFA flow without changing those policies.

Acceptance includes direct SQL/Data API denial for patient status/hospital/file
number changes and document reference/hash/attribution changes, not only UI tests.
Repeat finalisation concurrently with separate database connections and confirm a
single document row and single durable upload event. Test the Storage upload URL
against overwrite attempts; it must retain the existing non-upsert behaviour.

## Rollback

Before the revocation migration, the old application can be restored while the
additive database objects remain. This temporarily restores the old application
weaknesses; prefer fixing forward or disabling document writes.

After revocation, do not restore the old application alone: its direct document
writes no longer have permission. Prefer rolling forward while preserving the
closed grants. Do not automatically regrant broad permissions or drop the intent
records; both would undo security or discard state needed for safe retries. Any
full rollback requires a separately reviewed database/application plan and a
maintenance window. No destructive down migration is provided.

## Verification

Repository checks: `npm run typecheck`, `npm run lint`, `npm run check:functions`,
`npm test`, `npm run build`, and `npm run typecheck:scripts`.

SQL suites: `supabase db start` then `supabase test db`, using a disposable local
stack. `protected_record_writes.test.sql` includes denial, legitimate workflow,
replay, active-role, durable-audit rollback, backup/compression and cleanup checks.
The AuthZ workflow also runs `scripts/test-record-concurrency.sh` with two
independent local PostgreSQL connections. It refuses non-local database URLs.
The TypeScript finalisation tests execute the real handler and MIME detector with
mocked Storage/database transports; they are not a live Storage integration test.

Initial local validation used Node 22 and PGlite PostgreSQL with synthetic Auth
and Storage catalogue schemas, actual repository migrations, pgcrypto and pgTAP.
This executes database grants/RLS/functions rather than mocking them. It does not
validate hosted Auth, PostgREST, Storage service behaviour, independent database
connections or deployed configuration. Full local Supabase could not start in
this environment (Docker unavailable); CI/staging must cover those remaining
boundaries. No production patient records or Storage objects were used.
