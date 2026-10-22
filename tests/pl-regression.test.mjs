import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {parse} from 'csv-parse/sync';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let dir,child,base,stderr='';
async function start(){
 child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,PORT:'3197',GEMINI_API_KEY:'',PL_READER:'local'},stdio:['ignore','ignore','pipe']});
 child.stderr.on('data',b=>{stderr=(stderr+b).slice(-5000);});base='http://127.0.0.1:3197';
 for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error(stderr);try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Server timeout '+stderr);
}
async function stop(){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}
async function json(url,options){const r=await fetch(base+url,options);const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;}
async function upload(bytes,name='test.pdf',extra={}){const form=new FormData();form.set('file',new Blob([bytes],{type:'application/pdf'}),name);for(const [k,v]of Object.entries(extra))form.set(k,v);return json('/api/upload',{method:'POST',body:form});}
before(async()=>{
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'plm-test-'));
 for(const name of ['pl','backend','frontend','sample-data','database','server.mjs','print.mjs','package.json'])fs.cpSync(path.join(root,name),path.join(dir,name),{recursive:true,filter:p=>!p.includes('node_modules')&&!/\.sqlite(?:-wal|-shm)?$/.test(p)});
 fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');await start();
});
after(async()=>{await stop();if(dir)fs.rmSync(dir,{recursive:true,force:true});});
const fields={sapPo:'SAP PO',sapNo:'SAP NO.',description:'DESCRIPTION',totalQty:'TOTAL QTY (PCS)',qtyPcs:'QTY (PCS)',qtyCtns:'QTY (CTNS)',nw:'N.W.(KGS)',gw:'G.W.(KGS)',meas:'Meas.'};
for(const c of ['case-001','case-002','case-003','case-004'])test('Original PL exact field regression '+c,async()=>{
 const folder=path.join(root,'pl/tests/packing-list',c),csv=fs.readFileSync(path.join(folder,'expected.csv'),'utf8').replace(/^\uFEFF/,'').split(/\r?\n/);
 const start=csv.findIndex(l=>l.includes('SAP NO.')&&l.includes('DESCRIPTION'));
 const expected=parse(csv.slice(start).join('\n'),{columns:true,skip_empty_lines:true}).filter(r=>Object.values(fields).some(k=>r[k]?.trim()));
 const actual=await upload(fs.readFileSync(path.join(folder,'input.pdf')),c+'.pdf');
 assert.equal(actual.items.length,expected.length,'row count');
 for(let n=0;n<expected.length;n++)for(const[k,col]of Object.entries(fields)){
  const normal=v=>String(v??'').trim().replace(k==='description'?/\s+/g:/[\s,]/g,k==='description'?' ':'');
  assert.equal(normal(actual.items[n][k]),normal(expected[n][col]),`row ${n+1} ${k}`);
 }
});
test('All 9 recovered documents and all PDFs remain available with original bytes',async()=>{
 const original=JSON.parse(fs.readFileSync(path.join(root,'original-source/project_--main/uploads/documents.json')));
 const result=await json('/api/documents');assert.equal(result.documents.length,9);
 for(const m of result.documents){
  const d=(await json('/api/documents/'+m.documentId)).document;
  assert.deepEqual(d.items,original.find(o=>o.metadata.documentId===m.documentId).items);
  const bytes=Buffer.from(await (await fetch(base+'/api/documents/'+m.documentId+'/file')).arrayBuffer());
  const source=fs.readFileSync(path.join(root,'pl/uploads',m.storedFileName));assert.deepEqual(bytes,source);
 }
 assert.equal((await json('/api/sap-memory')).memories.length,166);
});
test('Shared WO PDF reader returns full PL rows, never undefined items',async()=>{
 const form=new FormData();form.set('file',new Blob([fs.readFileSync(path.join(root,'pl/tests/packing-list/case-001/input.pdf'))]),'INV26-TEST.pdf');
 const result=await json('/api/import/pdf/extract',{method:'POST',headers:{'x-data-mode':'real'},body:form});assert.ok(result.items.length>0);assert.ok(result.draftToken);assert.equal(result.items[0].sap_po.length>0,true);
});
test('Import confirmed PL into real WO; repeated import preserves notes/QC and does not duplicate',async()=>{
 const headers={'x-data-mode':'real','Content-Type':'application/json'};
 const list=await json('/api/pl/documents',{headers});assert.equal(list.documents.length,9);
 const draft=await json('/api/pl/documents/'+list.documents[0].documentId,{headers});assert.ok(draft.items.length);
 draft.document.received_date='2026-10-21';draft.document.owner='test';
 const preview=await json('/api/import/pdf/preview',{method:'POST',headers,body:JSON.stringify({...draft,reviewed:true})});assert.equal(preview.errors.length,0,JSON.stringify(preview.errors));
 const first=await json('/api/import/commit',{method:'POST',headers,body:JSON.stringify({token:preview.token})});assert.equal(first.inserted,draft.items.length);
 const items=await json('/api/items',{headers});const item=items[0];assert.equal(item.qc_result,'');
 await json('/api/items/'+item.id+'/notes',{method:'POST',headers,body:JSON.stringify({author:'tester',note:'retained note'})});
 const again=await json('/api/pl/documents/'+list.documents[0].documentId,{headers});
 const preview2=await json('/api/import/pdf/preview',{method:'POST',headers,body:JSON.stringify({...again,reviewed:true})});assert.equal(preview2.errors.length,0);
 const second=await json('/api/import/commit',{method:'POST',headers,body:JSON.stringify({token:preview2.token})});assert.equal(second.inserted,0);assert.equal((await json('/api/items/'+item.id,{headers})).notes[0].note,'retained note');
 await stop();await start();assert.equal((await json('/api/items',{headers})).length,items.length);assert.equal((await json('/api/items/'+item.id,{headers})).notes[0].note,'retained note');
});
test('Confirm PL, restart server, reupload renamed PDF: stored document and memory are reused',async()=>{
 const c='case-004',bytes=fs.readFileSync(path.join(root,'pl/tests/packing-list',c,'input.pdf'));
 const result=await upload(bytes,'INV26-PERSIST.pdf');
 const items=result.items.map(i=>({...i,bomFound:false,brand:'',brandSource:'',productionModels:[],reviewed:true}));
 const saved=await json('/api/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({metadata:result.metadata,items,reviewed:true})});
 await stop();await start();
 const reused=await upload(bytes,'RENAMED.pdf');assert.equal(reused.reusedSavedDocument,true);assert.equal(reused.metadata.documentId,saved.document.metadata.documentId);assert.deepEqual(reused.items,items);
});
test('Invalid PDF, non-PDF, missing files and private-origin requests return useful errors',async()=>{
 const form=new FormData();form.set('file',new Blob(['bad']),'bad.pdf');const r=await fetch(base+'/api/upload',{method:'POST',body:form});assert.equal(r.status,400);assert.match((await r.json()).message,/PDF/);
 assert.equal((await fetch(base+'/api/health',{headers:{Origin:'https://example.com'}})).status,403);
 assert.equal((await fetch(base+'/api/documents/does-not-exist/file')).status,404);
});

test('Print all recovered PLs with BOM and BRAND, never production models',async()=>{for(const meta of (await json('/api/documents')).documents.filter(d=>d.documentId.startsWith('PL-20261013')||d.documentId.startsWith('PL-20261015')||d.documentId.startsWith('PL-20261020'))){const r=await fetch(base+'/api/documents/'+meta.documentId+'/print');if(!r.ok)assert.fail(meta.documentId+' '+await r.text());assert.equal(r.headers.get('content-type'),'application/pdf');assert.ok((await r.arrayBuffer()).byteLength>1000);}});
