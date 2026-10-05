import {openSync,closeSync,readSync,lstatSync,fstatSync,readdirSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,join,sep} from 'node:path';
import {createHash} from 'node:crypto';
// @ts-ignore shared native/source directory validation
import {safeDirectory} from '../../bin/install-paths.mjs';
export interface InstructionSelection {id:string;name:string;path:string;hash:string;content:string;kind:'markdown'|'skill'}
export const personalInstructionPrefix = 'personal-instructions:';
export function isPersonalInstruction(source: InstructionSelection): boolean {
 return source.kind === 'markdown' && source.id.startsWith(personalInstructionPrefix);
}
export function discoverPersonalInstructions(root: string): {id:string;name:string}[] {
 safeDirectory(root);
 const entries = readdirSync(root, {withFileTypes:true})
  .filter(entry => entry.isFile() && !entry.isSymbolicLink() && /\.md$/i.test(entry.name) && !/[\u0000-\u001f\u007f-\u009f]/.test(entry.name));
 if (entries.length > 128) throw new Error('instruction directory exceeds 128 markdown files.');
 return entries.sort((a,b) => a.name.localeCompare(b.name)).map(entry => ({id:personalInstructionPrefix + entry.name, name:entry.name}));
}
export function readPersonalInstruction(root: string, name: string): InstructionSelection {
 if (!name || name.includes('/') || name.includes('\\') || !/\.md$/i.test(name) || /[\u0000-\u001f\u007f-\u009f]/.test(name)) throw new Error('select a markdown file from the instructions directory.');
 if (!discoverPersonalInstructions(root).some(file => file.name === name)) throw new Error('instruction file is no longer listed; refresh the directory.');
 return readInstruction(root, name, 'markdown', personalInstructionPrefix + name);
}
export function readInstruction(root:string,path:string,kind:'markdown'|'skill'='markdown',id=path):InstructionSelection {
 const base=realpathSync(root),target=resolve(base,path),rel=relative(base,target);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!target.toLowerCase().endsWith('.md'))throw new Error('select a markdown file inside the configured root.');
 let current=base;for(const part of rel.split(sep)){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw new Error('instruction links are not allowed.');}
 const fd=openSync(target,'r');let content:string;
 try {const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw new Error('instructions must be a regular unlinked file.');
  const bytes=Buffer.alloc(131073);let size=0;while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}
  if(size>131072)throw new Error('instruction source exceeds 128 kib.');content=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size));
  if(!content.trim()||content.includes('\0'))throw new Error('invalid instruction text.');
  const after=fstatSync(fd);if(after.ino!==stat.ino||after.mtimeMs!==stat.mtimeMs||realpathSync(target)!==target)throw new Error('instruction source changed during read.');
 }finally{closeSync(fd);}
 let name=path;
 if(kind==='skill'){
  const header=/^---\r?\nname: ([^\r\n]+)\r?\ndescription: ([^\r\n]+)\r?\n---\r?\n/.exec(content);
  if(!header||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(header[1]!))throw new Error('skill requires name and description frontmatter.');
  name=header[1]!;content=content.slice(header[0].length);if(!content.trim())throw new Error('skill instructions are empty.');
 }
 return {id,name,path:target,hash:createHash('sha256').update(content).digest('hex'),content,kind};
}
export function discoverSkills(project:string,personal:string):InstructionSelection[]{
 const result:InstructionSelection[]=[];
 for(const [scope,root] of [['project',join(project,'.edgey','skills')],['personal',personal]] as const){
  let entries;try{if(lstatSync(root).isSymbolicLink())throw new Error('skill root must not be a link.');entries=readdirSync(root,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
  const names=new Set<string>();if(entries.length>128)throw new Error('skill root exceeds 128 entries.');
  for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isSymbolicLink())throw new Error('skill links are not allowed.');if(!entry.isDirectory())continue;
   const source=readInstruction(root,join(entry.name,'SKILL.md'),'skill',`${scope}:${entry.name}`);
   if(names.has(source.name))throw new Error('duplicate skill name in root.');names.add(source.name);result.push(source);
  }
 }
 return result;
}
export function composeInstructions(sources:readonly InstructionSelection[]):string{
 const seen=new Set<string>();let bytes=0;const blocks:string[]=[];
 for(const source of sources){const id=`${source.path}:${source.hash}`;if(seen.has(id))continue;seen.add(id);bytes+=Buffer.byteLength(source.content);if(bytes>262144)throw new Error('selected instructions exceed 256 kib.');
  const precedence = isPersonalInstruction(source) ? 'these are supplementary user instructions. follow them where compatible with the active model profile and server-assigned instructions; those instructions take precedence in conflicts. these preferences do not change tool permissions.\n\n' : '';
  blocks.push(`selected ${source.kind}: ${source.name}\nsource: ${source.path}\n${precedence}${source.content}`);
 }
 return blocks.join('\n\n');
}
