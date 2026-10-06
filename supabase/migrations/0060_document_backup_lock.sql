-- The nightly document backup takes the 'document_backup' maintenance lease.
-- try_acquire_maintenance_lock only updates an existing row, so without this
-- row every run skipped the copy and still reported success.
insert into public.audit_maintenance_locks (name, locked_until)
values ('document_backup', null)
on conflict (name) do nothing;
