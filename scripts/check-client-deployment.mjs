import { existsSync } from "node:fs";
import { join } from "node:path";

export function checkClientDeployment(env = process.env, root = process.cwd()) {
  if (env.NEXT_PUBLIC_DEPLOYMENT_PROFILE !== "client") return;
  const required = ["NEXT_PUBLIC_APP_NAME", "NEXT_PUBLIC_APP_TITLE", "NEXT_PUBLIC_APP_DESCRIPTION", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL"];
  for (const key of required) {
    if (!env[key]?.trim() || /SUPPLY_|REPLACE_|example\.|\.invalid/i.test(env[key])) throw new Error(`Client configuration missing: ${key}`);
  }
  const app = new URL(env.NEXT_PUBLIC_APP_URL);
  if (app.protocol !== "https:" || app.origin !== new URL(env.NEXT_PUBLIC_SITE_URL).origin)
    throw new Error("Client URLs must use HTTPS and have matching origins");
  if (env.NEXT_PUBLIC_BRAND_ASSET_BASE !== "/client-brand") throw new Error("Client asset base must be /client-brand");
  if (env.CLINICAL_NOTES_KEY_PROVIDER !== "vault" || env.ALLOW_DEV_KEK_FALLBACK !== "false" || env.CLINICAL_NOTES_KEK_DEV_KEY)
    throw new Error("Client deployments require Vault, ALLOW_DEV_KEK_FALLBACK=false and no development KEK");
  for (const name of ["logo.png", "logo-pdf.png", "favicon-192x192.png", "favicon-512x512.png", "apple-touch-icon.png"])
    if (!existsSync(join(root, "public", "client-brand", name))) throw new Error(`Missing client asset: ${name}`);
}

if (process.argv[1]?.endsWith("check-client-deployment.mjs")) {
  checkClientDeployment();
  console.log("Deployment branding checks passed.");
}
