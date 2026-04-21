import { resolveSession } from "@/lib/auth/session";
import { jsonOk } from "@/lib/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await resolveSession();
  if (!session) return jsonOk({ authenticated: false });
  return jsonOk({
    authenticated: true,
    user: { id: session.userId, email: session.email, fullName: session.fullName, role: session.role },
  });
}
