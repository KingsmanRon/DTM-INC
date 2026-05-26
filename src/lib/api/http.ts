// Helpers shared across Route Handlers.
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodSchema } from "zod";
import { authErrorResponse } from "@/lib/auth/session";

export function jsonOk<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

export function jsonError(status: number, code: string, message?: string) {
  const safeMessage =
    message ??
    (code === "validation_error"
      ? "Some submitted details are invalid. Please review the form and try again."
      : code === "stale_consent"
        ? "The consent text has changed. Please refresh and re-confirm consent before submitting."
        : code === "onboarding_failed"
          ? "We couldn’t save this patient right now. Please check the details and try again."
          : "Request failed.");
  return NextResponse.json({ error: code, message: safeMessage }, { status });
}

export async function parseJson<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new BadRequestError("invalid_json"); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ValidationError(parsed.error);
  return parsed.data;
}

export class BadRequestError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export class ValidationError extends Error {
  constructor(public readonly zodError: ZodError) { super("validation_error"); }
  toResponse() {
    return NextResponse.json(
      {
        error: "validation_error",
        message: "Some submitted details are invalid. Please review the form and try again.",
        issues: this.zodError.issues.map((i) => ({ path: i.path, message: i.message })),
      },
      { status: 422 }
    );
  }
}

export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof ValidationError) return err.toResponse();
  if (err instanceof BadRequestError) return jsonError(400, err.code);
  try { return authErrorResponse(err); } catch { /* fall through */ }
  console.error("[route] unhandled error", err);
  return jsonError(500, "internal_error");
}

export function clientIp(req: NextRequest): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null
  );
}
