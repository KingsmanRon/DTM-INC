import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { resolveSession } from "@/lib/auth/session";
import { resolveMfa } from "@/lib/auth/mfa";
import { getSupabaseServer } from "@/lib/supabase/server";
import { LogoutButton } from "./_components/logout-button";
import { InstallHelpLink } from "@/components/InstallHelpLink";

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
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex items-center justify-between gap-3">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
            <Image
              src="/brand/logo.png"
              alt="DTM INC. logo"
              width={40}
              height={40}
              priority
              className="h-10 w-10 rounded-full object-contain"
            />
              <span className="truncate font-semibold">{practiceName}</span>
            </Link>
            <div className="flex items-center gap-2 text-sm text-text-secondary sm:hidden">
              <span className="max-w-[9rem] truncate">{session.fullName}</span>
              <span className="px-2 py-0.5 text-xs rounded bg-bg-primary border border-border-subtle uppercase tracking-wide">
                {session.role}
              </span>
            </div>
          </div>
          <nav className="w-full flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:w-auto">
            <Link href="/dashboard" className="hover:text-accent-teal">Dashboard</Link>
            {session.role === "doctor" || session.role === "staff" ? (
              <Link href="/patients/new" className="hover:text-accent-teal">New patient</Link>
            ) : null}
            {session.role === "admin" ? (
              <>
                <Link href="/admin/users" className="hover:text-accent-teal">Users</Link>
                <Link href="/admin/audit" className="hover:text-accent-teal">Audit</Link>
                <Link href="/admin/settings" className="hover:text-accent-teal">Settings</Link>
                <Link href="/admin/conflicts" className="hover:text-accent-teal">Conflicts</Link>
              </>
            ) : null}
          </nav>
          <div className="hidden sm:ml-auto sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-2 sm:text-sm sm:text-text-secondary">
            <span>{session.fullName}</span>
            <span className="px-2 py-0.5 text-xs rounded bg-bg-primary border border-border-subtle uppercase tracking-wide">
              {session.role}
            </span>
            <LogoutButton />
          </div>
          <div className="flex justify-end sm:hidden">
            <LogoutButton />
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">{children}</main>

      <footer className="border-t border-border-subtle text-xs text-text-secondary">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap gap-4 justify-between">
          <span>POPIA-protected · Information Officer: {settings?.information_officer_name ?? "Dr. Thomas Mtshali"}</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/privacy" className="hover:text-accent-teal">Privacy notice</Link>
            <InstallHelpLink />
          </div>
        </div>
      </footer>
    </div>
  );
}
