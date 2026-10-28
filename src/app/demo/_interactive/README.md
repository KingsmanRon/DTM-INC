# Interactive demo (`/demo`)

A self-contained, in-browser simulation of DTM Inc. for prospective practices. The scroll-driven product story that used to live at `/demo` is now at `/demo/story`.

**Isolation.** No Supabase client, no API route, no storage, no cookies, no analytics. All state lives in a React reducer and is lost on reload. Every patient, hospital, scheme and staff member is invented (`SYN-ID-#####`, `000 000 ####` phones, `@example.test` emails). The demo makes no network requests of its own beyond loading its own page assets (verified in a browser: every request same-origin and `GET`). The site-wide CSP and service worker are DTM's own and unchanged.

**Fidelity to DTM.** Per-hospital file numbers (`{PREFIX}-{YYYY}-{SEQ:6}`); moving a patient issues a new number, retires the old one (still searchable) and drops unexported billing rows; the audit trail is Administrator-only; the Administrator has no patient, note or billing access; doctor-only notes are never present in staff or admin views (`state/selectors.ts` projects by role before anything renders).

| Path | Purpose |
| --- | --- |
| `brand.ts` | Wording, `mailto:` recipient and the *Billing File Tracking* label. Change them here only. |
| `fixtures/` | All synthetic data. |
| `state/` | Reducer, permissions, role projection, onboarding validation, simulated audit chain. |
| `view/` | URL model (`mode`, `step`, `scene`, `role`, `patient`, `tab`) and the guided-tour script. |
| `ui/` | Shell, scenes and panels. |
| `demo-app.module.css` | Dark skin, every selector scoped under one root class so it cannot collide with DTM's global styles. |
| `__tests__/` | Vitest: reducer workflows, access rules, onboarding, URL model, audit chain. Run with `npm test`. |

The audit "integrity check" uses a plain checksum for illustration only; it is labelled as simulated and non-cryptographic in the UI.
