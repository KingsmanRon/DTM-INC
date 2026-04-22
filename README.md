# DTM Inc. — Patient Onboarding & Records PWA

Internal-only, POPIA-aligned, single-practice surgical EHR for Dr. Thomas Mtshali Inc., Sebokeng.

This repo is the v1. It replaces the paper onboarding form and the `DATE | NOTES` clinical sheet with digital equivalents, generates unique file numbers, and gives the doctor a searchable patient register — without touching third-party claims processing.

---

## Quick start

```bash
# 1. Install
npm install

# 2. Copy envs
cp .env.example .env.local
# Fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
# Generate a dev KEK for envelope encryption:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# and paste into CLINICAL_NOTES_KEK_DEV_KEY (dev only — prod uses Supabase Vault).

# 3. Apply migrations (use Supabase CLI or psql)
#   supabase db push
# or concat all migrations to stdout and pipe to your own tool:
#   npm run db:migrate | psql $SUPABASE_AUDIT_DB_URL

# 4. Run
npm run dev
```

---

## Architecture snapshot

```
┌────────────────────────────────────────────────────────────────────┐
│  Next.js 15 (App Router) on Vercel — PWA, EU/SA edge              │
│   ├── /login, /dashboard, /patients/new, /patients/:id, /admin/*  │
│   └── Service worker caches APP SHELL ONLY (never /api responses) │
└────────────────────────────────────────────────────────────────────┘
        │ cookie-bound session (Supabase SSR)
        ▼
┌────────────────────────────────────────────────────────────────────┐
│  Route Handlers /api/v1/** — Node runtime                          │
│   ├── requireRole() on every protected endpoint (§10.1 layer 2)    │
│   ├── writes audit rows to append-only audit_logs (hash chain)     │
│   └── unwraps per-patient DEKs for clinical notes (envelope AES)   │
└────────────────────────────────────────────────────────────────────┘
        │                                            │
        ▼                                            ▼
┌─────────────────────────────┐          ┌────────────────────────┐
│ Supabase Postgres (EU)      │          │ Supabase Storage       │
│  · RLS on every table       │          │  · patient-documents   │
│  · roles: doctor/staff/admin│          │  · signed URLs only    │
│  · clinical_notes: doctor   │          │                        │
│    only (DB trigger)        │          │                        │
│  · audit_logs: INSERT only  │          │                        │
└─────────────────────────────┘          └────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────────────┐
│  Supabase Vault / KMS — wraps per-patient DEKs                    │
│  Railway service (future): stricter isolation for audit writer    │
│  and PDF generation                                                │
└────────────────────────────────────────────────────────────────────┘
```

### Three-layer authorisation (§10.1)

1. **UI** — role-aware route guards in `src/middleware.ts` and conditional rendering.
2. **API** — `requireRole()` in `src/lib/auth/session.ts` is called by every `/api/v1/**` route. 404 (not 403) for authenticated-but-forbidden.
3. **Database** — RLS policies in `supabase/migrations/0002_rls_policies.sql`. Clinical notes have a PL/pgSQL trigger that blocks writes whose `author_user_id` is not a doctor.

### Three-layer invisibility of clinical notes to staff (§15 decision #2)

1. Frontend: the Clinical notes tab is not rendered for staff/admin (see `patient-tabs.tsx`).
2. API: every notes endpoint starts with `requireRole("doctor")` which returns 404.
3. DB: RLS on `clinical_notes` restricts all access to `is_doctor()`.

### Hash-chained audit log (§10.5)

- `src/lib/audit/log.ts` computes `entry_hash = sha256(prev_hash || canonical_json(row))`.
- `0002_rls_policies.sql` revokes UPDATE/DELETE from every role on `audit_logs`.
- `scripts/verify-audit-chain.mjs` walks the chain end-to-end; run as a daily cron.
- `chain_anchor_id` is reserved for the v2 Inntris on-chain anchor (Base mainnet) per §FR-11.

### Envelope encryption of clinical notes (§10.3)

