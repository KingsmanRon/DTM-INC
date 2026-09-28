import { z } from "zod";

export const FileNumberFormat = z.string().max(100).refine((s) => {
  const tokens = ["{PREFIX}", "{YYYY}", "{SEQ:06}"];
  return tokens.every(token => s.split(token).length === 2)
    && /^[ /._-]*$/.test(tokens.reduce((value, token) => value.replace(token, ""), s));
}, "Use {PREFIX}, {YYYY} and {SEQ:06} exactly once, with spaces, /, ., _ or hyphens between them");
