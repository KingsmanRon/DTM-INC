import { notFound } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import { AuditLogViewer } from "./_components/audit-log-viewer";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await resolveSession();
  if (!session || session.role !== "admin") notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="text-text-secondary text-sm">
        Append-only, hash-chained. The daily verifier job walks the chain incrementally; a full
        walk runs via the internal route with <code>?full=true</code> (§10.5). Filter by action or
        patient, expand a row for its metadata.
      </p>
      <AuditLogViewer />
    </div>
  );
}
