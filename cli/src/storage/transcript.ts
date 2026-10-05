import type { Database } from "bun:sqlite";
import type { DurableStore } from "../types";
import type { TranscriptEntry,TranscriptFilter } from "../core/transcript";

const caches=new WeakMap<Database,Map<string,TranscriptEntry>>();
const initialized=new WeakSet<Database>();
/** Only event references are scanned. Contexts and run metadata are never selected. */
export function readTranscriptPage(db:Database,store:DurableStore,sessionId:string,offset:number|undefined,filter:TranscriptFilter,limit:number,anchor?:string) {
  // Connection-local display index: no migration or historical record is modified.
  // Finished request output is inspected for its validation marker once per revision.
  if(!initialized.has(db)){db.run("CREATE TEMP TABLE transcript_validation (id TEXT PRIMARY KEY, revision INTEGER, present INTEGER)");initialized.add(db);}
  db.query(`INSERT INTO temp.transcript_validation(id,revision,present)
    SELECT q.id,q.revision,coalesce(json_type(q.output,'$.validation')='object',0)
    FROM request_attempts q JOIN runs u ON u.id=q.run_id
    LEFT JOIN temp.transcript_validation v ON v.id=q.id
    WHERE u.session_id=? AND (v.id IS NULL OR v.revision<>q.revision)
    ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,present=excluded.present`).run(sessionId);
  const prefix=`WITH m AS MATERIALIZED (SELECT CAST(j.key AS INTEGER) mi,j.value message,json_extract(j.value,'$.id') mid
    FROM sessions s,json_each(s.messages) j WHERE s.id=$session),
    r AS MATERIALIZED (SELECT m.mi,q.id,q.run_id,q.sequence,q.revision,v.present FROM m JOIN runs u ON u.id=m.mid AND u.session_id=$session JOIN request_attempts q ON q.run_id=u.id JOIN temp.transcript_validation v ON v.id=q.id),
    events AS (
      SELECT 'message' kind,mid id,mi,-1 ri,0 stage,0 ti,0 revision FROM m WHERE NOT EXISTS(SELECT 1 FROM r WHERE r.run_id=m.mid)
      UNION ALL SELECT 'request',id,mi,sequence,0,0,revision FROM r
      UNION ALL SELECT 'validation',id,mi,sequence,1,0,revision FROM r WHERE present=1
      UNION ALL SELECT 'tool',t.id,r.mi,r.sequence,2,t.sequence,t.revision FROM r JOIN tool_executions t ON t.request_id=r.id AND t.run_id=r.run_id
    ), selected AS (SELECT * FROM events WHERE ${filter==="tools"?"kind IN ('tool','validation')":filter==="changes"?"kind='tool' AND id IN (SELECT id FROM tool_executions WHERE name IN ('prepare_change','apply_change','undo_change'))":"1"})`;
  const total=(db.query(prefix+" SELECT count(*) count FROM selected").get({session:sessionId}) as {count:number}).count;
  let start=Math.min(offset??Math.max(0,total-limit),Math.max(0,total-1));
  if(anchor){const row=db.query(prefix+" SELECT n FROM (SELECT id,mi,row_number() OVER (ORDER BY mi,ri,stage,ti,id)-1 n FROM selected) WHERE id=$anchor OR mi=(SELECT mi FROM m WHERE mid=$anchor) ORDER BY n LIMIT 1").get({session:sessionId,anchor}) as {n:number}|null;if(row)start=row.n;}
  const refs=db.query(prefix+" SELECT * FROM selected ORDER BY mi,ri,stage,ti,id LIMIT $limit OFFSET $offset").all({session:sessionId,limit,offset:start}) as {kind:string;id:string;revision:number}[];
  let cache=caches.get(db);if(!cache){cache=new Map();caches.set(db,cache);}
  const entries=refs.map(ref=>{
    const key=`${sessionId}:${ref.kind}:${ref.id}:${ref.revision}`,saved=ref.kind!=="message"?cache!.get(key):undefined;
    if(saved)return saved;
    let entry:TranscriptEntry;
    if(ref.kind==="message"){
      const row=db.query("SELECT j.value message FROM sessions s,json_each(s.messages) j WHERE s.id=? AND json_extract(j.value,'$.id')=?").get(sessionId,ref.id) as {message:string};
      const m=JSON.parse(row.message);entry={id:ref.id,kind:m.role,title:m.role==="user"?"you":m.model??"assistant",content:m.content,status:m.status};
    }else if(ref.kind==="tool"){
      const tool=store.readTranscriptTool!(sessionId,ref.id)!;entry={id:ref.id,kind:"tool",title:tool.name,content:"",status:tool.status,outputId:ref.id,tool};
    }else{
      const row=db.query("SELECT model,status,sequence,output FROM request_attempts WHERE id=?").get(ref.id) as {model:string;status:string;sequence:number;output:string|null};
      const output=row.output?JSON.parse(row.output):{};
      if(ref.kind==="validation")entry={id:ref.id+":validation",kind:"validation",title:output.validation.exhausted?"arguments rejected · correction limit reached":`arguments rejected · correction ${output.validation.repair}/2`,content:output.validation.issues.map((issue:any)=>`${issue.tool} → ${issue.path}\nexpected ${issue.expected}; received ${issue.receivedType}\nnot executed`).join("\n\n")};
      else{const content=output.content??"";entry={id:ref.id,kind:"request",title:`round ${row.sequence+1} · ${row.model}`,status:row.status,content:content.length>16000?content.slice(0,16000)+"\n[preview shortened · click round heading for full output]":content,outputId:ref.id};}
    }
    if(ref.kind!=="message"&&JSON.stringify(entry).length<64000){cache!.set(key,entry);while(cache!.size>64)cache!.delete(cache!.keys().next().value!);}
    return entry;
  });
  return {entries,total,start,end:Math.min(total,start+limit),pageSize:limit};
}
