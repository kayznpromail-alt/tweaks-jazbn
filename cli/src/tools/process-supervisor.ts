export const supervisor = `const {args,cwd}=JSON.parse(process.env.EDGEY_PROCESS_ARGV); delete process.env.EDGEY_PROCESS_ARGV;
const alive=setInterval(()=>{},1000); let p;
process.on("message",async message=>{
if(message==="launch" && !p) {
try { p=Bun.spawn(args,{cwd,stdin:"pipe",stdout:"inherit",stderr:"inherit",env:process.env,windowsVerbatimArguments:process.platform==="win32" && /(?:^|[\\\\/])cmd\\.exe$/i.test(args[0])});
process.send({type:"started",pid:p.pid}); p.exited.then(code=>process.send({type:"exit",code,signal:p.signalCode}));
} catch { process.send({type:"error"}); }
} else if(message?.type==="input" && p) {
try { if(message.text) { p.stdin.write(message.text); await p.stdin.flush(); } if(message.eof) await p.stdin.end();
process.send({type:"input",id:message.id,ok:true}); } catch { process.send({type:"input",id:message.id,ok:false}); }
}}); process.send({type:"ready"});`;
