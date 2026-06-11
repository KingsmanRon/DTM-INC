# Break-glass runbook (§10.4)

Emergency, audited admin access to a patient's clinical notes when the doctor
is unavailable. UI: **Admin → Break-glass**.

## Procedure
1. Admin opens /admin/break-glass, enters the patient UUID (from the patient's
   profile URL via a staff member, or the audit log) and a justification of at
   least 40 characters. Submitting starts a **48-hour cool-off**.
2. **Notify the doctor out of band immediately** (call/SMS). The in-app
   notification email is not yet built — this manual step IS practice policy
   until it ships. The request is also visible to the doctor in their audit
   view (`break_glass_request` rows).
3. After the cool-off, the same admin (requests are requester-bound) clicks
   "Access notes". The first access opens a **24-hour window**; every read is
   audited BEFORE any decryption (`break_glass_access`).
4. After the window expires, a new request (and new cool-off) is required.

## Revocation
The doctor/owner can revoke a pending request before access:
`update break_glass_requests set revoked_at = now() where id = '<id>';`
(SQL editor; revocation is honoured by the access endpoint.)

## Review
Audit page → filter action `break_glass_request` / `break_glass_access`.
Each access row carries the request id, patient id, and window end.
