"use client";

import { useState } from "react";
import { Badge, Callout } from "@/app/demo/_interactive/kit/Badge";
import { Button } from "@/app/demo/_interactive/kit/Button";
import { Dialog } from "@/app/demo/_interactive/kit/Dialog";
import { Icon } from "@/app/demo/_interactive/kit/Icon";
import { SelectField } from "@/app/demo/_interactive/kit/Fields";
import { BRAND } from "@/app/demo/_interactive/brand";
import { FACILITIES, facilityById } from "@/app/demo/_interactive/fixtures/practice";
import { BATCH_STATUS_LABEL, BILLING_MONTHS, buildHandoverCsv, handoverFileName } from "@/app/demo/_interactive/state/billing";
import { derivePayerLabel } from "@/app/demo/_interactive/state/billing";
import { can } from "@/app/demo/_interactive/state/permissions";
import type { BatchStatus, BillingBatch, BillingItem, FacilityId } from "@/app/demo/_interactive/types";
import { formatDate, formatMonth, pluralise } from "@/app/demo/_interactive/kit/format";
import { SceneHead } from "../common";
import { useDemo } from "../DemoProvider";

const STATUS_TONE: Record<BatchStatus, "warn" | "info" | "teal" | "success"> = {
  preparing: "warn",
  ready: "info",
  handed_over: "teal",
  returned: "success",
};

function PayerCell({ item }: { item: Pick<BillingItem, "payerKind" | "payerLabel"> }) {
  if (item.payerKind === "cash") return <Badge>CASH</Badge>;
  if (item.payerKind === "missing") return <Badge tone="warn" icon="alert">Missing</Badge>;
  return <span className="mono">{item.payerLabel}</span>;
}

