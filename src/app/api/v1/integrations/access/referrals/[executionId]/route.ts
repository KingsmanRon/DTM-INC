// ACCESS integration read-back: has the delivery for this execution id been
// stored? 200 with the inbox reference and status, or an authoritative 404.
// ACCESS uses this after any unclear delivery instead of sending again.
import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/api/http";
import { integrationDeps, logIntegrationFailure, toIntegrationRequest } from "@/lib/integrations/access/deps";
import { handleReadBack } from "@/lib/integrations/access/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ executionId: string }> }) {
  try {
    const { executionId } = await params;
    const result = await handleReadBack(
      toIntegrationRequest(req, "", clientIp(req)),
      { executionId },
      integrationDeps()
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    logIntegrationFailure("read-back", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
