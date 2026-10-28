import type { BillingBatch, BillingItem } from "@/app/demo/_interactive/types";
import { SEED_PATIENTS } from "./patients";
import { derivePayerLabel } from "@/app/demo/_interactive/state/billing";

function item(patientId: string, addedAt: string): BillingItem {
  const patient = SEED_PATIENTS.find((p) => p.id === patientId);
  if (!patient) throw new Error(`Unknown patient for seeded billing item: ${patientId}`);
  const payer = derivePayerLabel(patient.payer);
  return {
    patientId,
    fileNumber: patient.fileNumber,
    patientName: `${patient.firstNames} ${patient.surname}`,
    payerKind: payer.kind,
    payerLabel: payer.label,
    addedAt,
  };
}

const RECIPIENT = "External billing provider (sample)";

/**
 * Seeded batches: one returned and one handed over from September, plus an
 * October batch still being prepared. They illustrate the handover history.
 */
export const SEED_BATCHES: readonly BillingBatch[] = [
  {
    id: "b-0001",
    facilityId: "nth",
    month: "2026-09",
    status: "returned",
    createdAt: "2026-09-28T09:00:00+02:00",
    readyAt: "2026-09-30T15:00:00+02:00",
    outgoingAt: "2026-10-01T09:30:00+02:00",
    returnedAt: "2026-10-12T11:15:00+02:00",
    recipient: RECIPIENT,
    items: [
      item("p-0001", "2026-09-28T09:05:00+02:00"),
      item("p-0003", "2026-09-28T09:06:00+02:00"),
      item("p-0007", "2026-09-28T09:07:00+02:00"),
    ],
  },
  {
    id: "b-0002",
    facilityId: "jhb",
    month: "2026-09",
    status: "handed_over",
    createdAt: "2026-09-29T10:00:00+02:00",
    readyAt: "2026-10-01T16:00:00+02:00",
    outgoingAt: "2026-10-02T08:45:00+02:00",
    returnedAt: null,
    recipient: RECIPIENT,
    items: [
      item("p-0002", "2026-09-29T10:05:00+02:00"),
      item("p-0004", "2026-09-29T10:06:00+02:00"),
      item("p-0005", "2026-09-29T10:07:00+02:00"),
    ],
  },
  {
    id: "b-0003",
    facilityId: "jhb",
    month: "2026-10",
    status: "preparing",
    createdAt: "2026-10-27T15:30:00+02:00",
    readyAt: null,
    outgoingAt: null,
    returnedAt: null,
    recipient: RECIPIENT,
    items: [item("p-0009", "2026-10-27T15:34:00+02:00"), item("p-0012", "2026-10-27T15:34:00+02:00")],
  },
];

export const NEXT_BATCH_SEQUENCE = 4;
