import type { FacilityId, IdType, Patient, Payer } from "@/app/demo/_interactive/types";
import { formatFileNumber, facilityById } from "./practice";

/**
 * Seeded fictional register. Names are invented; identifiers use the
 * obviously synthetic "SYN-ID-#####" / "SYN-PP-#####" pattern so they can
 * never be mistaken for, or collide with, genuine national ID numbers.
 * Phone numbers are placeholders and emails use the reserved ".test" TLD.
 */

interface SeedInput {
  n: number;
  /** Sequence number within the hospital prefix. */
  seq: number;
  former?: Patient["formerFileNumbers"];
  title: string;
  firstNames: string;
  surname: string;
  dateOfBirth: string;
  idType?: IdType;
  idNumber: string;
  facilityId: FacilityId;
  payer: Payer;
  createdAt: string;
  archived?: boolean;
  referral?: Patient["referral"];
  address: string;
  amendments?: Patient["amendments"];
  assignments?: Patient["assignments"];
}

const SIGNED = "2026-09";

function seed(input: SeedInput): Patient {
  const id = `p-${String(input.n).padStart(4, "0")}`;
  const fullName = `${input.firstNames} ${input.surname}`;
  const emailLocal = `${input.firstNames}.${input.surname}`.toLowerCase().replace(/[^a-z.]/g, "");
  return {
    id,
    fileNumber: formatFileNumber(facilityById(input.facilityId).prefix, input.seq),
    formerFileNumbers: input.former ?? [],
    title: input.title,
    firstNames: input.firstNames,
    surname: input.surname,
    idType: input.idType ?? "id",
    idNumber: input.idNumber,
    dateOfBirth: input.dateOfBirth,
    phone: `000 000 ${String(100 + input.n).padStart(4, "0")}`,
    email: `${emailLocal}@example.test`,
    address: input.address,
    facilityId: input.facilityId,
    recordStatus: input.archived ? "archived" : "active",
    payer: input.payer,
    responsible: {
      sameAsPatient: true,
      name: fullName,
      relationship: "Self",
      idNumber: input.idNumber,
      phone: `000 000 ${String(100 + input.n).padStart(4, "0")}`,
      address: input.address,
    },
    emergency: {
      name: "Sample Contact",
      relationship: "Family member",
      phone: `000 000 ${String(200 + input.n).padStart(4, "0")}`,
      email: "",
    },
    referral: input.referral ?? { source: "self", name: "", phone: "", notes: "" },
    dependants: [],
    consent: {
      agreed: true,
      signedName: fullName,
      wordingVersion: "Sample wording v1",
      capturedAt: `${input.createdAt.slice(0, 10)}T09:00:00+02:00`,
    },
    createdAt: input.createdAt,
    amendments: input.amendments ?? [],
    assignments: input.assignments ?? [
      {
        at: input.createdAt,
        actor: "Lindiwe Sample (Reception)",
        facilityId: input.facilityId,
        note: "Assigned at registration",
      },
    ],
  };
}

const aid = (scheme: string, plan: string, membershipNumber: string): Payer => ({
  kind: "medical_aid",
  scheme,
  plan,
  membershipNumber,
});

