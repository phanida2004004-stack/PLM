import {spawn} from 'node:child_process';import net from 'node:net';import assert from 'node:assert/strict';
const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),PL_READER:'local'},stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',b=>{err=(err+b).slice(-3000);});
const base=`http://127.0.0.1:${port}`;
try{
 let ready=false;for(let n=0;n<150;n++){if(child.exitCode!==null)throw Error(err);try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'Server did not start');
 for(const route of ['/','/pl/','/pl/history.html','/pl/memory.html','/pl/assets/pl.css','/pl/assets/lucide.min.js','/pl/assets/sweetalert2.all.min.js']){const r=await fetch(base+route);assert.equal(r.status,200,route);assert.ok((await r.arrayBuffer()).byteLength>0);}
 const docs=await(await fetch(base+'/api/documents')).json();
 for(const meta of docs.documents){const r=await fetch(base+'/api/documents/'+encodeURIComponent(meta.documentId)+'/file');assert.equal(r.status,200,meta.documentId);assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0,5).toString(),'%PDF-');}
 const memory=await(await fetch(base+'/api/sap-memory')).json();assert.ok(Array.isArray(memory.memories));
 console.log(`SMOKE PASS · WO + PL + local assets + ${docs.documents.length} original PDFs + ${memory.memories.length} memories`);
}finally{await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill('SIGTERM');});}
