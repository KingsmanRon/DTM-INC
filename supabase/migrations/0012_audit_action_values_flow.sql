-- 0012_audit_action_values_flow.sql
-- Expand audit_action enum for appointment/queue/consultation/sync workflows.
-- Isolated migration because ALTER TYPE ... ADD VALUE cannot run inside a
-- transaction block when combined with other DDL.

alter type audit_action add value if not exists 'appointment_create';
alter type audit_action add value if not exists 'appointment_update';
alter type audit_action add value if not exists 'appointment_check_in';

alter type audit_action add value if not exists 'queue_assign';
alter type audit_action add value if not exists 'queue_status_transition';

alter type audit_action add value if not exists 'consultation_start';
alter type audit_action add value if not exists 'consultation_complete';

alter type audit_action add value if not exists 'offline_action_synced';
alter type audit_action add value if not exists 'sync_conflict_detected';