export const SEED_PATIENTS: readonly Patient[] = [
  seed({
    n: 1,
    seq: 102,
    title: "Ms",
    firstNames: "Amahle",
    surname: "Nkosi",
    dateOfBirth: "1985-03-12",
    idNumber: "SYN-ID-10001",
    facilityId: "nth",
    payer: aid("Demo Health Scheme", "Core Plan", "DHS-10001-A"),
    createdAt: `${SIGNED}-02T08:30:00+02:00`,
    address: "14 Sample Street, Demoville, 0000",
  }),
  seed({
    n: 2,
    seq: 61,
    title: "Mr",
    firstNames: "Pieter",
    surname: "van der Merwe",
    dateOfBirth: "1972-11-04",
    idNumber: "SYN-ID-10002",
    facilityId: "jhb",
    payer: aid("Sample Medical Society", "Comprehensive", "SMS-20002-B"),
    createdAt: `${SIGNED}-04T10:15:00+02:00`,
    address: "3 Example Road, Sampletown, 0000",
    referral: { source: "gp", name: "Dr Example GP", phone: "000 000 0900", notes: "Referred for specialist review." },
  }),
  seed({
    n: 3,
    seq: 103,
    title: "Mrs",
    firstNames: "Fatima",
    surname: "Hendricks",
    dateOfBirth: "1990-07-23",
    idNumber: "SYN-ID-10003",
    facilityId: "nth",
    payer: { kind: "private" },
    createdAt: `${SIGNED}-08T09:05:00+02:00`,
    address: "22 Placeholder Avenue, Demoville, 0000",
  }),
  seed({
    n: 4,
    seq: 62,
    title: "Mr",
    firstNames: "Sibusiso",
    surname: "Dube",
    dateOfBirth: "1968-01-30",
    idNumber: "SYN-ID-10004",
    facilityId: "jhb",
    payer: aid("Example Medical Aid", "Network Plan", "EMA-40004-C"),
    createdAt: `${SIGNED}-10T11:40:00+02:00`,
    address: "9 Fictional Close, Sampletown, 0000",
    referral: { source: "specialist", name: "Dr Sample Specialist", phone: "000 000 0901", notes: "Ongoing review." },
  }),
  seed({
    n: 5,
    seq: 63,
    title: "Ms",
    firstNames: "Naledi",
    surname: "Mahlangu",
    dateOfBirth: "1979-09-15",
    idNumber: "SYN-ID-10005",
    facilityId: "jhb",
    payer: aid("Demo Health Scheme", "Executive Plan", "DHS-50005-D"),
    createdAt: `${SIGNED}-15T13:20:00+02:00`,
    address: "71 Imaginary Drive, Sampletown, 0000",
    referral: { source: "gp", name: "Dr Example GP", phone: "000 000 0900", notes: "" },
  }),
  seed({
    n: 6,
    seq: 104,
    title: "Mr",
    firstNames: "Kevin",
    surname: "Pillay",
    dateOfBirth: "1994-02-08",
    idNumber: "SYN-ID-10006",
    facilityId: "nth",
    // Membership number intentionally absent: a realistic data gap that the
    // Billing File Tracking scene flags without blocking the batch.
    payer: aid("Sample Medical Society", "Essential Plan", ""),
    createdAt: `${SIGNED}-17T08:50:00+02:00`,
    address: "5 Mock Lane, Demoville, 0000",
    amendments: [
      {
        at: "2026-10-26T09:20:00+02:00",
        actor: "Lindiwe Sample (Reception)",
        field: "Phone number",
        from: "000 000 0099",
        to: "000 000 0106",
      },
    ],
  }),
  seed({
    n: 7,
    seq: 105,
    title: "Ms",
    firstNames: "Zanele",
    surname: "Khumalo",
    dateOfBirth: "2001-05-27",
    idNumber: "SYN-ID-10007",
    facilityId: "nth",
    payer: aid("Example Medical Aid", "Starter Plan", "EMA-70007-E"),
    createdAt: `${SIGNED}-21T14:10:00+02:00`,
    address: "48 Test Crescent, Demoville, 0000",
  }),
  seed({
    n: 8,
    seq: 101,
    title: "Mr",
    firstNames: "Johan",
    surname: "Botha",
    dateOfBirth: "1955-12-19",
    idNumber: "SYN-ID-10008",
    facilityId: "nth",
    payer: { kind: "private" },
    createdAt: `${SIGNED}-01T09:45:00+02:00`,
    address: "2 Sketch Street, Demoville, 0000",
    archived: true,
  }),
  seed({
    n: 9,
    seq: 66,
    title: "Mr",
    firstNames: "Thabo",
    surname: "Molefe",
    dateOfBirth: "1983-06-02",
    idType: "passport",
    idNumber: "SYN-PP-30001",
    facilityId: "jhb",
    payer: aid("Demo Health Scheme", "Core Plan", "DHS-90009-F"),
    createdAt: `${SIGNED}-23T10:00:00+02:00`,
    address: "17 Prototype Park, Sampletown, 0000",
    referral: { source: "hospital", name: "Sample Day Clinic", phone: "000 000 0902", notes: "" },
    former: [{ number: "NTH-2026-000106", facilityId: "nth", retiredAt: "2026-10-27T14:02:00+02:00" }],
    assignments: [
      {
        at: `${SIGNED}-23T10:00:00+02:00`,
        actor: "Lindiwe Sample (Reception)",
        facilityId: "nth",
        note: "Assigned at registration as NTH-2026-000106",
      },
      {
        at: "2026-10-27T14:02:00+02:00",
        actor: "Lindiwe Sample (Reception)",
        facilityId: "jhb",
        note: "Moved from Northfield Demo Hospital to Jubilee Demo Hospital. New file number JHB-2026-000066; NTH-2026-000106 retired",
      },
    ],
  }),
  seed({
    n: 10,
    seq: 107,
    title: "Mrs",
    firstNames: "Lerato",
    surname: "Sithole",
    dateOfBirth: "1976-10-11",
    idNumber: "SYN-ID-10010",
    facilityId: "nth",
    payer: aid("Sample Medical Society", "Classic Plan", "SMS-10010-G"),
    createdAt: `${SIGNED}-25T09:30:00+02:00`,
    address: "60 Dummy Gardens, Demoville, 0000",
  }),
  seed({
    n: 11,
    seq: 64,
    title: "Ms",
    firstNames: "Michelle",
    surname: "Jacobs",
    dateOfBirth: "1988-08-30",
    idNumber: "SYN-ID-10011",
    facilityId: "jhb",
    payer: { kind: "private" },
    createdAt: `${SIGNED}-29T15:05:00+02:00`,
    address: "31 Make-Believe Way, Sampletown, 0000",
  }),
  seed({
    n: 12,
    seq: 65,
    title: "Mr",
    firstNames: "Daniel",
    surname: "Naicker",
    dateOfBirth: "1965-04-21",
    idNumber: "SYN-ID-10012",
    facilityId: "jhb",
    payer: aid("Example Medical Aid", "Network Plan", "EMA-12012-H"),
    createdAt: "2026-10-27T08:15:00+02:00",
    address: "8 Illustration Row, Sampletown, 0000",
    referral: { source: "gp", name: "Dr Example GP", phone: "000 000 0900", notes: "Referral letter on file." },
  }),
];

export const NEXT_PATIENT_SEQUENCE = 13;
