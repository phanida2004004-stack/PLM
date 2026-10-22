import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hash,itemId } from './validation.js';
import { normalizeQC,evaluate,summarize,invoiceStatus,daysWaiting } from './logic.js';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export class Store {
  constructor(filename) {
    fs.mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(fs.readFileSync(path.join(ROOT,'database/migrations/001_initial.sql'),'utf8'));
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES(1,?)').run(new Date().toISOString());
  }
  all(sql,...args){ return this.db.prepare(sql).all(...args); }
  get(sql,...args){ return this.db.prepare(sql).get(...args); }
  run(sql,...args){ return this.db.prepare(sql).run(...args); }
  close(){this.db.close();}
  audit(id,action,before,after,source,author='') {
    this.run('INSERT INTO audit_history VALUES(?,?,?,?,?,?,?,?)',randomUUID(),id,action,JSON.stringify(before),JSON.stringify(after),source,author,new Date().toISOString());
  }
  existingErrors(rows) {
    const errors=[];
    const confirmedWOs=new Map(this.all('SELECT c.item_id,c.payload_json,c.base_hash,i.source_hash FROM user_confirmations c JOIN invoice_items i ON i.id=c.item_id').filter(c=>c.base_hash===c.source_hash).map(c=>[JSON.parse(c.payload_json).wo_number,c.item_id]));
    rows.forEach((r,i)=>{
      const old=this.get('SELECT sap_no FROM invoice_items WHERE id=?',itemId(r));
      if(old&&old.sap_no!==r.sap_no) errors.push({row:i+2,message:'item_ref เดิมผูกกับ SAP NO. อื่น ใช้ item_ref ใหม่หรือแก้ข้อมูลต้นทาง'});
      if(r.wo_number) {
        const other=this.get('SELECT item_id FROM wo_records WHERE wo_number=? AND item_id<>?',r.wo_number,itemId(r));
        if(other||(confirmedWOs.has(r.wo_number)&&confirmedWOs.get(r.wo_number)!==itemId(r))) errors.push({row:i+2,message:'WO Number ถูกผูกกับรายการอื่นในฐานข้อมูลแล้ว'});
      }
    });return errors;
  }
  importRows(rows,source='file') {
    const errors=this.existingErrors(rows);
    if(errors.length) throw Object.assign(Error(errors[0].message),{status:409});
    let inserted=0,updated=0,unchanged=0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for(const row of rows) {
        const id=itemId(row),invoiceId=hash(row.invoice_no),now=new Date().toISOString(),fingerprint=hash(row);
        const previous=this.get('SELECT source_json,source_hash FROM invoice_items WHERE id=?',id);
        if(previous?.source_hash===fingerprint){unchanged++;continue;}
        const confirmation=this.get('SELECT * FROM user_confirmations WHERE item_id=?',id);
        const priorRow=previous?JSON.parse(previous.source_json):null;
        const priorStatus=priorRow?evaluate({...priorRow,...(confirmation?.base_hash===previous.source_hash?JSON.parse(confirmation.payload_json):{}),confirmation_stale:!!confirmation&&confirmation.base_hash!==previous.source_hash}).status:null;
        this.run(`INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET invoice_date=excluded.invoice_date,etd=excluded.etd,eta=excluded.eta,etr=excluded.etr,owner=excluded.owner,updated_at=excluded.updated_at`,invoiceId,row.invoice_no,row.invoice_date,row.etd,row.eta,row.etr,row.owner,now);
        this.run(`INSERT INTO invoice_items VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET description=excluded.description,received_date=excluded.received_date,source_note=excluded.source_note,source_json=excluded.source_json,source_hash=excluded.source_hash,source=excluded.source,updated_at=excluded.updated_at`,id,invoiceId,row.item_ref,row.sap_no,row.description,row.received_date,row.source_note,JSON.stringify(row),fingerprint,source,now);
        this.run(`INSERT INTO qc_results VALUES(?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET raw_result=excluded.raw_result,result=excluded.result,qc_date=excluded.qc_date,direct_confirmed=excluded.direct_confirmed,confirmed_by=excluded.confirmed_by,reference=excluded.reference`,id,row.qc_result,normalizeQC(row.qc_result),row.qc_date,+row.direct_confirmed,row.direct_by,row.qc_reference);
        this.run(`INSERT INTO wo_records VALUES(?,?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET wo_number=excluded.wo_number,model=excluded.model,verified=excluded.verified,opened_at=excluded.opened_at,opened_by=excluded.opened_by,reference=excluded.reference`,id,row.wo_number,row.wo_model,+row.wo_verified,row.wo_date,row.wo_by,row.wo_reference);
        this.audit(id,previous?'source_updated':'imported',priorRow?{...priorRow,status:priorStatus}:null,{...row,status:evaluate({...row,confirmation_stale:!!confirmation}).status},source);
        if(previous)updated++;else inserted++;
      }
      const result={inserted,updated,unchanged};
      this.run('INSERT INTO sync_history VALUES(?,?,?,?,?,?)',randomUUID(),source,'success',JSON.stringify(result),rows.length,new Date().toISOString());
      this.db.exec('COMMIT');return result;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  items() {
    const raw=this.all(`SELECT i.*,v.invoice_no,v.invoice_date,v.etd,v.eta,v.etr,v.owner,
      c.payload_json,c.base_hash,c.author AS confirmed_by,c.confirmed_at,
      (SELECT MAX(created_at) FROM follow_up_notes f WHERE f.item_id=i.id) AS last_followed
      FROM invoice_items i JOIN invoices v ON v.id=i.invoice_id LEFT JOIN user_confirmations c ON c.item_id=i.id ORDER BY v.invoice_no DESC,i.item_ref`);
    return raw.map(item=>{
      const source=JSON.parse(item.source_json),stale=!!item.base_hash&&item.base_hash!==item.source_hash;
      const override=item.payload_json&&!stale?JSON.parse(item.payload_json):{};
      const result=evaluate({...source,...override,id:item.id,invoice_id:item.invoice_id,updated_at:item.updated_at,source:item.source,
        source_hash:item.source_hash,confirmation_stale:stale,confirmed_by:item.confirmed_by,confirmed_at:item.confirmed_at,last_followed:item.last_followed});
      return {...result,daysWaiting:['waiting','pending','review'].includes(result.status)?daysWaiting(result.waitStart):null};
    });
  }
  dashboard() {
    const items=this.items();
    const invoices=this.all('SELECT * FROM invoices ORDER BY invoice_no DESC').map(inv=>{
      const summary=summarize(items.filter(i=>i.invoice_id===inv.id));return {...inv,summary,status:invoiceStatus(summary)};
    });
    return {summary:{invoices:invoices.length,...summarize(items)},invoices,
      lastSync:this.get("SELECT * FROM sync_history WHERE status='success' ORDER BY created_at DESC LIMIT 1")||null};
  }
  detail(id) {
    const item=this.items().find(i=>i.id===id);
    if(!item) throw Object.assign(Error('ไม่พบรายการ'),{status:404});
    return {...item,sourceData:JSON.parse(this.get('SELECT source_json FROM invoice_items WHERE id=?',id).source_json),
      notes:this.all('SELECT * FROM follow_up_notes WHERE item_id=? ORDER BY created_at DESC',id),
      history:this.all('SELECT * FROM audit_history WHERE item_id=? ORDER BY created_at DESC LIMIT 100',id)};
  }
  addNote(id,note,author) {
    this.detail(id);
    this.run('INSERT INTO follow_up_notes VALUES(?,?,?,?,?)',randomUUID(),id,note,author,new Date().toISOString());
    this.audit(id,'follow_up_note',null,{note},'manual',author);
  }
  confirm(id,payload,author,reason,expectedHash) {
    const item=this.get('SELECT source_hash FROM invoice_items WHERE id=?',id);
    if(!item) throw Object.assign(Error('ไม่พบรายการ'),{status:404});
    if(item.source_hash!==expectedHash) throw Object.assign(Error('ข้อมูลเปลี่ยน กรุณาปิดและเปิดรายละเอียดใหม่ก่อนยืนยัน'),{status:409});
    const before=this.detail(id);
    this.run(`INSERT INTO user_confirmations VALUES(?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET payload_json=excluded.payload_json,base_hash=excluded.base_hash,author=excluded.author,reason=excluded.reason,confirmed_at=excluded.confirmed_at`,id,JSON.stringify(payload),item.source_hash,author,reason,new Date().toISOString());
    this.audit(id,'confirmed',before,{...payload,reason,status:this.detail(id).status},'manual',author);
  }
  settings(){return Object.fromEntries(this.all('SELECT * FROM settings').map(r=>[r.key,r.value]));}
  saveSettings(obj){for(const [k,v] of Object.entries(obj))this.run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k,v);}
}
