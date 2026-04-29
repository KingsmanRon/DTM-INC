import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveSession } from "@/lib/auth/session";
import { resolveMfa } from "@/lib/auth/mfa";
import { getSupabaseServer } from "@/lib/supabase/server";
import { LogoutButton } from "./_components/logout-button";

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const session = await resolveSession();
  if (!session) redirect("/login");

  // FR-1: doctor + admin cannot reach authenticated routes without MFA.
  const mfa = await resolveMfa(session.role);
  if (mfa.action === "enrol") redirect("/mfa/enrol");
  if (mfa.action === "challenge") redirect("/mfa/challenge");

  const supabase = await getSupabaseServer();
  const { data: settings } = await supabase
    .from("practice_settings")
    .select("practice_name, information_officer_name")
    .eq("id", 1)
    .maybeSingle();

  const practiceName = settings?.practice_name ?? "DTM Inc.";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border-subtle bg-surface-elevated">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-6">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent-dtm-green flex items-center justify-center">
              <span className="text-white font-bold text-sm">D</span>
            </div>
            <span className="font-semibold">{practiceName}</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="hover:text-accent-teal">Dashboard</Link>
            {session.role === "doctor" || session.role === "staff" ? (
              <Link href="/patients/new" className="hover:text-accent-teal">New patient</Link>
            ) : null}
            {session.role === "admin" ? (
              <>
                <Link href="/admin/users" className="hover:text-accent-teal">Users</Link>
                <Link href="/admin/audit" className="hover:text-accent-teal">Audit</Link>
                <Link href="/admin/settings" className="hover:text-accent-teal">Settings</Link>
              </>
            ) : null}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-text-secondary">
            <span>{session.fullName}</span>
            <span className="px-2 py-0.5 text-xs rounded bg-bg-primary border border-border-subtle uppercase tracking-wide">
              {session.role}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">{children}</main>

      <footer className="border-t border-border-subtle text-xs text-text-secondary">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap gap-4 justify-between">
          <span>POPIA-protected · Information Officer: {settings?.information_officer_name ?? "Dr. Thomas Mtshali"}</span>
          <Link href="/privacy" className="hover:text-accent-teal">Privacy notice</Link>
        </div>
      </footer>
    </div>
  );
}
