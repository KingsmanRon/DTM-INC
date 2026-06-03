// Server-side PDF of a patient's clinical notes (Phase 5).
//
// Typed notes render as text; finalised handwritten notes embed their durable
// PNG (decrypted by the route). Draft handwriting shows a placeholder, because a
// server-side PDF has no image to embed until the note is finalised (the PNG is
// only captured at finalisation — see migration 0028).
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import fs from "node:fs";
import path from "node:path";
import React from "react";

const LOGO_BUFFER = fs.readFileSync(
  path.join(process.cwd(), "public", "brand", "Dr. T. Mtshali_LOGO - PDF.png"),
);

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
  title: { fontSize: 12, fontWeight: 700, color: BRAND_DARK, marginBottom: 8 },
  note: { borderWidth: 1, borderColor: RULE, borderLeftWidth: 3, borderLeftColor: BRAND_ACCENT, padding: 8, marginBottom: 10 },
  noteHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  noteDate: { fontFamily: "Courier", fontWeight: 700 },
  badge: { fontSize: 8, color: MUTED },
  inkImage: { width: "100%", marginTop: 4 },
  placeholder: { fontSize: 9, color: MUTED, marginTop: 4 },
  footer: {
    position: "absolute", left: 36, right: 36, bottom: 18,
    flexDirection: "row", justifyContent: "space-between",
    fontSize: 8, color: MUTED, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 6,
  },
});

export type ClinicalNotesPdfInput = {
  practice: {
    name: string; doctorName: string; qualifications: string;
    practiceNumber: string; address: string; phone: string;
  };
  fileNumber: string;
  patientName: string;
  notes: Array<{
    note_date: string;
    is_finalised: boolean;
    body: string;
    inkPng: Buffer | null;
    hasInk: boolean;
  }>;
};

export function ClinicalNotesPdfDoc(input: ClinicalNotesPdfInput) {
  const { practice, fileNumber, patientName, notes } = input;
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image, not an HTML img */}
          <Image src={{ data: LOGO_BUFFER, format: "png" }} style={styles.logo} />
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

        <Text style={styles.title}>Clinical notes — {patientName}</Text>

        {notes.length === 0 ? (
          <Text>No clinical notes on record.</Text>
        ) : notes.map((n, i) => (
          <View key={i} style={styles.note}>
            <View style={styles.noteHead}>
              <Text style={styles.noteDate}>{n.note_date}</Text>
              <Text style={styles.badge}>{n.is_finalised ? "Finalised" : "Unfinalised"}</Text>
            </View>
            {n.body ? n.body.split("\n").map((line, j) => <Text key={j}>{line || " "}</Text>) : null}
            {n.inkPng ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image, not an HTML img
              <Image src={{ data: n.inkPng, format: "png" }} style={styles.inkImage} />
            ) : n.hasInk ? (
              <Text style={styles.placeholder}>[Handwritten draft — finalise the note to include the handwriting in the record.]</Text>
            ) : null}
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>{practice.name} · POPIA-protected · File {fileNumber}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderClinicalNotesPdf(input: ClinicalNotesPdfInput): Promise<Buffer> {
  const el = React.createElement(ClinicalNotesPdfDoc, input) as unknown as Parameters<typeof renderToBuffer>[0];
  return renderToBuffer(el);
}
