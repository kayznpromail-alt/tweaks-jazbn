import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserManager } from "./manager";
import { ImageStore } from "../media/images";
import { imageClipboardProgram } from "../ui/clipboard";

/** Explicit native acceptance; never loads credentials, history, or a customer site. */
export async function browserCheck(){
  const root=mkdtempSync(join(tmpdir(),"edgey-native-browser-")),manager=new BrowserManager(root);
  const server=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response('<html><title>edgey browser check</title><body><h1>local browser acceptance</h1><input aria-label="fixture"><button>fixture button</button></body></html>',{headers:{"content-type":"text/html"}})});
  try{
    const signal=new AbortController().signal;
    const page=await manager.execute("native-check","open",{url:`http://127.0.0.1:${server.port}`},signal) as any;
    if(!page.ok||!page.text.includes("local browser acceptance"))throw new Error("native browser read failed");
    const shot=await manager.execute("native-check","screenshot",{},signal) as any;
    if(!shot.ok||new ImageStore(root).read(shot.image).length<100)throw new Error("native browser screenshot failed");
    let clipboard=false;
    if(process.env.EDGEY_TEST_IMAGE_CLIPBOARD==="1"){
      const bytes=await imageClipboardProgram("read");if(!bytes)throw new Error("native image clipboard empty");new ImageStore(root).add(Buffer.from(bytes,"base64"));clipboard=true;
    }
    console.log(JSON.stringify({ok:true,native:typeof EDGEY_COMPILED!=="undefined",browser:true,screenshot:true,clipboard,credentialsAccessed:false}));
  }finally{await manager.dispose();server.stop(true);rmSync(root,{recursive:true,force:true});}
}
declare const EDGEY_COMPILED:boolean;
