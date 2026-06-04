import { redirect } from "next/navigation";
import { resolveSession } from "@/lib/auth/session";

export default async function RootPage() {
  const session = await resolveSession();
  if (!session) redirect("/login");
  redirect("/dashboard");
}
