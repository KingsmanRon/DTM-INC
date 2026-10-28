import type { BillingBatch, BillingItem, Payer, PayerKind } from "@/app/demo/_interactive/types";
import { formatDate, formatMonth } from "@/app/demo/_interactive/kit/format";
import { facilityById } from "@/app/demo/_interactive/fixtures/practice";

/**
 * Billing File Tracking helpers.
 *
 * Scope: this records which patient files are staged and handed to an
 * external billing provider. It does not submit claims, calculate tariffs,
 * invoice or process payments, and nothing here pretends otherwise.
 */

/** Mirrors the three payer states used when files are staged for handover. */
export function derivePayerLabel(payer: Payer): { kind: PayerKind; label: string } {
  if (payer.kind === "private") return { kind: "cash", label: "CASH" };
  const number = payer.membershipNumber.trim();
  return number ? { kind: "member", label: number } : { kind: "missing", label: "" };
}

export const BATCH_STATUS_LABEL: Record<BillingBatch["status"], string> = {
  preparing: "Preparing",
  ready: "Ready for handover",
  handed_over: "Handed over",
  returned: "Returned",
};

/** Neutralises spreadsheet formula injection and quotes values safely. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const CSV_NOTICE =
  "# SYNTHETIC DEMONSTRATION DATA. Fictional patients only. This is a file handover list, not a claim submission.";

const CSV_HEADER = [
  "File number",
  "Patient name (fictional)",
  "Medical aid number / payer",
  "Hospital",
  "Batch month",
  "Batch status",
  "Outgoing date",
  "Returned date",
];

export function buildHandoverCsv(batch: BillingBatch): string {
  const facility = facilityById(batch.facilityId).name;
  const rows = batch.items.map((item: BillingItem) =>
    [
      item.fileNumber,
      item.patientName,
      item.payerLabel,
      facility,
      formatMonth(batch.month),
      BATCH_STATUS_LABEL[batch.status],
      batch.outgoingAt ? formatDate(batch.outgoingAt) : "",
      batch.returnedAt ? formatDate(batch.returnedAt) : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [CSV_NOTICE, CSV_HEADER.map(csvCell).join(","), ...rows].join("\r\n") + "\r\n";
}

export function handoverFileName(batch: BillingBatch): string {
  return `sample-handover-${batch.facilityId}-${batch.month}.csv`;
}

export const BILLING_MONTHS: readonly string[] = ["2026-10", "2026-11"];
