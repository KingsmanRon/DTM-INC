"use client";

import { Callout } from "@/app/demo/_interactive/kit/Badge";
import type { Patient } from "@/app/demo/_interactive/types";
import { PatientPicker, SceneHead } from "../common";
import { useDemo } from "../DemoProvider";
import { DocumentsPanel } from "../panels/DocumentsPanel";
import { NotesPanel } from "../panels/NotesPanel";

function useSelectedPatient(activeOnly: boolean): {
  patients: readonly Patient[];
  selected: Patient | undefined;
  choose: (id: string) => void;
  selectedId: string | null;
} {
  const { model, patientId, navigate } = useDemo();
  const patients = activeOnly ? model.patients.filter((p) => p.recordStatus === "active") : model.patients;
  const found = patientId ? model.patients.find((p) => p.id === patientId) : undefined;
  const selected = found && (!activeOnly || found.recordStatus === "active") ? found : patients[0];
  return { patients, selected, selectedId: selected?.id ?? null, choose: (id) => navigate({ patientId: id }) };
}

export function DocumentsScene() {
  const { patients, selected, selectedId, choose } = useSelectedPatient(false);
  return (
    <div className="stack-lg">
      <SceneHead
        eyebrow="Patient registry and documents"
        title="Documents"
        lead="Referral letters, medical aid cards, identity copies and consent forms stay with the patient, with a history of every change."
      />
      <div className="card card--pad">
        <PatientPicker patients={patients} value={selectedId} onChange={choose} />
      </div>
      {selected ? <DocumentsPanel key={selected.id} patient={selected} /> : null}
    </div>
  );
}

export function NotesScene() {
  const { patients, selected, selectedId, choose } = useSelectedPatient(true);
  return (
    <div className="stack-lg">
      <SceneHead
        eyebrow="Clinical notes"
        title="Clinical notes"
        lead="Save, finalise, amend and void notes without ever losing what was originally written."
      />
      <Callout tone="info" icon="info">
        This section exists for the Doctor role only. Switch to Reception or the Administrator and it
        disappears completely: the notes are not part of their view.
      </Callout>
      <div className="card card--pad">
        <PatientPicker patients={patients} value={selectedId} onChange={choose} />
      </div>
      {selected ? <NotesPanel key={selected.id} patient={selected} /> : null}
    </div>
  );
}
