import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import ExcelJS from 'exceljs';
import {Store,ROOT} from '../src/database.js';
import {createApp} from '../src/app.js';
import {parseFile} from '../src/imports.js';
import {COLUMNS,validateRows,parseDate,itemId} from '../src/validation.js';
const demo=await parseFile(fs.readFileSync(path.join(ROOT,'sample-data/demo.csv')),'demo.csv');
const fresh=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-test-'));return {dir,store:new Store(path.join(dir,'test.sqlite'))};};
test('Demo source: five invoices, 25 items, isolated SAP repeats, correct totals',()=>{
  assert.equal(demo.errors.length,0);const {store,dir}=fresh();try{
    assert.deepEqual(store.importRows(demo.rows),{inserted:25,updated:0,unchanged:0});
    assert.deepEqual(store.dashboard().summary,{invoices:5,total:25,completed:12,pending:4,waiting:6,review:3});
    const invoices=store.dashboard().invoices;
    assert.equal(invoices.filter(i=>i.status==='เปิดครบแล้ว').length,2);
    assert.equal(invoices.find(i=>i.invoice_no==='INV-DEMO-105').summary.completed,2);
    assert.equal(invoices.find(i=>i.invoice_no==='INV-DEMO-103').summary.completed,0);
    assert.equal(store.items().filter(i=>i.sap_no==='7000101').length,5);
    assert.deepEqual(store.importRows(demo.rows),{inserted:0,updated:0,unchanged:25});
  }finally{store.close();fs.rmSync(dir,{recursive:true});}
});
test('validation blocks conflicting duplicate, missing identifiers, invalid dates and malformed booleans',async()=>{
  const bad=await parseFile(fs.readFileSync(path.join(ROOT,'sample-data/invalid-duplicate.csv')),'invalid.csv');assert.ok(bad.errors.length>=2);
  const dup=await parseFile(fs.readFileSync(path.join(ROOT,'sample-data/duplicate-identical.csv')),'dup.csv');assert.equal(dup.rows.length,1);assert.equal(dup.errors.length,0);assert.ok(dup.warnings.length);
  assert.throws(()=>parseDate('2026-02-30'));assert.equal(parseDate('21/10/2569'),'2026-10-21');
  const row={...demo.rows[0],wo_verified:'perhaps'};assert.ok(validateRows(COLUMNS,[COLUMNS.map(c=>row[c])]).errors.length);
  assert.ok(validateRows(['sap_no'],[['123']]).errors.length);
});
test('item references remain stable; conflicting SAP and WO assignments are refused',()=>{
  const {store,dir}=fresh();try{
    store.importRows([demo.rows[0]]);
    assert.throws(()=>store.importRows([{...demo.rows[0],sap_no:'9999999'}]));
    assert.throws(()=>store.importRows([{...demo.rows[1],wo_number:demo.rows[0].wo_number}]));
    assert.equal(store.items().length,1);
  }finally{store.close();fs.rmSync(dir,{recursive:true});}
});
test('local notes and confirmations persist; changed source invalidates confirmation and keeps audit',()=>{
  const {store,dir}=fresh();try{
    const row=demo.rows[1];store.importRows([row]);const item=store.items()[0];
    store.addNote(item.id,'ติดตาม QC แล้ว','Tester');
    const payload={qc_result:'REJECT',qc_date:'2026-10-20',qc_reference:'Evidence',direct_confirmed:false,direct_by:'',wo_number:'WO-CONFIRM-1',wo_model:'Inspection_Assembly',wo_verified:true,wo_reference:'Verified SAP Export'};
    store.confirm(item.id,payload,'Tester','Checked proof',item.source_hash);
    assert.equal(store.detail(item.id).status,'completed');
    store.importRows([row]);assert.equal(store.detail(item.id).status,'completed');
    store.importRows([{...row,qc_result:'ACCEPT'}]);
    const changed=store.detail(item.id);assert.equal(changed.status,'review');assert.equal(changed.confirmation_stale,true);assert.equal(changed.notes.length,1);assert.ok(changed.history.length>=4);
    assert.throws(()=>store.confirm(item.id,payload,'Tester','old preview',item.source_hash));
    const newProcess=spawnSync(process.execPath,['--input-type=module','-e',`import {Store} from ${JSON.stringify(path.join(ROOT,'backend/src/database.js'))};const s=new Store(${JSON.stringify(path.join(dir,'test.sqlite'))});const d=s.detail(${JSON.stringify(item.id)});console.log(JSON.stringify({notes:d.notes.length,status:d.status,confirmed:d.confirmed_by}));s.close();`],{encoding:'utf8'});
    assert.equal(newProcess.status,0);assert.deepEqual(JSON.parse(newProcess.stdout),{notes:1,status:'review',confirmed:'Tester'});
  }finally{store.close();fs.rmSync(dir,{recursive:true});}
});
test('manual WO number cannot be reused by later import',()=>{
  const {store,dir}=fresh();try{store.importRows([demo.rows[1]]);const i=store.items()[0];store.confirm(i.id,{qc_result:'REJECT',wo_number:'WO-LOCAL-42',wo_model:'Inspection_Assembly',wo_verified:true,wo_reference:'Export'},'Tester','Proof',i.source_hash);assert.ok(store.existingErrors([{...demo.rows[3],wo_number:'WO-LOCAL-42'}]).length);}finally{store.close();fs.rmSync(dir,{recursive:true});}
});
test('HTTP APIs: preview/commit, mode separation, notes, confirmations, export, Sheets setup errors',async()=>{
  const a=fresh(),b=fresh(),server=createApp({demo:a.store,real:b.store}).listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
  const root='http://127.0.0.1:'+server.address().port;
  const req=async(p,{mode='demo',...options}={})=>fetch(root+'/api'+p,{...options,headers:{'x-data-mode':mode,...options.headers}});
  const json=(body)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  try{
    const upload=new FormData();upload.append('file',new Blob([fs.readFileSync(path.join(ROOT,'sample-data/demo.csv'))]),'demo.csv');
    const pr=await req('/import/preview',{method:'POST',body:upload});assert.equal(pr.status,200);const preview=await pr.json();assert.equal(preview.errors.length,0);
    assert.equal((await req('/import/commit',{mode:'real',...json({token:preview.token})})).status,409);
    const commit=await req('/import/commit',json({token:preview.token}));assert.equal(commit.status,200);assert.equal((await commit.json()).inserted,25);
    assert.equal((await (await req('/dashboard')).json()).summary.completed,12);
    assert.equal((await (await req('/dashboard',{mode:'real'})).json()).summary.total,0);
    const item=(await (await req('/items')).json())[0];
    assert.equal((await req('/items/'+item.id+'/notes',json({note:'Follow-up from HTTP',author:'Tester'}))).status,200);
    assert.equal((await (await req('/items/'+item.id)).json()).notes.length,1);
    const payload={qc_result:'ACCEPT',qc_date:'2026-10-20',qc_reference:'Check note',direct_by:'',direct_confirmed:false,wo_number:'WO-HTTP-UNIQUE',wo_model:'STK+CTN_CHANGE CODE',wo_verified:true,wo_reference:'SAP Export'};
    assert.equal((await req('/items/'+item.id+'/confirm',json({payload,author:'Tester',reason:'Evidence verified',source_hash:item.source_hash}))).status,200);
    assert.equal((await (await req('/items/'+item.id)).json()).status,'completed');
    const invalid={...payload,wo_reference:''};assert.equal((await req('/items/'+item.id+'/confirm',json({payload:invalid,author:'Tester',reason:'test',source_hash:item.source_hash}))).status,400);
    assert.equal((await req('/items/'+item.id+'/confirm',{...json({author:'Tester'}),method:'DELETE'})).status,200);
    const exported=await req('/export?kind=backlog&status=waiting&q=INV-DEMO-105');assert.equal(exported.status,200);
    const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(await exported.arrayBuffer()));assert.equal(wb.worksheets[0].rowCount,3);
    const summary=await req('/export?kind=summary');const summaryWB=new ExcelJS.Workbook();await summaryWB.xlsx.load(Buffer.from(await summary.arrayBuffer()));assert.equal(summaryWB.worksheets[0].rowCount,6);
    assert.equal((await req('/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({spreadsheetId:'sample-sheet-id-123',range:'Tracking!A1:V10000'})})).status,200);
    assert.equal((await req('/sheets/preview',{mode:'real',method:'POST'})).status,400);
    assert.equal((await (await req('/history',{mode:'real'})).json()).sync[0].status,'error');
    assert.equal((await req('/dashboard',{headers:{Origin:'https://untrusted.example'}})).status,403);
    assert.equal((await req('/health',{mode:'invalid'})).status,400);
  }finally{await new Promise(r=>server.close(r));a.store.close();b.store.close();fs.rmSync(a.dir,{recursive:true});fs.rmSync(b.dir,{recursive:true});}
});
test('stale import preview rejected after another import changes same source',async()=>{
  const a=fresh(),b=fresh(),server=createApp({demo:a.store,real:b.store}).listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
  try{
    const root='http://127.0.0.1:'+server.address().port;
    const body=new FormData();body.append('file',new Blob([fs.readFileSync(path.join(ROOT,'sample-data/demo.csv'))]),'demo.csv');
    const p=await (await fetch(root+'/api/import/preview',{method:'POST',body})).json();a.store.importRows([{...demo.rows[0],source_note:'Updated after preview'}]);
    const r=await fetch(root+'/api/import/commit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:p.token})});assert.equal(r.status,409);
  }finally{await new Promise(r=>server.close(r));a.store.close();b.store.close();fs.rmSync(a.dir,{recursive:true});fs.rmSync(b.dir,{recursive:true});}
});
test('XLSX template round-trip parser accepts native dates and rejects formula values',async()=>{
  const wb=new ExcelJS.Workbook();const s=wb.addWorksheet('Tracking');s.addRow(COLUMNS);const row={...demo.rows[0],invoice_date:new Date('2026-10-16T00:00:00Z')};s.addRow(COLUMNS.map(k=>row[k]));
  assert.equal((await parseFile(Buffer.from(await wb.xlsx.writeBuffer()),'test.xlsx')).errors.length,0);
  s.getCell('D2').value={formula:'1+1',result:2};assert.ok((await parseFile(Buffer.from(await wb.xlsx.writeBuffer()),'test.xlsx')).errors.length);
});
test('delivered template imports correctly and retains identifier / date / boolean types',async()=>{
  const result=await parseFile(fs.readFileSync(path.join(ROOT,'sample-data/google-sheets-template.xlsx')),'template.xlsx');
  assert.equal(result.errors.length,0,JSON.stringify(result.errors));assert.equal(result.rows.length,4);
  assert.equal(result.rows[0].invoice_no,'INV-DEMO-105');assert.equal(result.rows[0].invoice_date,'2026-10-16');assert.equal(result.rows[2].direct_confirmed,true);
});
