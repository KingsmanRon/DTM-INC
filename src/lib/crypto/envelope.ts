import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/server";

const ALGO = "aes-256-gcm";
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export class KeyManagementUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyManagementUnavailableError";
  }
}

function parseVaultSecretName(kekId: string): string {
  // Expected format: vault:secret-name[/version]
  if (!kekId.startsWith("vault:")) return kekId;
  const raw = kekId.slice("vault:".length);
  return raw.split("/")[0] ?? raw;
}

function decodeDevKey(base64Key: string): Buffer {
  const buf = Buffer.from(base64Key, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new KeyManagementUnavailableError(`CLINICAL_NOTES_KEK_DEV_KEY must decode to ${KEY_BYTES} bytes, got ${buf.length}`);
  }
  return buf;
}

async function getKekFromVault(): Promise<Buffer> {
  const env = getServerEnv();
  const secretName = parseVaultSecretName(env.CLINICAL_NOTES_KEK_ID);
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("read_app_secret", { p_name: secretName });
  if (error || typeof data !== "string") {
    throw new KeyManagementUnavailableError(`Vault key read failed for ${secretName}: ${error?.message ?? "invalid response"}`);
  }
  return decodeDevKey(data);
}

async function getKek(): Promise<Buffer> {
  const env = getServerEnv();
  const provider = env.CLINICAL_NOTES_KEY_PROVIDER;

  if (provider === "vault") {
    try {
      return await getKekFromVault();
    } catch (err) {
      if (!env.ALLOW_DEV_KEK_FALLBACK) throw err;
      if (!env.CLINICAL_NOTES_KEK_DEV_KEY) throw err;
      return decodeDevKey(env.CLINICAL_NOTES_KEK_DEV_KEY);
    }
  }

  if (!env.CLINICAL_NOTES_KEK_DEV_KEY) {
    throw new KeyManagementUnavailableError("CLINICAL_NOTES_KEK_DEV_KEY is required when provider=dev");
  }
  return decodeDevKey(env.CLINICAL_NOTES_KEK_DEV_KEY);
}


function decryptWrappedDekWithKek(wrapped: Buffer, kek: Buffer): Buffer {
  const nonce = wrapped.subarray(0, NONCE_BYTES);
  const tag = wrapped.subarray(wrapped.length - 16);
  const ct = wrapped.subarray(NONCE_BYTES, wrapped.length - 16);
  const decipher = createDecipheriv(ALGO, kek, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export async function wrapDek(dek: Buffer): Promise<Buffer> {
  if (dek.length !== KEY_BYTES) throw new Error("DEK must be 32 bytes");
  const kek = await getKek();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, kek, nonce);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ct, tag]);
}

export async function unwrapDek(wrapped: Buffer): Promise<Buffer> {
  const env = getServerEnv();
  const kek = await getKek();
  try {
    return decryptWrappedDekWithKek(wrapped, kek);
  } catch (primaryErr) {
    if (env.CLINICAL_NOTES_KEY_PROVIDER !== "vault" || !env.ALLOW_DEV_KEK_FALLBACK || !env.CLINICAL_NOTES_KEK_DEV_KEY) {
      throw primaryErr;
    }
    const fallbackKek = decodeDevKey(env.CLINICAL_NOTES_KEK_DEV_KEY);
    return decryptWrappedDekWithKek(wrapped, fallbackKek);
  }
}

export function generateDek(): Buffer {
  return randomBytes(KEY_BYTES);
}

export type EncryptedNote = {
  ciphertext: Buffer;
  nonce: Buffer;
};

export function encryptNoteBody(dek: Buffer, plaintext: string): EncryptedNote {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, dek, nonce);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([ct, tag]), nonce };
}

export function decryptNoteBody(dek: Buffer, ciphertext: Buffer, nonce: Buffer): string {
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const ct = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv(ALGO, dek, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function zero(buf: Buffer): void {
  buf.fill(0);
}

// Binary variants for non-text payloads (e.g. the rasterised PNG of a
// handwritten note). Same AES-256-GCM envelope as the text helpers, but with no
// utf8 round-trip so arbitrary bytes survive intact.
export function encryptNoteBytes(dek: Buffer, data: Buffer): EncryptedNote {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, dek, nonce);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([ct, tag]), nonce };
}

export function decryptNoteBytes(dek: Buffer, ciphertext: Buffer, nonce: Buffer): Buffer {
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const ct = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv(ALGO, dek, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// Ink JSON is encrypted separately, but with the same patient DEK path as the
// typed body. Separate nonces ensure AES-GCM never reuses a nonce/key pair.
export const encryptNoteInk = encryptNoteBody;
export const decryptNoteInk = decryptNoteBody;
