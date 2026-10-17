# ACCESS referral integration

ACCESS (KingsmanRon/Appointments) receives referrals for the practice, checks
they are administratively complete, and delivers them to DTM. Each delivered
referral lands in the **Referral inbox** (`/referrals`). Reception then either
links it to the patient's file or declines it.

The integration is **off** until it is configured, and it ships for synthetic
test data first. Real referrals need the go-live steps at the end of this page.

## What ACCESS can and cannot do

| ACCESS can | ACCESS cannot |
| --- | --- |
| Deliver a referral to the inbox | Create, edit or archive a patient file |
| Read back whether its delivery is stored, with the inbox reference and status | Read any patient file, clinical note, document or billing row |
| | See which patient a referral was linked to |
| | Deliver anything from another ACCESS organisation, or test data to a live practice |

New patients are still onboarded at reception, because Section G consent needs
the patient present. ACCESS keeps the referral documents; v1 transfers none.

## How a referral flows

1. ACCESS's worker sends `POST /api/v1/integrations/access/referrals`, signed, with the referral.
2. DTM stores it once per ACCESS execution id and answers with an inbox reference (`IN-000042`).
3. If the answer is lost, ACCESS asks `GET /api/v1/integrations/access/referrals/{execution_id}`
   before doing anything else. It never sends the same referral twice on a guess.
4. Reception opens the inbox. If exactly one active file has the same ID or passport
   number, it is shown as a possible match; reception still chooses.
5. Reception links the referral to a file, which adds a `patient_referrals` row, or declines it with a reason.

## Security

**Signed requests.** Every request carries three headers:

| Header | Value |
| --- | --- |
| `x-access-key-id` | Key id, from `ACCESS_INTEGRATION_KEYS` |
| `x-access-timestamp` | Unix seconds; refused if more than 300 s from DTM's clock |
| `x-access-signature` | `v1=` + hex HMAC-SHA256 of the canonical request |

The canonical request is five lines joined by `\n`:

```text
access-dtm-v1
POST
/api/v1/integrations/access/referrals
1792224000
<sha256 hex of the body; of "" for GET>
```

Both repositories test the same fixed vector
(`src/lib/integrations/access/signature.test.ts` here), so the two
implementations cannot drift apart unnoticed.

**One organisation.** `ACCESS_INTEGRATION_TENANT_ID` names the only ACCESS
organisation allowed to deliver. Any other is refused (403) and audited.

**Test data stays separate.** `ACCESS_INTEGRATION_DATA_MODE` is `synthetic` or
`real`. A delivery in the other mode is refused (409) and audited, so synthetic
referrals can never reach the live practice and real ones never reach a test copy.

**Least privilege in the database (0063).**

- Only two `SECURITY DEFINER` functions, granted to `service_role` alone, write
  or read inbox rows for the integration.
- Reception's accept and decline functions check that the caller is a doctor or staff member.
- No API role can insert, update or delete inbox rows directly.
- Admin, as for patient files, cannot read the inbox.

**Audit.** These actions are written to the hash-chained audit log, with no
patient details in their metadata:

| Action | When |
| --- | --- |
| `access_referral_received` | A delivery is stored (not on replays) |
| `access_referral_view` | Someone opens an inbox referral |
| `access_referral_accepted` | A referral is linked to a file |
| `access_referral_declined` | A referral is declined |
| `access_integration_denied` | A signed request is refused: wrong organisation, wrong data mode, or a conflicting replay |

Requests that fail the signature check are counted in the server log but not
audited, because anyone on the internet can send them.

**Fails closed.** A missing or malformed setting switches the integration off
(503) without affecting the rest of DTM.

## API contract (v1)

All paths are under `/api/v1/integrations/access`.

### `POST /referrals`

Send the body below, with `content-type: application/json` and
`idempotency-key: <execution_id>`. The body is limited to 64 KB.

```json
{
  "schema_version": "access-referral-delivery.v1",
  "execution_id": "uuid",
  "correlation_id": "uuid",
  "access_tenant_id": "uuid",
  "data_mode": "SYNTHETIC",
  "referral": {
    "case_reference": "REF-1A2B3C4D",
    "referral_id": "uuid",
    "received_at": "2026-10-17T07:55:00Z",
    "patient": { "given_name": "…", "family_name": "…", "date_of_birth": "1980-01-01", "identifier": "optional" },
    "referrer": { "name": "…" },
    "reason": "optional, up to 4000 characters",
    "requested_service": "OPTIONAL_CODE",
    "referral_date": "2026-10-15",
    "funding": { "type": "MEDICAL_AID", "scheme": "optional" },
    "documents_held": ["referral_letter"]
  }
}
```

Unknown fields are refused.

| Status | Meaning for ACCESS |
| --- | --- |
| `201` | Stored. The body is the receipt: `{schema_version: "access-referral-receipt.v1", execution_id, reference, status, delivered_at, deduplicated: false}` |
| `200` | Already stored with the same content (a replay). The same receipt, with `deduplicated: true` |
| `409 idempotency_conflict` | Something else is already stored under this execution id. Read it back |
| `400`, `401`, `403`, `409 data_mode_mismatch`, `413`, `422`, `503` | Refused. Nothing stored |
| `500` | Unknown. Read back before doing anything else |

### `GET /referrals/{execution_id}` and `GET /referrals?reference=IN-000042`

| Status | Body |
| --- | --- |
| `200` | `{schema_version: "access-referral-status.v1", execution_id, reference, status, delivered_at, resolved_at}`, where `status` is `pending`, `accepted` or `declined` |
| `404` | Nothing is stored for that key yet. A delivery still in flight can be stored while its signature is valid (five minutes), so ACCESS keeps checking and hands the case to its staff if it never appears |
| `500` | Unknown; try again later |

## Operating it

The steps below cover setup, key rotation and switching the integration off.
The variables are listed in `.env.example`.

**Set up**

1. Apply migrations `0062` and then `0063`.
2. Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
3. Set `ACCESS_INTEGRATION_KEYS=<key id>:<secret>`, `ACCESS_INTEGRATION_TENANT_ID`, and
   `ACCESS_INTEGRATION_DATA_MODE` (leave it at `synthetic` until go-live).
4. Give ACCESS the same key id and secret, its worker-only `DTM_*` settings, and DTM's base URL.

**Rotate keys**

1. Set `ACCESS_INTEGRATION_KEYS=new:<secret>,old:<secret>`.
2. Switch ACCESS to the new key.
3. Remove the old key.

**Switch off**

Unset `ACCESS_INTEGRATION_KEYS`. Every integration request then gets a 503.
ACCESS raises its referrals for staff to enter by hand.

**Test**

- `npm run test` covers signing, validation and every response branch.
- `supabase test db` runs `supabase/tests/access_referral_inbox.test.sql`. It covers access rules,
  idempotency, the possible-match rule, and the accept and decline rules.

## Before real referrals (go-live)

1. The practice, as the responsible party, approves the integration. ACCESS's
   operator is covered by an operator agreement (POPIA s.20–21). The privacy
   notice names referral intake through ACCESS.
2. Run ACCESS's DTM connector qualification against a DTM staging copy in
   `synthetic` mode. Record the results.
3. Switch both sides to real data on the same day: `ACCESS_INTEGRATION_DATA_MODE=real` here, and
   ACCESS's REAL data mode with its client-pilot checklist complete.
