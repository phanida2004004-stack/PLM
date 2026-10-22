import { createHash } from 'node:crypto';
import { normalizeQC, normalizeModel } from './logic.js';
export const COLUMNS=['invoice_no','item_ref','sap_no','description','invoice_date','etd','eta','etr','owner','received_date','qc_result','qc_date','direct_confirmed','direct_by','qc_reference','wo_number','wo_model','wo_verified','wo_date','wo_by','wo_reference','source_note'];
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const itemId = row => hash([row.invoice_no,row.item_ref]);
const dateKeys=['invoice_date','etd','eta','etr','received_date','qc_date','wo_date'];
const boolKeys=['direct_confirmed','wo_verified'];
export function parseDate(value) {
  if(value===null || value===undefined || value==='') return '';
  if(value instanceof Date) return value.toISOString().slice(0,10);
  const s=String(value).trim();
  let y,m,d;
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) [y,m,d]=s.split('-').map(Number);
  else if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) [d,m,y]=s.split('/').map(Number);
  else throw Error('วันที่ต้องเป็น YYYY-MM-DD หรือ DD/MM/YYYY');
  if(y>=2400) y-=543;
  const date=new Date(Date.UTC(y,m-1,d));
  if(y<1900||y>2200||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d) throw Error('วันที่ไม่มีอยู่จริง');
  return date.toISOString().slice(0,10);
}
function parseBool(v) {
  const s=String(v??'').trim().toLowerCase();
  if(['','false','0','no'].includes(s)) return false;
  if(['true','1','yes'].includes(s)) return true;
  throw Error('ใช้ TRUE/FALSE สำหรับการยืนยัน');
}
export function validateRows(headers,input) {
  const errors=[],warnings=[],rows=[],seen=new Map(),invoices=new Map(),wo=new Map();
  const names=headers.map(h=>String(h??'').trim().toLowerCase().replace(/^\uFEFF/,''));
  for(const c of COLUMNS) if(!names.includes(c)) errors.push({row:1,message:`ไม่มีคอลัมน์ ${c} กรุณาใช้แม่แบบ`});
  if(new Set(names).size!==names.length) errors.push({row:1,message:'ชื่อคอลัมน์ซ้ำ'});
  for(const n of names) if(n&&!COLUMNS.includes(n)) warnings.push({row:1,message:`ไม่ใช้คอลัมน์ ${n}`});
  if(input.length>10000) errors.push({row:1,message:'รองรับไม่เกิน 10,000 แถวต่อครั้ง'});
  if(errors.length) return {rows,errors,warnings};
  input.slice(0,10000).forEach((cells,i)=>{
    if(cells.every(v=>v===null||v===undefined||v==='')) return;
    const row={}; let invalid=false;
    for(const key of COLUMNS) {
      const v=cells[names.indexOf(key)];
      try {
        if(dateKeys.includes(key)) row[key]=parseDate(v);
        else if(boolKeys.includes(key)) row[key]=parseBool(v);
        else {
          if(typeof v==='object'&&v!==null) throw Error('ไม่รองรับสูตร / Rich Text ใช้ค่าข้อความแทน');
          row[key]=String(v??'').trim();
          if(row[key].length>2000) throw Error('ข้อความยาวเกิน 2,000 ตัวอักษร');
        }
      } catch(e) { errors.push({row:i+2,message:`${key}: ${e.message}`}); invalid=true; }
    }
    for(const key of ['invoice_no','item_ref','sap_no','description']) if(!row[key]) {errors.push({row:i+2,message:`${key}: ต้องมีข้อมูล`});invalid=true;}
    for(const key of ['invoice_no','item_ref','sap_no','wo_number']) if(row[key]&&(/[\r\n]/.test(row[key])||row[key].length>120)) {errors.push({row:i+2,message:`${key}: รหัสไม่ถูกต้อง`});invalid=true;}
    if(invalid) return;
    row.wo_model=normalizeModel(row.wo_model);
    const key=itemId(row),fingerprint=hash(row);
    if(seen.has(key)) {
      if(seen.get(key)===fingerprint) warnings.push({row:i+2,message:'แถวซ้ำเหมือนกัน ข้ามแถวนี้'});
      else errors.push({row:i+2,message:'Invoice + item_ref ซ้ำ แต่ข้อมูลขัดแย้ง'});
      return;
    }
    seen.set(key,fingerprint);
    const meta=hash(['invoice_date','etd','eta','etr','owner'].map(k=>row[k]));
    if(invoices.has(row.invoice_no)&&invoices.get(row.invoice_no)!==meta) errors.push({row:i+2,message:'วันที่ / ผู้รับผิดชอบของ Invoice เดียวกันขัดแย้ง'});
    invoices.set(row.invoice_no,meta);
    if(row.wo_number) {
      if(wo.has(row.wo_number)&&wo.get(row.wo_number)!==key) errors.push({row:i+2,message:'WO Number เดียวกันถูกใช้กับหลายรายการ กรุณาตรวจหลักฐาน'});
      wo.set(row.wo_number,key);
    }
    if(normalizeQC(row.qc_result)==='UNKNOWN') warnings.push({row:i+2,message:'ผล QC ไม่ชัดเจน จะอยู่ใน ต้องตรวจสอบ'});
    if(!row.received_date&&!row.qc_date) warnings.push({row:i+2,message:'ไม่มีวันที่เริ่มรอ ระบบจะแสดง - แทนจำนวนวัน'});
    rows.push(row);
  });
  if(!rows.length&&!errors.length) errors.push({row:2,message:'ไม่มีรายการข้อมูล'});
  return {rows,errors,warnings};
}
