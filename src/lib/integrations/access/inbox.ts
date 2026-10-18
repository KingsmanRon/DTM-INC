// Shapes and helpers for the reception inbox pages (no server-only imports).

export const INBOX_LIST_SELECT =
  "id, reference, access_case_reference, data_mode, patient_given_name, patient_family_name, " +
  "patient_date_of_birth, referrer_name, requested_service, delivered_at, suggested_patient_id";

export const INBOX_RESOLVED_SELECT =
  "id, reference, access_case_reference, data_mode, patient_given_name, patient_family_name, status, resolved_at";

export const INBOX_DETAIL_SELECT =
  "id, reference, access_case_reference, data_mode, patient_given_name, patient_family_name, " +
  "patient_date_of_birth, patient_identifier, referrer_name, reason, requested_service, referral_date, " +
  "funding_type, funding_scheme, documents_held, received_at, delivered_at, suggested_patient_id, status, " +
  "linked_patient_id, decline_reason, resolved_at";

export type InboxListRow = {
  id: string;
  reference: string;
  access_case_reference: string;
  data_mode: "synthetic" | "real";
  patient_given_name: string;
  patient_family_name: string;
  patient_date_of_birth: string;
  referrer_name: string;
  requested_service: string | null;
  delivered_at: string;
  suggested_patient_id: string | null;
};

export type InboxResolvedRow = {
  id: string;
  reference: string;
  access_case_reference: string;
  data_mode: "synthetic" | "real";
  patient_given_name: string;
  patient_family_name: string;
  status: "accepted" | "declined";
  resolved_at: string;
};

export type InboxDetailRow = InboxListRow & {
  patient_identifier: string | null;
  reason: string | null;
  referral_date: string | null;
  funding_type: string | null;
  funding_scheme: string | null;
  documents_held: string[];
  received_at: string;
  status: "pending" | "accepted" | "declined";
  linked_patient_id: string | null;
  decline_reason: string | null;
  resolved_at: string | null;
};

export type PatientSummary = {
  id: string;
  file_number: string;
  first_names: string;
  surname: string;
  id_number: string | null;
  status: "active" | "archived";
};

export const PATIENT_SUMMARY_SELECT = "id, file_number, first_names, surname, id_number, status";

const DOCUMENT_LABELS: Record<string, string> = {
  referral_letter: "Referral letter",
  insurance: "Insurance details",
  demographics: "Demographics",
  medical_aid_card: "Medical aid card",
  identity_document: "Identity document",
  consent_form: "Consent form",
  prior_results: "Prior results",
};

export function documentLabel(type: string): string {
  return DOCUMENT_LABELS[type] ?? type;
}

const FUNDING_LABELS: Record<string, string> = {
  MEDICAL_AID: "Medical aid",
  SELF_PAY: "Self-pay",
  OTHER: "Other",
  UNKNOWN: "Not stated",
};

export function fundingLabel(type: string | null, scheme: string | null): string {
  if (!type) return "Not stated";
  const label = FUNDING_LABELS[type] ?? type;
  return scheme ? `${label} · ${scheme}` : label;
}

/** Same masking as patient search: last four characters only. */
export function maskIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  const tail = value.slice(-4);
  return value.length <= 4 ? tail : `••••${tail}`;
}

export function serviceLabel(code: string | null): string | null {
  if (!code) return null;
  const words = code.toLowerCase().split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
