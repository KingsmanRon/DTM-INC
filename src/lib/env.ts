// Env validation. Fail at boot with a clear message rather than NPE at request time.
import { z } from "zod";

const EnvBoolean = z.enum(["true", "false"]).default("false").transform((value) => value === "true");

const ServerEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CLINICAL_NOTES_KEK_ID: z.string().default("vault:clinical-notes-kek/v1"),
  CLINICAL_NOTES_KEY_PROVIDER: z.enum(["vault", "dev"]).default("vault"),
  // Raw string here; resolved to a boolean in the .transform below.
  //   * Previous code used z.coerce.boolean(), for which the STRING "false" is
  //     truthy — setting ALLOW_DEV_KEK_FALLBACK=false never actually disabled it.
  //   * The default is now environment-aware: in production the fallback is OFF
  //     unless explicitly set to "true". Silently re-keying new clinical notes
  //     to the dev key during a Vault outage is exactly the failure a prod
  //     deployment must fail CLOSED on. (Verify Vault reads succeed before
  //     relying on this in prod — see docs/internal/v2-fix-plan.md item 11.)
  ALLOW_DEV_KEK_FALLBACK: z.enum(["true", "false"]).optional(),
  CLINICAL_NOTES_KEK_DEV_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  SESSION_IDLE_TIMEOUT_STAFF_MIN: z.coerce.number().default(30),
  SESSION_IDLE_TIMEOUT_DOCTOR_MIN: z.coerce.number().default(15),
  SESSION_IDLE_TIMEOUT_ADMIN_MIN: z.coerce.number().default(15),
  FEATURE_HANDWRITTEN_NOTES: EnvBoolean,
  FEATURE_HANDWRITTEN_NOTES_DOCTOR_IDS: z.string().default(""),
  FEATURE_HANDWRITTEN_NOTES_FINALISE: EnvBoolean,
  FEATURE_HANDWRITTEN_NOTES_PDF: EnvBoolean,
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
}).superRefine((env, ctx) => {
  if (env.SUPABASE_SERVICE_ROLE_KEY === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SUPABASE_SERVICE_ROLE_KEY"],
      message: "must not equal NEXT_PUBLIC_SUPABASE_ANON_KEY",
    });
  }

  // Legacy Supabase keys are JWTs. If this key is a JWT, assert the role
  // claim is service_role so we fail fast on env mixups in production.
  if (env.SUPABASE_SERVICE_ROLE_KEY.includes(".")) {
    try {
      const payloadB64 = env.SUPABASE_SERVICE_ROLE_KEY.split(".")[1] ?? "";
      const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
      const payload = JSON.parse(payloadJson) as { role?: string };
      if (payload.role && payload.role !== "service_role") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["SUPABASE_SERVICE_ROLE_KEY"],
          message: `JWT role claim must be service_role (got ${payload.role})`,
        });
      }
    } catch {
      // Non-JWT formats are allowed (Supabase secret keys). Ignore parse
      // failures and rely on downstream auth failures if malformed.
    }
  }

  if (!env.CLINICAL_NOTES_KEK_DEV_KEY) return;
  try {
    const buf = Buffer.from(env.CLINICAL_NOTES_KEK_DEV_KEY, "base64");
    if (buf.length !== 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CLINICAL_NOTES_KEK_DEV_KEY"],
        message: "must be base64 for a 32-byte key",
      });
    }
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CLINICAL_NOTES_KEK_DEV_KEY"],
      message: "must be base64 for a 32-byte key",
    });
  }

}).transform((env) => ({
  ...env,
  // Fail closed in production: dev-key fallback only when explicitly "true".
  // Outside production it stays on by default for local DX.
  ALLOW_DEV_KEK_FALLBACK:
    env.ALLOW_DEV_KEK_FALLBACK === undefined
      ? env.NODE_ENV !== "production"
      : env.ALLOW_DEV_KEK_FALLBACK === "true",
}));

let cached: z.infer<typeof ServerEnv> | null = null;

export function getServerEnv() {
  if (cached) return cached;
  const parsed = ServerEnv.safeParse(process.env);
  if (!parsed.success) {
    // Don't leak key prefixes; just list which vars are wrong.
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server env: ${keys}`);
  }
  cached = parsed.data;
  return cached;
}

export const PublicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "",
};
