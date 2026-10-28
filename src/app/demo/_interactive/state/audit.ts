import type { AuditAction, AuditCategory, AuditEvent, Role } from "@/app/demo/_interactive/types";

/**
 * Illustrative audit chain.
 *
 * Each entry's `ref` is derived from the previous entry's `ref` plus its own
 * content, so editing any past entry breaks every later link. This is a
 * 32-bit FNV-1a checksum used purely to *illustrate* tamper evidence. It is
 * NOT cryptographic, and it is not evidence about how any production system
 * verifies its audit records.
 */

export const GENESIS_REF = "00000000";

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function categoryOf(action: AuditAction): AuditCategory {
  if (action.startsWith("patient.facility")) return "facility";
  if (action.startsWith("patient.")) return "patient";
  if (action.startsWith("document.")) return "document";
  if (action.startsWith("note.")) return "clinical";
  return "billing";
}

type EventContent = Pick<AuditEvent, "at" | "actorName" | "action" | "target" | "summary">;

export function computeRef(prevRef: string, event: EventContent): string {
  return fnv1a([prevRef, event.at, event.actorName, event.action, event.target, event.summary].join("|"));
}

export interface AuditInput {
  id: string;
  at: string;
  actorName: string;
  actorRole: Role;
  action: AuditAction;
  target: string;
  subjectId?: string;
  summary: string;
}

export function makeAuditEvent(previous: AuditEvent | undefined, input: AuditInput): AuditEvent {
  const prevRef = previous?.ref ?? GENESIS_REF;
  return {
    ...input,
    category: categoryOf(input.action),
    prevRef,
    ref: computeRef(prevRef, input),
  };
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  /** Index (oldest first) of the first entry that fails verification. */
  brokenAt: number | null;
}

/** Verifies a chronologically ordered (oldest first) list of events. */
export function verifyChain(events: readonly AuditEvent[]): ChainVerification {
  let expectedPrev = events[0]?.prevRef ?? GENESIS_REF;
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    if (!event) continue;
    if (event.prevRef !== expectedPrev || computeRef(event.prevRef, event) !== event.ref) {
      return { ok: false, checked: i + 1, brokenAt: i };
    }
    expectedPrev = event.ref;
  }
  return { ok: true, checked: events.length, brokenAt: null };
}
