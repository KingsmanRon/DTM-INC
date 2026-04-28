import { redirect } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";
import { getSupabaseServer } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  const session = await resolveSession();
  if (!session) redirect(user ? "/unauthorised" : "/login");
  redirect("/dashboard");
}
