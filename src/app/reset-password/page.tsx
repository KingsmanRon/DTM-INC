"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    const supabase = getSupabaseBrowser();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // Sign out so the next sign-in goes through the normal /login + MFA
    // flow with the new password. Without this, the recovery session stays
    // alive and would let the user reach /dashboard without re-auth.
    await supabase.auth.signOut();
    setBusy(false);
    setDone(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Set a new password</h1>
          <p className="text-text-secondary text-sm">
            Minimum 12 characters. You&apos;ll be asked to sign in again afterwards.
          </p>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="text-state-success text-sm">
              Password updated. Sign in with your new password to continue.
            </p>
            <Link href="/login" className="btn-primary w-full text-center">Go to sign in</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="label" htmlFor="password">New password</label>
              <input id="password" type="password" className="input" autoComplete="new-password"
                     value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>

            <div>
              <label className="label" htmlFor="confirm">Confirm new password</label>
              <input id="confirm" type="password" className="input" autoComplete="new-password"
                     value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>

            {error ? <p className="text-state-danger text-sm">{error}</p> : null}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
