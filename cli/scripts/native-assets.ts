import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { typescriptExecutable } from "../src/tools/language";

export function nativeEntrySource(entry: string): string {
  const tsc=typescriptExecutable(), libraries=readdirSync(dirname(tsc)).filter(name=>name.endsWith(".d.ts")).sort();
  const quote=(path:string)=>JSON.stringify(path.replaceAll("\\","/"));
  const asset=(variable:string,path:string)=>`import ${variable} from ${quote(path)} with { type: "file" };`;
  const pwRoot=dirname(import.meta.resolve("playwright-core/package.json").replace(/^file:\/\//,""));
  const packageRoot=process.platform==="win32"&&/^\/[A-Za-z]:/.test(pwRoot)?pwRoot.slice(1):pwRoot;
  const files:string[]=[];const walk=(dir:string,prefix="")=>{for(const item of readdirSync(dir,{withFileTypes:true})){const name=prefix+item.name;if(item.isDirectory())walk(join(dir,item.name),name+"/");else if(item.isFile())files.push(name);}};walk(decodeURIComponent(packageRoot));files.sort();
  return [...files.map((name,index)=>asset(`pw${index}`,join(decodeURIComponent(packageRoot),name))),
    `import { setBundledPlaywright } from ${quote(resolve(import.meta.dir,"../src/browser/runtime.ts"))};`,
    `setBundledPlaywright({${files.map((name,index)=>`${JSON.stringify(name)}:pw${index}`).join(",")}});`,asset("asset",tsc),...libraries.map((name,index)=>asset(`lib${index}`,join(dirname(tsc),name))),
    `import { setBundledTypescript } from ${quote(resolve(import.meta.dir,"../src/tools/language.ts"))};`,
    `setBundledTypescript(asset,{${libraries.map((name,index)=>`${JSON.stringify(name)}:lib${index}`).join(",")}});`,
    `await import(${quote(entry)});`].join("\n");
}
