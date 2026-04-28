"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";

// TOTP challenge for an already-enrolled user. Elevates AAL1 → AAL2.
export default function MfaChallengePage() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowser();
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") {
        router.replace("/dashboard");
        return;
      }
      const { data } = await supabase.auth.mfa.listFactors();
      const totp = data?.totp?.find((f) => f.status === "verified");
      if (!totp) { router.replace("/mfa/enrol"); return; }
      setFactorId(totp.id);
    })();
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true); setError(null);
    const supabase = getSupabaseBrowser();
    const { data: chal, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr || !chal) { setError(cErr?.message ?? "Challenge failed"); setBusy(false); return; }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: chal.id, code });
    if (vErr) { setBusy(false); setError(vErr.message); return; }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel !== "aal2") {
      setBusy(false);
      setError("MFA verification succeeded, but the session was not elevated. Please try again.");
      return;
    }
    // Full-page navigation — see login/page.tsx for why router.push races the cookie write.
    window.location.assign("/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={onSubmit} className="card w-full max-w-md space-y-5">
        <h1 className="text-2xl font-semibold">Two-factor code</h1>
        <p className="text-text-secondary text-sm">Enter the 6-digit code from your authenticator app.</p>

        {error ? <p className="text-state-danger text-sm">{error}</p> : null}

        <input
          autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
          className="input font-mono text-lg tracking-widest text-center"
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required
        />

        <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6 || !factorId}>
          {busy ? "Verifying…" : "Continue"}
        </button>
      </form>
    </main>
  );
}
