import { notFound } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import { BreakGlassClient } from "./_components/break-glass-client";

export const dynamic = "force-dynamic";

export default async function BreakGlassPage() {
  const session = await resolveSession();
  if (!session || session.role !== "admin") notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Break-glass access</h1>
      <p className="text-text-secondary text-sm">
        Emergency, fully-audited access to a patient&rsquo;s clinical notes when the doctor is
        unavailable (§10.4). Use only when patient care requires it.
      </p>
      <BreakGlassClient />
    </div>
  );
}
