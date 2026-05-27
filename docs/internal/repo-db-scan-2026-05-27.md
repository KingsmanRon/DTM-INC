# Repo + DB Deployment Scan (2026-05-27)

## Scope
- Quick inventory of repository components.
- Review of the most recent code/database changes.
- Assessment of what appears deployed vs what may still be pending in production DB.

## Repository inventory
- **App framework**: Next.js 15 App Router with TypeScript and PWA assets.
- **Data layer**: Supabase Postgres + RLS policies + SQL migration chain (`supabase/migrations`).
- **Security features**: role-gated API access, append-only audit log chain, envelope encryption for clinical notes.
- **Ops docs**: internal go-live and handover checklists in `docs/internal`.

## Recent change stream (from git history)
Most recent commits are focused on audit write reliability under RLS:
1. `86cc192` — Fix patient onboarding RPC auth context.
2. `cca0ea7` — Add backstop RLS policy for audit writer inserts.
3. `1398742` — Reassert `write_audit_entry` security-definer invariants.
4. `83c0525` — Add service_role audit_logs insert RLS backstop.
5. `a3be365` — Merge PR #75 containing the above.

## DB migration state inferred from repository
Latest migrations present in repo:
- `0018_audit_writer_rls_backstop.sql`
- `0019_reassert_write_audit_entry_security.sql`
- `0020_audit_logs_insert_policy_for_service_role.sql`

These migrations indicate an iterative hardening path for audit inserts:
- Ensure `audit_writer` role has insert privilege + explicit policy.
- Reassert `write_audit_entry` is `SECURITY DEFINER`, owned by `audit_writer`, executable by `service_role`.
- Add direct `service_role` insert policy as operational fallback.

## Production signal from deployment logs (screenshot)
Observed log error around onboarding PDF generation:
- `insert failed ... new row violates row-level security policy for table "audit_logs"`

Interpretation:
- Production was (at least at that moment) still hitting an RLS denial on audit insert path.
- This is exactly the class of issue addressed by migrations `0018`/`0019`/`0020`.

## Likely deployment gap
Most likely causes:
1. One or more of `0018`/`0019`/`0020` not applied in prod DB.
2. Applied but function owner/grants/policies drifted post-migration.
3. Runtime path not using expected role/session during audit write.

## Immediate verification checklist (DB)
Run in production Supabase SQL editor:
1. Confirm migration versions include 0018, 0019, 0020.
2. Confirm function owner:
   - `public.write_audit_entry(...)` owner = `audit_writer`.
3. Confirm grants:
   - `service_role` has EXECUTE on `write_audit_entry`.
   - `service_role` INSERT on `public.audit_logs` (if fallback is desired).
4. Confirm policies on `public.audit_logs` include:
   - `audit_logs_writer_insert` for `audit_writer`.
   - `audit_logs_service_role_insert` for `service_role`.
5. Trigger one onboarding flow and verify no audit RLS errors in Vercel logs.

## Recommended next action
- Apply pending migrations to production (`0018`→`0020`) and immediately re-test onboarding PDF generation.
- If already applied, run a drift-correction SQL reasserting owner/grants/policies, then re-test.
