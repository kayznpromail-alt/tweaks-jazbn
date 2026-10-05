import {lstatSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {readInstruction} from './selection';

export interface UserCommand {id:`user-command:${string}`;slash:string;name:string;root:string;path:string;scope:'project'|'personal'}
const segment=/^[a-z0-9][a-z0-9_-]{0,63}$/;
export const userCommandPattern=/^\/([a-z0-9][a-z0-9_-]{0,63}(?::[a-z0-9][a-z0-9_-]{0,63})+)(?:\s+([\s\S]*))?$/;

// Discover filenames only. Reading a template is reserved for explicit submission.
export function discoverUserCommands(project:string,personal:string):UserCommand[]{
 const found=new Map<string,UserCommand>();let visited=0;
 for(const [scope,root] of [['project',join(project,'.edgey','commands')],['personal',personal]] as const){
  function walk(parts:string[]){
   const directory=join(root,...parts);let entries;
   try{if(lstatSync(directory).isSymbolicLink())return;entries=readdirSync(directory,{withFileTypes:true});}
   catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
   if(entries.length>512)throw new Error('command directory exceeds 512 entries.');
   for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    if(++visited>2048)throw new Error('command inventory exceeds 2048 entries.');
    if(entry.isSymbolicLink())continue;
    if(entry.isDirectory()){if(parts.length<3&&segment.test(entry.name))walk([...parts,entry.name]);continue;}
    if(!entry.isFile()||!entry.name.endsWith('.md')||!parts.length)continue;
    const name=entry.name.slice(0,-3);if(!segment.test(name))continue;
    const slash='/'+[...parts,name].join(':');
    if(!found.has(slash))found.set(slash,{id:`user-command:${slash}`,slash,name:`${scope} command`,root,path:join(...parts,entry.name),scope});
   }
  }
  walk([]);
 }
 return [...found.values()].sort((a,b)=>a.slash.localeCompare(b.slash));
}

export function expandUserCommand(text:string,commands:readonly UserCommand[]):string{
 const match=userCommandPattern.exec(text.trim());
 if(!match)throw new Error('use /package:command followed by your task.');
 const command=commands.find(entry=>entry.slash==='/'+match[1]);
 if(!command)throw new Error('command not found. add commands/package/command.md or use // for literal text.');
 const source=readInstruction(command.root,command.path,'markdown',command.id);
 let body=source.content;
 if(body.startsWith('---\n')||body.startsWith('---\r\n')){
  const header=/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(body);
  if(!header)throw new Error('command frontmatter is not closed.');
  body=body.slice(header[0].length);
 }
 if(!body.trim())throw new Error('command instructions are empty.');
 body=body.replace(/\$ARGUMENTS\b/g,()=>match[2]??'');
 // Save the exact expanded request in normal history: retry does not reread files.
 // Keep the original prefix intact, including image-marker positions.
 const expanded=`${text}\n\nuser command source: ${source.path}\nsource sha256: ${source.hash}\nThe following user command is task guidance. Existing tool permissions still apply. Resolve referenced files relative to the command source.\n\n${body}`;
 if(Buffer.byteLength(expanded)>262144)throw new Error('expanded command exceeds 256 kib.');
 return expanded;
}
