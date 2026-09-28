import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const pattern = /DTM|Mtshali|Sebokeng|Moshoeshoe|1144286|Nkanyezi|Naledi|Clinix|Fountain|Mediclinic|Midvaal|Vereeniging|Carletonville|Fochville|MBBCh|BSc \(Lab Med\)|SMU|WITS|016 420|018 788|084 340|\b(NKA|FOU|MID)\b/i;
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if ([".temp", ".branches", "business", "evidence"].includes(entry.name)) continue;
    const path = join(dir,entry.name).replaceAll("\\","/");
    if (entry.isDirectory()) walk(path);
    else if (/\.(ts|tsx|sql|js|mjs|json|md|toml|css|yml|yaml|html)$/.test(path) && !/docs\/client-|scripts\/audit-practice-values\.mjs$/.test(path)) files.push(path);
  }
}
for (const dir of ["src","supabase","docs","public","scripts",".github","config"]) walk(dir);
files.push(".env.example","README.md","SPEC.md","package.json","tailwind.config.ts");
const hits = [];
for (const path of files.sort()) {
  readFileSync(path,"utf8").split(/\r?\n/).forEach((line,index) => {
    if (!pattern.test(line)) return;
    const category = /test\.|supabase\/tests/.test(path) ? "test/demo fixture"
      : /logo|\.png|favicon|brand\/README/.test(line + path) ? "branding asset"
      : /hashtext|dtm_audit_chain|accent-dtm|DRAFT_STORAGE_KEY|DISMISS_KEY|x-dtm-service|CustomEvent|health\/route|package\.json|project_id/.test(line + path) ? "global product behaviour"
      : "per-practice configuration";
    hits.push({ file: path, line: index+1, category, text: line.trim() });
  });
}
for (const path of ["public/brand/logo.png","public/brand/Dr. T. Mtshali_LOGO - PDF.png","public/icons/favicon.ico","public/icons/favicon-192x192.png","public/icons/favicon-512x512.png","public/icons/apple-touch-icon.png","public/favicon.ico","public/apple-touch-icon.png"])
  hits.push({ file:path,line:0,category:"branding asset",text:"Legacy DTM binary asset; excluded from client staging" });
mkdirSync("docs/evidence",{recursive:true});
writeFileSync("docs/evidence/practice-value-inventory.json",JSON.stringify(hits,null,2)+"\n");
console.log(`Recorded ${hits.length} residual practice references. See docs/client-practice-value-audit.md for disposition.`);
