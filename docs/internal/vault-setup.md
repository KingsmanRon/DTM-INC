# Supabase Vault setup for clinical-note KEK

## 1) Run DB migrations first (required)
The error `function public.create_app_secret(...) does not exist` means migration `0010_vault_secret_wrappers.sql` has not been applied to that environment yet.

Apply migrations before running any wrapper function:

```bash
npm run db:migrate
# then apply output via your SQL deploy path / Supabase migration flow
```

## 2) Verify wrappers exist
Run this in Supabase SQL editor:

```sql
select n.nspname as schema, p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_app_secret', 'read_app_secret', 'update_app_secret');
```

You should see all three functions.

## 3) Seed KEK (wrapper path)
Use SQL editor (service role context):

```sql
select public.create_app_secret(
  p_name => 'clinical-notes-kek',
  p_value => '<BASE64_32_BYTE_KEY>',
  p_description => 'Clinical notes KEK v1'
);
```

## 4) If wrappers are unavailable, seed directly with Vault API
(Temporary/manual fallback only)

```sql
select vault.create_secret(
  '<BASE64_32_BYTE_KEY>',
  'clinical-notes-kek',
  'Clinical notes KEK v1'
);
```

## 5) Set Vercel production env vars
- `CLINICAL_NOTES_KEY_PROVIDER=vault`
- `CLINICAL_NOTES_KEK_ID=vault:clinical-notes-kek/v1`
- `ALLOW_DEV_KEK_FALLBACK=true` (initial rollout), later set `false`
- `CLINICAL_NOTES_KEK_DEV_KEY=<BASE64_32_BYTE_KEY>` (only while fallback enabled)

## 6) Rotation
Rotate secret value via wrapper:

```sql
select public.update_app_secret(
  p_name => 'clinical-notes-kek',
  p_value => '<NEW_BASE64_32_BYTE_KEY>',
  p_description => 'Clinical notes KEK v2'
);
```

## 7) Troubleshooting
- `42883 function ... does not exist`:
  - migration not applied to this DB, or wrong project selected.
- `permission denied for function ...`:
  - run with a role that can execute wrapper functions (service role / owner context).
- Vault read fails at runtime:
  - verify `public.read_app_secret('clinical-notes-kek')` returns a value.

## 8) Why fallback=false can fail after cutover
If historical DEKs were wrapped with an older/local key, and Vault now returns a different key, unwrap will fail until keys are aligned.

Transition strategy:
1. Keep `ALLOW_DEV_KEK_FALLBACK=true` temporarily.
2. Ensure Vault secret value matches the previously used key.
3. Create at least one new clinical note and verify read/amend/finalise.
4. Then set `ALLOW_DEV_KEK_FALLBACK=false`.
