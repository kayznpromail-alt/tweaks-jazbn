import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { nativeEntrySource } from "./native-assets";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const bun = join(root, "node_modules", "bun", "bin", process.platform === "win32" ? "bun.exe" : "bun");
if (!existsSync(bun)) throw new Error("local bun runtime is missing; run npm ci first");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const candidate=process.argv.find(arg=>arg.startsWith("--candidate="))?.slice(12) ?? (process.argv.includes("--candidate")?"1":undefined);
if(candidate!==undefined&&!/^[a-z0-9-]{1,32}$/.test(candidate))throw new Error("invalid candidate label");
const output = join(root, "releases", `edgey-${pkg.version}${candidate ? `-candidate-${candidate}` : ""}-win-x64.exe`);
mkdirSync(join(root, "releases"), { recursive: true });
if (existsSync(output)) throw new Error("release exists; choose an unused immutable version");
const entry = join(root, "scripts", `.native-entry-${process.pid}.ts`);
writeFileSync(entry,nativeEntrySource(join(root,"src","native-entry.ts")));
let result;
try { result = spawnSync(bun, ["build", entry, "--define", "EDGEY_COMPILED=true", "--compile", "--outfile", output], { stdio: "inherit" }); }
finally { unlinkSync(entry); }
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(JSON.stringify({ output, bytes: readFileSync(output).byteLength, sourceIncluded: false }));

