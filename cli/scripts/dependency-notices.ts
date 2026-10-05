import {readFileSync,writeFileSync,readdirSync,existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";

// Enumerate the exact installed lockfile packages, including native and build tooling.
// Never export arbitrary application files or read user configuration.
const root=resolve(import.meta.dir,".."),lock=JSON.parse(readFileSync(join(root,"package-lock.json"),"utf8"));
const packages:unknown[]=[],notices:string[]=[];
for(const [location,record] of Object.entries(lock.packages) as [string,any][]){
  if(!location||!existsSync(join(root,location,"package.json")))continue;
  const directory=join(root,location),pkg=JSON.parse(readFileSync(join(directory,"package.json"),"utf8"));
  if(pkg.version!==record.version)throw new Error(`installed version mismatch: ${location}`);
  const files=readdirSync(directory).filter(name=>/^(license|licence|notice|copying|thirdparty)/i.test(name)&&!name.endsWith(".json"));
  if(pkg.name==="typescript"&&existsSync(join(directory,"vendor/vscode-jsonrpc/License.txt")))files.push("vendor/vscode-jsonrpc/License.txt");
  const documents=files.map(name=>{const content=readFileSync(join(directory,name),"utf8");notices.push(`## ${pkg.name} ${pkg.version} — ${name}\n\n${content}\n`);return {path:name,sha256:createHash("sha256").update(content).digest("hex")};});
  packages.push({name:pkg.name,version:pkg.version,location,license:pkg.license??record.license??"unspecified",integrity:record.integrity,documents});
}
const runtime=join(root,"BUN_RUNTIME_NOTICES.txt");
if(existsSync(runtime))notices.push(readFileSync(runtime,"utf8"));
writeFileSync(join(root,"DEPENDENCIES.json"),JSON.stringify({format:1,applicationVersion:lock.version,scope:"installed lockfile packages; includes build/test tooling, not a binary reachability assertion",packages},null,2)+"\n");
writeFileSync(join(root,"THIRD_PARTY_NOTICES.txt"),"# third-party notices\n\nverbatim notices from the exact installed packages; capitalization below belongs to their authors. runtime references appear at the end.\n\n"+notices.join("\n"));
console.log(JSON.stringify({packages:packages.length,documents:notices.length}));
