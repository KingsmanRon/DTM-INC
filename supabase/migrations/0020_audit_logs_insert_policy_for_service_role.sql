-- Operational backstop: allow service_role to INSERT audit logs under RLS.
-- This prevents audit write outages if SECURITY DEFINER ownership/grants drift
-- and write_audit_entry executes without the intended owner context.
-- Direct UPDATE/DELETE remain revoked (0002), so rows stay append-only.

begin;

grant insert on table public.audit_logs to service_role;

drop policy if exists audit_logs_service_role_insert on public.audit_logs;
create policy audit_logs_service_role_insert on public.audit_logs
for insert
to service_role
with check (true);

commit;
