-- 0056_practice_settings_locale.sql
--
-- Per-practice locale. This is the trusted, server-side switch that drives the
-- SA/US differences (identity rules, payer model, file numbering, consent). It
-- lives on practice_settings — NOT in the onboarding payload — so a client can
-- never claim a different locale to bypass identity validation; onboard_patient
-- (0057) reads it from here.
--
-- Defaults to 'za', so every existing single-tenant SA deployment keeps its
-- current behaviour with no action. A US practice is provisioned with 'us'.

alter table public.practice_settings
  add column if not exists locale text not null default 'za';

alter table public.practice_settings
  drop constraint if exists practice_settings_locale_check;
alter table public.practice_settings
  add constraint practice_settings_locale_check
  check (locale in ('za', 'us'));

comment on column public.practice_settings.locale is
  'Regulatory/identity locale for this practice: za (SA, default) or us. Trusted source for onboard_patient identity rules.';
