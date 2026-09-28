# Environment checklist

Use a new Vercel project and a dedicated Supabase project. Never import the DTM project's environment variables. Node 22 is required. Public variables are compiled into browser assets and require a rebuild after changes.

| Variable | Required value/source | Secret |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_DEPLOYMENT_PROFILE` | `client` for every new practice | No |
| `NEXT_PUBLIC_BRAND_ASSET_BASE` | `/client-brand` | No |
| `NEXT_PUBLIC_APP_NAME` | Approved short name | No |
| `NEXT_PUBLIC_APP_TITLE` | Approved browser/PWA title | No |
| `NEXT_PUBLIC_APP_DESCRIPTION` | Approved description | No |
| `NEXT_PUBLIC_APP_URL` | Final HTTPS origin | No |
| `NEXT_PUBLIC_SITE_URL` | Same origin | No |
| `NEXT_PUBLIC_SUPABASE_URL` | New project URL only | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | New project's public anonymous key; required by the existing SSR/middleware path | Public key |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional new publishable key; do not substitute it for the required variable without checking every client | Public key |
| `SUPABASE_SERVICE_ROLE_KEY` | New project's server key, Vercel secret only | Yes |
| `CLINICAL_NOTES_KEY_PROVIDER` | `vault` | No |
| `CLINICAL_NOTES_KEK_ID` | `vault:clinical-notes-kek/v1` referring to the new project's secret | Identifier only |
| `ALLOW_DEV_KEK_FALLBACK` | `false` | No |
| `CLINICAL_NOTES_KEK_DEV_KEY` | Must be absent | Never deploy |
| `CRON_SECRET` | New random secret, at least 32 bytes, stored in Vercel | Yes |
| `SESSION_IDLE_TIMEOUT_STAFF_MIN` | 30 unless explicitly reviewed | No |
| `SESSION_IDLE_TIMEOUT_DOCTOR_MIN` | 15 unless explicitly reviewed | No |
| `SESSION_IDLE_TIMEOUT_ADMIN_MIN` | 15 unless explicitly reviewed | No |
| `FEATURE_HANDWRITTEN_NOTES` | `false` until doctor acceptance | No |
| `FEATURE_HANDWRITTEN_NOTES_DOCTOR_IDS` | Empty initially; approved Auth doctor UUIDs later | No |
| `FEATURE_HANDWRITTEN_NOTES_FINALISE` | `false` until acceptance | No |
| `FEATURE_HANDWRITTEN_NOTES_PDF` | `false` until acceptance | No |
| `AUTH_DEBUG`, `SUPABASE_CALL_DEBUG` | Absent or `false` | No |

The generated `branding.env` contains only public configuration and nonsecret feature settings. Transfer values to Vercel using its environment editor or an approved secret manager. Do not evaluate that file as shell code.

Supabase dashboard settings: disable public signups; configure the final Site URL, exact callback/reset redirect URLs, SMTP and branded templates; enable TOTP MFA; set a password length of at least 12; enable leaked password protection. Confirm your plan supports leaked password protection before patient use. This is a hosted Auth control and is not proven by a local SQL advisor run. See [Supabase password security](https://supabase.com/docs/guides/auth/password-security).

Keep `private` and `vault` out of exposed Data API schemas. Do not enable anonymous signups. Keep the patient and practice brand buckets private. Preview deployments must use a separate nonproduction Supabase environment with synthetic data, or be disabled; never silently share the production database for previews.
