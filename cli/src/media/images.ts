import { ApiError } from "../api/errors";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ensureDirectory, readPrivate } from "../workspace/artifacts";
import { getDataDirectory } from "../storage/paths";

export interface ImageRef { hash: string; mime: "image/png" | "image/jpeg" | "image/webp"; bytes: number; width: number; height: number; name: string }
export const imageLimits = { count: 4, fileBytes: 5 * 1024 * 1024, totalBytes: 8 * 1024 * 1024, pixels: 25_000_000 };
const crc32=(data:Buffer)=>{let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function imageInfo(data: Buffer): Pick<ImageRef, "mime" | "width" | "height"> {
  if (!data.length || data.length > imageLimits.fileBytes) throw new Error("image must be between 1 byte and 5 mib");
  let width = 0, height = 0, mime: ImageRef["mime"];
  if (data.length >= 33 && data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    mime = "image/png";
    if (data.toString("ascii",12,16) !== "IHDR" || data.readUInt32BE(8) !== 13) throw new Error("invalid png header");
    width = data.readUInt32BE(16); height = data.readUInt32BE(20);
    let at = 8, end = false, pixels = false;
    while (at + 12 <= data.length) { const n = data.readUInt32BE(at), type = data.toString("ascii",at+4,at+8); if(at + n + 12 > data.length) break;
      if(crc32(data.subarray(at+4,at+8+n))!==data.readUInt32BE(at+8+n))throw new Error("damaged png checksum");
      if(type==="acTL")throw new Error("animated images are not supported");
      if(type === "IDAT") pixels = true; at += n + 12; if(type === "IEND") { end = n === 0 && at === data.length; break; } }
    if(!end || !pixels) throw new Error("incomplete png image");
  } else if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[data.length-2] === 255 && data[data.length-1] === 217) {
    mime = "image/jpeg";
    let at = 2;
    while(at + 4 <= data.length) { if(data[at++] !== 255) break; while(data[at] === 255) at++; const marker = data[at++];
      if(marker === 218 || marker === 217) break; if(marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const n = data.readUInt16BE(at); if(n < 2 || at + n > data.length) break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && n >= 8) { height=data.readUInt16BE(at+3); width=data.readUInt16BE(at+5); break; } at += n;
    }
  } else if(data.length >= 30 && data.toString("ascii",0,4)==="RIFF" && data.toString("ascii",8,12)==="WEBP" && data.readUInt32LE(4)+8===data.length) {
    mime="image/webp"; const kind=data.toString("ascii",12,16);
    if(kind==="VP8X") { if(data[20]&2) throw new Error("animated images are not supported"); width=1+data.readUIntLE(24,3);height=1+data.readUIntLE(27,3); }
    else if(kind==="VP8 " && data[23]===157 && data[24]===1 && data[25]===42) {width=data.readUInt16LE(26)&16383;height=data.readUInt16LE(28)&16383;}
    else if(kind==="VP8L" && data[20]===47) { const bits=data.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1; }
  } else throw new Error("unsupported or damaged image; use png, jpeg or webp");
  if(!width || !height || width*height>imageLimits.pixels) throw new Error("invalid image dimensions; maximum 25 megapixels");
  return {mime, width, height};
}
export function validateImages(value: unknown): ImageRef[] {
  if(!Array.isArray(value) || value.length>imageLimits.count) throw new Error("maximum 4 images per message");
  let total=0;
  for(const v of value) {
    if(!v || typeof v!=="object" || Object.keys(v).sort().join()!=="bytes,hash,height,mime,name,width" || !/^[a-f0-9]{64}$/.test(v.hash)
      || !["image/png","image/jpeg","image/webp"].includes(v.mime) || typeof v.name!=="string" || v.name.length>240 || /[\x00-\x1f\x7f]/.test(v.name)
      || ![v.bytes,v.width,v.height].every(n=>Number.isSafeInteger(n)&&n>0) || v.bytes>imageLimits.fileBytes || v.width*v.height>imageLimits.pixels) throw new Error("invalid image reference");
    total+=v.bytes;
  }
  if(total>imageLimits.totalBytes) throw new Error("images exceed 8 mib per message");
  return structuredClone(value);
}
export class ImageStore {
  readonly directory: string;
  constructor(root=getDataDirectory()) {this.directory=join(root,"images");}
  addFile(path:string):ImageRef {const fd=openSync(path,"r");try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>imageLimits.fileBytes)throw new Error("image must be a regular file up to 5 mib");return this.add(readFileSync(fd),basename(path));}finally{closeSync(fd);}}
  add(bytes:Buffer,name="image.png"):ImageRef {
    const info=imageInfo(bytes),ref:ImageRef={...info,hash:hash(bytes),bytes:bytes.length,name:basename(name).replace(/[\x00-\x1f\x7f]/g,"").slice(0,240)||"image"};
    ensureDirectory(this.directory);
    if(lstatSync(this.directory).isSymbolicLink())throw new Error("image storage cannot be a link");
    const target=join(this.directory,ref.hash);
    if(!existsSync(target)){const temp=join(this.directory,randomUUID()+".tmp");try{writeFileSync(temp,bytes,{flag:"wx",mode:0o600});renameSync(temp,target);}finally{if(existsSync(temp))unlinkSync(temp);}}
    this.read(ref);return ref;
  }
  read(ref:ImageRef):Buffer {
    validateImages([ref]);const path=join(this.directory,ref.hash);
    try { if(lstatSync(this.directory).isSymbolicLink()||lstatSync(path).isSymbolicLink())throw new Error();
      const bytes=readPrivate(path,imageLimits.fileBytes),info=imageInfo(bytes);
      if(bytes.length!==ref.bytes||hash(bytes)!==ref.hash||info.mime!==ref.mime||info.width!==ref.width||info.height!==ref.height)throw new Error();return bytes;
    }catch{throw new ApiError("image_unavailable");}
  }
  content(ref:ImageRef){return {type:"image_url" as const,image_url:{url:`data:${ref.mime};base64,${this.read(ref).toString("base64")}`}};}
}
