import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BRAND } from "./_interactive/brand";
import { DemoApp } from "./_interactive/ui/DemoApp";
import { parseView } from "./_interactive/view/url";

export const metadata: Metadata = {
  title: `${BRAND.product.name} | Interactive product demo`,
  description:
    "Try DTM Inc. with entirely fictional patients: duplicate prevention, seven-section onboarding, documents, clinical notes, roles, hospitals, billing file tracking and the audit log.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function DemoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  // Links to the original scrolling story (/demo?chapter=...) keep working.
  const chapter = Array.isArray(params.chapter) ? params.chapter[0] : params.chapter;
  if (chapter) redirect(`/demo/story?chapter=${encodeURIComponent(chapter)}`);
  return <DemoApp initialView={parseView(params)} />;
}
