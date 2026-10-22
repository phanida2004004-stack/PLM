import ExcelJS from 'exceljs';
import { LABELS } from './logic.js';
export async function reportBuffer(store,{kind='backlog',status='',from='',to='',q=''}={}) {
  const wb=new ExcelJS.Workbook();wb.creator='WO Tracking Dashboard';
  const sheet=wb.addWorksheet(kind==='summary'?'Invoice Summary':'Follow-up');
  let rows,cols;
  if(kind==='summary') {
    rows=store.dashboard().invoices.map(i=>({invoice:i.invoice_no,date:i.invoice_date,total:i.summary.total,completed:i.summary.completed,pending:i.summary.pending,waiting:i.summary.waiting,review:i.summary.review,status:i.status}));
    cols=[['Invoice','invoice',25],['วันที่ Invoice','date',18],['ทั้งหมด (รายการ)','total',18],['เปิดแล้ว','completed',15],['รอเปิด WO','pending',15],['รอผล','waiting',15],['ต้องตรวจสอบ','review',20],['สถานะ','status',22]];
  } else {
    const notes=new Map();for(const n of store.all('SELECT item_id,author,note FROM follow_up_notes ORDER BY created_at DESC')){if(!notes.has(n.item_id))notes.set(n.item_id,[]);notes.get(n.item_id).push(`${n.author}: ${n.note}`);}
    rows=store.items().filter(i=>status?i.status===status:i.status!=='completed').filter(i=>(!from||i.waitStart&&i.waitStart>=from)&&(!to||i.waitStart&&i.waitStart<=to)&&[i.invoice_no,i.sap_no,i.description,i.owner].join(' ').toLowerCase().includes(q.toLowerCase())).map(i=>({...i,status:LABELS[i.status],note:[i.source_note,...notes.get(i.id)||[]].filter(Boolean).join('\n')}));
    cols=[['Invoice','invoice_no',25],['รายการอ้างอิง','item_ref',20],['SAP NO.','sap_no',18],['DESCRIPTION','description',40],['QC','qc',16],['WO MODEL','requiredModel',28],['สถานะ','status',20],['WO NO.','wo_number',22],['เริ่มรอ','waitStart',18],['วันรอ','daysWaiting',12],['ผู้รับผิดชอบ','owner',24],['ติดตามล่าสุด','last_followed',25],['ข้อมูลที่ต้องติดตาม','issue',48],['หมายเหตุ','note',45]];
  }
  sheet.columns=cols.map(([header,key,width])=>({header,key,width}));
  for(const row of rows)sheet.addRow(row);
  sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF243F88'}};
  sheet.getRow(1).height=30;sheet.views=[{state:'frozen',ySplit:1}];
  sheet.autoFilter={from:'A1',to:{row:Math.max(1,sheet.rowCount),column:cols.length}};
  sheet.eachRow((r,n)=>{r.alignment={vertical:'top',wrapText:true};if(n>1)r.height=42;});
  // Identifiers/text are string cells. ExcelJS does not turn strings beginning '=' into formulas.
  return wb.xlsx.writeBuffer();
}
