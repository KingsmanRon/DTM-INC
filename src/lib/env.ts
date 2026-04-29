// Env validation. Fail at boot with a clear message rather than NPE at request time.
import { z } from "zod";

const ServerEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_AUDIT_DB_URL: z.string().optional(),
  CLINICAL_NOTES_KEK_ID: z.string().default("vault:clinical-notes-kek/v1"),
  CLINICAL_NOTES_KEK_DEV_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
  SESSION_IDLE_TIMEOUT_STAFF_MIN: z.coerce.number().default(30),
  SESSION_IDLE_TIMEOUT_DOCTOR_MIN: z.coerce.number().default(15),
  SESSION_IDLE_TIMEOUT_ADMIN_MIN: z.coerce.number().default(15),
  PDF_SERVICE_SHARED_SECRET: z.string().optional(),
}).superRefine((env, ctx) => {
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
});

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
