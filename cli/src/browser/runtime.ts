import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDataDirectory } from "../storage/paths";
import { ensureDirectory } from "../workspace/artifacts";
let assets:Record<string,string>|undefined;
let loaded:typeof import("playwright-core")|undefined;
export function setBundledPlaywright(value:Record<string,string>){assets=value;}
export function playwright():typeof import("playwright-core") {
  if(loaded)return loaded;
  if(!assets)return loaded=createRequire(import.meta.url)("playwright-core");
  const root=join(getDataDirectory(),"runtime","playwright-1.63.0");
  for(const [name,asset] of Object.entries(assets)){
    if(name.includes("..")||name.startsWith("/")||name.includes("\\"))throw new Error("invalid browser runtime asset");
    const file=join(root,name),bytes=readFileSync(asset);ensureDirectory(dirname(file));
    if(!existsSync(file))try{writeFileSync(file,bytes,{flag:"wx",mode:0o600});}catch(error){if(!existsSync(file))throw error;}
    if(createHash("sha256").update(readFileSync(file)).digest("hex")!==createHash("sha256").update(bytes).digest("hex"))throw new Error("browser runtime integrity check failed");
  }
  return loaded=createRequire(join(root,"index.js"))(join(root,"index.js"));
}
