// Allowlist for the post-auth `?next=` query param. Reject anything that
// isn't a same-origin, path-only redirect target — including absolute URLs
// (`https://evil.example`) and protocol-relative paths (`//evil.example`),
// both of which are accepted by the WHATWG URL parser and `router.replace`
// otherwise. The fallback is the caller's responsibility.
export function safeRedirectPath(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/\\")) return fallback;
  return value;
}
