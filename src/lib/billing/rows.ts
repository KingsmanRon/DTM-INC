// Pure transform from staged billing items to the spreadsheet matrix. Kept free
// of I/O so it is trivially unit-testable — the acceptance criterion that the
// exported ID/Passport and Medical Aid Number are POPULATED (not blank) lives
// or dies here.
import { BILLING_COLUMNS, CASH_PAYER_LABEL, formatBillingDate } from "./format";

// Mirrors the public.payer_type enum snapshotted onto billing_export_items.
export type BillingPayerType = "medical_aid" | "private";

export type BillingItem = {
  file_number: string | null;
  patient_name: string | null;
  id_number: string | null;
  medical_aid_number: string | null;
  // Snapshot of patients.payer_type at stage time. null = legacy row staged
  // before migration 0041; rendered with the pre-0041 fallback (number/blank).
  payer_type: BillingPayerType | null;
  outgoing_date: string | null;
  returned_date: string | null;
};

// The Medical Aid Number cell. payer_type is authoritative: a private (cash)
// payer renders CASH even if a stale membership number was snapshotted, so a
// patient who dropped their medical aid cannot be claimed against it. Blank is
// reserved for a medical-aid (or legacy/unknown) row with no number captured.
export function medicalAidCell(
  item: Pick<BillingItem, "payer_type" | "medical_aid_number">,
): string {
  if (item.payer_type === "private") return CASH_PAYER_LABEL;
  return item.medical_aid_number ?? "";
}

// Header row + one row per item, in BILLING_COLUMNS order. Identifier columns
// carry the patient's real File Number, ID/Passport and Medical Aid Number
// (or CASH for private payers); dates are formatted "DD MMMM YYYY", and a
// blank returned date stays blank.
export function buildBillingRows(items: BillingItem[]): string[][] {
  const header = [...BILLING_COLUMNS];
  const body = items.map((item) => [
    item.file_number ?? "",
    item.patient_name ?? "",
    item.id_number ?? "",
    medicalAidCell(item),
    formatBillingDate(item.outgoing_date),
    formatBillingDate(item.returned_date),
  ]);
  return [header, ...body];
}
