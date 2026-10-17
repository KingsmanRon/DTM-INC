import { describe, expect, it } from "vitest";
import {
  MAX_CLOCK_SKEW_SECONDS,
  canonicalRequest,
  sha256Hex,
  signCanonical,
  verifySignature,
} from "./signature";

// Shared with KingsmanRon/Appointments (apps/worker test of the ACCESS side):
// both implementations must produce these exact signatures.
const VECTOR = {
  secret: "dtm-test-vector-secret-0123456789abcdef",
  timestamp: "1792224000",
  post: {
    path: "/api/v1/integrations/access/referrals",
    body: '{"schema_version":"access-referral-delivery.v1"}',
    bodySha256: "fb2958fc6206eb0e042736bbb920999321ed28c0c29e53317eb385cff7227949",
    signature: "v1=6d8e2a8cc0f77c141bfc4036458cd389bd1c152cad04f09c478838b600af52c2",
  },
  get: {
    path: "/api/v1/integrations/access/referrals/0b4c1f2e-8d3a-4c5b-9e6f-7a8b9c0d1e2f",
    signature: "v1=13cd00c159e89530ce66935ada65ebd0ea70069993d9d5ddd9c0eba519b53766",
  },
};

const keys = new Map([["2026-10", VECTOR.secret]]);
const at = (seconds: number) => new Date(seconds * 1000);

function check(overrides: Partial<Parameters<typeof verifySignature>[0]> = {}) {
  return verifySignature({
    method: "POST",
    pathWithQuery: VECTOR.post.path,
    keyId: "2026-10",
    timestamp: VECTOR.timestamp,
    signature: VECTOR.post.signature,
    body: VECTOR.post.body,
    keys,
    now: at(Number(VECTOR.timestamp)),
    ...overrides,
  });
}

describe("ACCESS request signature", () => {
  it("matches the shared test vector for a delivery and a read-back", () => {
    expect(sha256Hex(VECTOR.post.body)).toBe(VECTOR.post.bodySha256);
    const post = canonicalRequest({
      method: "post",
      pathWithQuery: VECTOR.post.path,
      timestamp: VECTOR.timestamp,
      bodySha256: VECTOR.post.bodySha256,
    });
    expect(post.split("\n")).toEqual([
      "access-dtm-v1",
      "POST",
      VECTOR.post.path,
      VECTOR.timestamp,
      VECTOR.post.bodySha256,
    ]);
    expect(signCanonical(VECTOR.secret, post)).toBe(VECTOR.post.signature);
    const get = canonicalRequest({
      method: "GET",
      pathWithQuery: VECTOR.get.path,
      timestamp: VECTOR.timestamp,
      bodySha256: sha256Hex(""),
    });
    expect(signCanonical(VECTOR.secret, get)).toBe(VECTOR.get.signature);
  });

  it("accepts a correctly signed request and names the key", () => {
    expect(check()).toEqual({ ok: true, keyId: "2026-10" });
  });

  it("accepts requests up to five minutes either side of the server clock", () => {
    const t = Number(VECTOR.timestamp);
    expect(check({ now: at(t + MAX_CLOCK_SKEW_SECONDS) }).ok).toBe(true);
    expect(check({ now: at(t - MAX_CLOCK_SKEW_SECONDS) }).ok).toBe(true);
    expect(check({ now: at(t + MAX_CLOCK_SKEW_SECONDS + 1) })).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(check({ now: at(t - MAX_CLOCK_SKEW_SECONDS - 1) })).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("refuses a changed body, path or method", () => {
    expect(check({ body: VECTOR.post.body.replace("v1", "v2") })).toEqual({ ok: false, reason: "bad_signature" });
    expect(check({ pathWithQuery: `${VECTOR.post.path}?x=1` })).toEqual({ ok: false, reason: "bad_signature" });
    expect(check({ method: "PUT" })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a signature made with another secret", () => {
    const forged = signCanonical(
      "another-secret-that-is-long-enough-to-pass",
      canonicalRequest({
        method: "POST",
        pathWithQuery: VECTOR.post.path,
        timestamp: VECTOR.timestamp,
        bodySha256: VECTOR.post.bodySha256,
      })
    );
    expect(check({ signature: forged })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses missing headers, unknown keys and malformed values", () => {
    expect(check({ keyId: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(check({ signature: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(check({ keyId: "2026-09" })).toEqual({ ok: false, reason: "unknown_key" });
    expect(check({ timestamp: "1792224000.5" })).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(check({ signature: "v1=abc" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(check({ signature: VECTOR.post.signature.toUpperCase() })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("accepts either key during a rotation", () => {
    const rotating = new Map([
      ["2026-11", "the-next-secret-0123456789abcdefghij"],
      ["2026-10", VECTOR.secret],
    ]);
    expect(check({ keys: rotating })).toEqual({ ok: true, keyId: "2026-10" });
  });
});
