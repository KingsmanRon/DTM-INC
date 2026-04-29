"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type AdminUserRow = {
  id: string;
  email: string;
  full_name: string;
  status: "active" | "deactivated" | "pending_invite";
  mfa_enabled: boolean;
  last_login_at: string | null;
  role: string | null;
};

const ROLES = ["staff", "doctor", "admin"] as const;

export function UsersAdmin({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<typeof ROLES[number]>("staff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/admin/users/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, full_name: fullName, role }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.message ?? j?.error ?? "Could not invite user.");
      return;
    }
    setEmail(""); setFullName(""); setRole("staff"); setOpen(false);
    router.refresh();
  }

  async function toggleStatus(u: AdminUserRow) {
    if (u.id === currentUserId) return;
    const action = u.status === "active" ? "deactivate" : "activate";
    if (action === "deactivate" && !confirm(`Deactivate ${u.email}? They will be signed out and bounced to /unauthorised on next request.`)) return;
    setPendingId(u.id);
    setError(null);
    const res = await fetch(`/api/v1/admin/users/${u.id}/${action}`, {
      method: "POST", credentials: "same-origin",
    });
    setPendingId(null);
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.message ?? j?.error ?? `Could not ${action} user.`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <button className="btn-primary" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "Invite user"}
        </button>
      </div>
      <p className="text-text-secondary text-sm">
        Invite, activate, deactivate. MFA is mandatory for doctor and admin roles.
      </p>

      {open ? (
        <form onSubmit={submitInvite} className="card space-y-3">
          <h2 className="section-title">Invite user</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Full name</label>
              <input
                className="input"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Role</label>
              <select
                className="input"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof ROLES[number])}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-xs text-text-secondary">
            Supabase will email a confirmation link. The user sets a password and signs in via the
            normal login + MFA flow. Doctor and admin invites must complete TOTP enrolment on first
            sign-in.
          </p>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy || !email || !fullName}>
              {busy ? "Sending invite…" : "Send invite"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : null}

      {error ? <p className="text-state-danger text-sm">{error}</p> : null}

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
              <th className="pr-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              const pending = pendingId === u.id;
              return (
                <tr key={u.id} className="border-t border-border-subtle">
                  <td className="py-2 pr-3 font-mono">{u.email}</td>
                  <td className="pr-3">{u.full_name}</td>
                  <td className="pr-3 uppercase text-xs">{u.role}</td>
                  <td className="pr-3">{u.status}</td>
                  <td className="pr-3">{u.mfa_enabled ? "✓" : "—"}</td>
                  <td className="pr-3 text-xs text-text-secondary">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : "never"}
                  </td>
                  <td className="pr-3 text-right">
                    {isSelf ? (
                      <span className="text-xs text-text-secondary">you</span>
                    ) : u.status === "active" ? (
                      <button
                        className="btn-secondary text-xs"
                        disabled={pending}
                        onClick={() => toggleStatus(u)}
                      >
                        {pending ? "…" : "Deactivate"}
                      </button>
                    ) : (
                      <button
                        className="btn-secondary text-xs"
                        disabled={pending}
                        onClick={() => toggleStatus(u)}
                      >
                        {pending ? "…" : "Activate"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
