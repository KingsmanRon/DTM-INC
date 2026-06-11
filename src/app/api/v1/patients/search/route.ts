import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POPIA minimality: the type-ahead list never ships the full identity number.
// Reception confirms a caller off the last digits; the full number lives on the
// patient profile. Keeps the dropdown — rendered on every keystroke, visible at
// the front desk — low-value if shoulder-surfed.
function maskIdNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const tail = value.slice(-4);
  return value.length <= 4 ? tail : `••••${tail}`;
}

// GET /api/v1/patients/search?q=<term>
// Matches on file number, name (fuzzy), ID number, phone (last-7), medical aid number.
export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(["doctor", "staff"]);
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const prefix = (url.searchParams.get("prefix") ?? "").trim().toUpperCase();
    const sort = (url.searchParams.get("sort") ?? "updated_desc").trim();
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "10", 10) || 10));

    if (q.length < 3 && !prefix) return jsonOk({ data: [], page, pageSize, hasMore: false });

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
    //
    // No count:"exact": an exact count makes Postgres do the full match-set's
    // work for a number no consumer displays. Fetch pageSize+1 rows and derive
    // hasMore from the overflow row instead.
    const from = (page - 1) * pageSize;
    const to = from + pageSize; // one extra row on purpose — see above

    let query = supabase
      .from("active_patients")
      .select("id, file_number, title, first_names, surname, id_number, phone, payer_type, status, updated_at");

    if (q.length >= 3) query = query.or(conditions.join(","));
    if (prefix) query = query.ilike("file_number", `${prefix}-%`);

    if (sort === "file_number_asc") query = query.order("file_number", { ascending: true });
    else if (sort === "file_number_desc") query = query.order("file_number", { ascending: false });
    else query = query.order("updated_at", { ascending: false });

    const { data, error } = await query.range(from, to);

    // A DB failure is a 500, not an empty result set — the previous behaviour
    // (200 + an `error` field) made an outage indistinguishable from
    // "no matches" in every consumer.
    if (error) return jsonError(500, "db_error", error.message);

    void session;
    const rows = data ?? [];
    const hasMore = rows.length > pageSize;
    const pageRows = (hasMore ? rows.slice(0, pageSize) : rows).map((r) => ({
      ...r,
      id_number: maskIdNumber(r.id_number as string | null),
    }));
    return jsonOk({ data: pageRows, page, pageSize, hasMore });
  } catch (err) {
    return handleRouteError(err);
  }
}
