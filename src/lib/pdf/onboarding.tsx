// Server-side PDF generation of the onboarding pack (§FR-10).
// Uses @react-pdf/renderer. Layout mirrors the paper carbon form, so
// reception can hand the PDF to the third-party claims processor
// (§14 rule 10 — no integration; manual delivery).
import { Document, Page, Text, View, Image, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

// The letterhead logo arrives as INPUT (input.logo) — resolved by
// src/lib/pdf/logo.ts (practice-brand storage override -> bundled fallback)
// in the route, never read at module load. The PNG typically contains the
// practice name/tagline, so the header avoids duplicating that text.

const BRAND_DARK = "#1d4d3a";
const BRAND_ACCENT = "#2d7d5e";
const RULE = "#cbd5e1";
const MUTED = "#4b5563";

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 10, lineHeight: 1.4, color: "#111" },

  header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6 },
  logo: { width: 140, height: 105, objectFit: "contain", marginRight: 16 },
  headerInfo: { flex: 1, paddingTop: 4, paddingRight: 14 },
  doctorLine: { fontSize: 10, fontWeight: 700, color: BRAND_DARK },
  practiceMeta: { fontSize: 9, color: MUTED, marginTop: 2 },

  fileBox: { borderWidth: 1, borderColor: BRAND_DARK, padding: 6, width: 130, alignItems: "center", marginTop: 4 },
  fileLabel: { fontSize: 7, color: BRAND_DARK, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 },
  fileNo: { fontSize: 11, fontWeight: 700, fontFamily: "Courier", marginTop: 2 },

  rule: { borderBottomWidth: 2, borderBottomColor: BRAND_DARK, marginTop: 8, marginBottom: 4 },
  ruleThin: { borderBottomWidth: 0.5, borderBottomColor: BRAND_ACCENT, marginBottom: 12 },

  sectionTitle: {
    fontSize: 10, fontWeight: 700, color: "#fff", backgroundColor: BRAND_DARK,
    paddingVertical: 4, paddingHorizontal: 6, marginTop: 12, marginBottom: 6,
    letterSpacing: 0.6, textTransform: "uppercase",
  },

  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 140, color: MUTED },
  value: { flex: 1, fontWeight: 700 },

  consentBox: { borderWidth: 1, borderColor: RULE, borderLeftWidth: 3, borderLeftColor: BRAND_ACCENT, padding: 8, marginTop: 6 },
  consentMeta: { fontSize: 8, color: MUTED, marginTop: 4 },

  footer: {
    position: "absolute", left: 36, right: 36, bottom: 18,
    flexDirection: "row", justifyContent: "space-between",
    fontSize: 8, color: MUTED, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 6,
  },
});

export type OnboardingPdfInput = {
  logo: Buffer;
  practice: {
    name: string; tagline: string; practiceNumber: string;
    doctorName: string; qualifications: string;
    address: string; phone: string;
  };
  fileNumber: string;
  patient: Record<string, string | null>;
  responsible: Record<string, string | null> | null;
  medicalAid: Record<string, string | null> | null;
  contacts: Array<Record<string, string | null>>;
  referral: Record<string, string | null> | null;
  dependants: Array<Record<string, string | null>>;
  consent: {
    version: string; hash: string;
    acceptedBy: string; acceptedAt: string;
    signatureType: string; signatureValue: string;
  } | null;
};

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || "—"}</Text>
    </View>
  );
}

