import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BreakGlassRequest = z.object({
  target_patient_id: z.string().uuid(),
  justification: z.string().min(40, "Justification must be ≥ 40 characters"),
});

// Admin creates a break-glass request to read clinical notes (§10.4).
// 48-hour cool-off. Doctor is notified by email (hook emitted here; actual
// email sent by a separate worker). Only after the cool-off can admin read.
export async function POST(req: NextRequest) {
  try {
    const session = await requireRole("admin");
    const input = await parseJson(req, BreakGlassRequest);

    const coolOff = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("break_glass_requests")
      .insert({
        requester_user_id: session.userId,
        target_patient_id: input.target_patient_id,
        justification: input.justification,
        cool_off_until: coolOff,
      })
      .select("id")
      .single();
    if (error || !data) return jsonError(500, "db_error", error?.message);

    await writeAudit({
      actorUserId: session.userId,
      actorRole: "admin",
      action: "break_glass_request",
      entityType: "break_glass_requests",
      entityId: data.id,
      patientId: input.target_patient_id,
      metadata: { justification_length: input.justification.length, cool_off_until: coolOff },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    // TODO: enqueue doctor-notification email (Supabase Edge Function or Railway worker).

    return jsonOk({ id: data.id, cool_off_until: coolOff }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
