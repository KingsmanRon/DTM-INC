"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";

// Next 15 static-prerenders this route by default. useSearchParams() is a
// client-only hook that has no value at prerender time, so the caller must
// sit inside a <Suspense> boundary. The outer page is the suspense host;
// LoginForm is the inner component that actually reads the `next` param.

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
  const next = params.get("next") ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    router.push(next);
  }

  return (
    <LoginShell
      email={email}
      password={password}
      busy={busy}
      error={error}
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
    onEmail = () => {},
    onPassword = () => {},
    onSubmit = (e) => e.preventDefault(),
  } = props;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">DTM Inc.</h1>
          <p className="text-text-secondary text-sm">Sign in to continue. Staff access only.</p>
        </div>

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
          Doctor and admin accounts require MFA (TOTP). You will be prompted on first sign-in.
        </p>

        <p className="text-text-secondary text-xs pt-4 border-t border-border-subtle">
          This is a POPIA-protected system. All access is logged.
          Information Officer: Dr. Thomas Mtshali (registered with the SA Information Regulator).
        </p>
      </form>
    </main>
  );
}
