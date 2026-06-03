// Shared, client-safe limits for handwritten-ink payloads. Kept free of Node
// (Buffer) and zod imports so both the server validator (ink.ts) and the
// browser canvas can import the same numbers without bundling server-only code.
export const MAX_INK_BYTES = 1_000_000;
export const MAX_INK_PAGES = 20;

// Cap on the rasterised PNG accepted at finalisation. Handwriting (mostly white
// + thin strokes) compresses well, so this is generous; it mainly bounds abuse
// and keeps the finalise request body well under the platform limit.
export const MAX_INK_PNG_BYTES = 5_000_000;
