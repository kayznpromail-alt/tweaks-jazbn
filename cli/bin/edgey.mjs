import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const child=spawn(join(root,'node_modules','bun','bin',process.platform==='win32'?'bun.exe':'bun'),[join(root,'src','index.tsx'),...process.argv.slice(2)],{stdio:'inherit'});
child.on('error',()=>{console.error('run npm ci before starting edgey');process.exit(1)});
child.on('exit',code=>process.exit(code??1));
