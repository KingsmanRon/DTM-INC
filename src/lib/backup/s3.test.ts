import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { backupObjectKey, backupObjectUrl, backupTargetFromEnv, putBackupObject, type BackupTarget } from "./s3";

const target: BackupTarget = {
  bucket: "shoba-backups", region: "af-south-1", accessKeyId: "AKIATEST", secretAccessKey: "secret",
  prefix: "patient-documents/", storageClass: "GLACIER_IR", endpoint: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("backup target", () => {
  it("is disabled until bucket and both key parts are set, and defaults to Cape Town Glacier IR", () => {
    expect(backupTargetFromEnv({})).toBeNull();
    expect(backupTargetFromEnv({ BACKUP_S3_BUCKET: "b", BACKUP_S3_ACCESS_KEY_ID: "k" })).toBeNull();
    const t = backupTargetFromEnv({ BACKUP_S3_BUCKET: "b", BACKUP_S3_ACCESS_KEY_ID: "k", BACKUP_S3_SECRET_ACCESS_KEY: "s" });
    expect(t).toMatchObject({ region: "af-south-1", storageClass: "GLACIER_IR", prefix: "patient-documents/", endpoint: null });
  });

  it("mirrors the storage key under the backup prefix and encodes each path segment", () => {
    const key = backupObjectKey(target, "pid/uuid/Scan 1 (left).pdf");
    expect(key).toBe("patient-documents/pid/uuid/Scan 1 (left).pdf");
    expect(backupObjectUrl(target, key)).toBe("https://shoba-backups.s3.af-south-1.amazonaws.com/patient-documents/pid/uuid/Scan%201%20%28left%29.pdf");
    expect(backupObjectUrl({ ...target, endpoint: "http://127.0.0.1:9000/" }, "a/b.pdf")).toBe("http://127.0.0.1:9000/shoba-backups/a/b.pdf");
  });
});

describe("putBackupObject", () => {
  it("sends a signed, conditional, checksummed PUT in the configured storage class", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("", { status: 200, headers: { "x-amz-version-id": "v1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = new TextEncoder().encode("%PDF-1.4 test");
    const result = await putBackupObject(target, "patient-documents/a/b.pdf", bytes, "application/pdf");
    expect(result).toEqual({ status: "stored", versionId: "v1" });
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init.headers);
    expect(init.method).toBe("PUT");
    expect(headers.get("if-none-match")).toBe("*");
    expect(headers.get("x-amz-storage-class")).toBe("GLACIER_IR");
    expect(headers.get("x-amz-checksum-sha256")).toBe(createHash("sha256").update(bytes).digest("base64"));
    expect(headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/af-south-1\/s3\/aws4_request/);
    expect(url).toBe("https://shoba-backups.s3.af-south-1.amazonaws.com/patient-documents/a/b.pdf");
  });

  it("passes the bytes themselves so the upload keeps a known length", async () => {
    // A Request (or stream) body is re-sent by Next.js as a chunked upload,
    // which S3 refuses with 501 NotImplemented.
    const fetchMock = vi.fn(async (_url: unknown, _init: RequestInit) => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = new TextEncoder().encode("abc");
    await putBackupObject(target, "patient-documents/x.pdf", bytes, "application/pdf");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(typeof url).toBe("string");
    expect(init.body).toBe(bytes);
    expect(new Request(String(url), { method: "PUT", body: init.body as BodyInit }).headers.get("transfer-encoding")).toBeNull();
  });

  it("treats an existing object as already backed up and reports other failures without secrets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 412 })));
    await expect(putBackupObject(target, "k", new Uint8Array([1]), "application/pdf")).resolves.toEqual({ status: "exists" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 })));
    await expect(putBackupObject(target, "k", new Uint8Array([1]), "application/pdf")).rejects.toThrow("s3_put_failed: HTTP 403 AccessDenied");
  });
});
