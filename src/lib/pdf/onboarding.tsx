// Server-side PDF generation of the onboarding pack (§FR-10).
// Uses @react-pdf/renderer. Layout mirrors the paper carbon form, so
// reception can hand the PDF to the third-party claims processor
// (§14 rule 10 — no integration; manual delivery).
import { Document, Page, Text, View, StyleSheet, Font, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

const styles = StyleSheet.create({
  page: { padding: 32, fontFamily: "Helvetica", fontSize: 10, lineHeight: 1.4 },
  header: { flexDirection: "row", borderBottom: "1 solid #000", paddingBottom: 8, marginBottom: 12 },
  practiceName: { fontSize: 14, fontWeight: 700 },
  practiceTag: { fontSize: 9, color: "#444" },
  practiceMeta: { fontSize: 8, color: "#444", marginTop: 2 },
  fileBox: { border: "1 solid #000", padding: 6, minWidth: 180, alignItems: "center" },
  fileLabel: { fontSize: 7, color: "#444" },
  fileNo: { fontSize: 13, fontWeight: 700, fontFamily: "Courier" },
  sectionTitle: { fontSize: 11, fontWeight: 700, backgroundColor: "#eee", padding: 4, marginTop: 10, marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 140, color: "#333" },
  value: { flex: 1, fontWeight: 700 },
  consentBox: { border: "1 solid #000", padding: 8, marginTop: 8 },
  consentMeta: { fontSize: 8, color: "#444", marginTop: 4 },
});

export type OnboardingPdfInput = {
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
  const { practice, fileNumber, patient, responsible, medicalAid, contacts, referral, dependants, consent } = input;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.practiceName}>{practice.name}</Text>
            <Text style={styles.practiceTag}>{practice.tagline}</Text>
            <Text style={styles.practiceMeta}>{practice.doctorName} — {practice.qualifications}</Text>
            <Text style={styles.practiceMeta}>{practice.address}</Text>
            <Text style={styles.practiceMeta}>Tel: {practice.phone}   PR. No. {practice.practiceNumber}</Text>
          </View>
          <View style={styles.fileBox}>
            <Text style={styles.fileLabel}>FILE / COMPUTER NO.</Text>
            <Text style={styles.fileNo}>{fileNumber}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>A · Patient details</Text>
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
            {d.allergies ? <Text style={{ fontSize: 8, color: "#444" }}>Allergies: {d.allergies}</Text> : null}
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
      </Page>
    </Document>
  );
}

export async function renderOnboardingPdf(input: OnboardingPdfInput): Promise<Buffer> {
  const element = React.createElement(OnboardingPdfDoc, input);
  // renderToBuffer expects a Document element.
  return renderToBuffer(element as unknown as React.ReactElement);
}

// Suppress unused import lint
void Font;
