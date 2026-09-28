# Single practice deployment runbook

This baseline is one legal practice per Vercel project and dedicated Supabase Database/Auth/Storage/Vault project. Multiple facilities live inside that practice. There is no tenant selector or cross practice data access.

Do not run any step against `dtm-inc-prod` or the existing DTM Vercel project. The tools in this repository generate local files; they never discover, link or connect to a hosted project automatically. An operator must verify the new project's name, reference, organisation and database connection before any hosted operation. A configuration's `project_ref` is a review label, not cryptographic proof of the SQL Editor's target.

## 1. Collect and review inputs

Complete [the information checklist](client-information-required.md). Copy `config/client.example.json` into the ignored `client-config/` directory and replace every placeholder. Confirm prefixes and starting sequences against existing paper files. Obtain approved consent/privacy wording and assets. Keep secrets outside the file.

```powershell
npm ci
npm run client:prepare -- --config client-config/practice.json --out client-output/reviewed
npm run client:assets -- --logo client-config/logo.png --letterhead client-config/letterhead.png --icon client-config/icon.png --out client-output/assets
```

Review `bootstrap.sql`, `initial-users.sql`, `branding.env` and the rendered assets. Outputs are not overwritten. The config schema rejects unknown keys, duplicate facilities/prefixes/emails, invalid formats and example placeholders. SQL encodes free text before embedding it, so quotation marks or SQL delimiters in approved text cannot become executable SQL.

## 2. Prove the database builds locally

Docker and Supabase CLI 2.118.0 were used for the implementation validation. The local container is `supabase_db_practice-baseline-validation`, database port 55438; existing local projects stay separate. Do not add a hosted project link to this checkout for these checks.

```powershell
npx supabase --version
npx supabase db start
npx supabase db reset --local --no-seed
npx supabase test db
npm run test:bootstrap
npx supabase db advisors --local --type security
npx supabase db lint --local --schema public,private --fail-on error
```

The reset is destructive only to that disposable local database. It applies all 57 migration files in lexical order, including the timestamped security migration. Number 0039 is absent in the historical sequence; no file should be invented to fill the gap. Default seeds are disabled. The bootstrap test runs synthetic fixtures in a transaction and rolls back.

## 3. Provision the new Supabase project

Create a new project in the agreed region under the correct organisation. Record its unique project reference privately. Configure backup/PITR and recovery ownership. Do not clone DTM database backups, storage, Auth users, settings or KEKs.

Apply the complete migration history to the empty project's application schema. Supabase itself supplies `auth`, `storage`, Vault and platform roles; this is not a generic bare PostgreSQL install. Use a separate operator workspace linked only to the new project, inspect `supabase link --help` and `supabase db push --help`, verify the link and apply the migrations with the CLI. Alternatively, generate ordered SQL with `node scripts/run-migrations.mjs` and apply it using `psql -X -v ON_ERROR_STOP=1` with the new project's connection obtained from its dashboard. Do not wrap the entire historical chain in one extra transaction because enum migrations have transaction boundaries. Record each applied file and stop on the first error. The CLI is preferred because it records migration history.

After checking the target in that separate workspace, the verified CLI sequence is:

```powershell
npx supabase@2.118.0 link --project-ref NEW_PROJECT_REF
npx supabase@2.118.0 db push --linked --dry-run --skip-vault
npx supabase@2.118.0 db push --linked --skip-vault
```

Let the CLI prompt for credentials or obtain them through your approved secret store. Do not put a password in the command line or commit a connection string. `--skip-vault` keeps migration application separate from deliberate KEK provisioning.

Do not apply `seed.sql`, `seed-dev-user.sql` or the retired bootstrap admin file. The historical migrations intentionally contain DTM settings and hospitals for compatibility; the next step replaces only those reference rows in an empty new environment. Do not expose the app between migration and bootstrap.

## 4. Initialise the new practice

While Auth and patient tables are empty, run the reviewed `bootstrap.sql` in the NEW project's SQL Editor as the migration owner. It replaces the historical facility/settings rows with the supplied values and initial sequences. It refuses existing application data, Auth accounts, patient storage or a different bootstrap fingerprint. An exact rerun returns without resetting data. A changed configuration cannot be used to reseed a running practice.

