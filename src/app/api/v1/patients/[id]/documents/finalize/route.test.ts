import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), role: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: mocks.admin }));
vi.mock("@/lib/auth/session", () => ({
  requireRole: mocks.role,
  authErrorResponse: (error: unknown) => { throw error; },
}));
import { POST } from "./route";

const patient = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const actor = "22222222-2222-2222-2222-222222222222";
const key = `${patient}/new/upload.pdf`;
const pdf = Buffer.from("%PDF-1.7\nsynthetic document\n%%EOF");
const intent = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc", original_filename: "scan.pdf",
  category: "other", mime_type: "application/pdf", declared_size: pdf.length,
  expires_at: "2099-01-01T00:00:00Z", document_id: null as string | null,
};
const document = { id: "dddddddd-dddd-dddd-dddd-dddddddddddd", original_filename: "scan.pdf" };
let intentResult: { data: typeof intent | null; error: { code: string } | null };
let rpcResult: { data: typeof document | null; error: { code: string } | null };
let download: ReturnType<typeof vi.fn>;
let remove: ReturnType<typeof vi.fn>;
let rpc: ReturnType<typeof vi.fn>;
let filters: Array<[string, unknown]>;

function query(result: () => unknown) {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return q; }),
    is: vi.fn(() => q),
    maybeSingle: vi.fn(async () => result()),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  filters = [];
  mocks.role.mockResolvedValue({ userId: actor, role: "staff" });
  intentResult = { data: { ...intent }, error: null };
  rpcResult = { data: document, error: null };
  download = vi.fn(async () => ({ data: new Blob([pdf]), error: null }));
  remove = vi.fn();
  rpc = vi.fn(() => query(() => rpcResult));
  mocks.admin.mockReturnValue({
    from: (table: string) => query(() => table === "document_upload_intents" ? intentResult : { data: document, error: null }),
    storage: { from: () => ({ download, remove }) }, rpc,
  });
});

async function finalise(overrides = {}) {
  return POST(new NextRequest("http://localhost/api/finalize", {
    method: "POST", body: JSON.stringify({ storageKey: key, filename: "scan.pdf", category: "other", mime: "application/pdf", ...overrides }),
    headers: { "content-type": "application/json" },
  }), { params: Promise.resolve({ id: patient }) });
}

// These test the real handler and MIME detector; DB role/transaction semantics
// are exercised separately in protected_record_writes.test.sql.
describe("upload finalisation authority and non-destructive failures", () => {
  it("rejects an existing document key without an intent before touching Storage", async () => {
    intentResult.data = null;
    expect((await finalise({ mime: "image/png" })).status).toBe(404);
    expect(filters).toEqual(expect.arrayContaining([["storage_key", key], ["patient_id", patient], ["actor_user_id", actor]]));
    expect(download).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([{ mime: "image/png" }, { category: "id_copy" }, { filename: "replacement.pdf" }])("rejects changed intent metadata %j without deletion", async (changed) => {
    expect((await finalise(changed)).status).toBe(409);
    expect(download).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("rejects expired uploads without touching Storage", async () => {
    intentResult.data!.expires_at = "2000-01-01T00:00:00Z";
    expect((await finalise()).status).toBe(410);
    expect(download).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("registers a valid staff upload using server-measured size and hash", async () => {
    const response = await finalise();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ document });
    expect(rpc).toHaveBeenCalledWith("finalize_document_upload", expect.objectContaining({
      p_actor_user_id: actor, p_patient_id: patient, p_file_size: pdf.length,
      p_sha256: expect.stringMatching(/^[a-f0-9]{64}$/), p_mime: "application/pdf",
    }));
    expect(remove).not.toHaveBeenCalled();
  });
  it("rejects actual content mismatch without deleting the object", async () => {
    download.mockResolvedValue({ data: new Blob([Buffer.alloc(pdf.length, 65)]), error: null });
    expect((await finalise()).status).toBe(415);
    expect(remove).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects a truncated upload without deleting it", async () => {
    download.mockResolvedValue({ data: new Blob([pdf.subarray(0, 4)]), error: null });
    expect((await finalise()).status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
  });
  it("does not delete after a database failure or uncertain commit response", async () => {
    rpcResult = { data: null, error: { code: "PGRST000" } };
    expect((await finalise()).status).toBe(500);
    expect(remove).not.toHaveBeenCalled();
  });
  it("replays completed uploads without re-reading the original object or writing twice", async () => {
    intentResult.data!.document_id = document.id;
    intentResult.data!.expires_at = "2000-01-01T00:00:00Z";
    expect((await finalise()).status).toBe(201);
    expect(download).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
