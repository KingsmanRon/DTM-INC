# Audit-chain runbook

## How the chain works (post-0048)
- Every audit row links to the previous via `prev_hash`; `entry_hash` =
  sha256(prev_hash | canonical_json(row)). Walk order is `chain_position`
  (a DB sequence) — NEVER `created_at`.
- `created_at` is stamped by the DATABASE clock inside
  `write_audit_entry_atomic`; callers cannot backdate. `occurred_at` carries
  the caller's event time (differs for outbox-drained events).
- Daily cron `/api/v1/internal/verify-audit-chain` verifies INCREMENTALLY from
  the checkpoint (`audit_verify_checkpoints`). Append `?full=true` for a
  genesis walk (run weekly and after any incident).
  `scripts/verify-audit-chain.mjs` always walks from genesis.

## If the verifier reports BROKEN
1. **Do not write to audit_logs. Do not "fix" rows.** Preserve evidence.
2. Re-run a FULL walk twice (`?full=true`, then the script) and capture both
   outputs. A transient infra error during paging is not a break; a stable
   `brokenAt` row id is.
3. Identify the break row:
   `select * from audit_logs where id = '<brokenAt>';` and its neighbours by
   `chain_position` (±5). Diff `prev_hash` against the previous row's
   `entry_hash`.
4. Likely causes, in order: (a) a manual INSERT/UPDATE on audit_logs from the
   SQL editor (superuser bypasses the revokes — check
   `metadata_json`/shape oddities), (b) a restore/PITR that truncated the tail,
   (c) a code/SQL canonicalisation divergence (did metadata contain a float?
   was a migration applied mid-window?).
5. Escalate to the Information Officer — under POPIA a tamper-evident log
   showing tampering is itself a notifiable concern if PHI access is implicated.
6. Remediation is a DOCUMENTED FORK, never a rewrite: record the incident,
   leave the broken segment in place, and (if the cause is (c)) fix the
   canonicalisation so subsequent rows verify; reset the checkpoint row
   (`delete from audit_verify_checkpoints where name = 'audit_chain'`) only
   after the cause is understood.

## Routine checks
- Vercel cron dashboard: both crons green daily.
- `select max(chain_position), max(created_at) from audit_logs;` sanity.
- Outbox health: `select count(*) from audit_log_outbox where processed_at is null;`
  — a growing backlog means synchronous writes are failing; check
  `dead_lettered_at is not null` rows and the drain cron logs.
