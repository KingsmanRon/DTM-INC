# Practice value audit

The audit covered source, migration history, defaults/seeds, PDFs, PWA metadata, public assets, environment defaults, documentation and tests. The machine readable [line inventory](evidence/practice-value-inventory.json) records every remaining match from the practice names, facilities, contact numbers, practice number and qualifications found during the initial audit, plus the binary assets. Regenerate it with `node scripts/audit-practice-values.mjs`. New client reports and the inventory itself are excluded from that scan to avoid recursive matches.

| Classification | Remaining values and locations | Treatment |
| :--- | :--- | :--- |
| Per practice configuration | DTM name/title/description/TOTP issuer in `src/lib/branding.ts` | Compatibility defaults only when client mode is absent. New clients supply deployment variables; strict client build checks prevent missing configuration |
| Per practice configuration | DTM identity, qualifications, telephone, address, consent cards, facility names and prefixes in migrations 0001, 0012 through 0017, 0036, 0044 and 0051 | Historical migrations retained. Guarded fresh bootstrap replaces reference rows and new migration drops DTM column defaults. Existing DTM rows are not rewritten |
| Branding asset | DTM header, PDF letterhead, favicons and Apple icons under `public` | Retained for the existing deployment. `client:stage` excludes all original public assets and installs only owner supplied client assets |
| Branding asset | Legacy PDF/watermark asset paths in branding/PDF modules | Used only outside client mode. Client PDF fallback resolves its own supplied asset and fails if none exists |
| Global product behaviour | `dtm_audit_chain` advisory lock identifier in historical/canonical audit functions | Retained: old/new writers must share the lock to preserve chain serialisation. It is database local, not a client identity or tenant key |
| Global product behaviour | `accent-dtm-green` internal CSS token, health service/package identifier, `x-dtm-service-client`, `dtm:pwa-install-event`, install dismissal key and old onboarding draft key | Compatibility identifiers, not displayed practice data. Theme colour is shared product styling. The old patient draft key is only removed, never read or written |
| Test/demo fixture | DTM facility/prefix examples in SQL, onboarding and billing tests and explanatory comments | Synthetic fixtures only. No production patients or Auth accounts are copied. PDF test uses a generated generic PNG |
| Per practice configuration | DTM details in original `SPEC.md`, `README.md`, branding notes and historical internal reports | Historical reference documentation. New client runbook supersedes old setup instructions; no automatic seed uses those details |
| Deployment secret | Supabase keys, KEK plaintext, cron secret and database credentials | None belongs in the example/client configuration. Supplied separately to the new secret stores; never copied from DTM |

Removed executable or visible hardcoding: privacy contact/name/address literals, install screen names, demo headings, header alternative text, fixed settings prefix restriction, CSS watermark path, unconditional DTM PDF fallback in client mode, old DTM consent/contact seed and the production UUID in the admin seed. The missing maskable icon reference was removed; normal 192/512 PNG icons remain. A maskable icon can be added only with a supplied, reviewed asset.

No hosted schema drift comparison was performed because connecting to DTM production was prohibited. The complete source migration history was instead rebuilt and tested locally. This establishes reproducibility of the repository, not equivalence with unknown production modifications.
