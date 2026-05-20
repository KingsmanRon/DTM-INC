import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";

type QueueRow = {
  id: string;
  patient_id: string;
  queue_number: number;
  queued_at: string | null;
  status: "queued" | "called" | "in_room" | "completed";
  appointment: {
    id: string;
    scheduled_at: string;
    reason: string | null;
  } | null;
  completed_at: string | null;
  patient: {
    first_names: string;
    surname: string;
    file_number: string;
  } | null;
};

function formatDuration(startIso: string | null): string {
  if (!startIso) return "—";
  const diffMs = Date.now() - new Date(startIso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "< 1m";

  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours > 0) return `${hours}h ${remMins}m`;
  return `${Math.max(1, remMins)}m`;
}

function formatAppt(iso: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

async function startConsultation(formData: FormData) {
  "use server";
  const session = await resolveSession();
  if (!session || session.role !== "doctor") notFound();

  const queueId = String(formData.get("queueId") ?? "");
  const supabase = await getSupabaseServer();
  await supabase
    .from("appointment_queue")
    .update({ status: "in_room", in_room_at: new Date().toISOString() })
    .eq("id", queueId)
    .neq("status", "completed");

  revalidatePath("/doctor/queue");
}

async function completeConsultation(formData: FormData) {
  "use server";
  const session = await resolveSession();
  if (!session || session.role !== "doctor") notFound();

  const queueId = String(formData.get("queueId") ?? "");
  const supabase = await getSupabaseServer();
  await supabase
    .from("appointment_queue")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", queueId);

  revalidatePath("/doctor/queue");
}

export default async function DoctorQueuePage() {
  const session = await resolveSession();
  if (!session || session.role !== "doctor") notFound();

  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from("appointment_queue")
    .select("id, patient_id, queue_number, queued_at, status, completed_at, appointment:appointments(id,scheduled_at,reason), patient:patients(first_names,surname,file_number)")
    .in("status", ["queued", "called", "in_room", "completed"])
    .order("queue_number", { ascending: true })
    .returns<QueueRow[]>();

  if (error) {
    return (
      <div className="card">
        <h1 className="text-2xl font-semibold mb-2">Doctor queue</h1>
        <p className="text-sm text-state-danger">Unable to load queue right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Doctor queue</h1>
          <p className="text-text-secondary text-sm">Patients waiting, arrived, in consultation, and completed.</p>
        </div>
      </header>

      {(!data || data.length === 0) ? (
        <div className="card text-text-secondary text-sm">No patients currently in queue.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((ticket) => (
            <article key={ticket.id} className="card space-y-3">
              <div className="flex items-center justify-between">
                <span className="file-number text-sm">Queue #{ticket.queue_number}</span>
                <span className="px-2 py-1 rounded text-xs bg-surface-muted border border-border-subtle">{ticket.status}</span>
              </div>

              <div>
                <h2 className="text-lg font-medium">
                  {ticket.patient?.surname}, {ticket.patient?.first_names}
                </h2>
                <p className="text-sm text-text-secondary">File: {ticket.patient?.file_number ?? "—"}</p>
              </div>

              <dl className="text-sm space-y-1">
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Appointment</dt>
                  <dd>{formatAppt(ticket.appointment?.scheduled_at ?? ticket.queued_at ?? new Date().toISOString())}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Reason</dt>
                  <dd className="text-right">{ticket.appointment?.reason ?? "General consultation"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-text-secondary">Waiting duration</dt>
                  <dd>{formatDuration(ticket.queued_at)}</dd>
                </div>
              </dl>

              <div className="flex flex-wrap gap-2">
                <form action={startConsultation}>
                  <input type="hidden" name="queueId" value={ticket.id} />
                  <button className="btn-secondary" disabled={ticket.status === "in_room" || ticket.status === "completed"}>
                    Start consultation
                  </button>
                </form>

                <form action={completeConsultation}>
                  <input type="hidden" name="queueId" value={ticket.id} />
                  <button className="btn-primary" disabled={ticket.status === "completed"}>
                    Complete consultation
                  </button>
                </form>

                <Link className="btn-secondary" href={`/patients/${ticket.patient_id}`}>
                  Open patient record
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
