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
    const digits = q.replace(/\D/g, "");

    // PostgREST `.or(...)` uses `,` as clause separator and `.` as field
    // separator; `(`, `)`, and `"` are also reserved. Wrap values in `"..."`
    // and escape `\` and `"` inside so user-supplied strings can never break
    // out of the value position and inject a synthetic clause.
    //   e.g. q = `","id.gt.00000000-0000-0000-0000-000000000000`
    //        becomes `"\",\"id.gt.00000000..."` — one harmless literal.
    const escape = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    const like = escape(`%${q}%`);
    const filePrefix = escape(`${q}%`);

    const conditions = [
      `file_number.ilike.${filePrefix}`,
      `surname.ilike.${like}`,
      `first_names.ilike.${like}`,
      `id_number.ilike.${like}`,
    ];
    if (digits.length >= 4) conditions.push(`phone.ilike.${escape(`%${digits}`)}`);

    // `active_patients` is a security_invoker view defined in migration 0004
    // — filters `archived_at IS NULL` in one place so we don't scatter that
    // predicate across the codebase (per review §active_patients).
    const { data, error } = await supabase
      .from("active_patients")
      .select("id, file_number, title, first_names, surname, id_number, phone, status, updated_at")
      .or(conditions.join(","))
      .order("updated_at", { ascending: false })
      .limit(10);

    if (error) return jsonOk({ data: [], error: error.message });
    void session;
    return jsonOk({ data });
  } catch (err) {
    return handleRouteError(err);
  }
}
