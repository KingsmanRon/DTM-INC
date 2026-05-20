"use client";

type OfflineActionType =
  | "appointment_create"
  | "appointment_update"
  | "appointment_check_in"
  | "queue_start"
  | "queue_complete"
  | "patient.create_basic"
  | "patient.update_basic";

type QueueStatus = "pending" | "processing" | "failed" | "completed";

const DB_NAME = "dtm-offline-queue";
const DB_VERSION = 1;
const ACTION_STORE = "actions";
const ID_MAP_STORE = "id_map";
const KEY_STORAGE = "dtm_offline_queue_k";
const MAX_ATTEMPTS = 8;

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function backoffMs(attempt: number) {
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)) + jitter;
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getKeyMaterial(): Promise<CryptoKey | null> {
  if (typeof window === "undefined") return null;
  let b64 = window.localStorage.getItem(KEY_STORAGE);
  if (!b64) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    b64 = btoa(String.fromCharCode(...raw));
    window.localStorage.setItem(KEY_STORAGE, b64);
  }
  const rawBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", rawBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptPayload(value: unknown): Promise<string> {
  const key = await getKeyMaterial();
  if (!key) return JSON.stringify(value);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(value));
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  const blob = new Uint8Array(iv.length + enc.length);
  blob.set(iv, 0);
  blob.set(enc, iv.length);
  return btoa(String.fromCharCode(...blob));
}

async function decryptPayload<T>(value: string): Promise<T> {
  const key = await getKeyMaterial();
  if (!key) return JSON.parse(value) as T;
  const raw = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const data = raw.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ACTION_STORE)) {
        const store = db.createObjectStore(ACTION_STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(ID_MAP_STORE)) {
        db.createObjectStore(ID_MAP_STORE, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function generateIdempotencyKey(actionType: OfflineActionType, payload: unknown) {
  return sha256Hex(`${actionType}:${JSON.stringify(payload)}:${Date.now()}`);
}

type StoredAction = {
  id: string;
  actionType: OfflineActionType;
  payloadCipher: string;
  endpoint: string;
  method: "POST" | "PATCH";
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
  attemptCount: number;
  lastError: string | null;
  status: QueueStatus;
};

export async function mapLocalToServerId(localId: string, serverId: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ID_MAP_STORE, "readwrite");
    tx.objectStore(ID_MAP_STORE).put({ localId, serverId, mappedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function resolveIdMappings<T>(payload: T): Promise<T> {
  const data = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  const db = await openDb();
  const store = db.transaction(ID_MAP_STORE, "readonly").objectStore(ID_MAP_STORE);
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && v.startsWith("local:")) {
      await new Promise<void>((resolve) => {
        const req = store.get(v);
        req.onsuccess = () => {
          if (req.result?.serverId) data[k] = req.result.serverId;
          resolve();
        };
        req.onerror = () => resolve();
      });
    }
  }
  return data as T;
}

export async function enqueueWrite<T>(args: { actionType: OfflineActionType; endpoint: string; method: "POST" | "PATCH"; payload: T }) {
  const db = await openDb();
  const now = Date.now();
  const action: StoredAction = {
    id: crypto.randomUUID(),
    actionType: args.actionType,
    payloadCipher: await encryptPayload(args.payload),
    endpoint: args.endpoint,
    method: args.method,
    idempotencyKey: await generateIdempotencyKey(args.actionType, args.payload),
    createdAt: now,
    updatedAt: now,
    attemptCount: 0,
    lastError: null,
    status: "pending",
  };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTION_STORE, "readwrite");
    tx.objectStore(ACTION_STORE).put(action);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  return action.id;
}

async function readAllActions() {
  const db = await openDb();
  return new Promise<StoredAction[]>((resolve, reject) => {
    const tx = db.transaction(ACTION_STORE, "readonly");
    const req = tx.objectStore(ACTION_STORE).getAll();
    req.onsuccess = () => resolve((req.result as StoredAction[]).sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
}

async function saveAction(action: StoredAction) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ACTION_STORE, "readwrite");
    tx.objectStore(ACTION_STORE).put(action);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function replayOfflineQueue() {
  if (isOffline()) return;
  const actions = await readAllActions();
  for (const action of actions) {
    if (action.status === "completed" || action.status === "failed") continue;
    action.status = "processing";
    action.updatedAt = Date.now();
    await saveAction(action);

    try {
      const payload = await decryptPayload<Record<string, unknown>>(action.payloadCipher);
      const resolved = await resolveIdMappings(payload);
      const res = await fetch(action.endpoint, {
        method: action.method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": action.idempotencyKey,
          "x-offline-replay": "1",
        },
        body: JSON.stringify(resolved),
      });

      if (res.ok) {
        action.status = "completed";
        action.lastError = null;
        const body = await res.json().catch(() => ({}));
        if (typeof payload.local_id === "string" && typeof body?.id === "string") {
          await mapLocalToServerId(payload.local_id, body.id);
        }
      } else {
        action.attemptCount += 1;
        action.status = action.attemptCount >= MAX_ATTEMPTS ? "failed" : "pending";
        action.lastError = `HTTP ${res.status}`;
        if (action.status === "pending") await new Promise((r) => setTimeout(r, backoffMs(action.attemptCount)));
      }
    } catch (error) {
      action.attemptCount += 1;
      action.status = action.attemptCount >= MAX_ATTEMPTS ? "failed" : "pending";
      action.lastError = error instanceof Error ? error.message : "unknown_error";
      if (action.status === "pending") await new Promise((r) => setTimeout(r, backoffMs(action.attemptCount)));
    }

    action.updatedAt = Date.now();
    await saveAction(action);
  }
}

export function installOfflineReplayListener() {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => {
    void replayOfflineQueue();
  };
  window.addEventListener("online", onOnline);
  void replayOfflineQueue();
  return () => window.removeEventListener("online", onOnline);
}

export async function writeWithOfflineQueue<T>(args: {
  actionType: OfflineActionType;
  endpoint: string;
  method: "POST" | "PATCH";
  payload: T;
}) {
  if (isOffline()) {
    const queueId = await enqueueWrite(args);
    return { queued: true, queueId };
  }

  const onlineIdempotencyKey = await generateIdempotencyKey(args.actionType, args.payload);
  const res = await fetch(args.endpoint, {
    method: args.method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-idempotency-key": onlineIdempotencyKey },
    body: JSON.stringify(args.payload),
  });

  if (res.ok) return { queued: false, response: res };

  const queueId = await enqueueWrite(args);
  return { queued: true, queueId, response: res };
}
