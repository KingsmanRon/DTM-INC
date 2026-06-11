// Server-side PDF of a patient's clinical notes (Phase 5).
//
// Typed notes render as flowing text on the leading page. Finalised handwritten
// notes embed their durable PNG, each on its OWN page, sized to preserve the
// image's true aspect ratio (never stretched). Draft handwriting shows a
// placeholder in the flow, because a server-side PDF has no image to embed until
// the note is finalised (the PNG is only captured at finalisation — see
// migration 0028).
import { Document, Page, Text, View, Image, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import React from "react";

// The letterhead logo arrives as INPUT (input.logo) — resolved by
// src/lib/pdf/logo.ts (practice-brand storage override -> bundled fallback)
// in the route, never read at module load.

const BRAND_DARK = "#1d4d3a";
const BRAND_ACCENT = "#2d7d5e";
const RULE = "#cbd5e1";
const MUTED = "#4b5563";

// A4 printable area (595.28 x 841.89pt minus this page's padding). Used to fit
// a handwriting image to its page while preserving aspect ratio.
const IMG_MAX_W = 523;
const IMG_MAX_H = 690;

// Read a PNG's pixel dimensions straight from the IHDR chunk so the embed can
// preserve aspect ratio without trusting @react-pdf's auto-height (the source of
// the old multi-page stretch). Returns null for anything that isn't a PNG.
function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

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
  slimHeader: { marginBottom: 4 },
  inkPageBody: { alignItems: "center", marginTop: 4 },
  placeholder: { fontSize: 9, color: MUTED, marginTop: 4 },
  footer: {
    position: "absolute", left: 36, right: 36, bottom: 18,
    flexDirection: "row", justifyContent: "space-between",
    fontSize: 8, color: MUTED, borderTopWidth: 0.5, borderTopColor: RULE, paddingTop: 6,
  },
});

export type ClinicalNotesPdfInput = {
  logo: Buffer;
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
  // When the export is scoped to a single date, shown alongside the title.
  dateLabel?: string;
};

export function ClinicalNotesPdfDoc(input: ClinicalNotesPdfInput) {
  const { logo, practice, fileNumber, patientName, notes, dateLabel } = input;
  // Finalised handwriting (has a durable PNG) gets its own page; everything
  // else — typed notes and draft handwriting placeholders — flows on the lead.
  const flowNotes = notes.filter((n) => !n.inkPng);
  const imageNotes = notes.filter((n) => n.inkPng);

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

        <Text style={styles.title}>Clinical notes — {patientName}{dateLabel ? ` · ${dateLabel}` : ""}</Text>

        {notes.length === 0 ? (
          <Text>No clinical notes on record{dateLabel ? ` for ${dateLabel}` : ""}.</Text>
        ) : (
          <>
            {flowNotes.map((n, i) => (
              <View key={i} style={styles.note}>
                <View style={styles.noteHead}>
                  <Text style={styles.noteDate}>{n.note_date}</Text>
                  <Text style={styles.badge}>{n.is_finalised ? "Finalised" : "Unfinalised"}</Text>
                </View>
                {n.body ? n.body.split("\n").map((line, j) => <Text key={j}>{line || " "}</Text>) : null}
                {n.hasInk ? (
                  <Text style={styles.placeholder}>[Handwritten draft — finalise the note to include the handwriting in the record.]</Text>
                ) : null}
              </View>
            ))}
            {flowNotes.length === 0 && imageNotes.length > 0 ? (
              <Text style={styles.placeholder}>
                Handwritten note{imageNotes.length > 1 ? "s" : ""} on the following page{imageNotes.length > 1 ? "s" : ""}.
              </Text>
            ) : null}
          </>
        )}

        <View style={styles.footer} fixed>
          <Text>{practice.name} · POPIA-protected · File {fileNumber}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {imageNotes.map((n, i) => {
        const png = n.inkPng as Buffer;
        const dim = pngDimensions(png);
        // Fit-to-page while preserving the source ratio. min() of both axes
        // guarantees the whole image fits without any disproportionate scaling.
        const scale = dim ? Math.min(IMG_MAX_W / dim.width, IMG_MAX_H / dim.height) : 1;
        const displayW = dim ? dim.width * scale : IMG_MAX_W;
        const displayH = dim ? dim.height * scale : IMG_MAX_H;
        return (
          <Page key={`ink-${i}`} size="A4" style={styles.page}>
            <View style={styles.slimHeader}>
              <Text style={styles.doctorLine}>{practice.doctorName} — {practice.qualifications}</Text>
              <Text style={styles.practiceMeta}>
                {patientName} · File {fileNumber} · {n.note_date} · {n.is_finalised ? "Finalised" : "Unfinalised"}
              </Text>
            </View>
            <View style={styles.ruleThin} />
            <View style={styles.inkPageBody}>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer Image, not an HTML img */}
              <Image src={{ data: png, format: "png" }} style={{ width: displayW, height: displayH }} />
            </View>
            <View style={styles.footer} fixed>
              <Text>{practice.name} · POPIA-protected · File {fileNumber}</Text>
              <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
            </View>
          </Page>
        );
      })}
    </Document>
  );
}

export async function renderClinicalNotesPdf(input: ClinicalNotesPdfInput): Promise<Buffer> {
  const el = React.createElement(ClinicalNotesPdfDoc, input) as unknown as Parameters<typeof renderToBuffer>[0];
  return renderToBuffer(el);
}
