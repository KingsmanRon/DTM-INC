import type { SupabaseClient } from "@supabase/supabase-js";

export type PatientBundle = {
  patient: Record<string, string | null>;
  responsible: Record<string, string | null> | null;
  medical_aid: Record<string, string | null> | null;
  contacts: Array<Record<string, string | null>>;
  referral: Record<string, string | null> | null;
  dependants: Array<Record<string, string | null>>;
  consent?: Record<string, string | null> | null;
};

type EmbeddedRow = Record<string, unknown> & {
  patient_account_responsible?: unknown;
  patient_medical_aid?: unknown;
  patient_emergency_contacts?: unknown;
  patient_referrals?: unknown;
  patient_dependants?: unknown;
  consent_records?: unknown;
};

function firstRecord(value: unknown): Record<string, string | null> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, string | null> | undefined) ?? null;
  return (value as Record<string, string | null> | null | undefined) ?? null;
}

function records(value: unknown): Array<Record<string, string | null>> {
  if (!Array.isArray(value)) return [];
  return value as Array<Record<string, string | null>>;
}

function byCreatedAtDesc(a: Record<string, string | null>, b: Record<string, string | null>): number {
  return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
}

// One RLS-preserving PostgREST embedded read for the patient demographics bundle.
// The caller passes the normal cookie-bound Supabase server client, so each
// underlying table remains gated by the authenticated user's RLS policies.
export async function getPatientBundle(
  supabase: SupabaseClient,
  patientId: string,
  options: { includeConsent?: boolean } = {},
): Promise<{ data: PatientBundle | null; error: { message: string } | null }> {
  const select = [
    "*",
    "patient_account_responsible(*)",
    "patient_medical_aid(*)",
    "patient_emergency_contacts(*)",
    "patient_referrals(*)",
    "patient_dependants(*)",
    options.includeConsent ? "consent_records(*)" : null,
  ].filter(Boolean).join(",");

  const { data, error } = await supabase
    .from("patients")
    .select(select)
    .eq("id", patientId)
    .maybeSingle();

  if (error) return { data: null, error: { message: error.message } };
  if (!data) return { data: null, error: null };

  const row = data as unknown as EmbeddedRow;
  const {
    patient_account_responsible,
    patient_medical_aid,
    patient_emergency_contacts,
    patient_referrals,
    patient_dependants,
    consent_records,
    ...patient
  } = row;

  const referrals = records(patient_referrals).sort(byCreatedAtDesc);
  const dependants = records(patient_dependants).filter((d) => d.archived_at == null);
  const consents = records(consent_records).sort((a, b) => String(b.accepted_at ?? "").localeCompare(String(a.accepted_at ?? "")));

  return {
    data: {
      patient: patient as Record<string, string | null>,
      responsible: firstRecord(patient_account_responsible),
      medical_aid: firstRecord(patient_medical_aid),
      contacts: records(patient_emergency_contacts),
      referral: referrals[0] ?? null,
      dependants,
      ...(options.includeConsent ? { consent: consents[0] ?? null } : {}),
    },
    error: null,
  };
}
