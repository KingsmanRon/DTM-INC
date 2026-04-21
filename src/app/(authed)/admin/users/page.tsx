import { notFound } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export default async function UsersPage() {
  const session = await resolveSession();
  if (!session || session.role !== "admin") notFound();

  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("app_users")
    .select("id, email, full_name, status, mfa_enabled, last_login_at, roles:role_id(name)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="text-text-secondary text-sm">
        Invite, activate, deactivate. MFA is mandatory for doctor and admin roles.
      </p>
      <div className="card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-secondary">
              <th className="py-2 pr-3">Email</th>
              <th className="pr-3">Name</th>
              <th className="pr-3">Role</th>
              <th className="pr-3">Status</th>
              <th className="pr-3">MFA</th>
              <th className="pr-3">Last login</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u) => {
              const role = Array.isArray(u.roles) ? u.roles[0]?.name : (u.roles as { name: string } | null)?.name;
              return (
                <tr key={u.id} className="border-t border-border-subtle">
                  <td className="py-2 pr-3 font-mono">{u.email}</td>
                  <td className="pr-3">{u.full_name}</td>
                  <td className="pr-3 uppercase text-xs">{role}</td>
                  <td className="pr-3">{u.status}</td>
                  <td className="pr-3">{u.mfa_enabled ? "✓" : "—"}</td>
                  <td className="pr-3 text-xs text-text-secondary">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "never"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
