import { type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { handleRouteError, jsonOk } from "@/lib/api/http";

type LookupPatient = {
  id: string;
  first_names: string;
  surname: string;
  file_number: string | null;
  id_number: string | null;
  passport_number: string | null;
  phone: string | null;
};

type LookupAppointmentRow = {
  id: string;
  scheduled_at: string;
  doctor_id: string;
  patient: LookupPatient[] | null;
};

export async function POST(req: NextRequest) {
  try {
    await requireRole(["doctor", "staff"]);
    const body = (await req.json()) as { date?: string; fileNumber?: string; idNumber?: string; passport?: string; phone?: string };
    const date = body.date ?? new Date().toISOString().slice(0, 10);
    const start = new Date(`${date}T00:00:00.000Z`).toISOString();
    const end = new Date(`${date}T23:59:59.999Z`).toISOString();

    const admin = getSupabaseAdmin();
    let query = admin
      .from("appointments")
      .select("id, scheduled_at, doctor_id, patient:patients(id,first_names,surname,file_number,id_number,passport_number,phone)")
      .gte("scheduled_at", start)
      .lte("scheduled_at", end);

    if (body.fileNumber) query = query.eq("patient.file_number", body.fileNumber);
    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as LookupAppointmentRow[];
    const records = rows.filter((r) => {
      const p = r.patient?.[0];
      if (!p) return false;
      if (body.idNumber && p.id_number !== body.idNumber) return false;
      if (body.passport && p.passport_number !== body.passport) return false;
      if (body.phone && p.phone !== body.phone) return false;
      return true;
    }).map((r) => ({
      appointmentId: r.id,
      patientName: `${r.patient?.[0]?.surname ?? ""}, ${r.patient?.[0]?.first_names ?? ""}`,
      date,
      time: new Date(r.scheduled_at).toISOString().slice(11, 16),
    }));

    return jsonOk({ records });
  } catch (err) {
    return handleRouteError(err);
  }
}
