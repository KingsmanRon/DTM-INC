-- 0051_consent_cards_settings.sql — consent summary cards become practice data
-- (review P3/V2 #31).
--
-- The onboarding wizard's Section G summary cards (Treatment consent / POPIA /
-- Financial terms / Dependants) were hardcoded in the client component and name
-- Dr. Thomas Mtshali in their wording — a repackaging blocker for any other
-- practice. They now live on the practice_settings row next to the consent body
-- they summarise. The DEFAULT below is the exact current wording, so the live
-- DTM deployment renders identically with zero data changes.
--
-- Shape: jsonb array of { badge, title, body }, rendered in order. The full
-- declaration text remains active_consent_body (versioned + hashed); these
-- cards are presentation, deliberately NOT part of the consent hash.

begin;

alter table public.practice_settings
  add column if not exists consent_cards jsonb not null default '[
    {
      "badge": "A",
      "title": "Treatment consent",
      "body": "I consent to consultation, examination and treatment by Dr. Thomas Mtshali and to such investigations and procedures as may, in his clinical judgement, be reasonably necessary for my care. I understand that separate, specific consent will be obtained before any surgical or invasive procedure."
    },
    {
      "badge": "B",
      "title": "Information processing under POPIA",
      "body": "I authorise Dr. Thomas Mtshali Inc. (\"the Practice\") to collect, store, use and share my personal and health information for care, lawful record-keeping, and authorised administration. Under POPIA I have rights of access and correction, subject to lawful retention requirements."
    },
    {
      "badge": "C",
      "title": "Financial terms",
      "body": "I accept personal responsibility for payment of fees not covered by my medical aid, including co-payments and shortfalls. I acknowledge cancellation/no-show terms and understand outstanding accounts may proceed to lawful collections processes."
    },
    {
      "badge": "D",
      "title": "Dependants (where applicable)",
      "body": "Where I am the main member or legal guardian of any dependant whose details I provide, I confirm I am authorised to give the above consents on their behalf."
    }
  ]'::jsonb;

comment on column public.practice_settings.consent_cards is
  'Section G summary cards shown in the onboarding wizard: jsonb array of '
  '{badge, title, body}. Presentation only — the hashed/versioned consent text '
  'is active_consent_body. Editable via PATCH /api/v1/admin/practice-settings.';

commit;
