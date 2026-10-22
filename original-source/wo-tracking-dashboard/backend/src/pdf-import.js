import { COLUMNS, validateRows } from './validation.js';

export function preparePDFImport(store,document,items,filename) {
  const warnings=[],extraErrors=[];
  const invoiceNo=String(document.invoice_no||'').trim();
  const existingInvoice=store.get('SELECT * FROM invoices WHERE invoice_no=?',invoiceNo);
  if(existingInvoice)warnings.push({row:1,message:'Invoice นี้มีอยู่แล้ว จะคงวันกำหนดการ ผู้รับผิดชอบ ผล QC และ WO เดิม; แก้รายละเอียดสินค้าจะทำให้ต้องตรวจการยืนยันใหม่'});
  const rows=items.map((item,index)=>{
    const row=Object.fromEntries(COLUMNS.map(c=>[c,'']));row.direct_confirmed=false;row.wo_verified=false;
    const ref=String(item.item_ref||'').trim(),sap=String(item.sap_no||'').trim();
    const old=store.get('SELECT source_json FROM invoice_items WHERE invoice_id=(SELECT id FROM invoices WHERE invoice_no=?) AND item_ref=?',invoiceNo,ref);
    if(old)Object.assign(row,JSON.parse(old.source_json));
    const others=store.all('SELECT item_ref FROM invoice_items WHERE invoice_id=(SELECT id FROM invoices WHERE invoice_no=?) AND sap_no=?',invoiceNo,sap);
    if(!old&&others.length&&!item.separate)extraErrors.push({row:index+2,message:`SAP NO. ${sap} มีอยู่ใน Invoice แล้วที่ Ref. ${others.map(i=>i.item_ref).join(', ')} กรุณาใช้ Ref. เดิม หรือทำเครื่องหมายว่าเป็นรายการแยก`});
    Object.assign(row,{invoice_no:invoiceNo,item_ref:ref,sap_no:sap,description:String(item.description||'').trim()});
    for(const key of ['invoice_date','etd','eta','etr','owner'])row[key]=existingInvoice?existingInvoice[key]:document[key]||'';
    if(!old){row.received_date=document.received_date||'';row.source_note=`PDF: ${filename}${item.sap_po?' | SAP PO. '+String(item.sap_po).trim():''}`;}
    return row;
  });
  const result=validateRows(COLUMNS,rows.map(row=>COLUMNS.map(c=>row[c])));
  result.errors.push(...extraErrors);result.warnings.push(...warnings);
  return result;
}
