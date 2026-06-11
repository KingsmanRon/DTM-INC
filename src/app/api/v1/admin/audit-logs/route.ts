import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireRole("admin");
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    const action = url.searchParams.get("action");
    const patientId = url.searchParams.get("patient_id");

    const supabase = await getSupabaseServer();
    // Ordered by chain_position (0048) — the chain's true insertion order —
    // with one extra row to derive hasMore without a count.
    let q = supabase
      .from("audit_logs")
      .select("id, actor_user_id, actor_role, action, entity_type, entity_id, patient_id, metadata_json, ip_address, created_at, occurred_at, chain_position")
      .order("chain_position", { ascending: false })
      .range(offset, offset + limit);
    if (action) q = q.eq("action", action);
    if (patientId) q = q.eq("patient_id", patientId);

    const { data, error } = await q;
    if (error) return jsonError(500, "db_error", error.message);
    const rows = data ?? [];
    const hasMore = rows.length > limit;
    return jsonOk({ data: hasMore ? rows.slice(0, limit) : rows, hasMore });
  } catch (err) {
    return handleRouteError(err);
  }
}
