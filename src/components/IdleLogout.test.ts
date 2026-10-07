import { describe, expect, it } from "vitest";
import { ACTIVITY_KEY, idleExpired, readSharedActivity, writeSharedActivity } from "./IdleLogout";

const MIN = 60_000;

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("idle logout across tabs", () => {
  it("keeps a background tab signed in while another tab is active", () => {
    const store = memoryStore();
    const backgroundTabLoaded = 0;
    writeSharedActivity(store, 14 * MIN); // the user clicks in another tab
    expect(idleExpired(16 * MIN, backgroundTabLoaded, readSharedActivity(store), 15 * MIN)).toBe(false);
  });

  it("locks every tab once the whole browser has been idle", () => {
    const store = memoryStore();
    writeSharedActivity(store, 10 * MIN);
    expect(idleExpired(25 * MIN, 0, readSharedActivity(store), 15 * MIN)).toBe(true);
  });

  it("falls back to the tab's own activity when storage is blocked", () => {
    const blocked = {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
    };
    expect(() => writeSharedActivity(blocked, 1)).not.toThrow();
    expect(readSharedActivity(blocked)).toBe(0);
    expect(readSharedActivity(null)).toBe(0);
    expect(idleExpired(16 * MIN, 0, readSharedActivity(blocked), 15 * MIN)).toBe(true);
  });

  it("ignores a corrupt stored value", () => {
    const store = memoryStore();
    store.setItem(ACTIVITY_KEY, "not-a-number");
    expect(readSharedActivity(store)).toBe(0);
  });
});
