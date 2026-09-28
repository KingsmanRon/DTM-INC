import type { NextRequest } from "next/server";
import { z } from "zod";
import { FileNumberFormat } from "@/lib/validation/file-number";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { invalidatePracticeSettings } from "@/lib/practice/settings";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Anyone authenticated can READ settings — the header/footer need them.
// Only admin can WRITE.
export async function GET() {
  try {
    await requireRole(["doctor", "staff", "admin"]);
    const supabase = await getSupabaseServer();
    const { data, error } = await supabase.from("practice_settings").select("*").eq("id", 1).single();
    if (error) return jsonError(500, "db_error", error.message);
    return jsonOk(data);
  } catch (err) {
    return handleRouteError(err);
  }
}

const Patch = z.object({
  practice_name: z.string().min(1).optional(),
  practice_tagline: z.string().optional(),
  practice_number: z.string().optional(),
  doctor_name: z.string().optional(),
  doctor_qualifications: z.string().optional(),
  practice_address: z.string().optional(),
  practice_phone: z.string().optional(),
  logo_path: z.string().optional(),
  file_number_prefix: z.string().regex(/^[A-Z]{2,5}$/).optional(),
  file_number_format: FileNumberFormat.optional(),
  active_consent_version: z.string().optional(),
  active_consent_body: z.string().optional(),
  // Section G summary cards (0051) — presentation copy for the wizard,
  // deliberately outside the hashed/versioned consent body.
  consent_cards: z
    .array(
      z.object({
        badge: z.string().min(1).max(3),
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(2_000),
      })
    )
    .max(10)
    .optional(),
  information_officer_name: z.string().optional(),
  information_officer_email: z.string().email().optional(),
  privacy_notice_body: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireRole("admin");
    const patch = await parseJson(req, Patch);

    const supabase = await getSupabaseServer();
    const { error } = await supabase
      .from("practice_settings")
      .update({ ...patch, updated_by: session.userId })
      .eq("id", 1);
    if (error) return jsonError(500, "db_error", error.message);

    // Drop the cached copy so the header/settings reflect the change immediately.
    invalidatePracticeSettings();

    await writeAudit({
      actorUserId: session.userId,
      actorRole: "admin",
      action: "practice_settings_update",
      entityType: "practice_settings",
      entityId: "1",
      metadata: { changed_fields: Object.keys(patch) },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ ok: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
