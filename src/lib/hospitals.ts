// Hospitals — the data-driven replacement for the hardcoded hospital/prefix
// maps (review #29, migration 0044). Server-side only: pages fetch the list
// under the caller's RLS context and pass it to client components as props,
// so the UI dropdowns, the validation, and onboard_patient() all read the
// same source of truth.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Hospital = {
  name: string;
  file_prefix: string;
};

// Active hospitals in display order — drives every dropdown and filter.
export async function getActiveHospitals(supabase: SupabaseClient): Promise<Hospital[]> {
  const { data, error } = await supabase
    .from("hospitals")
    .select("name, file_prefix")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`hospitals_unavailable: ${error.message}`);
  return (data ?? []) as Hospital[];
}

// Route-handler validation: is this an active hospital? Replaces the old
// hardcoded zod enums — the API answer can change when the table does,
// without a deploy. onboard_patient() re-checks as the final backstop.
export async function isActiveHospital(supabase: SupabaseClient, name: string): Promise<boolean> {
  if (!name) return false;
  const { data, error } = await supabase
    .from("hospitals")
    .select("name")
    .eq("name", name)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`hospitals_unavailable: ${error.message}`);
  return Boolean(data);
}
