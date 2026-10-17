import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthError, requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import {
  INBOX_LIST_SELECT,
  INBOX_RESOLVED_SELECT,
  serviceLabel,
  type InboxListRow,
  type InboxResolvedRow,
} from "@/lib/integrations/access/inbox";

export const dynamic = "force-dynamic";

const dateTime = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" });

function SyntheticBadge({ mode }: { mode: "synthetic" | "real" }) {
  if (mode !== "synthetic") return null;
  return (
    <span className="px-2 py-0.5 rounded bg-state-warning/20 text-state-warning text-xs uppercase tracking-wide">
      Test data
    </span>
  );
}

// Referrals delivered by ACCESS wait here until reception links each one to
// a patient file or declines it. Doctor + staff (the same audience as patient
// demographics); admin is turned away like on /billing.
export default async function ReferralInboxPage() {
  try {
    await requireRole(["doctor", "staff"]);
  } catch (err) {
    if (err instanceof AuthError) notFound();
    throw err;
  }

  const supabase = await getSupabaseServer();
  const [{ data: pending }, { data: resolved }] = await Promise.all([
    supabase
      .from("access_referral_inbox")
      .select(INBOX_LIST_SELECT)
      .eq("status", "pending")
      .order("delivered_at", { ascending: true })
      .limit(200)
      .returns<InboxListRow[]>(),
    supabase
      .from("access_referral_inbox")
      .select(INBOX_RESOLVED_SELECT)
      .in("status", ["accepted", "declined"])
      .order("resolved_at", { ascending: false })
      .limit(20)
      .returns<InboxResolvedRow[]>(),
  ]);

  const waiting = pending ?? [];
  const done = resolved ?? [];

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold mb-1">Referral inbox</h1>
        <p className="text-text-secondary text-sm max-w-2xl">
          Referrals sent by ACCESS. Open each one, link it to the patient&rsquo;s file, or decline it.
          A new patient is onboarded first, in person, then the referral is linked to their new file.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="section-title">
          Waiting <span className="text-text-secondary font-normal">({waiting.length})</span>
        </h2>
        {waiting.length === 0 ? (
          <p className="card text-text-secondary text-sm">No referrals are waiting.</p>
        ) : (
          <ul className="bg-surface-elevated border border-border-subtle rounded-xl divide-y divide-border-subtle overflow-hidden">
            {waiting.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/referrals/${r.id}`}
                  prefetch={false}
                  className="flex flex-col gap-1 px-4 py-3 hover:bg-bg-primary transition-colors sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-medium break-words">
                      {r.patient_family_name}, {r.patient_given_name}{" "}
                      <span className="text-text-secondary font-normal text-sm">born {r.patient_date_of_birth}</span>
                    </div>
                    <div className="text-xs text-text-secondary">
                      From {r.referrer_name}
                      {r.requested_service ? ` · ${serviceLabel(r.requested_service)}` : ""}
                      {r.suggested_patient_id ? " · possible existing file" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-secondary sm:shrink-0">
                    <SyntheticBadge mode={r.data_mode} />
                    <span className="font-mono">{r.reference}</span>
                    <span>{dateTime.format(new Date(r.delivered_at))}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {done.length > 0 ? (
        <section className="space-y-2">
          <h2 className="section-title">Recently handled</h2>
          <ul className="bg-surface-elevated border border-border-subtle rounded-xl divide-y divide-border-subtle overflow-hidden text-sm">
            {done.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/referrals/${r.id}`}
                  prefetch={false}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 hover:bg-bg-primary transition-colors"
                >
                  <span className="break-words">
                    {r.patient_family_name}, {r.patient_given_name}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-text-secondary">
                    <SyntheticBadge mode={r.data_mode} />
                    <span className={r.status === "accepted" ? "text-state-success" : "text-text-secondary"}>
                      {r.status === "accepted" ? "Linked to file" : "Declined"}
                    </span>
                    <span className="font-mono">{r.reference}</span>
                    <span>{dateTime.format(new Date(r.resolved_at))}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