- `src/lib/crypto/envelope.ts` — AES-256-GCM.
- One DEK per patient, wrapped under a KMS-managed KEK.
- Dev path uses `CLINICAL_NOTES_KEK_DEV_KEY`. Prod MUST swap to Supabase Vault or a KMS.

---

## Project structure

```
src/
├── app/
│   ├── (authed)/              # authenticated routes; layout enforces session
│   │   ├── dashboard/         # search + new-patient tile
│   │   ├── patients/new/      # 7-step onboarding wizard (Sections A–G)
│   │   ├── patients/[id]/     # profile with tabs; clinical tab is doctor-only
│   │   └── admin/             # users, audit log, practice settings
│   ├── api/v1/                # Route Handlers — the only data surface
│   ├── login/                 # Supabase Auth UI
│   ├── privacy/               # POPIA privacy notice (IO contact, rights)
│   └── health/                # liveness probe
├── lib/
│   ├── audit/log.ts           # append-only writer + chain verifier
│   ├── auth/session.ts        # resolveSession / requireRole / 404 on forbidden
│   ├── crypto/envelope.ts     # AES-256-GCM envelope encryption
│   ├── pdf/onboarding.tsx     # @react-pdf/renderer doc matching paper form
│   ├── supabase/              # server + browser clients (SSR cookie-bound)
│   └── validation/            # zod schemas + SA ID Luhn
├── middleware.ts              # session refresh + coarse public/private gate
└── ...
supabase/migrations/           # 0001 schema · 0002 RLS · 0003 storage
public/
├── manifest.webmanifest       # PWA manifest
├── sw.js                      # shell-only service worker
├── icons/favicon.svg          # DTM mark — designer-replace per §16
└── brand/README.md            # §16 brand asset workflow
scripts/
├── run-migrations.mjs
└── verify-audit-chain.mjs
```

---

## Environment variables

See [`.env.example`](./.env.example). Production must never include a `.env` file — all secrets in Vercel / Railway / Supabase Vault.

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (EU/Frankfurt by default) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client auth key (RLS still enforces) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; bypasses RLS — use sparingly |
| `SUPABASE_AUDIT_DB_URL` | Optional dedicated `audit_writer` connection |
| `CLINICAL_NOTES_KEK_ID` | Reference to the KEK in Vault / KMS |
| `CLINICAL_NOTES_KEK_DEV_KEY` | Base64 32-byte dev fallback — NEVER set in prod |

---

## Deployment

- **Frontend:** Vercel. Region `fra1` or `cdg1`. Pin explicitly via project setting.
- **Database & auth:** Supabase. EU (Frankfurt) until Cape Town is GA. Enable PITR.
- **Railway service:** future home of audit writer + PDF generation for stronger isolation from the public edge (§11).
- **Signed DPAs** with Supabase, Vercel, Railway covering POPIA s.72 (§6.2).

Operational runbooks (restore drill, break-glass, breach-notification) belong in a private ops repo.

---

## What's intentionally **not** built

Per §2 / §14 rule 10 / §15 decision #4, the following will not exist in v1 and should not be added without a deliberate spec change:

- Medical aid claims capture / submission / remittance
- Any integration with the third-party claims processor
- Payment processing, billing, invoicing
- Patient portal or self-service
- Appointment scheduling
- ePrescribing, lab / theatre / imaging integrations
- WhatsApp / SMS / email notifications to patients
- Multi-practice / multi-tenant flags (single doctor by design — §15 decision #1)

---

## Phase 2 / 3 hooks already reserved

- `audit_logs.chain_anchor_id` — daily Merkle root anchored to Inntris Base mainnet registry (§FR-11).
- `consent_records.signature_type = 'drawn_signature'` — phase 2 switch from typed name to drawn SVG.
- `patient_encryption_keys.rotated_at` — DEK rotation workflow stub.

---

## Licence

Proprietary. Internal to DTM Inc. / Inntris. Not for redistribution.
