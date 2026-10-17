-- 0062_access_integration_audit_actions.sql — enum value additions, isolated.
--
-- Same rule as 0005/0035: ALTER TYPE ... ADD VALUE must not share a
-- transaction with a statement that uses the new value, and Supabase wraps
-- each migration file in a transaction. These values are only used at runtime
-- (through write_audit_entry_atomic), never inside a migration.
--
-- They back the POPIA trail for the ACCESS referral integration
-- (docs/integrations/access.md):
--   access_referral_received   ACCESS delivered a referral to the inbox
--   access_referral_view       a staff member opened an inbox referral
--   access_referral_accepted   reception linked it to a patient file
--   access_referral_declined   reception declined it
--   access_integration_denied  a correctly signed request was refused: wrong
--                              organisation, wrong data mode, or a conflicting
--                              replay (bad signatures are logged, not audited)
--
-- Apply BEFORE 0063_access_referral_inbox.sql and before deploying the code
-- that writes these actions.

alter type audit_action add value if not exists 'access_referral_received';
alter type audit_action add value if not exists 'access_referral_view';
alter type audit_action add value if not exists 'access_referral_accepted';
alter type audit_action add value if not exists 'access_referral_declined';
alter type audit_action add value if not exists 'access_integration_denied';
