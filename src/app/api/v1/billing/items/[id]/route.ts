import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { writeAudit } from "@/lib/audit/log";
import { clientIp, handleRouteError, jsonError, jsonOk, parseJson } from "@/lib/api/http";
import { UpdateItemPayload } from "@/lib/validation/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ItemRow = {
  id: string;
  patient_id: string;
  hospital: string;
  export_month: string;
  status: "pending" | "exported" | "returned";
  outgoing_date: string | null;
  returned_date: string | null;
  exported_at: string | null;
};

const ITEM_SELECT =
  "id, patient_id, hospital, export_month, status, outgoing_date, returned_date, exported_at";

// PATCH /api/v1/billing/items/[id] — inline-edit the shared outgoing date and/or
// the returned date for a staged row. Updating an existing row only (the row is
// staged first), so this never inserts and cannot create a duplicate. Doctor + staff.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;
    const payload = await parseJson(req, UpdateItemPayload);

    const supabase = await getSupabaseServer();
    const { data: current, error: readErr } = await supabase
      .from("billing_export_items")
      .select(ITEM_SELECT)
      .eq("id", id)
      .maybeSingle<ItemRow>();
    if (readErr) return jsonError(500, "db_error", readErr.message);
    if (!current) return jsonError(404, "not_found");

    const update: Record<string, string | null> = {
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    };

    if (payload.outgoing_date !== undefined) {
      update.outgoing_date = payload.outgoing_date === "" ? null : payload.outgoing_date;
    }

    let markedReturned = false;
    if (payload.returned_date !== undefined) {
      const returned = payload.returned_date === "" ? null : payload.returned_date;
      update.returned_date = returned;
      if (returned) {
        update.status = "returned";
        markedReturned = current.status !== "returned";
      } else {
        // Clearing the returned date reverts the lifecycle marker.
        update.status = current.exported_at ? "exported" : "pending";
      }
    }

    const { data: updated, error: updErr } = await supabase
      .from("billing_export_items")
      .update(update)
      .eq("id", id)
      .select(ITEM_SELECT)
      .maybeSingle<ItemRow>();
    if (updErr) return jsonError(500, "update_failed", updErr.message);
    if (!updated) return jsonError(404, "not_found");

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: markedReturned ? "billing_export_mark_returned" : "billing_export_item_update",
      entityType: "billing_export_items",
      entityId: id,
      patientId: current.patient_id,
      metadata: {
        change: markedReturned ? "mark_returned" : "edit_dates",
        hospital: current.hospital,
        export_month: current.export_month,
        outgoing_date: updated.outgoing_date,
        returned_date: updated.returned_date,
        status: updated.status,
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ item: updated });
  } catch (err) {
    return handleRouteError(err);
  }
}

// DELETE /api/v1/billing/items/[id] — remove a still-pending row from the batch
// (un-stage). Exported rows are kept for the disclosure record. Doctor + staff.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const { id } = await params;

    const supabase = await getSupabaseServer();
    const { data: deleted, error } = await supabase
      .from("billing_export_items")
      .delete()
      .eq("id", id)
      .eq("status", "pending")
      .select(ITEM_SELECT)
      .maybeSingle<ItemRow>();
    if (error) return jsonError(500, "delete_failed", error.message);
    if (!deleted) {
      return jsonError(409, "not_removable", "Only pending (not yet exported) rows can be removed.");
    }

    await writeAudit({
      actorUserId: session.userId,
      actorRole: session.role,
      action: "billing_export_item_update",
      entityType: "billing_export_items",
      entityId: id,
      patientId: deleted.patient_id,
      metadata: {
        change: "remove",
        hospital: deleted.hospital,
        export_month: deleted.export_month,
      },
      ipAddress: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });

    return jsonOk({ removed: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
