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
    const prefix = (url.searchParams.get("prefix") ?? "").trim().toUpperCase();
    const hospital = (url.searchParams.get("hospital") ?? "").trim();
    const sort = (url.searchParams.get("sort") ?? "updated_desc").trim();
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "10", 10) || 10));

    if (q.length < 2 && !prefix && !hospital) return jsonOk({ data: [], total: 0, page, pageSize, hasMore: false });

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
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("active_patients")
      .select("id, file_number, title, first_names, surname, id_number, phone, hospital, status, updated_at", { count: "exact" });

    if (q.length >= 2) query = query.or(conditions.join(","));
    if (prefix) query = query.ilike("file_number", `${prefix}-%`);
    if (hospital) query = query.eq("hospital", hospital);

    if (sort === "file_number_asc") query = query.order("file_number", { ascending: true });
    else if (sort === "file_number_desc") query = query.order("file_number", { ascending: false });
    else query = query.order("updated_at", { ascending: false });

    const { data, error, count } = await query.range(from, to);

    if (error) return jsonOk({ data: [], total: 0, page, pageSize, hasMore: false, error: error.message });
    void session;
    const total = count ?? 0;
    return jsonOk({ data: data ?? [], total, page, pageSize, hasMore: to + 1 < total });
  } catch (err) {
    return handleRouteError(err);
  }
}
