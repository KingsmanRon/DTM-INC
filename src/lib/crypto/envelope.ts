// Envelope encryption for clinical notes (§10.3, §FR-8).
//
//   KEK (in Supabase Vault / KMS) wraps a per-patient DEK.
//   DEK encrypts each note body with AES-256-GCM using a fresh per-note nonce.
//
// In production, wrap/unwrap MUST go through Supabase Vault or a KMS (AWS
// KMS, GCP KMS, HashiCorp Vault). For local development we fall back to a
// symmetric key in CLINICAL_NOTES_KEK_DEV_KEY — never enable in prod.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getServerEnv } from "@/lib/env";

const ALGO = "aes-256-gcm";
const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export class KeyManagementUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyManagementUnavailableError";
  }
}

function getKek(): Buffer {
  const env = getServerEnv();
  if (!env.CLINICAL_NOTES_KEK_DEV_KEY) {
    throw new KeyManagementUnavailableError(
      "CLINICAL_NOTES_KEK_DEV_KEY not set and no KMS client is configured. " +
      "In production, wrap/unwrap must call Supabase Vault or a KMS."
    );
  }
  const buf = Buffer.from(env.CLINICAL_NOTES_KEK_DEV_KEY, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new KeyManagementUnavailableError(`CLINICAL_NOTES_KEK_DEV_KEY must decode to ${KEY_BYTES} bytes, got ${buf.length}`);
  }
  return buf;
}

// Wraps a 32-byte DEK under the KEK. Output layout: [nonce(12) | ciphertext | tag(16)].
export function wrapDek(dek: Buffer): Buffer {
  if (dek.length !== KEY_BYTES) throw new Error("DEK must be 32 bytes");
  const kek = getKek();
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, kek, nonce);
  const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ct, tag]);
}

export function unwrapDek(wrapped: Buffer): Buffer {
  const kek = getKek();
  const nonce = wrapped.subarray(0, NONCE_BYTES);
  const tag = wrapped.subarray(wrapped.length - 16);
  const ct = wrapped.subarray(NONCE_BYTES, wrapped.length - 16);
  const decipher = createDecipheriv(ALGO, kek, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export function generateDek(): Buffer {
  return randomBytes(KEY_BYTES);
}

export type EncryptedNote = {
  ciphertext: Buffer; // includes GCM tag appended
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

// Zero a Buffer so plaintext keys don't linger in memory after use (§10.3).
export function zero(buf: Buffer): void {
  buf.fill(0);
}
