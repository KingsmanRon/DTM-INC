// Configuration for the ACCESS integration. Read here rather than in
// getServerEnv() on purpose: a mistyped integration variable must switch the
// integration off (503), not stop the whole EHR from booting.
//
//   ACCESS_INTEGRATION_KEYS       "<key id>:<secret>[,<key id>:<secret>]"
//                                 Two entries during a key rotation. Secrets
//                                 are at least 32 characters.
//   ACCESS_INTEGRATION_TENANT_ID  The one ACCESS organisation allowed to deliver.
//   ACCESS_INTEGRATION_DATA_MODE  "synthetic" (default) or "real". Deliveries
//                                 whose data mode differs are refused, so
//                                 synthetic test referrals can never reach a
//                                 live practice and real ones never reach a
//                                 test copy.
//
// With ACCESS_INTEGRATION_KEYS unset the integration is off.

export type AccessDataMode = "synthetic" | "real";

export type AccessIntegrationConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      keys: ReadonlyMap<string, string>;
      tenantId: string;
      dataMode: AccessDataMode;
    };

const KEY_ID = /^[A-Za-z0-9._-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_SECRET_LENGTH = 32;

export function accessIntegrationConfig(
  env: Record<string, string | undefined> = process.env
): AccessIntegrationConfig {
  const rawKeys = env.ACCESS_INTEGRATION_KEYS?.trim();
  if (!rawKeys) return { enabled: false, reason: "not_configured" };

  const keys = new Map<string, string>();
  for (const entry of rawKeys.split(",")) {
    const separator = entry.indexOf(":");
    const keyId = entry.slice(0, separator).trim();
    const secret = entry.slice(separator + 1).trim();
    if (separator < 1 || !KEY_ID.test(keyId) || secret.length < MIN_SECRET_LENGTH || keys.has(keyId)) {
      return { enabled: false, reason: "invalid_keys" };
    }
    keys.set(keyId, secret);
  }

  const tenantId = env.ACCESS_INTEGRATION_TENANT_ID?.trim() ?? "";
  if (!UUID.test(tenantId)) return { enabled: false, reason: "invalid_tenant" };

  const mode = (env.ACCESS_INTEGRATION_DATA_MODE?.trim() || "synthetic").toLowerCase();
  if (mode !== "synthetic" && mode !== "real") return { enabled: false, reason: "invalid_data_mode" };

  return { enabled: true, keys, tenantId: tenantId.toLowerCase(), dataMode: mode };
}
