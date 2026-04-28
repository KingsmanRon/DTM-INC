"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseBrowser } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    // The redirectTo URL is the *only* place the recovery email knows where
    // to send the user after Supabase verifies the token. Point it at the
    // PKCE callback with next=/reset-password so the user lands on the
    // set-new-password form with a valid session cookie.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setSent(true);
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Forgot password</h1>
          <p className="text-text-secondary text-sm">
            Enter your email and we&apos;ll send a recovery link.
          </p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <p className="text-state-success text-sm">
              If an account exists for <strong>{email}</strong>, a recovery email is on the way.
              Check your inbox.
            </p>
            <Link href="/login" className="btn-secondary w-full text-center">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" autoComplete="email"
                     value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            {error ? <p className="text-state-danger text-sm">{error}</p> : null}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? "Sending…" : "Send recovery email"}
            </button>

            <p className="text-text-secondary text-xs">
              <Link href="/login" className="hover:text-accent-teal">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
