import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import {
  INBOX_DETAIL_SELECT,
  PATIENT_SUMMARY_SELECT,
  documentLabel,
  fundingLabel,
  maskIdentifier,
  serviceLabel,
  type InboxDetailRow,
  type PatientSummary,
} from "@/lib/integrations/access/inbox";
import { ReferralActions } from "./_components/referral-actions";

export const dynamic = "force-dynamic";

const dateTime = new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium", timeStyle: "short" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

export default async function InboxReferralPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await resolveSession();
  if (!session) notFound();
  // Staff + doctor only; admin has no demographic read (same as patient files).
  if (session.role === "admin") notFound();

  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await getSupabaseServer();
  const { data: item } = await supabase
    .from("access_referral_inbox")
    .select(INBOX_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle<InboxDetailRow>();
  if (!item) notFound();

  const patientIds = [item.suggested_patient_id, item.linked_patient_id].filter((v): v is string => Boolean(v));
  const { data: patients } = patientIds.length
    ? await supabase.from("patients").select(PATIENT_SUMMARY_SELECT).in("id", patientIds).returns<PatientSummary[]>()
    : { data: [] as PatientSummary[] };
  const suggested = patients?.find((p) => p.id === item.suggested_patient_id && p.status === "active") ?? null;
  const linked = patients?.find((p) => p.id === item.linked_patient_id) ?? null;

  // POPIA access logging: opening the referral shows the patient's details.
  const h = await headers();
  await writeAudit({
    actorUserId: session.userId,
    actorRole: session.role,
    action: "access_referral_view",
    entityType: "access_referral_inbox",
    entityId: item.id,
    patientId: item.linked_patient_id,
    metadata: { reference: item.reference, surface: "inbox_detail" },
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  });

  return (
    <div className="space-y-4">
      <Link href="/referrals" prefetch={false} className="text-sm text-text-secondary hover:text-accent-teal">
        ← Referral inbox
      </Link>

      <header className="card space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span className="font-mono">{item.reference}</span>
          <span>·</span>
          <span>ACCESS {item.access_case_reference}</span>
          {item.data_mode === "synthetic" ? (
            <span className="px-2 py-0.5 rounded bg-state-warning/20 text-state-warning uppercase tracking-wide">
              Test data
            </span>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold break-words">
          {item.patient_family_name}, {item.patient_given_name}
        </h1>
        <p className="text-text-secondary text-sm">
          Referred by {item.referrer_name}
          {item.requested_service ? ` for ${serviceLabel(item.requested_service)}` : ""}. Delivered{" "}
          {dateTime.format(new Date(item.delivered_at))}.
        </p>
      </header>

      <section className="card">
        <h2 className="section-title mb-4">Referral</h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Fact label="Date of birth">{item.patient_date_of_birth}</Fact>
          <Fact label="ID or passport number">{item.patient_identifier ?? "Not supplied"}</Fact>
          <Fact label="Referred by">{item.referrer_name}</Fact>
          <Fact label="Referral date">{item.referral_date ?? "Not stated"}</Fact>
          <Fact label="Requested service">{serviceLabel(item.requested_service) ?? "Not stated"}</Fact>
          <Fact label="Funding">{fundingLabel(item.funding_type, item.funding_scheme)}</Fact>
          <Fact label="Received by ACCESS">{dateTime.format(new Date(item.received_at))}</Fact>
          <Fact label="Documents held by ACCESS">
            {item.documents_held.length ? item.documents_held.map(documentLabel).join(", ") : "None"}
          </Fact>
        </dl>
        {item.reason ? (
          <div className="mt-4">
            <div className="label">Reason given</div>
            <p className="whitespace-pre-wrap break-words">{item.reason}</p>
          </div>
        ) : null}
        <p className="mt-4 text-xs text-text-secondary">
          ACCESS keeps the referral documents. Ask for the letter if it is needed before the first visit.
        </p>
      </section>

      {item.status === "pending" ? (
        <ReferralActions
          inboxId={item.id}
          reference={item.reference}
          suggested={
            suggested
              ? {
                  id: suggested.id,
                  fileNumber: suggested.file_number,
                  name: `${suggested.surname}, ${suggested.first_names}`,
                  maskedId: maskIdentifier(suggested.id_number),
                }
              : null
          }
        />
      ) : (
        <section className="card space-y-1">
          <h2 className="section-title">
            {item.status === "accepted" ? "Linked to a patient file" : "Declined"}
          </h2>
          {item.status === "accepted" && linked ? (
            <p>
              <Link href={`/patients/${linked.id}`} prefetch={false} className="text-accent-teal hover:underline">
                {linked.file_number} · {linked.surname}, {linked.first_names}
              </Link>
            </p>
          ) : null}
          {item.status === "declined" && item.decline_reason ? (
            <p className="whitespace-pre-wrap break-words">{item.decline_reason}</p>
          ) : null}
          {item.resolved_at ? (
            <p className="text-xs text-text-secondary">{dateTime.format(new Date(item.resolved_at))}</p>
          ) : null}
        </section>
      )}
    </div>
  );
}
