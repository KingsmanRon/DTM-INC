// Pure transform from staged billing items to the spreadsheet matrix. Kept free
// of I/O so it is trivially unit-testable — the acceptance criterion that the
// exported ID/Passport and Medical Aid Number are POPULATED (not blank) lives
// or dies here.
import { BILLING_COLUMNS, formatBillingDate } from "./format";

export type BillingItem = {
  file_number: string | null;
  patient_name: string | null;
  id_number: string | null;
  medical_aid_number: string | null;
  outgoing_date: string | null;
  returned_date: string | null;
};

// Header row + one row per item, in BILLING_COLUMNS order. Identifier columns
// carry the patient's real File Number, ID/Passport and Medical Aid Number;
// dates are formatted "DD MMMM YYYY", and a blank returned date stays blank.
export function buildBillingRows(items: BillingItem[]): string[][] {
  const header = [...BILLING_COLUMNS];
  const body = items.map((item) => [
    item.file_number ?? "",
    item.patient_name ?? "",
    item.id_number ?? "",
    item.medical_aid_number ?? "",
    formatBillingDate(item.outgoing_date),
    formatBillingDate(item.returned_date),
  ]);
  return [header, ...body];
}
