// Off-site document backup target (AWS S3, af-south-1 by default).
//
// The backup credentials are deliberately add-only: the IAM policy grants
// s3:PutObject on the backup prefix and nothing else, so a leaked key can
// neither read patient documents nor delete or overwrite backups. Every PUT is
// conditional (If-None-Match: *), so an existing object is never replaced, and
// carries a SHA-256 checksum that S3 verifies before accepting the bytes.
//
// Import-safe from Route Handlers and tsx scripts (no "server-only" import);
// the caller supplies credentials from its own server-side environment.
import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

export type BackupTarget = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  storageClass: string;
  // Path-style endpoint override for S3-compatible test servers only.
  endpoint: string | null;
};

const PUT_TIMEOUT_MS = 30_000;

export type PutOutcome = { status: "stored"; versionId: string | null } | { status: "exists" };

export function backupTargetFromEnv(env: Record<string, string | undefined> = process.env): BackupTarget | null {
  const bucket = env.BACKUP_S3_BUCKET?.trim();
  const accessKeyId = env.BACKUP_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.BACKUP_S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region: env.BACKUP_S3_REGION?.trim() || "af-south-1",
    accessKeyId,
    secretAccessKey,
    prefix: "patient-documents/",
    storageClass: env.BACKUP_S3_STORAGE_CLASS?.trim() || "GLACIER_IR",
    endpoint: env.BACKUP_S3_ENDPOINT?.trim() || null,
  };
}

// Strict RFC 3986 encoding per path segment, as AWS SigV4 canonicalises it.
// encodeURIComponent leaves !'()* unescaped, which file names such as
// "Report (left).pdf" contain.
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

export function backupObjectKey(target: BackupTarget, storageKey: string): string {
  return `${target.prefix}${storageKey}`;
}

export function backupObjectUrl(target: BackupTarget, key: string): string {
  if (target.endpoint) return `${target.endpoint.replace(/\/$/, "")}/${target.bucket}/${encodeKey(key)}`;
  return `https://${target.bucket}.s3.${target.region}.amazonaws.com/${encodeKey(key)}`;
}

export async function putBackupObject(
  target: BackupTarget,
  key: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<PutOutcome> {
  const client = new AwsClient({
    accessKeyId: target.accessKeyId,
    secretAccessKey: target.secretAccessKey,
    region: target.region,
    service: "s3",
  });
  const checksum = createHash("sha256").update(bytes).digest("base64");
  const signed = await client.sign(backupObjectUrl(target, key), {
    method: "PUT",
    body: bytes,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "If-None-Match": "*",
      "x-amz-storage-class": target.storageClass,
      "x-amz-checksum-sha256": checksum,
    },
  });
  // Send the bytes, not the signed Request. Next.js's patched fetch rebuilds a
  // Request input from its body stream, which arrives at S3 as a chunked upload
  // without a length and is refused with 501 NotImplemented. A failed PUT is
  // retried by the next run, so no in-request retry.
  const res = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: bytes,
    cache: "no-store",
    signal: AbortSignal.timeout(PUT_TIMEOUT_MS),
  });
  if (res.status === 412) return { status: "exists" };
  if (!res.ok) {
    // S3 error bodies are XML with a short Code; never include request headers.
    const body = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? "unknown";
    throw new Error(`s3_put_failed: HTTP ${res.status} ${code}`);
  }
  return { status: "stored", versionId: res.headers.get("x-amz-version-id") };
}
