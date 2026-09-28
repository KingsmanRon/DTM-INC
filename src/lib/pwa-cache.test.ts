import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const match = vi.fn(async () => undefined);
  const fetch = vi.fn(async () => { throw new Error("offline"); });
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: { location: { origin: "https://test.local" }, addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn; }, skipWaiting: vi.fn(), clients: { claim: vi.fn() } },
    URL, Response, fetch, caches: { match }, console: { error: vi.fn() },
  });
  return { handlers, match, fetch };
}
describe("shell only service worker", () => {
  it.each(["/api/v1/patients", "/patients/123", "/reports/scan.png", "/_next/image?url=patient", "/icons/favicon-192x192.png?patient=123"])("does not cache %s", url => {
    const w = worker();
    const respondWith = vi.fn();
    w.handlers.fetch!({ request: { method: "GET", mode: "cors", destination: "image", url: `https://test.local${url}` }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(w.match).not.toHaveBeenCalled();
  });
  it("never serves a cached patient navigation while offline", async () => {
    const w = worker();
    let response: Promise<Response> | undefined;
    w.handlers.fetch!({ request: { method: "GET", mode: "navigate", destination: "document", url: "https://test.local/patients/123" }, respondWith: (p: Promise<Response>) => { response = p; } });
    expect(await (await response)!.text()).toContain("You are offline");
    expect(w.match).not.toHaveBeenCalled();
  });
});
