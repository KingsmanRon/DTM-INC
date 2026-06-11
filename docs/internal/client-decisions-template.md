# Client decisions template (per-practice §15 equivalent)

SPEC.md §15 captures decisions locked with Dr. Mtshali. They are PER-PRACTICE.
Before building/deploying for a new client, capture their answers here, signed
by the practice owner. Copy this file per client into the client's ops folder.

| # | Question | DTM's answer (reference) | THIS CLIENT's answer | Signed off |
|---|----------|--------------------------|----------------------|------------|
| 1 | Additional doctors / locums? | No — single doctor by design | | ☐ |
| 2 | May staff see that clinical notes EXIST (count/badge)? | No — entirely invisible | | ☐ |
| 3 | Medical aid scheme: dropdown or free text? | Free text | | ☐ |
| 4 | Claims processor integration? | Never — manual PDF handover | | ☐ |
| 5 | Information Officer registered + named? | Dr. Mtshali | | ☐ |
| 6 | Hospitals + file-number prefixes (drives public.hospitals) | NKA/FOU/MED/MID | | ☐ |
| 7 | Brand: name, logo assets, colours | DTM green | | ☐ |
| 8 | Consent wording (active_consent_body + consent_cards) reviewed by client? | v1.0.0 | | ☐ |
| 9 | Idle timeouts per role (minutes) | 30 staff / 15 doctor / 15 admin | | ☐ |
| 10 | Handwritten notes feature on? Which doctor UUIDs? | On, single doctor | | ☐ |
| 11 | Billing export recipient name (audit disclosure label) | "third-party billing company" | | ☐ |
| 12 | Data region (Supabase) | EU Frankfurt | | ☐ |

Owner signature: ____________________  Date: ____________
