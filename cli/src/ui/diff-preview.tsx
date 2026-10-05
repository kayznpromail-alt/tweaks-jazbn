import { useTerminalDimensions } from "@opentui/react";
import { displayText, theme } from "./theme";

export function diffRows(source:string, limit=12, width=100) {
  let oldLine=0,newLine=0,insideHunk=false;
  const rows:{kind:"add"|"remove"|"context"|"hunk";number:string;text:string}[]=[];
  for(const line of displayText(source).split("\n")){
    if(/^(diff --git|index |--- |\+\+\+ |\\ No newline)/.test(line))continue;
    const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if(hunk){insideHunk=true;oldLine=Number(hunk[1]);newLine=Number(hunk[2]);rows.push({kind:"hunk",number:"",text:`lines ${hunk[1]} → ${hunk[2]}`});continue;}
    if(!insideHunk||!/^[-+ ]/.test(line))continue;
    const kind=line[0]==="+"?"add":line[0]==="-"?"remove":"context";
    const number=kind==="remove"?String(oldLine++):String(newLine++);
    if(kind==="context")oldLine++;
    const text=line.slice(1).replace(/\t/g,"  "),cap=Math.max(12,width-12);
    rows.push({kind,number,text:text.length>cap?text.slice(0,cap-1)+"…":text});
  }
  return {rows:rows.slice(0,limit),omitted:Math.max(0,rows.length-limit)};
}
export function DiffPreview({source,onOutput}:{source:string;onOutput?:()=>void}) {
  const {width}=useTerminalDimensions(), {rows,omitted}=diffRows(source,width<60?6:12,width);
  return <box id="change-preview" flexDirection="column" flexShrink={0} marginTop={1}>
    {rows.map((row,index)=><text key={index} wrapMode="none" height={1}
      fg={row.kind==="add"?theme.accentBright:row.kind==="remove"?theme.error:theme.muted}>
      {`${row.kind==="hunk"?"    ":row.number.padStart(4)} ${row.kind==="add"?"+":row.kind==="remove"?"−":" "} ${row.text}`}
    </text>)}
    <text fg={theme.info} selectable={false} onMouseDown={onOutput}>{`${omitted?`${omitted} more lines · `:""}open full recorded output →`}</text>
  </box>;
}
