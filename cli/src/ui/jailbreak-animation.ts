import { renderEdgey } from "./logo-model";
export const transitionDuration = 1200;
const clamp = (n:number) => Math.max(0,Math.min(1,Number.isFinite(n)?n:0));
export function waveAtRow(row:number, rows:number, progress:number, enabling:boolean):number {
 const value = clamp((progress * 1.2 - row / Math.max(1,rows-1)) / .2);
 return enabling ? value : 1-value;
}
type Dot = {x:number;y:number;char:string};
const cache = new Map<string,{source:Dot[];target:Dot[];first:string;last:string}>();
export function sampleJailbreakTransition(elapsedMs:number,width:number,height:number,enabling:boolean):string {
 if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>240||height>96) return "";
 const key = `${width}:${height}:${enabling}`;
 let data = cache.get(key);
 if (!data) {
  const first=renderEdgey(width,height,-.32,.24,"EDGEY"), last=renderEdgey(width,height,-.32,.24,"EDGEY");
  const dots=(frame:string):Dot[]=>frame.split("\n").flatMap((row,y)=>[...row].flatMap((char,x)=>char===" "?[]:[{x,y,char}])).filter((_,i)=>i%Math.max(1,Math.ceil(width*height/3000))===0);
  data={first,last,source:dots(first),target:dots(last)};if(cache.size>=8)cache.delete(cache.keys().next().value!);cache.set(key,data);
 }
 const time=Math.max(0,elapsedMs);if(time<=180)return data.first;if(time>=1200)return data.last;
 const t=clamp((time-180)/1020), settle=t*t*(3-2*t), spread=Math.sin(Math.PI*t);
 const grid=Array.from({length:height},()=>Array<string>(width).fill(" "));
 const count=Math.max(data.source.length,data.target.length);
 for(let i=0;i<count;i++) {
  const a=data.source[i%data.source.length],b=data.target[i%data.target.length];if(!a||!b)continue;
  const angle=((i*2654435761)>>>0)/4294967296*Math.PI*2;
  const x=Math.round(a.x+(b.x-a.x)*settle+Math.cos(angle)*width*.22*spread);
  const y=Math.round(a.y+(b.y-a.y)*settle+(Math.sin(angle)*height*.4+height*.25)*spread);
  if(x>=0&&x<width&&y>=0&&y<height)grid[y]![x]=t<.5?a.char:b.char;
 }
 return grid.map(row=>row.join("")).join("\n");
}
