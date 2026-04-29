# Supabase Vault setup for clinical-note KEK

## 1) Run DB migrations
Apply latest migration so wrapper RPCs exist:
- `public.create_app_secret(p_name, p_value, p_description)`
- `public.read_app_secret(p_name)`
- `public.update_app_secret(p_name, p_value, p_description)`

## 2) Seed the KEK secret
Use SQL editor (service role context):

```sql
select public.create_app_secret(
  'clinical-notes-kek',
  '<BASE64_32_BYTE_KEY>',
  'Clinical notes KEK v1'
);
```

## 3) Set Vercel production env vars
- `CLINICAL_NOTES_KEY_PROVIDER=vault`
- `CLINICAL_NOTES_KEK_ID=vault:clinical-notes-kek/v1`
- `ALLOW_DEV_KEK_FALLBACK=true` (initial rollout), later set `false`
- `CLINICAL_NOTES_KEK_DEV_KEY=<BASE64_32_BYTE_KEY>` (only while fallback enabled)

## 4) Rotation
Rotate secret value:

```sql
select public.update_app_secret(
  'clinical-notes-kek',
  '<NEW_BASE64_32_BYTE_KEY>',
  'Clinical notes KEK v2'
);
```
