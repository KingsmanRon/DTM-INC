import type { Metadata } from "next";
import { DemoExperience } from "./_components/demo-experience";

export const metadata: Metadata = {
  title: "DTM Inc. | Guided product tour",
  description:
    "A guided demonstration of DTM Inc. patient onboarding, records, billing and audit workflows.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default function DemoPage() {
  return <DemoExperience />;
}