Check `practice_settings`, `hospitals` and `file_number_sequences` directly. Confirm no DTM facility or consent text remains in the configured rows. The migration removes DTM column defaults without modifying existing DTM rows. For later changes, use the authorised settings API and reviewed facility administration; do not rerun bootstrap with a new hash.

## 5. Configure storage and encryption

Migrations create `patient-documents` and `practice-brand` as private buckets. Verify they are private and that ordinary users cannot list/write their objects directly. Patient uploads still go through the authorised, validated signed upload flow. Existing PDF/JPEG/PNG/HEIC/WEBP support and categories remain unchanged.

Upload the approved PNG letterhead to `practice-brand` using the supplied `logo_path`. Generate a NEW KEK inside the new project's Vault, without displaying its plaintext:

```sql
select private.create_app_secret(
  'clinical-notes-kek',
  encode(extensions.gen_random_bytes(32), 'base64'),
  'Clinical notes KEK for this practice only'
);
```

Run once. Never replace an existing KEK as a setup shortcut; existing DEKs depend on it. Verify presence/decoded length through an operator query returning only a boolean or length. `private.create_app_secret` and `private.update_app_secret` require operator access. The application can only read the KEK through the service role wrapper. Set Vault mode and disable development fallback in Vercel. Test encryption, readback and recovery before patient use.

## 6. Configure Auth and initial users

Apply all Auth settings in [the environment checklist](client-environment-checklist.md), including leaked password protection. Add the final origin plus the exact `/auth/callback` and password reset destinations used by this application. Configure SMTP and owner approved email branding.

Create or invite the supplied initial users through the NEW Supabase Auth dashboard after bootstrap. Do not invent UUIDs or shared passwords. Run the generated `initial-users.sql` to bind each email to its real Auth UUID and intended application role. It audits newly created profiles, refuses mismatched existing profiles and can be rerun safely. An Auth user must set their password and enrol TOTP; a database `mfa_enabled` flag never substitutes for AAL2. Existing in-app admin invitations remain available for later users.

## 7. Prepare separate deployment source and Vercel project

```powershell
npm run client:stage -- --assets client-output/assets --out client-output/deployment
```

This creates an independent source directory using an explicit allowlist. It excludes Git metadata, local secrets/tool settings, existing build outputs and all bundled DTM public brand assets. Only the supplied client assets are copied to `public/client-brand`. The original checkout and its DTM assets are unchanged. Review the staged folder before putting it in a new private client repository or using it as local Vercel deployment source. No source edits are needed for the practice identity.

Create a NEW Vercel project. Select Node 22 and the agreed region. Import the generated branding values and the new project's secrets from [the checklist](client-environment-checklist.md). Keep `NEXT_PUBLIC_DEPLOYMENT_PROFILE=client`; client builds fail if required branding, assets or Vault configuration is missing. Existing DTM builds retain their defaults when this profile is absent. Set the production domain and confirm HTTPS/DNS. Do not import or select the existing DTM Vercel project.

Run the quality gates in the staged directory, then deploy only to the newly verified project. If using Git integration, use the new private repository and dedicated deployment branch. Do not connect this work branch to the DTM production project.

## 8. Validate and release

```powershell
npm ci
npm run lint
npm run typecheck
npm run typecheck:scripts
npm test
npm run check:functions
npm run build
git diff --check
```

Run the database role suite on a disposable shadow environment, never a production database containing patients. Run hosted Supabase Security Advisors on the new project and review the intentionally authenticated RPC allowlist in [the security report](client-security-review.md). The local database advisor does not check hosted Auth, SMTP, URLs, backups or leak protection.

Complete [the go live checklist](client-go-live-checklist.md), including all five existing meanings of reports, doctor/staff/admin roles, MFA, onboarding, search, documents, clinical notes, billing, audit, phone/tablet/desktop and actual installation on iOS/iPadOS. Do not onboard a real patient until the owner and operator sign off. Use synthetic records during acceptance and remove them only through an approved procedure; immutable audit history remains intact.

## 9. DTM compatibility and future upgrades

This work does not connect to or alter the live DTM project. Historical migration bodies and DTM brand assets remain in the original source tree. A future DTM rollout needs its own change window: staff must enrol MFA, Node 22 must be selected, and new migrations must precede the application rollout. Do not apply a new client's bootstrap to DTM. The default DTM identity is retained; old privacy contact literals now come from the existing practice settings rather than duplicated source text.
