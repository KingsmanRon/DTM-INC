import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AuthError, requireRole } from "@/lib/auth/session";
import { BillingClient } from "./_components/billing-client";

export const dynamic = "force-dynamic";

// Billing export is a reception/clinician function: doctor + staff only
// (admin has no demographic read). The nav entry is gated to the same roles;
// typing the URL as admin lands here and is turned away (and audited via
// requireRole's access_denied write), so nav visibility and access agree.
export default async function BillingPage() {
  try {
    await requireRole(["doctor", "staff"]);
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold mb-1">Monthly billing export</h1>
        <p className="text-text-secondary text-sm">
          Build a hospital&rsquo;s outgoing batch for the billing company, then download a
          spreadsheet with file numbers, ID/passport and medical aid numbers filled in
          automatically.
        </p>
      </section>

      {/* The selectors read URL search params, so the interactive client must sit
          inside a Suspense boundary or the production build fails (Next 15). */}
      <Suspense fallback={<p className="text-text-secondary text-sm">Loading billing export…</p>}>
        <BillingClient />
      </Suspense>
    </div>
  );
}
