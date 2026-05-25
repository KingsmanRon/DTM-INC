# File number prefix + sequence policy (internal)

This note documents the canonical file-number allocation behavior to prevent drift.

## Sequence ownership

- Sequence key is **`(year, prefix)`** in `file_number_sequences`.
- Each practice/prefix sequence starts at **`000001`** for each new year.
- Allocation is done by `allocate_file_number(p_year, p_prefix)` and should always pass an explicit prefix when business rules require one.

## Hospital mapping rules

- Onboarding (`onboard_patient`) uses a single authoritative **hospital -> prefix** mapping block.
- Unknown/unmapped hospitals must hard-fail in SQL before allocation; they must never fall back to global defaults.
- Current mapping lives in:
  - `supabase/migrations/0013_patient_hospital_prefix.sql` (`onboard_patient`)

## Admin settings interaction

- `practice_settings.file_number_prefix` is treated as a **global fallback only**.
- It is **not** the source of truth for hospital-specific onboarding prefixes.
- Admin API validation for this field lives in:
  - `src/app/api/v1/admin/practice-settings/route.ts`

## Safe update procedure

When introducing a new hospital or changing a prefix:

1. Update the hospital allow-list / validation enum used by onboarding payload validation.
2. Update the authoritative SQL mapping block in `onboard_patient`.
3. Keep SQL guardrails that reject unknown hospitals or null mapping output.
4. Add/adjust migration notes if sequence behavior changes.
