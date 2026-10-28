import type { DocumentCategory, PatientDocument, SampleDocumentTemplate } from "@/app/demo/_interactive/types";

/**
 * Bundled demonstration documents. The public demo never accepts uploads:
 * visitors can only attach one of these fictional samples, which render as
 * on-screen previews and are never real files.
 */
export const SAMPLE_DOCUMENTS: readonly SampleDocumentTemplate[] = [
  {
    id: "tpl-referral",
    title: "Referral letter (sample)",
    category: "referral_letter",
    fileName: "sample-referral-letter.pdf",
    sizeLabel: "212 KB",
    description: "A fictional letter from a referring doctor.",
  },
  {
    id: "tpl-aidcard",
    title: "Medical aid card (sample)",
    category: "medical_aid_card",
    fileName: "sample-medical-aid-card.jpg",
    sizeLabel: "168 KB",
    description: "A fictional membership card for a fictional scheme.",
  },
  {
    id: "tpl-id",
    title: "Identity document copy (sample)",
    category: "id_copy",
    fileName: "sample-identity-copy.pdf",
    sizeLabel: "428 KB",
    description: "A fictional identity page using a synthetic identifier.",
  },
  {
    id: "tpl-consent",
    title: "Signed consent form (sample)",
    category: "consent_form",
    fileName: "sample-consent-form.pdf",
    sizeLabel: "301 KB",
    description: "A fictional consent form with sample wording.",
  },
  {
    id: "tpl-letter",
    title: "Practice correspondence (sample)",
    category: "correspondence",
    fileName: "sample-correspondence.pdf",
    sizeLabel: "96 KB",
    description: "A fictional administrative letter.",
  },
];

export function templateById(id: string): SampleDocumentTemplate | undefined {
  return SAMPLE_DOCUMENTS.find((tpl) => tpl.id === id);
}

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  id_copy: "ID copy",
  medical_aid_card: "Medical aid card",
  consent_form: "Consent form",
  referral_letter: "Referral letter",
  correspondence: "Correspondence",
};

/** Categories a complete patient file is expected to hold. */
export const EXPECTED_CATEGORIES: readonly DocumentCategory[] = [
  "id_copy",
  "medical_aid_card",
  "consent_form",
  "referral_letter",
];

const STAFF = "Lindiwe Sample (Reception)";

function seedDoc(
  n: number,
  patientId: string,
  templateId: string,
  attachedAt: string,
  verified = true,
): PatientDocument {
  const tpl = templateById(templateId);
  if (!tpl) throw new Error(`Unknown sample document template: ${templateId}`);
  return {
    id: `d-${String(n).padStart(4, "0")}`,
    patientId,
    templateId,
    title: tpl.title,
    category: tpl.category,
    fileName: tpl.fileName,
    sizeLabel: tpl.sizeLabel,
    status: "on_file",
    attachedAt,
    attachedBy: STAFF,
    history: [
      { at: attachedAt, actor: STAFF, action: "attached", detail: `${tpl.title} attached to the patient file` },
      ...(verified
        ? [
            {
              at: `${attachedAt.slice(0, 10)}T16:00:00+02:00`,
              actor: STAFF,
              action: "verified" as const,
              detail: "Content checked and filed",
            },
          ]
        : []),
    ],
  };
}

export const SEED_DOCUMENTS: readonly PatientDocument[] = [
  seedDoc(1, "p-0001", "tpl-id", "2026-09-02T08:40:00+02:00"),
  seedDoc(2, "p-0001", "tpl-aidcard", "2026-09-02T08:42:00+02:00"),
  seedDoc(3, "p-0001", "tpl-consent", "2026-09-02T08:50:00+02:00"),
  seedDoc(4, "p-0002", "tpl-referral", "2026-09-04T10:20:00+02:00"),
  seedDoc(5, "p-0002", "tpl-aidcard", "2026-09-04T10:22:00+02:00"),
  seedDoc(6, "p-0003", "tpl-consent", "2026-09-08T09:15:00+02:00"),
  seedDoc(7, "p-0004", "tpl-referral", "2026-09-10T11:50:00+02:00"),
  seedDoc(8, "p-0004", "tpl-consent", "2026-09-10T11:55:00+02:00"),
  seedDoc(9, "p-0004", "tpl-id", "2026-09-10T11:58:00+02:00"),
  seedDoc(10, "p-0005", "tpl-aidcard", "2026-10-26T08:41:00+02:00", false),
  seedDoc(11, "p-0010", "tpl-id", "2026-09-25T09:40:00+02:00"),
  seedDoc(12, "p-0012", "tpl-referral", "2026-10-27T08:19:00+02:00", false),
];

export const NEXT_DOCUMENT_SEQUENCE = 13;
