"use client";

import { useState } from "react";
import type { AppRole } from "@/lib/auth/session";
import { DemographicsTab } from "./demographics-tab";
import { DocumentsTab } from "./documents-tab";
import { ClinicalNotesTab } from "./clinical-notes-tab";
import type { PatientBundle } from "@/lib/patients/bundle";

// §15 decision #2: the clinical-notes tab is ENTIRELY INVISIBLE to non-doctors.
// We do not render a placeholder, a badge, or any count.
const BASE_TABS = [
  { id: "demographics", label: "Demographics" },
  { id: "documents", label: "Documents" },
] as const;

type TabId = "demographics" | "documents" | "clinical";

export type HospitalOption = { name: string; file_prefix: string };

export function PatientTabs({ patientId, role, handwrittenNotesEnabled, handwrittenFinaliseEnabled, notesPdfEnabled, initialDemographics, hospitals }: { patientId: string; role: AppRole; handwrittenNotesEnabled: boolean; handwrittenFinaliseEnabled: boolean; notesPdfEnabled: boolean; initialDemographics: PatientBundle; hospitals: HospitalOption[] }) {
  const [active, setActive] = useState<TabId>("demographics");

  const tabs = role === "doctor"
    ? [...BASE_TABS, { id: "clinical", label: "Clinical notes" }]
    : BASE_TABS;

  return (
    <div className="space-y-4">
      <nav className="flex gap-1 border-b border-border-subtle">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id as TabId)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              active === t.id
                ? "border-accent-dtm-green text-white"
                : "border-transparent text-text-secondary hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {active === "demographics" && <DemographicsTab patientId={patientId} initialData={initialDemographics} hospitals={hospitals} />}
      {active === "documents" && <DocumentsTab patientId={patientId} />}
      {active === "clinical" && role === "doctor" && <ClinicalNotesTab patientId={patientId} handwrittenNotesEnabled={handwrittenNotesEnabled} handwrittenFinaliseEnabled={handwrittenFinaliseEnabled} notesPdfEnabled={notesPdfEnabled} />}
    </div>
  );
}
