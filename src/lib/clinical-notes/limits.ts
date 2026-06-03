// Shared, client-safe limits for handwritten-ink payloads. Kept free of Node
// (Buffer) and zod imports so both the server validator (ink.ts) and the
// browser canvas can import the same numbers without bundling server-only code.
export const MAX_INK_BYTES = 1_000_000;
export const MAX_INK_PAGES = 20;
