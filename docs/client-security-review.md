# Client baseline security review

Scope: repository migrations and local Supabase rebuild only. The live DTM project was neither queried nor modified, so this review makes no claim about live schema drift or current hosted advisor output.

## Privileged function inventory and decisions

| Function | Final boundary | Reason |
| :--- | :--- | :--- |
| `public.allocate_file_number` | No PUBLIC, anon, authenticated or service execution | Internal caller inside authorised onboarding/reassignment only; fixed path; retired values excluded |
| `private.create_app_secret`, `private.update_app_secret` | Operator only; nonexposed schema | No browser or service secret administration |
| `private.read_app_secret` | Service role only | Vault KEK lookup for server encryption |
| `public.read_app_secret` | Service role, SECURITY INVOKER wrapper | Preserves existing server RPC contract without granting caller privilege |
| `private.hard_delete_patient_data` | Operator only; nonexposed schema | Destructive historical test tooling; ordinary lifecycle remains archive/void |
| `private.try_acquire_maintenance_lock`, `private.release_maintenance_lock` | Service role only | Internal audit maintenance leases |
| Public maintenance wrappers | Service role, SECURITY INVOKER | Preserves cron/outbox code contract |
| `public.current_app_role` | Authenticated only | Reads active role for `auth.uid()` and returns no data role below AAL2 |
| `public.get_my_app_profile` | Authenticated only | Own profile only, including before MFA enrolment; no supplied actor |
| `public.onboard_patient` | Authenticated doctor/staff with AAL2 | Checks authenticated actor, application role, active facility and current consent hash/signature/attestation internally |
| `public.reassign_patient_hospital` | Authenticated doctor/staff with AAL2 | Actor derived from `auth.uid()`, role checked internally, history retained |
| `public.stage_billing_export_items` | Authenticated doctor/staff with AAL2 | Rejects spoofed actor and writes the derived actor |
| `public.write_audit_entry`, `public.write_audit_entry_atomic` | Service role callers, restricted `audit_writer` owner | Preserves append only hash chain, dependencies, outbox and maintenance |

All application functions, not only SECURITY DEFINER functions, have PUBLIC/anon/authenticated execution revoked before an explicit allowlist is restored. Supabase can grant anon/authenticated directly through default privileges, so revoking PUBLIC alone is insufficient. Default execution grants are also closed for future postgres migrations. Extension owned functions are excluded from this application ACL pass.

The four document compression/status RPCs are SECURITY INVOKER and service only. `update_patient_bundle` and `void_clinical_note` remain authenticated SECURITY INVOKER operations constrained by RLS. Role helpers are authenticated; trigger functions have no direct client execution. The grant inventory can be rechecked with `supabase/verify-client-baseline.sql`.

Intentionally authenticated SECURITY DEFINER RPCs remain in `public` because the current application calls them under the user's verified JWT. They have narrow internal identity/role checks. They are not made public to resolve permission errors. Internal secrets and destructive operations were moved to `private`; keep that schema outside the Data API. See [Supabase function security](https://supabase.com/docs/guides/database/functions).

## Additional fixes

1. MFA applies to staff, doctor and admin in pages and APIs. Restrictive database policies prevent AAL1 access to patient, clinical, billing, audit and break glass records, even if a permissive policy is added later. Self profile access remains possible for enrolment.
2. The audit outbox now has RLS and no browser grants. This was found by the local Supabase advisor after rebuilding the full chain.
3. `pg_trgm` is moved into `extensions`; all application functions have deterministic search paths with `pg_catalog` first and `pg_temp` last. Public schema creation is revoked from untrusted roles and the audit writer.
4. The storage policy that appeared to deny patient documents actually allowed access to every other bucket. It is replaced with a restrictive policy protecting both private buckets from ordinary direct access. Server signed upload/view flows remain intact.
5. Browser onboarding drafts are memory only and the previous session storage key is purged. Service worker caching is restricted to explicit manifest/icon paths; patient navigation never falls back to a cached response. No new offline data capability exists.
6. Client builds require explicit identity/assets and Vault with development key fallback disabled. The PDF fallback cannot select a DTM asset in client mode. Separate deployment staging excludes DTM public assets.
7. Historical secret creation/admin seeds are retired. Initial users bind to actual Auth IDs by email and generate audit records. No production UUID is used in setup.
8. Dependency security patches retain Next.js 15, update Sharp and Vitest, override the vulnerable nested PostCSS with a compatible patched release, and align CI/runtime on Node 22. The lockfile is regenerated and validated with npm ci; no forced peer dependency bypass is used.
9. Direct browser writes to application profiles and break glass requests are revoked. User administration and break glass timing must pass through the existing authorised, audited server routes; admins cannot self promote through the Data API or shorten the cooldown directly.

## Required hosted checks

Local database advisors do not verify the new project's leaked password protection, SMTP, DNS, redirect allowlist, MFA enrolment, secret custody or recovery. These remain release gates for the new project. Never claim a clean local advisor run proves hosted production readiness.

This change does not retrofit an atomic audit transaction around every existing application side effect. Existing audited route behaviour and the durable outbox are preserved. Existing audited break glass uses a 48 hour cooldown and a 24 hour access window. It has no doctor approval step, and its doctor notification hook is not implemented. The owner must approve and rehearse a manual notification and review process before go live. Admins have no ordinary clinical access. The old operator hard delete helper is deliberately not part of onboarding or patient lifecycle and remains subject to immutable history/FK constraints; do not use it to bypass retention.
