import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseDate } from './validation.js';

const bad = message => Object.assign(Error(message), { status: 400 });
const labels = [
  ['sap_po', /\bSAP\s*P\s*\.?\s*O\.?\s*(?:NO\.?)?/i],
  ['sap_no', /\bSAP\s*(?:NO\.?|NUMBER|CODE)\b\.?/i],
  ['description', /\b(?:DESCRIPTION|DESCRIPTIONS|PRODUCT\s+DESCRIPTION)\b/i],
  ['item_ref', /\b(?:ITEM\s*(?:NO\.?|REF\.?)|LINE\s*NO\.?|NO\.)/i],
  ['quantity', /\b(?:QTY|QUANTITY|PCS|CTNS|N\.?W\.?|G\.?W\.?|MEAS)\b/i],
];

// Keep PDF coordinates: numeric quantities must not be mistaken for SAP codes.
export function groupLines(items) {
  const lines = [];
  for (const item of items.filter(i => i.str?.trim()).sort((a,b) => b.transform[5]-a.transform[5] || a.transform[4]-b.transform[4])) {
    const y=item.transform[5],x=item.transform[4];
    let line=lines.find(l => Math.abs(l.y-y)<3);
    if(!line){line={y,parts:[]};lines.push(line);}
    line.parts.push({text:item.str,x,width:item.width||item.str.length*5});
  }
  for(const line of lines) {
    line.parts.sort((a,b)=>a.x-b.x);line.text='';line.spans=[];
    for(const part of line.parts){
      if(line.text)line.text+=' ';
      line.spans.push({...part,start:line.text.length,end:line.text.length+part.text.length});line.text+=part.text;
    }
  }
  return lines.sort((a,b)=>b.y-a.y);
}
function xAt(line,index) {
  const span=line.spans.find(s=>index>=s.start&&index<s.end)||line.spans.findLast(s=>s.start<=index)||line.spans[0];
  return span.x+Math.max(0,index-span.start)/Math.max(1,span.text.length)*span.width;
}
function header(line) {
  const fields=[];
  for(const [key,pattern] of labels){
    const matches=[...line.text.matchAll(new RegExp(pattern.source,'gi'))];
    for(const m of matches){
      // NO. inside SAP NO. is not an independent line number column.
      if(key==='item_ref'&&fields.some(f=>m.index>=f.index&&m.index<f.end))continue;
      fields.push({key,x:xAt(line,m.index),right:xAt(line,m.index+m[0].trimEnd().length-1)+4,index:m.index,end:m.index+m[0].length});
    }
  }
  fields.sort((a,b)=>a.x-b.x);
  if(!fields.some(f=>f.key==='sap_no')||!fields.some(f=>f.key==='description'))return null;
  return fields.map((f,i)=>({...f,left:i?(fields[i-1].right+f.x)/2:-Infinity,
    limit:i<fields.length-1?(f.right+fields[i+1].x)/2:Infinity}));
}
function cellsFor(line,fields) {
  const values={};
  for(const part of line.parts){
    // A text item can contain a full row; split its words with approximate positions.
    for(const m of part.text.matchAll(/\S+/g)){
      const x=part.x+m.index/part.text.length*part.width;
      const field=fields.find(f=>x>=f.left&&x<f.limit);
      if(field)values[field.key]=[values[field.key],m[0]].filter(Boolean).join(' ');
    }
  }
  return values;
}
export function parsePages(pages,filename) {
  const all=pages.map(p=>p.lines.map(l=>l.text).join('\n')).join('\n');
  const invMatches=[...all.matchAll(/\bINVOICE\s*(?:NO\.?|NUMBER|#)?\s*[:：]?\s*([A-Z0-9][A-Z0-9/_.-]*\d[A-Z0-9/_.-]*)/gi)].map(m=>m[1]);
  const invoices=[...new Set(invMatches)];
  const invoiceDate=all.match(/\b(?:INVOICE\s+DATE|DATE)\s*[:：]\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]||'';
  let date='';try{date=parseDate(invoiceDate);}catch{/* Leave uncertain dates for human review. */}
  const items=[],warnings=[];let headersFound=0;
  for(const page of pages){
    let fields=null,last=null;
    for(let n=0;n<page.lines.length;n++){
      const line=page.lines[n];let h=header(line),combined=false;
      // Support stacked headings such as SAP / NO. and SAP / PO.
      if(!h&&n+1<page.lines.length&&line.y-page.lines[n+1].y<18&&/SAP|DESCRIPTION/i.test(line.text)){
        const next=page.lines[n+1];const parts=[];
        for(const p of line.parts){const below=next.parts.filter(q=>Math.abs(q.x-p.x)<18).map(q=>q.text).join(' ');parts.push({...p,str:[p.text,below].filter(Boolean).join(' '),transform:[1,0,0,1,p.x,line.y]});}
        const merged=groupLines(parts)[0];if(merged){h=header(merged);combined=!!h;}
      }
      if(h){fields=h;headersFound++;last=null;if(combined)n++;continue;}
      if(!fields)continue;
      if(/^(?:GRAND\s+TOTAL|TOTAL|SUBTOTAL|PAGE\s+\d|PACKING\s+LIST|INVOICE\b)/i.test(line.text.trim())){fields=null;last=null;continue;}
      const cell=cellsFor(line,fields),sap=(cell.sap_no||'').replace(/\s+/g,'');
      if(/^\d{5,12}(?:-1)?$/.test(sap)) {
        last={item_ref:(cell.item_ref||'').trim(),sap_no:sap,description:cell.description||'',sap_po:cell.sap_po||'',page:page.page};
        items.push(last);
      } else if(last&&!sap&&cell.description&&!cell.sap_po&&!cell.item_ref&&/\S/.test(cell.description)) {
        last.description+=' '+cell.description;
      }
    }
  }
  const counts=new Map();
  for(const row of items)counts.set(row.sap_no,(counts.get(row.sap_no)||0)+1);
  const occurrences=new Map();
  for(const row of items){
    const count=(occurrences.get(row.sap_no)||0)+1;occurrences.set(row.sap_no,count);
    if(!row.item_ref)row.item_ref=`PDF-${row.sap_no}${counts.get(row.sap_no)>1?'-'+count:''}`;
  }
  if(invoices.length>1)warnings.push('พบเลข Invoice หลายค่า กรุณาแยกนำเข้าทีละ Invoice หรือระบุเลขที่ถูกต้อง');
  if(!invoices.length)warnings.push('อ่านเลข Invoice ไม่ได้ กรุณากรอกเองก่อนบันทึก');
  if(!headersFound)warnings.push('ไม่พบหัวตาราง SAP NO. / DESCRIPTION ที่อ่านได้ กรุณาเพิ่มรายการเองโดยตรวจจาก PDF ต้นฉบับ');
  if(pages.some(p=>!p.lines.length))warnings.push('มีหน้าที่ไม่มีชั้นข้อความ อาจเป็นภาพสแกน รุ่นนี้ยังไม่มี OCR โปรดกรอกหรือตรวจรายการในหน้านั้นเอง');
  if(!items.length)warnings.push('ยังอ่านรายการไม่ได้ สามารถเพิ่มแถวและกรอกข้อมูลจาก PDF ได้');
  if([...counts.values()].some(n=>n>1))warnings.push('SAP NO. ซ้ำในเอกสาร กรุณาตรวจ Ref. ให้แต่ละรายการไม่ซ้ำและตรง Google Sheets');
  warnings.push('ตรวจจำนวนรายการและทุกแถวเทียบ PDF ก่อนยืนยัน ระบบอ่านเฉพาะตารางที่รู้จักและอาจอ่านได้ไม่ครบ');
  return {filename,pageCount:pages.length,document:{invoice_no:invoices.length===1?invoices[0]:'',invoice_date:date,etd:'',eta:'',etr:'',owner:'',received_date:''},items,warnings,text:all.slice(0,120000)};
}
async function extract(buffer,filename) {
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const require=createRequire(import.meta.url),base=path.dirname(require.resolve('pdfjs-dist/package.json'));
  const task=getDocument({data:new Uint8Array(buffer),isEvalSupported:false,useSystemFonts:true,
    standardFontDataUrl:path.join(base,'standard_fonts')+path.sep,cMapUrl:path.join(base,'cmaps')+path.sep,cMapPacked:true});
  try {
    const pdf=await task.promise;
    if(pdf.numPages>50)throw bad('PDF ต้องไม่เกิน 50 หน้า กรุณาแยกไฟล์');
    const pages=[];let chars=0;
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i),content=await page.getTextContent();
      chars+=content.items.reduce((n,i)=>n+(i.str?.length||0),0);
      if(chars>1000000)throw bad('ข้อความใน PDF มากเกินขอบเขต กรุณาแยกไฟล์');
      pages.push({page:i,lines:groupLines(content.items)});page.cleanup();
    }
    return parsePages(pages,filename);
  } catch(e) {
    if(e.status)throw e;
    if(e.name==='PasswordException')throw bad('PDF มีรหัสผ่าน กรุณาปลดรหัสผ่านก่อนอัปโหลด');
    throw bad('อ่าน PDF ไม่สำเร็จ ไฟล์อาจเสียหรือไม่ใช่ PDF ที่รองรับ');
  } finally {await task.destroy();}
}
export function extractPDF(buffer,filename) {
  if(!/\.pdf$/i.test(filename)||!buffer.subarray(0,1024).includes(Buffer.from('%PDF-')))return Promise.reject(bad('กรุณาเลือกไฟล์ PDF ที่ถูกต้อง (.pdf)'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{buffer,filename},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256}});
    const timer=setTimeout(()=>{worker.terminate();reject(bad('อ่าน PDF เกิน 30 วินาที กรุณาแยกไฟล์ให้เล็กลง'));},30000);
    worker.once('message',m=>{clearTimeout(timer);if(m.error)reject(bad(m.error));else resolve(m.result);});
    worker.once('error',()=>{clearTimeout(timer);reject(bad('อ่าน PDF ไม่สำเร็จ กรุณาลองไฟล์ที่เล็กลง'));});
    worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(bad('ไม่สามารถอ่าน PDF นี้ได้ กรุณาลองไฟล์ที่เล็กลง'));}});
  });
}
if(!isMainThread&&workerData?.buffer){
  try{parentPort.postMessage({result:await extract(workerData.buffer,workerData.filename)});}
  catch(e){parentPort.postMessage({error:e.message});}
}
