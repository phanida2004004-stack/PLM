import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate,normalizeQC,summarize,invoiceStatus,daysWaiting,MODELS } from '../src/logic.js';
const base={qc_result:'ACCEPT',wo_model:MODELS.ACCEPT,wo_number:'WO-SAMPLE-1',wo_verified:true,wo_reference:'SAP Export reference',qc_date:'2026-10-20',received_date:'2026-10-18'};
test('ACCEPT + verified matching WO completes',()=>assert.equal(evaluate(base).status,'completed'));
test('REJECT requires Inspection_Assembly and stays pending without WO',()=>{const r=evaluate({...base,qc_result:'REJECT',wo_model:'',wo_number:'',wo_verified:false});assert.equal(r.status,'pending');assert.equal(r.requiredModel,MODELS.REJECT);});
test('DIRECT requires named confirmation and evidence',()=>{
  assert.equal(evaluate({...base,qc_result:'DIRECT',wo_model:'DIRECT',direct_confirmed:true,direct_by:'Owner',qc_reference:'Project note'}).status,'completed');
  const waiting=evaluate({...base,qc_result:'DIRECT',direct_confirmed:false});assert.equal(waiting.status,'waiting');assert.equal(waiting.requiredModel,'');
});
test('no result never invents a model',()=>{const r=evaluate({qc_result:'',received_date:'2026-10-10'});assert.equal(r.status,'waiting');assert.equal(r.requiredModel,'');});
test('mismatch / unverified / missing model / orphan WO require review',()=>{
  for(const row of [{...base,wo_model:MODELS.REJECT},{...base,wo_verified:false},{...base,wo_reference:''},{...base,wo_model:''},{...base,qc_result:''}])assert.equal(evaluate(row).status,'review');
});
test('QC language aliases and ambiguous / negated results',()=>{
  for(const value of ['ACCEPT LOT/ผลผ่าน.','ACC.LOT/ผลผ่าน.','ACCEPT','Accept Lot.'])assert.equal(normalizeQC(value),'ACCEPT');
  assert.equal(normalizeQC('Defect เกินเกณฑ์ จึงขอทำการ Reject.'),'REJECT');
  for(const value of ['ACCEPT / REJECT','NOT ACCEPT','NOT YET ACCEPTED','ยังไม่ ACCEPT','ไม่ ACCEPT','ACCEPT pending approval','ไม่ผ่าน ACCEPT','unknown'])assert.equal(normalizeQC(value),'UNKNOWN');
});
test('stale manual confirmation cannot count as completed',()=>assert.equal(evaluate({...base,confirmation_stale:true}).status,'review'));
test('summary partitions all rows and invoice completion is exact',()=>{
  const rows=[evaluate(base),evaluate({qc_result:'REJECT'}),evaluate({qc_result:''}),evaluate({...base,wo_model:'DIRECT'})];
  assert.deepEqual(summarize(rows),{total:4,completed:1,pending:1,waiting:1,review:1});
  assert.equal(invoiceStatus(summarize([evaluate(base)])),'เปิดครบแล้ว');
  assert.equal(invoiceStatus(summarize([])),'ยังไม่เปิด WO');
});
test('waiting days use Bangkok calendar and missing start stays unknown',()=>{
  assert.equal(daysWaiting('2026-10-20',new Date('2026-10-20T18:00:00Z')),1);
  assert.equal(daysWaiting('',new Date()),null);
});
