"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { PublicEnv } from "@/lib/env";
import { Branding } from "@/lib/branding";

// TOTP enrolment flow.
// Supabase returns a qr_code (SVG data URI) and a secret on enrol(). We
// render the QR, have the user scan it in Authenticator / 1Password, then
// call verify() with a fresh 6-digit code to elevate to AAL2.
export default function MfaEnrolPage() {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseBrowser();
      const siteUrl = resolveClientSiteUrl();
      if (!siteUrl) {
        setError("MFA enrolment cannot start: site URL is not configured correctly.");
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (process.env.NODE_ENV !== "production") {
        console.info("[mfa-enrol:init]", {
          hasSupabaseUrl: Boolean(PublicEnv.supabaseUrl),
          hasPublicKey: Boolean(PublicEnv.supabaseAnonKey),
          hasSession: Boolean(session),
        });
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (verified) {
        if (aal?.currentLevel === "aal2") {
          router.replace("/dashboard");
          return;
        }
        router.replace("/mfa/challenge");
        return;
      }

      const staleUnverified = factors?.totp?.find((f) => f.status !== "verified");
      if (staleUnverified) {
        await supabase.auth.mfa.unenroll({ factorId: staleUnverified.id });
      }

      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: Branding.mfaIssuer,
        friendlyName: Branding.mfaIssuer,
      });
      if (error) { setError(error.message); return; }
      if (data.type !== "totp") { setError("Unexpected MFA factor type"); return; }
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    })();
  }, [router]);

  async function onVerify(e: React.FormEvent) {
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
    setBusy(false);
    // AAL2 obtained. Flip app_users.mfa_enabled so admin reports are accurate.
    await fetch("/api/v1/auth/mfa/mark-enrolled", { method: "POST", credentials: "same-origin" });
    // Full-page navigation so the AAL2 cookie is attached on the next request.
    window.location.assign("/dashboard");
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={onVerify} className="card w-full max-w-md space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Enrol two-factor auth</h1>
          <p className="text-text-secondary text-sm">
            Required for doctor and admin accounts. Scan the QR with 1Password, Authy, or Google Authenticator.
          </p>
        </div>

        {error ? <p className="text-state-danger text-sm">{error}</p> : null}

        {qr ? (
          <div className="bg-white p-4 rounded flex justify-center">
            <img src={qr} alt="TOTP QR code" className="w-48 h-48" />
          </div>
        ) : (
          <p className="text-text-secondary text-sm">Generating QR…</p>
        )}

        {secret ? (
          <p className="text-xs text-text-secondary">
            Can&apos;t scan? Enter this secret manually: <span className="font-mono">{secret}</span>
          </p>
        ) : null}

        <div>
          <label className="label" htmlFor="code">6-digit code from your app</label>
          <input id="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                 className="input font-mono text-lg tracking-widest text-center"
                 value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
        </div>

        <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6}>
          {busy ? "Verifying…" : "Verify and continue"}
        </button>
      </form>
    </main>
  );
}

function resolveClientSiteUrl(): string | null {
  const configured = PublicEnv.siteUrl?.trim();
  if (configured && configured !== "undefined" && configured !== "null") return configured;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return null;
}
