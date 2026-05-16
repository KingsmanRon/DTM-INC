# DTM Inc. — Patient Onboarding & Records PWA

**Practice:** Dr. Thomas Mtshali Inc. — Specialist Laparoscopic and General Surgeon
**Location:** Clinix Naledi-Nkanyezi Private Hospital, 1 Moshoeshoe Street, Sebokeng 1982
**Contact:** 016 420-3160
**Practice number:** PR. No. 1144286
**Version:** v1.1 (MVP spec, ready for build — all open questions resolved with practice owner)
**Document owner:** Inntris / Ronald Maduna
**Compliance posture:** POPIA-aligned (Health information = special personal information, POPIA s.26–s.27)
**Information Officer:** Dr. Thomas Mtshali

> This file is the authoritative product spec this repo builds against. The full text captured here matches the brief handed to the implementing agent at kickoff. When requirements change, update this file first, then the code, then the migrations.

See the repo's [`README.md`](./README.md) for architecture, quick start, and deployment.

## §1 Product goal
A secure, internal-only Progressive Web App that lets DTM Inc. staff:
1. Capture new patient demographics digitally with a system-generated, unique file number.
2. Search and retrieve patient records instantly during phone calls or front-desk interactions.
3. Update patient demographics, account-responsible party, medical aid, dependants, contacts, and referrals.
4. Upload and retrieve patient documents (ID copies, medical aid cards, referral letters, signed consent).
5. Allow the doctor — and only the doctor — to create and read clinical notes against a patient file.
6. Produce a print-ready PDF of the onboarding pack matching the existing carbon-form layout, for the third-party claims processor.
7. Maintain a tamper-evident audit trail of all sensitive actions.

## §15 Locked decisions (practice owner)

| # | Question | Decision |
|---|---|---|
| 1 | Future locum / partner doctor access? | **No.** Single-doctor practice by design. |
| 2 | Should staff see that clinical notes exist? | **No.** Entirely invisible to staff — no count, no badge, no tab. |
| 3 | Medical aid scheme dropdown? | **No.** Free text; reception types what the patient says. |
| 4 | Claims processor integration? | **No integration, ever.** Reception manually emails / hands over the PDF. |
| 5 | Information Officer registration? | **Done.** System only surfaces the IO contact. |
| 6 | Brand colours? | **Inntris palette as base; DTM green as accent. Sample green from a 600dpi flatbed scan.** |

---

*The full numbered spec (§1–§16) lives in the initial brief submitted with this repo. If you need the verbatim sections in-tree as well, request a split into per-section files — we've kept this single-file index to avoid duplicating the brief across the repo.*
