# DTM PWA Handover Architecture (2026-05-07)

## 1) System architecture overview
DTM is a Next.js 15 App Router PWA deployed on Vercel, backed by Supabase (Postgres/Auth/Storage), with POPIA-aligned role-based access and an append-only hash-chained audit trail.

### High-level layers
1. **Client/PWA (Next.js UI)**
   - Auth, dashboard, patients, admin pages.
   - Role-aware rendering and route gating.
2. **API Layer (`/api/v1/**`)**
   - Node runtime route handlers.
   - Session/role enforcement (`requireRole` / `requireSession`).
   - Audit writes for sensitive actions.
3. **Data Layer (Supabase Postgres + Storage)**
   - RLS enabled on core tables.
   - Clinical notes encrypted using envelope encryption.
   - Documents in Storage bucket with DB metadata rows.
4. **Key Management Layer (Vault-first)**
   - KEK read from Supabase Vault wrappers (`read_app_secret`).
   - Controlled dev fallback (`ALLOW_DEV_KEK_FALLBACK`).

---

## 2) Folder structure (handover view)

```text
.
├── src/
│   ├── app/
│   │   ├── (authed)/
│   │   │   ├── dashboard/
│   │   │   ├── patients/
│   │   │   │   ├── new/
│   │   │   │   └── [id]/
│   │   │   └── admin/
│   │   ├── api/
│   │   │   └── v1/
│   │   │       ├── auth/
│   │   │       ├── patients/
│   │   │       ├── admin/
│   │   │       └── internal/
│   │   ├── login/
│   │   ├── mfa/
│   │   └── health/
│   ├── lib/
│   │   ├── auth/
│   │   ├── audit/
│   │   ├── crypto/
│   │   ├── supabase/
│   │   ├── validation/
│   │   └── api/
│   └── middleware.ts
├── supabase/
│   ├── migrations/
│   └── seed*.sql
├── scripts/
│   ├── run-migrations.mjs
│   └── verify-audit-chain.mjs
├── docs/internal/
│   ├── go-live-owner-checklist.md
│   ├── vault-setup.md
│   ├── test-data-hard-delete.md
│   └── handover-architecture.md
└── .github/workflows/
    └── release-gate.yml
```

---

## 3) Tech stack list

### Frontend
- Next.js 15 (App Router)
- React 19
- Tailwind CSS
- PWA assets (`manifest.webmanifest`, `sw.js`)

### Backend/API
- Next.js Route Handlers (Node runtime)
- TypeScript
- Zod (request/env validation)

### Data/Auth/Storage
- Supabase Postgres
- Supabase Auth
- Supabase Storage
- Row Level Security policies

### Security/Crypto
- Envelope encryption (AES-256-GCM)
- Supabase Vault wrapper RPCs for KEK retrieval/rotation
- Optional controlled dev-key fallback during migration/cutover
- Hash-chained append-only audit logging

### DevOps/Quality
- GitHub Actions release gate (`npm ci`, lint, typecheck, test, build)
- Vercel deployment

---

## 4) Component communication

### Auth/session flow
1. User signs in via Supabase Auth.
2. Middleware verifies session presence and protects private routes.
3. API handlers call `requireRole(...)` before data access.
4. `resolveSession()` maps `auth.users.id` to `app_users` role/status row.

### Clinical notes flow (encrypted)
1. Doctor calls notes API route.
2. API resolves/creates patient DEK row (`patient_encryption_keys`).
3. `wrapDek` / `unwrapDek` uses KEK from Vault wrapper (`read_app_secret`).
4. Note body encrypted/decrypted with DEK (AES-256-GCM).
5. Action is audit-logged.

### Break-glass flow
1. Admin/doctor creates break-glass request with justification + cooldown.
2. Access endpoint checks request state and access window.
3. Notes are decrypted/read via same KEK/DEK path.
4. Access is audit-logged.

### Document flow
1. Upload metadata written to `patient_documents`.
2. Binary lives in Supabase Storage bucket.
3. Reads/downloads tracked and role-checked.

---

## 5) User journey (end-to-end)

### A) Receptionist (staff)
1. Login
2. Search or create patient
3. Capture demographics/administrative data
4. Upload documents
5. View patient profile tabs except clinical notes

### B) Doctor
1. Login (+ MFA if required)
2. Open patient profile
3. Create/read/amend/finalise clinical notes
4. Generate onboarding PDF
5. Review timeline and notes status

### C) Admin
1. Login (+ MFA)
2. Invite/activate/deactivate users
3. Review audit log
4. Manage practice settings
5. Trigger/approve break-glass workflow per policy

---

## 6) Operational runbooks & controls
1. **Vault setup & rotation**: `docs/internal/vault-setup.md`
2. **Test-data hard delete**: `docs/internal/test-data-hard-delete.md`
3. **Go-live ownership checklist**: `docs/internal/go-live-owner-checklist.md`
4. **Release gate CI**: `.github/workflows/release-gate.yml`
5. **Audit chain verification job**: `scripts/verify-audit-chain.mjs`

---

## 7) Known risks / important handover notes
1. Keep `ALLOW_DEV_KEK_FALLBACK=true` only during transition; disable after key alignment and validation.
2. Hard-delete SQL helper is irreversible and intended for non-production dummy data cleanup.
3. Audit logs are append-only and intentionally retained.
4. Ensure migration parity across environments before enabling Vault-only mode.
5. Confirm CI registry access so release gate can run to green.

---

## 8) Suggested first-week handover checklist
1. Confirm all DB migrations applied in production/staging.
2. Validate Vault secret read/write wrappers.
3. Run staff + doctor + admin smoke tests.
4. Validate break-glass path and audit trail entries.
5. Run audit chain verifier and capture evidence.
6. Confirm release gate pass on latest commit.
7. Document rollback owner + DNS rollback criteria.
