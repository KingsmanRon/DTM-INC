import { z } from "zod";

export const MAX_INK_BYTES = 1_000_000;

const InkPoint = z.tuple([z.number().finite(), z.number().finite(), z.number().min(0).max(1)]);
const InkStroke = z.array(InkPoint).min(1);
const InkPage = z.object({ strokes: z.array(InkStroke) }).strict();
const InkDocument = z.object({ version: z.literal(1), pages: z.array(InkPage).min(1) }).strict();

export type InkDocument = z.infer<typeof InkDocument>;

export function parseInkPayload(value: string): InkDocument {
  if (Buffer.byteLength(value, "utf8") > MAX_INK_BYTES) {
    throw new Error("ink_too_large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("invalid_ink");
  }

  const result = InkDocument.safeParse(parsed);
  if (!result.success || !result.data.pages.some((page) => page.strokes.length > 0)) {
    throw new Error("invalid_ink");
  }
  return result.data;
}

export function hasInk(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
