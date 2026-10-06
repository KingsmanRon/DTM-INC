import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runDocumentBackup, type PendingBackup } from "./documents";
import type { BackupTarget } from "./s3";

const target: BackupTarget = {
  bucket: "b", region: "af-south-1", accessKeyId: "k", secretAccessKey: "s",
  prefix: "patient-documents/", storageClass: "GLACIER_IR", endpoint: null,
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function fakeAdmin(pending: PendingBackup[], objects: Record<string, string>, opts: { lock?: boolean } = {}) {
  const ledger = new Map<string, Record<string, unknown>>();
  const rpc = vi.fn(async (name: string, args?: { p_limit?: number }) => {
    if (name === "try_acquire_maintenance_lock") return { data: opts.lock ?? true, error: null };
    if (name === "release_maintenance_lock") return { data: null, error: null };
    const open = pending.filter((p) => {
      const row = ledger.get(p.storage_key);
      return !row || (row.status !== "backed_up" && Number(row.attempts) < 5);
    });
    if (name === "documents_pending_backup") return { data: open.slice(0, args?.p_limit ?? 50), error: null };
    if (name === "documents_pending_backup_count") return { data: open.length, error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
  const admin = {
    rpc,
    storage: { from: () => ({ download: async (key: string) => key in objects ? { data: new Blob([objects[key]!]), error: null } : { data: null, error: { message: "not found" } } }) },
    from: () => ({ upsert: async (row: Record<string, unknown>) => { ledger.set(String(row.storage_key), row); return { error: null }; } }),
  } as unknown as SupabaseClient;
  return { admin, ledger, rpc };
}

const item = (key: string, content: string, extra: Partial<PendingBackup> = {}): PendingBackup =>
  ({ document_id: `doc-${key}`, storage_key: key, sha256_hash: sha(content), mime_type: "application/pdf", object_kind: "active", attempts: 0, ...extra });

describe("runDocumentBackup", () => {
  it("copies pending documents, records each outcome and reports nothing remaining", async () => {
    const pending = [item("p/1/a.pdf", "A"), item("p/1/b.pdf", "B"), item("p/2/c.pdf", "C")];
    const { admin, ledger } = fakeAdmin(pending, { "p/1/a.pdf": "A", "p/1/b.pdf": "B", "p/2/c.pdf": "C" });
    const put = vi.fn(async (_t: BackupTarget, key: string) => key.endsWith("b.pdf") ? { status: "exists" as const } : { status: "stored" as const, versionId: "v" });
    const s = await runDocumentBackup(admin, target, { timeBudgetMs: 60_000 }, { put });
    expect(s).toMatchObject({ acquired_lock: true, attempted: 3, stored: 2, already_present: 1, failed: 0, remaining: 0, stopped_for_time: false });
    expect(put).toHaveBeenCalledWith(target, "patient-documents/p/1/a.pdf", expect.any(Uint8Array), "application/pdf");
    expect([...ledger.values()].every((r) => r.status === "backed_up" && r.attempts === 1)).toBe(true);
  });

  it("refuses to copy a corrupted or missing source and does not retry it within the same run", async () => {
    const pending = [item("p/bad.pdf", "expected"), item("p/gone.pdf", "x"), item("p/ok.pdf", "ok")];
    const { admin, ledger } = fakeAdmin(pending, { "p/bad.pdf": "tampered", "p/ok.pdf": "ok" });
    const put = vi.fn(async () => ({ status: "stored" as const, versionId: null }));
    const s = await runDocumentBackup(admin, target, { timeBudgetMs: 60_000 }, { put });
    expect(s).toMatchObject({ attempted: 3, stored: 1, hash_mismatch: 1, missing_source: 1, remaining: 2 });
    expect(put).toHaveBeenCalledTimes(1);
    expect(ledger.get("p/bad.pdf")).toMatchObject({ status: "hash_mismatch", attempts: 1, backed_up_at: null });
  });

  it("records S3 failures for retry and stops cleanly when the time budget runs out", async () => {
    const pending = [item("p/1.pdf", "1"), item("p/2.pdf", "2")];
    const { admin, ledger } = fakeAdmin(pending, { "p/1.pdf": "1", "p/2.pdf": "2" });
    let clock = 0;
    const put = vi.fn(async () => { clock += 40_000; throw new Error("s3_put_failed: HTTP 503 SlowDown"); });
    const s = await runDocumentBackup(admin, target, { timeBudgetMs: 30_000 }, { put, now: () => clock });
    expect(s).toMatchObject({ attempted: 1, failed: 1, stopped_for_time: true, remaining: 2 });
    expect(ledger.get("p/1.pdf")).toMatchObject({ status: "failed", last_error: "s3_put_failed: HTTP 503 SlowDown" });
  });

  it("does nothing when another run holds the lock", async () => {
    const { admin, rpc } = fakeAdmin([item("p/1.pdf", "1")], { "p/1.pdf": "1" }, { lock: false });
    const s = await runDocumentBackup(admin, target, { timeBudgetMs: 60_000 }, { put: vi.fn() });
    expect(s).toMatchObject({ acquired_lock: false, attempted: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
