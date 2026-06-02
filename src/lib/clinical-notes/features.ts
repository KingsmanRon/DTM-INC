import { getServerEnv } from "@/lib/env";

export type HandwrittenNotesFeatures = {
  enabled: boolean;
  doctorIds: ReadonlySet<string>;
  finaliseEnabled: boolean;
  pdfEnabled: boolean;
};

export function getHandwrittenNotesFeatures(): HandwrittenNotesFeatures {
  const env = getServerEnv();
  return {
    enabled: env.FEATURE_HANDWRITTEN_NOTES,
    doctorIds: new Set(
      env.FEATURE_HANDWRITTEN_NOTES_DOCTOR_IDS
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    ),
    finaliseEnabled: env.FEATURE_HANDWRITTEN_NOTES_FINALISE,
    pdfEnabled: env.FEATURE_HANDWRITTEN_NOTES_PDF,
  };
}

export function canUseHandwrittenNotes(doctorId: string): boolean {
  const features = getHandwrittenNotesFeatures();
  return features.enabled && features.doctorIds.has(doctorId);
}
