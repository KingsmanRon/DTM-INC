import type { Metadata } from "next";
import { DemoExperience } from "./_components/demo-experience";

export const metadata: Metadata = {
  title: "DTM Inc. | Guided product tour",
  description:
    "A guided demonstration of DTM Inc. duplicate prevention, patient onboarding, document attachment and clinical note workflows.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

const CHAPTERS: Record<string, number> = {
  duplicates: 0,
  onboarding: 1,
  documents: 2,
  "clinical-notes": 3,
};

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ chapter?: string | string[] }> }) {
  const query = await searchParams;
  const requested = Array.isArray(query.chapter) ? query.chapter[0] : query.chapter;
  const initialChapter = requested ? (CHAPTERS[requested] ?? 0) : 0;
  return <DemoExperience initialChapter={initialChapter} />;
}
