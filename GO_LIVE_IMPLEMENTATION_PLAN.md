# Go-Live Implementation Plan (Production + DNS)

Date: 2026-04-29

## Objective
Ship safely to production and cut DNS only after hard technical and operational gates are green.

## 1) Unblock CI dependency installation
**What to do**
- Run `npm ci` from the production CI runner/network path that has registry access.
- If your org uses a private npm mirror, pin `.npmrc` to that mirror and verify `vitest` is resolvable.

**Why this matters**
- No reliable release decision is possible without reproducible installs.
- `npm ci` gives deterministic dependency trees for auditable deployments.

## 2) Make build quality gates mandatory
**What to do**
- Add a single release gate job that runs, in order:
  1. `npm run lint`
  2. `npm run typecheck`
  3. `npm run test`
  4. `npm run build`
- Block merge/deploy when any of the above fails.

**Why this matters**
- Catches syntax, type, behavior, and production build regressions before release.
- Prevents “works locally, fails in prod” cutovers.

## 3) Enforce production crypto key posture
**What to do**
- In production, do not set `CLINICAL_NOTES_KEK_DEV_KEY`.
- Use `CLINICAL_NOTES_KEK_ID` backed by Supabase Vault or KMS-managed key material.
- Add startup validation in your deploy checklist that confirms the dev key is absent.

**Why this matters**
- Dev fallback keys are not appropriate for regulated PHI workloads.
- Vault/KMS provides key governance, rotation control, and reduced secret sprawl.

## 4) Confirm DB resilience + recovery evidence
**What to do**
- Verify PITR is enabled for the production Supabase project.
- Execute and document one restore drill from a recent point in time.
- Record RTO/RPO results and approver sign-off.

**Why this matters**
- Go-live without restore evidence is operationally high risk.
- Recovery capability is as important as availability.

## 5) Activate continuous audit-chain assurance
**What to do**
- Schedule `npm run db:verify-chain` as a daily production job.
- Route failures to an on-call alert channel.
- Keep 30+ days of verification logs.

**Why this matters**
- The audit log’s integrity control only helps if monitored continuously.
- Early detection reduces the blast radius of data integrity issues.

## 6) Complete incident + break-glass runbooks
**What to do**
- Dry-run break-glass access workflow in staging.
- Dry-run breach notification and recovery communication workflow.
- Capture owner, pager, and SLA for each runbook.

**Why this matters**
- Under pressure, teams follow runbooks, not memory.
- Validated runbooks reduce response time and mistakes.

## 7) Do a staged rollout before DNS cutover
**What to do**
- Deploy to production behind restricted access first.
- Run smoke tests on auth, patient CRUD/search, notes, document upload/download, admin audit pages.
- Only then move DNS.

**Why this matters**
- Reduces user-facing risk by catching environment-specific issues pre-cutover.

## 8) DNS cutover strategy and rollback
**What to do**
- Lower DNS TTL 24 hours before cutover.
- Cut over during a defined maintenance window.
- Predefine rollback trigger thresholds (error rate, auth failures, latency, failed writes).
- If threshold crossed, revert DNS immediately and investigate.

**Why this matters**
- Controlled cutovers and explicit rollback criteria prevent prolonged outages.

---

## Recommended go-live decision rule
Proceed to DNS cutover only when all eight sections are complete and signed off by Engineering + Operations + Clinical owner.
