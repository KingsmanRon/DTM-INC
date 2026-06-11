"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { Branding } from "@/lib/branding";

// Next 15 static-prerenders this route by default. useSearchParams() is a
// client-only hook that has no value at prerender time, so the caller must
// sit inside a <Suspense> boundary. The outer page is the suspense host;
// LoginForm is the inner component that actually reads the `next` param.
//
// Sign-in goes through POST /api/v1/auth/login — NOT the browser Supabase
// client — so every success/failure/lockout lands in the hash-chained audit
// log and last_login_at is maintained (review P0#3). The route sets the same
// auth cookies the old client flow did; MFA enrol/challenge work unchanged.

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell disabled />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeRedirectPath(params.get("next"), "/dashboard");
  // The /auth/callback route redirects here with ?error=<message> when PKCE
  // code exchange fails (bad/expired link, replay, missing code). The idle
  // auto-logout lands here with ?reason=idle. Surface both so the user knows
  // why they ended up back on /login.
  const initialError = params.get("error");
  const idleNotice = params.get("reason") === "idle";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;

      if (!res.ok) {
        setBusy(false);
        setError(body?.message ?? "Sign-in failed. Please try again.");
        return;
      }

      router.replace(next);
      router.refresh();
    } catch (err) {
      console.error("[auth-login] unexpected sign-in failure", err);
      setBusy(false);
      setError("Sign-in failed. Please try again.");
    }
  }

  return (
    <LoginShell
      email={email}
      password={password}
      busy={busy}
      error={error}
      idleNotice={idleNotice}
      onEmail={setEmail}
      onPassword={setPassword}
      onSubmit={onSubmit}
    />
  );
}

// The shell is used by both the suspense fallback (disabled) and the live
// form. Keeping layout identical avoids cumulative layout shift on hydrate.
function LoginShell(props: {
  disabled?: boolean;
  email?: string;
  password?: string;
  busy?: boolean;
  error?: string | null;
  idleNotice?: boolean;
  onEmail?: (v: string) => void;
  onPassword?: (v: string) => void;
  onSubmit?: (e: React.FormEvent) => void;
}) {
  const {
    disabled = false,
    email = "",
    password = "",
    busy = false,
    error = null,
    idleNotice = false,
    onEmail = () => {},
    onPassword = () => {},
    onSubmit = (e) => e.preventDefault(),
  } = props;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">{Branding.appName}</h1>
          <p className="text-text-secondary text-sm">Sign in to continue. Staff access only.</p>
        </div>

        {idleNotice ? (
          <p className="text-text-secondary text-sm">
            You were signed out after a period of inactivity. Please sign in again.
          </p>
        ) : null}

        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" type="email" className="input" autoComplete="email"
                 disabled={disabled}
                 value={email} onChange={(e) => onEmail(e.target.value)} required />
        </div>

        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" autoComplete="current-password"
                 disabled={disabled}
                 value={password} onChange={(e) => onPassword(e.target.value)} required />
        </div>

        {error ? <p className="text-state-danger text-sm">{error}</p> : null}

        <button type="submit" className="btn-primary w-full" disabled={disabled || busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-text-secondary text-xs">
          <Link href="/forgot-password" className="hover:text-accent-teal">Forgot password?</Link>
        </p>

        <p className="text-text-secondary text-xs">
          Doctor and admin accounts require MFA (TOTP). You will be prompted on first sign-in.
        </p>

      </form>
    </main>
  );
}
