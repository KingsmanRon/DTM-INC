# Design: nonce-based CSP (fix-plan item 26 — DEFERRED, needs runtime verification)

## Current state
`next.config.mjs` ships a static CSP with `script-src 'self' 'unsafe-inline'`.
Next.js App Router emits inline bootstrap scripts, so removing
`'unsafe-inline'` without nonces breaks the app outright.

## Why deferred
Nonce CSP must be generated PER REQUEST in middleware (Next reads the nonce
from the request CSP header and stamps it onto its inline scripts). That means:
- middleware must run on EVERY html-serving path (today it matches only authed
  pages — public pages would need a second, auth-free middleware branch);
- one wrong matcher and production renders a blank page.
This is a change to verify against a RUNNING app, not to ship blind inside a
large batch. Risk/benefit also notes: the app is internal-only, `frame-ancestors
'none'`, no third-party scripts — the marginal XSS hardening is real but small.

## Implementation sketch (when scheduled)
1. In `middleware.ts`: `const nonce = crypto.randomUUID()`; build
   `Content-Security-Policy` with `script-src 'self' 'nonce-${nonce}'
   'strict-dynamic'`; set it on BOTH request (for Next) and response headers.
2. Broaden the matcher to all non-asset paths; keep the auth gate logic scoped
   to the protected subset (two concerns, one middleware).
3. Remove the static CSP from `next.config.mjs` (keep the other headers).
4. Verify: login, dashboard, wizard submit, PDF endpoints, PWA install, MFA QR
   render — with the browser console open for CSP violations.
