import { notFound } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { UsersAdmin, type AdminUserRow } from "./_components/users-admin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await resolveSession();
  if (!session || session.role !== "admin") notFound();

  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from("app_users")
    .select("id, email, full_name, status, mfa_enabled, last_login_at, roles:role_id(name)")
    .order("created_at", { ascending: false });

  const users: AdminUserRow[] = (data ?? []).map((u) => {
    const role = Array.isArray(u.roles)
      ? (u.roles[0] as { name: string } | undefined)?.name ?? null
      : (u.roles as { name: string } | null)?.name ?? null;
    return {
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      status: u.status,
      mfa_enabled: u.mfa_enabled,
      last_login_at: u.last_login_at,
      role,
    };
  });

  return <UsersAdmin users={users} currentUserId={session.userId} />;
}
