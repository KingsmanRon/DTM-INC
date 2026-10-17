// ACCESS integration: deliver a referral (POST) or look one up by inbox
// reference (GET ?reference=IN-000123). Called by the ACCESS worker with a
// signed request; there is no user session. Contract: docs/integrations/access.md.
import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/api/http";
import { MAX_DELIVERY_BYTES } from "@/lib/integrations/access/delivery";
import { integrationDeps, logIntegrationFailure, toIntegrationRequest } from "@/lib/integrations/access/deps";
import { handleDelivery, handleReadBack } from "@/lib/integrations/access/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Refuse an oversized body before reading it.
  if (Number(req.headers.get("content-length") ?? "0") > MAX_DELIVERY_BYTES) {
    return NextResponse.json({ error: "payload_too_large" }, { status: 413 });
  }
  try {
    const body = await req.text();
    const result = await handleDelivery(toIntegrationRequest(req, body, clientIp(req)), integrationDeps());
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    // Unknown outcome: ACCESS reads back by execution id before doing anything else.
    logIntegrationFailure("delivery", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const reference = req.nextUrl.searchParams.get("reference") ?? "";
    const result = await handleReadBack(
      toIntegrationRequest(req, "", clientIp(req)),
      { reference },
      integrationDeps()
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    logIntegrationFailure("status lookup", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
