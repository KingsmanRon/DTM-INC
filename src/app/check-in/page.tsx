"use client";

import { useMemo, useState } from "react";

type LookupRecord = {
  appointmentId: string;
  patientName: string;
  date: string;
  time: string;
  clinician?: string;
};

type PendingCheckIn = {
  queuedAt: string;
  appointmentId: string;
};

const PENDING_STORAGE_KEY = "dtm.pending-checkins.v1";

export default function CheckInPage() {
  const [fileNumber, setFileNumber] = useState("");
  const [saId, setSaId] = useState("");
  const [passport, setPassport] = useState("");
  const [phone, setPhone] = useState("");

  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [appointments, setAppointments] = useState<LookupRecord[]>([]);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);

  const hasAnyIdentifier = useMemo(
    () => Boolean(fileNumber.trim() || saId.trim() || passport.trim() || phone.trim()),
    [fileNumber, saId, passport, phone]
  );

  async function onLookup(e: React.FormEvent) {
    e.preventDefault();
    setLookupBusy(true);
    setLookupError(null);
    setConfirmationMessage(null);
    setAppointments([]);

    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch("/api/v1/appointments/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: today,
          fileNumber: fileNumber.trim() || undefined,
          idNumber: saId.trim() || undefined,
          passport: passport.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const payload = (await safeJson(res)) as { message?: string } | null;
        throw new Error(payload?.message || "Could not find same-day appointments.");
      }

      const payload = (await res.json()) as { records?: LookupRecord[] };
      setAppointments(payload.records ?? []);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLookupBusy(false);
    }
  }

  async function onConfirmCheckIn(appointmentId: string) {
    setConfirmingId(appointmentId);
    setConfirmationMessage(null);

    try {
      const res = await fetch("/api/v1/appointments/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentId }),
      });

      if (!res.ok) {
        const payload = (await safeJson(res)) as { message?: string } | null;
        throw new Error(payload?.message || "Check-in failed.");
      }

      const payload = (await res.json()) as { queueNumber?: string | number };
      const queueLabel = payload.queueNumber ?? "assigned";
      setConfirmationMessage(`Checked in successfully. Queue number: ${queueLabel}.`);
    } catch {
      queuePendingCheckIn({ appointmentId, queuedAt: new Date().toISOString() });
      setConfirmationMessage(
        "Check-in is pending (offline/network issue). It has been queued and will need syncing."
      );
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Same-day check-in</h1>
        <p className="text-sm text-text-secondary">
          Verify patient identity and find appointments scheduled for today.
        </p>
      </header>

      <form onSubmit={onLookup} className="card space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="fileNumber">File number</label>
            <input id="fileNumber" className="input" value={fileNumber} onChange={(e) => setFileNumber(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="idNumber">South African ID</label>
            <input id="idNumber" className="input" value={saId} onChange={(e) => setSaId(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="passport">Passport</label>
            <input id="passport" className="input" value={passport} onChange={(e) => setPassport(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="phone">Phone</label>
            <input id="phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>

        {lookupError ? <p className="text-sm text-state-danger">{lookupError}</p> : null}

        <button type="submit" className="btn-primary" disabled={!hasAnyIdentifier || lookupBusy}>
          {lookupBusy ? "Looking up…" : "Find today’s appointments"}
        </button>
      </form>

      <section className="card space-y-3">
        <h2 className="text-lg font-medium">Appointments</h2>
        {appointments.length === 0 ? (
          <p className="text-sm text-text-secondary">No records loaded.</p>
        ) : (
          <ul className="space-y-3">
            {appointments.map((row) => (
              <li key={row.appointmentId} className="rounded-lg border border-border-subtle p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{row.patientName}</p>
                  <p className="text-sm text-text-secondary">{row.date} · {row.time}{row.clinician ? ` · ${row.clinician}` : ""}</p>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={Boolean(confirmingId)}
                  onClick={() => onConfirmCheckIn(row.appointmentId)}
                >
                  {confirmingId === row.appointmentId ? "Confirming…" : "Confirm check-in"}
                </button>
              </li>
            ))}
          </ul>
        )}

        {confirmationMessage ? <p className="text-sm text-accent-teal">{confirmationMessage}</p> : null}
      </section>
    </main>
  );
}

function queuePendingCheckIn(entry: PendingCheckIn) {
  if (typeof window === "undefined") return;
  const current = readPendingCheckIns();
  current.push(entry);
  window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(current));
}

function readPendingCheckIns(): PendingCheckIn[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingCheckIn[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
