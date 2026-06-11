# Design: role-in-JWT custom claims (fix-plan item 13 — NOT yet implemented)

## Problem
`resolveSession` runs an `app_users` SELECT on EVERY authed request purely to
learn role/status (the dominant per-request DB multiplier — see the 19.7M
request-storm investigation). The data is nearly static per user.

## Proposed design
1. **Supabase Custom Access Token hook** (Dashboard → Auth → Hooks): a Postgres
   function that stamps `app_role` and `app_status` claims from `app_users`
   into every access token at issue/refresh time.
2. `resolveSession` reads role/status from the VERIFIED claims (after
   `getUser()`/`getClaims()`); the `app_users` SELECT disappears from the hot
   path.
3. **Revocation story (the hard part):**
   - Access-token TTL down to 10–15 min so deactivation propagates within that
     window (deactivate already revokes refresh tokens via `admin.signOut`).
   - KEEP the live DB status check on the highest-sensitivity paths only:
     clinical-notes routes, break-glass, admin user management. Cheap bound on
     the worst case; everything else trusts claims.
4. **Upgrade `@supabase/ssr` / `supabase-js`** to a version with `getClaims()`
   local JWKS verification; switch middleware from network `getUser()` to local
   verification (the middleware comments already anticipate this).

## Why not yet
- Requires a Supabase dashboard configuration (auth hook) that code review
  alone cannot apply or test.
- TTL reduction changes session behaviour for all users — needs a maintenance
  window + comms.
- The integration-test harness (now in repo) should be extended with hook
  simulation before flipping.

## Acceptance criteria
- p50 authed API request issues ZERO `app_users` reads.
- Deactivated user loses ALL access within token TTL, and clinical-notes
  access immediately.
- pgTAP suite extended: claims-only role resolution rejects forged-claim
  shapes (role not in enum, status != active).
