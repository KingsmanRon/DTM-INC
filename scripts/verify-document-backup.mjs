import { readFile, realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
export async function verifyBackup(inventory, directory) {
  if(!Array.isArray(inventory)) throw new Error("Expected JSON inventory array");
  const root=await realpath(directory), results=[];
  const inside=p=>{const rel=relative(root,p);return rel!==".."&&!rel.startsWith("../")&&!rel.startsWith("..\\")&&!isAbsolute(rel);};
  for(const [index,row] of inventory.entries()) {
    if(typeof row.storage_key!=="string" || !/^[a-f0-9]{64}$/i.test(row.sha256_hash) || !Number.isSafeInteger(row.file_size) || row.file_size<0 || typeof row.mime_type!=="string") throw new Error(`Invalid inventory row ${index+1}`);
    const candidate=resolve(root,row.storage_key);
    if(!inside(candidate)) throw new Error(`Unsafe object path in row ${index+1}`);
    let file;
    try { file=await realpath(candidate); } catch(err) { if(err.code==="ENOENT") { results.push({row:index+1,status:"MISSING"});continue; } throw err; }
    if(!inside(file)) throw new Error(`Unsafe object symlink in row ${index+1}`);
    const metadata=await stat(file);
    if(!metadata.isFile()) throw new Error(`Object is not a file in row ${index+1}`);
    const digest=createHash("sha256");for await(const chunk of createReadStream(file)) digest.update(chunk);
    results.push({row:index+1,status:metadata.size===row.file_size&&digest.digest("hex").toLowerCase()===row.sha256_hash.toLowerCase()?"MATCH":"CORRUPT"});
  }
  return results;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{manifest:{type:"string"},root:{type:"string"}}});
  if(!values.manifest||!values.root) throw new Error("Supply --manifest and --root; offline verification only");
  const results=await verifyBackup(JSON.parse(await readFile(values.manifest,"utf8")),values.root);
  console.log(JSON.stringify(results));if(results.some(r=>r.status!=="MATCH")) process.exitCode=1;
}
