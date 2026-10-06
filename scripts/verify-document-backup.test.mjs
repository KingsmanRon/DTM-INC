import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyBackup } from "./verify-document-backup.mjs";
it("distinguishes matching, corrupt and missing objects without disclosing keys",async()=>{
 const root=await mkdtemp(join(tmpdir(),"practice-backup-test-"));
 try {
  const bytes=Buffer.from("synthetic report");await writeFile(join(root,"object"),bytes);
  const row={storage_key:"object",sha256_hash:createHash("sha256").update(bytes).digest("hex"),file_size:bytes.length,mime_type:"application/pdf"};
  expect(await verifyBackup([row,{...row,file_size:0},{...row,storage_key:"missing"}],root)).toEqual([{row:1,status:"MATCH"},{row:2,status:"CORRUPT"},{row:3,status:"MISSING"}]);
  await expect(verifyBackup([{...row,storage_key:"../escape"}],root)).rejects.toThrow(/Unsafe/);
 } finally { await rm(root,{recursive:true,force:true}); }
});
