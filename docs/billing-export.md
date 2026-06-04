# Monthly billing export

Lets staff (and the doctor) hand the third-party billing company a spreadsheet
of patient files for a given hospital and month, with **File Number, Patient
Name, ID/Passport Number and Medical Aid Number auto-populated** from the
patient record — plus a shared outgoing date and an optional returned date.

## Recon findings that shaped the design

The original brief assumed a multi-practice schema with encrypted identifiers.
Recon showed otherwise, and the owner confirmed the resulting decisions:

| Brief assumption | Reality in this codebase | Decision |
|---|---|---|
| `patients.practice_id` is the filter key | Single-practice app; no `practice_id`. `patients.hospital` (mandatory, CHECK-constrained to 4 hospitals) is the clean grain and matches the sample filename. | Scope by **hospital + month**; unique key `(patient_id, hospital, export_month)`. |
| ID/Passport + Medical Aid are encrypted at rest → must decrypt server-side | Both are **plaintext** `text`. Only `clinical_notes` content is encrypted. | Export is still **server-side**, but for the POPIA disclosure audit (below), not for decryption. The feature is read-only against encrypted fields. |
| Scope candidates by "activity this month" (appointment/visit) | No appointments/visits/billing table exists. | New lightweight **batch staging**: staff explicitly add files to a hospital/month batch (`billing_export_items`). |
| Doctor access "if the app supports it" | Single-doctor practice. | **Doctor + staff** both get the nav entry and RLS read/write; admin is excluded (no demographic read per the authz matrix). |

## How it works

1. Pick a **hospital** and **month** (selectors read URL search params; the
   page wraps the client component in a `<Suspense>` boundary so the Next 15
   production build does not break).
2. **Candidates** = active patients at that hospital. Staff multi-select and
   *Add to batch*. The `stage_billing_export_items` RPC reads the patient +
   medical-aid snapshot and auto-fills the billing fields, upserting on
   `(patient_id, hospital, export_month)` so re-staging never duplicates a row.
3. Edit the **returned date** per row inline; set a shared **outgoing date** for
   the batch. *Remove* un-stages a still-pending row.
4. **Generate & download `.xlsx`** (`billing-export-<hospital>-YYYY-MM.xlsx`).
   Dates are written `DD MMMM YYYY` (e.g. `03 JUNE 2026`); identifiers are
   written as inline strings so Excel cannot mangle SA IDs / medical-aid numbers.

## Constraint compliance (non-negotiables)

- **No triggers.** `updated_at` is set explicitly in the write path; audit rows
  go only through the existing `write_audit_entry_atomic` SECURITY DEFINER
  function. New audit actions: `billing_export_generate`,
  `billing_export_item_update`, `billing_export_mark_returned`.
- **No `service_role` grant added/widened.** All reads/writes run under the
  caller's authenticated RLS context; `billing_export_items` is granted only to
  `authenticated` and gated by RLS to doctor/staff.
- **Clinical-notes isolation untouched.** Billing fields only — never
  `encrypted_body`/clinical content. See `supabase/verify-billing-rls.sql`.
- **POPIA (§5).** `billing_export_generate` records the recipient and the exact
  `patient_ids` / `file_numbers` disclosed, so each disclosure is reconstructable.

## Files

- Migrations: `supabase/migrations/0035_billing_export_audit_actions.sql`,
  `0036_billing_export_items.sql`; verification `supabase/verify-billing-rls.sql`.
- API: `src/app/api/v1/billing/{candidates,items,items/[id],export}/route.ts`.
- UI: `src/app/(authed)/billing/page.tsx` + `_components/billing-client.tsx`.
- Lib: `src/lib/billing/{format,rows,xlsx}.ts`, `src/lib/validation/billing.ts`.
- Tests: `src/lib/billing/*.test.ts` (xlsx, rows, format, migration guards).
