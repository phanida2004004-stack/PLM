import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import express from 'express';
import {Store} from './backend/src/database.js';
import {parseFile} from './backend/src/imports.js';
import {createApp} from './backend/src/app.js';
import {extractPDF} from './backend/src/pdf-extract.js';

const root=fileURLToPath(new URL('.',import.meta.url));
dotenv.config({path:path.join(root,'.env'),quiet:true});
const {default:pl}=await import('./pl/server.js');
await pl.ready;
const stores={demo:new Store(path.join(root,'database/demo.sqlite')),real:new Store(path.join(root,'database/real.sqlite'))};
if(!stores.demo.get('SELECT COUNT(*) AS n FROM invoice_items').n){
  const parsed=await parseFile(fs.readFileSync(path.join(root,'sample-data/demo.csv')),'demo.csv');
  if(parsed.errors.length)throw Error('อ่านข้อมูลตัวอย่างไม่สำเร็จ');
  stores.demo.importRows(parsed.rows,'demo_seed');
}
const plService={
  documents:()=>pl.readDocuments().filter(d=>d.metadata?.confirmedTimestamp),
  async extract(buffer,filename){
    const local=await pl.extractBuffer(buffer,filename);
    if(!local.items.length)return extractPDF(buffer,filename);
    return {filename,pageCount:local.pdfData.numpages,
      document:{invoice_no:local.invoice,invoice_date:'',received_date:'',owner:'',etd:'',eta:'',etr:''},
      items:local.items.map((v,i)=>({item_ref:String(v.itemNo||`PL-${i+1}`),sap_no:String(v.sapNo||''),sap_po:String(v.sapPo||''),description:String(v.description||''),page:null,separate:false})),
      warnings:['อ่านด้วยตัวอ่าน PL เดิมบนเครื่อง กรุณาตรวจทุกแถวก่อนยืนยัน','หากต้องการเก็บต้นฉบับ PDF และหาแบรนด์ ให้ใช้อัปโหลดในหน้า PL Brand System แล้วเลือกเอกสารที่ยืนยันในหน้านี้'],text:local.rawText};
  }
};
const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{
  if(req.headers.host&&!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host))return res.status(403).json({error:'อนุญาตเฉพาะ localhost'});
  if(req.headers.origin&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin))return res.status(403).json({error:'ไม่อนุญาตคำขอจากเว็บไซต์อื่น'});
  res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});next();
});
app.get('/index.html',(req,res)=>res.redirect('/pl/'));
app.use(pl.app);
app.use(createApp(stores,{plService}));
const port=Number(process.env.PORT||3000);
const server=app.listen(port,'127.0.0.1',()=>{
  console.log(`\nPLM Integrated พร้อมใช้งาน\nQC / WO Tracking: http://localhost:${port}\nPL Brand System:  http://localhost:${port}/pl/\nใช้ตัวอ่าน PDF ในเครื่องเป็นค่าเริ่มต้น · ข้อมูลจริงและ Demo แยกกัน\n`);
});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`เปิดไม่ได้: Port ${port} ถูกใช้งาน ปิด Terminal ของระบบเก่าด้วย Control+C แล้วรันใหม่`:e.message);Object.values(stores).forEach(s=>s.close());process.exit(1);});
function close(){server.close(()=>{Object.values(stores).forEach(s=>s.close());process.exit(0);});server.closeIdleConnections();}
process.on('SIGINT',close);process.on('SIGTERM',close);