export function OnboardingPdfDoc(input: OnboardingPdfInput) {
  const { logo, practice, fileNumber, patient, responsible, medicalAid, contacts, referral, dependants, consent } = input;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image, not an HTML img */}
          <Image src={{ data: logo, format: "png" }} style={styles.logo} />
          <View style={styles.headerInfo}>
            <Text style={styles.doctorLine}>{practice.doctorName} — {practice.qualifications}</Text>
            <Text style={styles.practiceMeta}>{practice.address}</Text>
            <Text style={styles.practiceMeta}>Tel: {practice.phone}    PR. No. {practice.practiceNumber}</Text>
          </View>
          <View style={styles.fileBox}>
            <Text style={styles.fileLabel}>File / Computer No.</Text>
            <Text style={styles.fileNo}>{fileNumber}</Text>
          </View>
        </View>
        <View style={styles.rule} fixed />
        <View style={styles.ruleThin} fixed />

        <Text style={styles.sectionTitle}>A · Patient details</Text>
        <Row label="Hospital" value={patient.hospital} />
        <Row label="Title" value={patient.title} />
        <Row label="First names" value={patient.first_names} />
        <Row label="Surname" value={patient.surname} />
        <Row label="ID / Passport" value={patient.id_number} />
        <Row label="Email" value={patient.email} />
        <Row label="Tel / Cell" value={patient.phone} />
        <Row label="Physical address" value={patient.address} />

        <Text style={styles.sectionTitle}>B · Person responsible for account</Text>
        {responsible ? (
          <>
            <Row label="Title" value={responsible.title} />
            <Row label="First names" value={responsible.first_names} />
            <Row label="Surname" value={responsible.surname} />
            <Row label="ID number" value={responsible.id_number} />
            <Row label="Date of birth" value={responsible.date_of_birth} />
            <Row label="Marital status" value={responsible.marital_status} />
            <Row label="Tel / Cell" value={responsible.phone} />
            <Row label="Home address" value={responsible.home_address} />
            <Row label="Employer" value={responsible.employer_name} />
            <Row label="Occupation" value={responsible.occupation} />
            <Row label="Work address" value={responsible.work_address} />
            <Row label="Work tel" value={responsible.work_phone} />
          </>
        ) : <Text>—</Text>}

        <Text style={styles.sectionTitle}>C · Medical aid</Text>
        {medicalAid ? (
          <>
            <Row label="Main member" value={medicalAid.main_member_name} />
            <Row label="Medical aid" value={medicalAid.medical_aid_name} />
            <Row label="Membership no." value={medicalAid.membership_number} />
            <Row label="Plan" value={medicalAid.plan} />
            <Row label="Other / hospital plan" value={medicalAid.other_plan_detail} />
          </>
        ) : <Text>Private payer</Text>}

        <Text style={styles.sectionTitle}>D · Nearest family / friend</Text>
        {contacts[0] ? (
          <>
            <Row label="Name" value={contacts[0].name} />
            <Row label="Relationship" value={contacts[0].relationship} />
            <Row label="Tel / Cell" value={contacts[0].phone} />
            <Row label="Email" value={contacts[0].email} />
            <Row label="Address" value={contacts[0].address} />
          </>
        ) : <Text>—</Text>}

        <Text style={styles.sectionTitle}>E · Referred by</Text>
        {referral ? (
          <>
            <Row label="Type" value={referral.referrer_type} />
            <Row label="Name" value={referral.referrer_name} />
            <Row label="Telephone" value={referral.referrer_phone} />
          </>
        ) : <Text>Self</Text>}

        <Text style={styles.sectionTitle}>F · Dependants on medical aid</Text>
        {dependants.length === 0 ? <Text>None</Text> : dependants.map((d, i) => (
          <View key={i} style={{ marginBottom: 3 }}>
            <Text>{d.name} · {d.sex} · DOB {d.date_of_birth} · Code {d.dependant_code}</Text>
            {d.allergies ? <Text style={{ fontSize: 8, color: MUTED }}>Allergies: {d.allergies}</Text> : null}
          </View>
        ))}

        <Text style={styles.sectionTitle}>G · Consent and declaration</Text>
        <View style={styles.consentBox}>
          {consent ? (
            <>
              <Text>Signed by: {consent.signatureValue}</Text>
              <Text style={styles.consentMeta}>Accepted at {consent.acceptedAt} by staff user {consent.acceptedBy}</Text>
              <Text style={styles.consentMeta}>Consent version {consent.version} · hash {consent.hash.slice(0, 16)}…</Text>
              <Text style={styles.consentMeta}>Signature type: {consent.signatureType}</Text>
            </>
          ) : <Text>No consent on record</Text>}
        </View>

        <View style={styles.footer} fixed>
          <Text>{practice.name} · POPIA-protected · File {fileNumber}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderOnboardingPdf(input: OnboardingPdfInput): Promise<Buffer> {
  // OnboardingPdfDoc returns a <Document> at runtime, but TS types the
  // element by the component's props (OnboardingPdfInput), not by what
  // it returns. renderToBuffer wants ReactElement<DocumentProps> — cast
  // through the function's actual parameter type so future signature
  // changes re-surface here instead of silently widening.
  const el = React.createElement(OnboardingPdfDoc, input) as unknown as Parameters<typeof renderToBuffer>[0];
  return renderToBuffer(el);
}

// Suppress unused import lint
void Font;
