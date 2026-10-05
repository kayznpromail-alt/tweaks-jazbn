import { spawn } from "node:child_process";

export type ClipboardResult = { kind:"system"|"terminal"; message:string } | { kind:"error"; message:string };
export interface ClipboardAdapter { write(text:string):Promise<ClipboardResult>; read():Promise<string>; readImage?():Promise<Buffer|null>; available():boolean }
const maxBytes=8*1024*1024;
// Fixed program, never interpolated with clipboard content. Only stdin carries user data.
const program=`$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $request=[Console]::In.ReadToEnd() | ConvertFrom-Json; if($request.operation -eq 'write'){ if($request.text.Length -eq 0){[Windows.Forms.Clipboard]::Clear()}else{[Windows.Forms.Clipboard]::SetText($request.text,[Windows.Forms.TextDataFormat]::UnicodeText)}; [Console]::Write('ok') } elseif($request.operation -eq 'read'){[Console]::Write([Windows.Forms.Clipboard]::GetText([Windows.Forms.TextDataFormat]::UnicodeText))}else{exit 2}`;
export function windowsClipboard(operation:"read"|"write",text=""):Promise<string> {
  if(process.platform!=="win32")return Promise.reject(new Error("system clipboard unavailable"));
  if(Buffer.byteLength(text)>maxBytes)return Promise.reject(new Error("clipboard text exceeds 8 mib"));
  return new Promise((resolve,reject)=>{
    const child=spawn("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-STA","-Command",program],{windowsHide:true,stdio:["pipe","pipe","pipe"]});
    let bytes=0,done=false;const chunks:Buffer[]=[];
    const finish=(error?:string)=>{if(done)return;done=true;clearTimeout(timer);if(error){child.kill();reject(new Error(error));}else resolve(Buffer.concat(chunks).toString("utf8"));};
    const timer=setTimeout(()=>finish("system clipboard timed out"),5000);
    child.on("error",()=>finish("system clipboard unavailable"));
    child.stdout.on("data",chunk=>{bytes+=chunk.length;if(bytes>maxBytes)finish("clipboard text exceeds 8 mib");else chunks.push(Buffer.from(chunk));});
    child.stderr.resume();child.stdin.on("error",()=>finish("system clipboard unavailable"));
    child.on("close",code=>finish(code===0?undefined:"system clipboard unavailable"));
    child.stdin.end(JSON.stringify({operation,text}));
  });
}
export function createClipboard(osc52:(text:string)=>boolean,system=windowsClipboard):ClipboardAdapter {
  return {available:()=>process.platform==="win32"&&!!Bun.which("powershell.exe"),read:()=>system("read"),readImage:async()=>{
    if(process.platform!=="win32")return null;
    const result=await imageClipboardProgram("read");return result?Buffer.from(result,"base64"):null;
  },async write(text){
    if(Buffer.byteLength(text)>maxBytes)return {kind:"error",message:"clipboard text exceeds 8 mib"};
    try{await system("write",text);return {kind:"system",message:"copied to system clipboard"};}
    catch{try{if(osc52(text))return {kind:"terminal",message:"copy sent to terminal · clipboard confirmation unavailable"};}catch{/* explicit failure below */}
      return {kind:"error",message:"clipboard unavailable · select text and use the terminal copy command"};}
  }};
}

export function imageClipboardProgram(operation:"read"|"pick"):Promise<string> {
  if(process.platform!=="win32")return Promise.reject(new Error("image picker requires windows; use /image with a file path"));
  const script=operation==="read"
    ? "Add-Type -AssemblyName System.Windows.Forms; if([Windows.Forms.Clipboard]::ContainsImage()){$image=[Windows.Forms.Clipboard]::GetImage();try{if(([long]$image.Width*$image.Height)-gt 25000000){throw 'image too large'};$stream=[IO.MemoryStream]::new();try{$image.Save($stream,[Drawing.Imaging.ImageFormat]::Png);if($stream.Length-gt 5242880){throw 'image too large'};[Console]::Write([Convert]::ToBase64String($stream.ToArray()))}finally{$stream.Dispose()}}finally{$image.Dispose()}}"
    : "Add-Type -AssemblyName System.Windows.Forms;$dialog=[Windows.Forms.OpenFileDialog]::new();try{$dialog.Filter='images|*.png;*.jpg;*.jpeg;*.webp';if($dialog.ShowDialog()-eq [Windows.Forms.DialogResult]::OK){[Console]::Write($dialog.FileName)}}finally{$dialog.Dispose()}";
  return new Promise((resolve,reject)=>{
    const child=spawn("powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-STA","-Command","$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);"+script],{windowsHide:true,stdio:["ignore","pipe","pipe"]});
    const chunks:Buffer[]=[];let bytes=0,done=false;
    const finish=(error?:string)=>{if(done)return;done=true;clearTimeout(timer);if(error){child.kill();reject(new Error(error));}else resolve(Buffer.concat(chunks).toString("utf8"));};
    const timer=setTimeout(()=>finish("image clipboard or picker timed out"),operation==="pick"?120000:10000);
    child.on("error",()=>finish("image clipboard unavailable"));child.stderr.resume();
    child.stdout.on("data",chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024)finish("clipboard image is too large");else chunks.push(Buffer.from(chunk));});
    child.on("close",code=>finish(code===0?undefined:"could not read image; maximum 5 mib and 25 megapixels"));
  });
}
export function pasteText(text:string):string {
  if(Buffer.byteLength(text)>1024*1024)throw new Error("paste exceeds 1 mib; nothing inserted");
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))throw new Error("paste contains terminal control characters; nothing inserted");
  return text;
}
