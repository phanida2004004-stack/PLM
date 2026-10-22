export const MODELS = { ACCEPT: 'STK+CTN_CHANGE CODE', REJECT: 'Inspection_Assembly', DIRECT: 'DIRECT' };
export const LABELS = { completed:'เปิดแล้ว', pending:'รอเปิด WO', waiting:'รอผล', review:'ต้องตรวจสอบ' };
export function normalizeQC(value) {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s || ['รอผล','WAITING','PENDING','-'].includes(s)) return '';
  // Interpret explicit tokens only. Mixed or negated statements always need a person.
  if (/ไม่ผ่าน|ไม่ยอมรับ|ยังไม่|ไม่\s*(?:ACCEPT|REJECT|DIRECT)|\bNOT\b|\bNO\s+(?:ACCEPT|REJECT|DIRECT)|\b(?:PENDING|WAITING|CANCELLED|CANCELED)\b|ยกเลิก/.test(s)) return 'UNKNOWN';
  const found = new Set();
  if (/\bACCEPT(?:ED)?\b|\bACC\.?\s*LOT\b|ผลผ่าน/.test(s)) found.add('ACCEPT');
  if (/\bREJECT(?:ED)?\b/.test(s)) found.add('REJECT');
  if (/\bDIRECT\b/.test(s)) found.add('DIRECT');
  return found.size === 1 ? [...found][0] : 'UNKNOWN';
}
export function normalizeModel(value) {
  const s=String(value??'').trim();
  return Object.values(MODELS).find(v=>v.toUpperCase()===s.toUpperCase()) || s;
}
export function evaluate(row) {
  const qc = normalizeQC(row.qc_result);
  const requiredModel = MODELS[qc] || '';
  let status, issue='';
  if(row.confirmation_stale) { status='review'; issue='ข้อมูลต้นทางเปลี่ยนหลังยืนยัน กรุณาตรวจใหม่'; }
  else if(qc==='UNKNOWN') { status='review'; issue='ผล QC ไม่ชัดเจนหรือมีหลายผล'; }
  else if(qc==='DIRECT' && (!row.direct_confirmed || !row.direct_by || !row.qc_reference)) {
    status='waiting'; issue='รอผู้รับผิดชอบยืนยัน DIRECT พร้อมข้อมูลอ้างอิง';
  } else if(!qc) {
    status=row.wo_number ? 'review':'waiting'; issue=row.wo_number?'พบ WO แต่ยังไม่มีผล QC / ยืนยัน DIRECT':'ติดตาม QC เพื่อขอผลตรวจ';
  } else if(!row.wo_number) {
    status=(row.wo_verified || row.wo_model)?'review':'pending'; issue=status==='review'?'มีข้อมูล WO แต่ไม่มี WO Number':'ติดตามผู้รับผิดชอบเปิด WO';
  } else if(normalizeModel(row.wo_model)!==requiredModel) {
    status='review'; issue='WO Model ไม่ตรงกับผล QC หรือไม่มี Model';
  } else if(!row.wo_verified || !row.wo_reference) {
    status='review'; issue='รอหลักฐานยืนยันว่าเปิด WO จริง';
  } else { status='completed'; }
  const waitStart = status==='waiting' ? (row.received_date||'') : (row.qc_date||'');
  return {...row,qc,requiredModel:qc==='DIRECT'&&status==='waiting'?'':requiredModel,status,statusLabel:LABELS[status],issue,waitStart};
}
export function summarize(items) {
  const result={total:items.length,completed:0,pending:0,waiting:0,review:0};
  for(const item of items) result[item.status]++;
  return result;
}
export function invoiceStatus(s) {
  if(s.review) return 'ต้องตรวจสอบ';
  if(s.total && s.total===s.completed) return 'เปิดครบแล้ว';
  if(s.completed) return 'เปิดบางส่วน';
  return 'ยังไม่เปิด WO';
}
export function bangkokToday(now=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function daysWaiting(start, now=new Date()) {
  if(!start) return null;
  return Math.max(0,Math.round((Date.parse(bangkokToday(now))-Date.parse(start))/86400000));
}
