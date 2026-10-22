import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store,ROOT } from '../src/database.js';
import { extractPDF,groupLines,parsePages } from '../src/pdf-extract.js';
import { preparePDFImport } from '../src/pdf-import.js';
import { createApp } from '../src/app.js';
const bytes=fs.readFileSync(path.join(ROOT,'sample-data/packing-list-demo.pdf'));
const fresh=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wo-pdf-'));return {dir,store:new Store(path.join(dir,'test.sqlite'))};};
const text=(str,x,y)=>({str,width:str.length*5,transform:[1,0,0,1,x,y]});
function blankPDF(){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>'];
  let s='%PDF-1.4\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(s));s+=`${i+1} 0 obj\n${o}\nendobj\n`;});const start=Buffer.byteLength(s);s+='xref\n0 4\n0000000000 65535 f \n';for(const n of offsets.slice(1))s+=String(n).padStart(10,'0')+' 00000 n \n';return Buffer.from(s+`trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`);
}
test('PDF: real two-page file extracts Invoice, stable refs, SAP PO, codes and wrapped description',async()=>{
  const p=await extractPDF(bytes,'demo.pdf');
  assert.equal(p.pageCount,2);assert.equal(p.document.invoice_no,'INV-DEMO-PDF-001');assert.equal(p.document.invoice_date,'2026-10-21');
  assert.deepEqual(p.items.map(i=>i.sap_no),['7000201','7000202','7000203','7000204']);
  assert.deepEqual(p.items.map(i=>i.item_ref),['001','002','003','004']);
  assert.equal(p.items[0].sap_po,'9001');assert.equal(p.items[0].description,'Demo component 1 Blue / sample only');assert.equal(p.items[3].page,2);
});
test('PDF: rejects disguised / corrupt files and handles textless pages without invented rows',async()=>{
  await assert.rejects(()=>extractPDF(Buffer.from('not a PDF'),'fake.pdf'),/PDF/);
  await assert.rejects(()=>extractPDF(bytes,'fake.xlsx'),/PDF/);
  await assert.rejects(()=>extractPDF(Buffer.from('%PDF-1.7\nbroken'),'broken.pdf'),/อ่าน PDF/);
  const blank=await extractPDF(blankPDF(),'scan.pdf');assert.equal(blank.items.length,0);assert.ok(blank.warnings.some(w=>w.includes('OCR')));
});
test('PDF: never guesses SAP from arbitrary numbers and supports stacked table labels',()=>{
  const noHeader=parsePages([{page:1,lines:groupLines([text('Invoice total 7000201 100 9001',42,700)])}],'unknown.pdf');assert.equal(noHeader.items.length,0);
  const lines=groupLines([text('SAP',80,700),text('SAP',150,700),text('DESCRIPTION',250,700),text('PO.',80,688),text('NO.',150,688),text('9001',80,650),text('7000201',150,650),text('Blue component',250,650)]);
  const stacked=parsePages([{page:1,lines}],'stacked.pdf');assert.equal(stacked.items.length,1);assert.equal(stacked.items[0].sap_no,'7000201');assert.equal(stacked.items[0].sap_po,'9001');
});
test('PDF: reimport preserves QC/WO/notes/confirmation and blocks ambiguous different refs',async()=>{
  const {store,dir}=fresh();try{
    const p=await extractPDF(bytes,'demo.pdf'),result=preparePDFImport(store,p.document,p.items,'demo.pdf');assert.equal(result.errors.length,0);
    store.importRows(result.rows,'pdf');let item=store.items()[0];const source=store.detail(item.id).sourceData;
    store.importRows([{...source,qc_result:'ACCEPT',qc_reference:'QC sheet',qc_date:'2026-10-21',wo_number:'WO-PDF-1',wo_model:'STK+CTN_CHANGE CODE',wo_verified:true,wo_reference:'SAP export'}]);
    item=store.items().find(i=>i.id===item.id);store.addNote(item.id,'Existing note','Tester');
    store.confirm(item.id,{qc_result:'ACCEPT',wo_number:'WO-PDF-1',wo_model:'STK+CTN_CHANGE CODE',wo_verified:true,wo_reference:'Confirmed export'},'Tester','Proof checked',item.source_hash);
    const repeat=preparePDFImport(store,p.document,p.items,'renamed.pdf');assert.equal(repeat.errors.length,0);store.importRows(repeat.rows,'pdf');
    const after=store.detail(item.id);assert.equal(after.qc_result,'ACCEPT');assert.equal(after.wo_number,'WO-PDF-1');assert.equal(after.status,'completed');assert.equal(after.confirmation_stale,false);assert.equal(after.notes.length,1);
    const otherRef={...p.items[0],item_ref:'OTHER'};
    assert.ok(preparePDFImport(store,p.document,[otherRef],'demo.pdf').errors.some(e=>e.message.includes('Ref.')));
    assert.equal(preparePDFImport(store,p.document,[{...otherRef,separate:true}],'demo.pdf').errors.length,0);
    const conflict={...p.items[0],sap_no:'9999999'};assert.ok(store.existingErrors(preparePDFImport(store,p.document,[conflict],'demo.pdf').rows).length);
  }finally{store.close();fs.rmSync(dir,{recursive:true});}
});
test('PDF HTTP: extraction is unsaved; reviewed editable preview commits, stays isolated, persists and is idempotent',async()=>{
  const a=fresh(),b=fresh(),server=createApp({demo:a.store,real:b.store}).listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
  const root='http://127.0.0.1:'+server.address().port;
  const post=(p,body,mode='demo')=>fetch(root+'/api'+p,{method:'POST',headers:{'Content-Type':'application/json','x-data-mode':mode},body:JSON.stringify(body)});
  async function extract(data=bytes,name='demo.pdf') {const f=new FormData();f.append('file',new Blob([data],{type:'application/pdf'}),name);return fetch(root+'/api/import/pdf/extract',{method:'POST',body:f});}
  try{
    assert.equal((await extract(Buffer.from('not pdf'))).status,400);
    assert.equal((await extract(Buffer.alloc(10*1024*1024+1))).status,413);
    const draft=await (await extract()).json();assert.ok(draft.draftToken);assert.equal(a.store.items().length,0);
    const body={draftToken:draft.draftToken,document:{...draft.document,received_date:'2026-10-21'},items:draft.items,reviewed:true};
    assert.equal((await post('/import/pdf/preview',{...body,reviewed:false})).status,400);
    assert.equal((await post('/import/pdf/preview',body,'real')).status,409);
    const invalid=await (await post('/import/pdf/preview',{...body,items:[{...body.items[0],description:''}]})).json();assert.equal(invalid.token,null);assert.ok(invalid.errors.length);
    body.items[0].description='Edited and checked description';
    const response=await post('/import/pdf/preview',body);assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.errors.length,0);assert.equal(preview.source,'pdf');assert.equal(a.store.items().length,0);
    assert.equal((await post('/import/commit',{token:preview.token},'real')).status,409);
    const commit=await post('/import/commit',{token:preview.token});assert.equal(commit.status,200);assert.equal((await commit.json()).inserted,4);
    assert.equal(a.store.items()[0].status,'waiting');assert.equal(b.store.items().length,0);assert.equal(a.store.items().find(i=>i.item_ref==='001').description,'Edited and checked description');
    const repeat=await (await post('/import/pdf/preview',body)).json();const result=await (await post('/import/commit',{token:repeat.token})).json();assert.equal(result.unchanged,4);assert.equal(a.store.items().length,4);
    const conflict=await (await post('/import/pdf/preview',{...body,items:[{...body.items[0],sap_no:'9999999'}]})).json();assert.equal(conflict.token,null);
    a.store.close();a.store=new Store(path.join(a.dir,'test.sqlite'));assert.equal(a.store.items().length,4);assert.equal(a.store.items()[0].source,'pdf');
  }finally{await new Promise(r=>server.close(r));a.store.close();b.store.close();fs.rmSync(a.dir,{recursive:true});fs.rmSync(b.dir,{recursive:true});}
});
