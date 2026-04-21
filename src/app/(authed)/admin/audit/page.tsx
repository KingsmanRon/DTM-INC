import { notFound } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export default async function AuditPage() {
  const session = await resolveSession();
  if (!session || session.role !== "admin") notFound();

  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("audit_logs")
    .select("id, actor_user_id, actor_role, action, entity_type, entity_id, patient_id, ip_address, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <p className="text-text-secondary text-sm">
        Append-only, hash-chained. The daily verifier job walks the chain end-to-end (§10.5).
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-secondary">
              <th className="py-2 pr-3">Time</th>
              <th className="pr-3">Action</th>
              <th className="pr-3">Role</th>
              <th className="pr-3">Entity</th>
              <th className="pr-3">Patient</th>
              <th className="pr-3">IP</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border-subtle">
                <td className="py-2 pr-3">{new Date(r.created_at).toISOString()}</td>
                <td className="pr-3">{r.action}</td>
                <td className="pr-3">{r.actor_role}</td>
                <td className="pr-3">{r.entity_type}{r.entity_id ? `/${r.entity_id.slice(0, 8)}` : ""}</td>
                <td className="pr-3">{r.patient_id?.slice(0, 8) ?? "—"}</td>
                <td className="pr-3">{r.ip_address ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