function downloadCsv(batch: BillingBatch) {
  const blob = new Blob([buildHandoverCsv(batch)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = handoverFileName(batch);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function BillingScene() {
  const { model, act, announce } = useDemo();
  const [facilityId, setFacilityId] = useState<FacilityId>("jhb");
  const [month, setMonth] = useState<string>(BILLING_MONTHS[0] ?? "2026-10");
  const [selected, setSelected] = useState<string[]>([]);
  const [exportOf, setExportOf] = useState<BillingBatch | null>(null);

  const canManage = can(model.role, "billing.manage");
  const batch = model.batches.find((b) => b.facilityId === facilityId && b.month === month);
  const inBatch = new Set(batch?.items.map((i) => i.patientId));
  const candidates = model.patients.filter((p) => p.recordStatus === "active" && p.facilityId === facilityId && !inBatch.has(p.id));
  const editable = !batch || batch.status === "preparing";
  const missing = batch?.items.filter((i) => i.payerKind === "missing").length ?? 0;
  const history = [...model.batches].sort((a, b) => b.month.localeCompare(a.month) || b.createdAt.localeCompare(a.createdAt));

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const allSelected = candidates.length > 0 && candidates.every((c) => selected.includes(c.id));

  const add = () => {
    const ids = selected.filter((id) => candidates.some((c) => c.id === id));
    if (ids.length === 0) return;
    act({ type: "billing/add", facilityId, month, patientIds: ids });
    announce(`${pluralise(ids.length, "file")} added to the ${formatMonth(month)} batch for ${facilityById(facilityId).name}.`);
    setSelected([]);
  };

  const openExport = (b: BillingBatch) => {
    setExportOf(b);
    act({ type: "progress/mark", key: "exportGenerated" });
  };

  return (
    <div className="stack-lg">
      <SceneHead
        eyebrow="Billing File Tracking"
        title={BRAND.features.billingTracking.label}
        lead="Group patient files into a monthly batch for each hospital and track the handover to your external billing provider."
      />

      <Callout tone="teal" icon="info" title="What this is, and what it is not">
        {BRAND.features.billingTracking.scopeStatement} Your external billing provider performs the actual billing and
        claims processing.
      </Callout>

      <section className="card card--pad" aria-labelledby="batch-setup-title">
        <h2 id="batch-setup-title" className="card__title">Choose a batch</h2>
        <div className="form-grid form-grid--2 mt">
          <SelectField name="billing.facility" label="Hospital" value={facilityId} onChange={(e) => { setFacilityId(e.target.value as FacilityId); setSelected([]); }}>
            {FACILITIES.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </SelectField>
          <SelectField name="billing.month" label="Month" value={month} onChange={(e) => { setMonth(e.target.value); setSelected([]); }}>
            {BILLING_MONTHS.map((m) => (
              <option key={m} value={m}>{formatMonth(m)}</option>
            ))}
          </SelectField>
        </div>
      </section>

      <div className="billing-grid">
        <section className="card card--pad" aria-labelledby="candidates-title">
          <h2 id="candidates-title" className="card__title">Patient files at this hospital</h2>
          <p className="card__lead">Active patients not yet in the {formatMonth(month)} batch.</p>
          {!editable ? (
            <Callout tone="warn" icon="lock" className="mt">
              This batch is already {BATCH_STATUS_LABEL[batch!.status].toLowerCase()}, so files can no longer be added.
            </Callout>
          ) : candidates.length === 0 ? (
            <div className="empty mt"><strong>Every active file is already in the batch</strong></div>
          ) : (
            <>
              <div className="row mt-sm">
                <Button size="sm" variant="ghost" onClick={() => setSelected(allSelected ? [] : candidates.map((c) => c.id))}>
                  {allSelected ? "Clear selection" : "Select all"}
                </Button>
                <span className="fine-print">{selected.length} selected</span>
              </div>
              <ul className="pick-list" aria-label="Candidate patient files">
                {candidates.map((p) => {
                  const payer = derivePayerLabel(p.payer);
                  return (
                    <li key={p.id}>
                      <label className="choice">
                        <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} disabled={!canManage} />
                        <span className="pick__text">
                          <span className="choice__title">{p.surname}, {p.firstNames}</span>
                          <span className="choice__text mono">{p.fileNumber}</span>
                        </span>
                        <PayerCell item={{ payerKind: payer.kind, payerLabel: payer.label }} />
                      </label>
                    </li>
                  );
                })}
              </ul>
              <div className="row mt">
                <Button variant="primary" icon="plus" onClick={add} disabled={!canManage || selected.length === 0}>
                  Add selected to batch
                </Button>
              </div>
            </>
          )}
        </section>

        <section className="card card--pad" aria-labelledby="batch-title">
          <div className="panel-head">
            <div>
              <h2 id="batch-title" className="card__title">
                {formatMonth(month)} · {facilityById(facilityId).name}
              </h2>
              <p className="card__lead">{batch ? pluralise(batch.items.length, "file") : "No batch yet. Add files to create it."}</p>
            </div>
            {batch ? <Badge tone={STATUS_TONE[batch.status]}>{BATCH_STATUS_LABEL[batch.status]}</Badge> : null}
          </div>

          {batch && batch.items.length > 0 ? (
            <div className="table-wrap mt">
              <table className="table">
                <caption className="sr-only">Files in the {formatMonth(month)} batch</caption>
                <thead>
                  <tr>
                    <th scope="col">File number</th>
                    <th scope="col">Patient</th>
                    <th scope="col">Medical aid number</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {batch.items.map((item) => (
                    <tr key={item.patientId}>
                      <td data-label="File number" className="mono">{item.fileNumber}</td>
                      <td data-label="Patient">{item.patientName}</td>
                      <td data-label="Medical aid number"><PayerCell item={item} /></td>
                      <td data-label="">
                        {batch.status === "preparing" && canManage ? (
                          <Button size="sm" variant="ghost" icon="x" onClick={() => act({ type: "billing/remove", batchId: batch.id, patientId: item.patientId })} aria-label={`Remove ${item.patientName} from batch`}>
                            Remove
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {missing > 0 ? (
            <Callout tone="warn" icon="alert" className="mt">
              {pluralise(missing, "file")} {missing === 1 ? "has" : "have"} no medical aid number recorded. Correct it on the patient
              record and add the file again. This warns but never blocks the batch.
            </Callout>
          ) : null}

          {batch ? (
            <div className="row mt">
              {batch.status === "preparing" ? (
                <Button
                  variant="primary"
                  icon="check"
                  disabled={!canManage || batch.items.length === 0}
                  onClick={() => { act({ type: "billing/ready", batchId: batch.id }); announce("Batch marked ready for external billing-provider handover."); }}
                >
                  Mark ready for handover
                </Button>
              ) : null}
              {batch.status === "ready" ? (
                <Button
                  variant="primary"
                  icon="arrow-right"
                  disabled={!canManage}
                  onClick={() => { act({ type: "billing/handover", batchId: batch.id }); announce("Handover to the external billing provider recorded."); }}
                >
                  Record handover to billing provider
                </Button>
              ) : null}
              {batch.status === "handed_over" ? (
                <Button
                  variant="primary"
                  icon="check"
                  disabled={!canManage}
                  onClick={() => { act({ type: "billing/returned", batchId: batch.id }); announce("Return of the files recorded."); }}
                >
                  Record files returned
                </Button>
              ) : null}
              <Button icon="download" disabled={batch.items.length === 0} onClick={() => openExport(batch)}>
                Generate sample export
              </Button>
            </div>
          ) : null}
        </section>
      </div>

      <section className="card card--pad" aria-labelledby="history-title">
        <h2 id="history-title" className="card__title">Handover history</h2>
        <p className="card__lead">Every batch, newest month first. Dates are fictional.</p>
        <div className="table-wrap mt">
          <table className="table">
            <caption className="sr-only">Batch handover history</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Hospital</th>
                <th scope="col">Files</th>
                <th scope="col">Status</th>
                <th scope="col">Handed over</th>
                <th scope="col">Returned</th>
              </tr>
            </thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id}>
                  <td data-label="Month">{formatMonth(b.month)}</td>
                  <td data-label="Hospital">{facilityById(b.facilityId).name}</td>
                  <td data-label="Files">{b.items.length}</td>
                  <td data-label="Status"><Badge tone={STATUS_TONE[b.status]}>{BATCH_STATUS_LABEL[b.status]}</Badge></td>
                  <td data-label="Handed over">{b.outgoingAt ? formatDate(b.outgoingAt) : "—"}</td>
                  <td data-label="Returned">{b.returnedAt ? formatDate(b.returnedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={exportOf !== null} onClose={() => setExportOf(null)} title="Sample handover export" wide>
        {exportOf ? (
          <div className="stack">
            <Callout tone="warn" icon="alert" title="Synthetic sample">
              Fictional patients only. This is a list of files for handover, not a claim submission, invoice or tariff
              calculation.
            </Callout>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Export preview</caption>
                <thead>
                  <tr>
                    <th scope="col">File number</th>
                    <th scope="col">Patient (fictional)</th>
                    <th scope="col">Medical aid number</th>
                    <th scope="col">Hospital</th>
                    <th scope="col">Month</th>
                  </tr>
                </thead>
                <tbody>
                  {exportOf.items.map((item) => (
                    <tr key={item.patientId}>
                      <td data-label="File number" className="mono">{item.fileNumber}</td>
                      <td data-label="Patient">{item.patientName}</td>
                      <td data-label="Medical aid number">{item.payerKind === "cash" ? "CASH" : item.payerLabel || "(blank)"}</td>
                      <td data-label="Hospital">{facilityById(exportOf.facilityId).shortName}</td>
                      <td data-label="Month">{formatMonth(exportOf.month)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <Button variant="primary" icon="download" onClick={() => { downloadCsv(exportOf); announce("Sample export downloaded."); }}>
                Download sample CSV
              </Button>
              <Button variant="ghost" onClick={() => setExportOf(null)}>Close</Button>
            </div>
            <p className="fine-print">
              <Icon name="info" className="inline-icon" /> The production product produces a spreadsheet in the format your billing provider expects. This
              demonstration downloads a simple CSV of fictional data.
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
