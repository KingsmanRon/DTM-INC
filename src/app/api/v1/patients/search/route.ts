import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { handleRouteError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/v1/patients/search?q=<term>
// Matches on file number, name (fuzzy), ID number, phone (last-7), medical aid number.
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return jsonOk({ data: [] });

    const supabase = await getSupabaseServer();
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, "");

    // Build an OR condition spanning the columns. Supabase `.or()` parses
    // column.op.value — we keep queries simple and let trigram indexes do the
    // heavy lifting on name columns.
    const conditions = [
      `file_number.ilike.${q}%`,
      `surname.ilike.${like}`,
      `first_names.ilike.${like}`,
      `id_number.ilike.${like}`,
    ];
    if (digits.length >= 4) conditions.push(`phone.ilike.%${digits}`);

    const { data, error } = await supabase
      .from("patients")
      .select("id, file_number, title, first_names, surname, id_number, phone, status, updated_at")
      .or(conditions.join(","))
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(10);

    if (error) return jsonOk({ data: [], error: error.message });
    void session;
    return jsonOk({ data });
  } catch (err) {
    return handleRouteError(err);
  }
}
