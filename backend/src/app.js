import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from './database.js';
import { parseFile } from './imports.js';
import { readSheets,sheetConfig } from './sheets.js';
import { reportBuffer } from './export.js';
import { normalizeQC,MODELS } from './logic.js';
import { parseDate } from './validation.js';
import { extractPDF } from './pdf-extract.js';
import { preparePDFImport } from './pdf-import.js';
import { verifyLineSignature, extractLineMessages } from './line-webhook.js';
import { parseLineQC } from './line-parser.js';
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
const fail=(msg,status=400)=>{throw Object.assign(Error(msg),{status});};
function text(v,name,max=2000){if(typeof v!=='string'||!v.trim()||v.length>max)fail(`กรุณาระบุ ${name} ไม่เกิน ${max} ตัวอักษร`);return v.trim();}
export function createApp(stores,{plService}={}) {
  const app=express(),previews=new Map(),pdfDrafts=new Map();
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});
    const isLineWebhook =
  req.method === 'POST' &&
  req.path === '/api/line/webhook';

const isLocalHost =
  /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
    req.headers.host || ''
  );

if (!isLocalHost && !isLineWebhook) {
  return res.status(403).json({
    error: 'อนุญาตเฉพาะ localhost'
  });
}
    const origin=req.headers.origin;
    if(origin&&!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))return res.status(403).json({error:'ไม่อนุญาตคำขอจากเว็บไซต์อื่น'});
    next();
  });
    // LINE Webhook: ตรวจสอบลายเซ็นก่อนอ่าน JSON
  app.post(
    '/api/line/webhook',
    express.raw({ type: 'application/json', limit: '256kb' }),
    (req, res) => {
      const secret = process.env.LINE_CHANNEL_SECRET;
      const signature = req.get('x-line-signature');

      if (!verifyLineSignature(req.body, signature, secret)) {
        return res.status(401).json({ error: 'Invalid LINE signature' });
      }

      let payload;
      try {
        payload = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const allowedGroup = process.env.LINE_GROUP_ID;
      if (!allowedGroup) {
  for (const event of payload.events || []) {
    if (event.source?.type === 'group' && event.source.groupId) {
      console.log('[LINE SETUP] Group ID:', event.source.groupId);
    }
  }

  return res.status(200).json({ ok: true });
}
      const messages = extractLineMessages(payload);

      if (!allowedGroup) {
        return res.status(503).json({
          error: 'LINE_GROUP_ID is not configured'
        });
      }

      const store = stores.real;

      try {
        for (const message of messages) {
          if (message.groupId !== allowedGroup) continue;

          const parsed = parseLineQC(message.rawText);
          const now = new Date().toISOString();

          store.run(
            `INSERT OR IGNORE INTO line_qc_messages
             (id, line_message_id, group_id, raw_text,
              sap_no, lot_no, quantity, qc_result,
              review_status, received_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            randomUUID(),
            message.messageId,
            message.groupId,
            message.rawText,
            parsed.sapNo,
            parsed.lotNo,
            parsed.quantity,
            parsed.qcResult,
            parsed.reviewStatus,
            message.receivedAt,
            now
          );
        }

        return res.status(200).json({ ok: true });
      } catch (error) {
        console.error('[LINE Webhook]', error.message);
        return res.status(500).json({ error: 'Webhook processing failed' });
      }
    }
  );
  app.use(express.json({limit:'1mb'}));
  app.use('/api',(req,res,next)=>{
    const mode=req.headers['x-data-mode']||'demo';
    if(!['demo','real'].includes(mode))return res.status(400).json({error:'โหมดข้อมูลไม่ถูกต้อง'});
    req.store=stores[mode];req.mode=mode;next();
  });
  app.get('/api/health',(req,res)=>res.json({ok:true,mode:req.mode,version:'1.1.0'}));
  app.get('/api/dashboard',(req,res)=>res.json(req.store.dashboard()));
  app.get('/api/items',(req,res)=>res.json(req.store.items()));
  app.get('/api/items/:id',(req,res)=>res.json(req.store.detail(req.params.id)));
  app.post('/api/items/:id/notes',(req,res)=>{
    req.store.addNote(req.params.id,text(req.body.note,'หมายเหตุ'),text(req.body.author,'ผู้บันทึก',100));res.json({ok:true});
  });
  app.post('/api/items/:id/confirm',(req,res)=>{
    const author=text(req.body.author,'ผู้ยืนยัน',100),reason=text(req.body.reason,'เหตุผล / แหล่งอ้างอิง');
    const p=req.body.payload;
    if(!p||typeof p!=='object')fail('ข้อมูลยืนยันไม่ถูกต้อง');
    const row={};
    for(const k of ['qc_result','direct_by','qc_reference','wo_number','wo_model','wo_reference','qc_date']){
      if(typeof p[k]!=='string'||p[k].length>2000)fail(`ข้อมูล ${k} ไม่ถูกต้อง`);row[k]=p[k].trim();
    }
    row.qc_date=parseDate(row.qc_date);
    if(!['','ACCEPT','REJECT','DIRECT'].includes(row.qc_result))fail('กรุณาเลือกผล QC ที่ชัดเจน');
    if(row.wo_model&&!Object.values(MODELS).includes(row.wo_model))fail('WO Model ไม่ถูกต้อง');
    for(const k of ['direct_confirmed','wo_verified']){if(typeof p[k]!=='boolean')fail(`ข้อมูล ${k} ต้องเป็น true/false`);row[k]=p[k];}
    if(row.qc_result==='DIRECT'&&row.direct_confirmed&&(!row.direct_by||!row.qc_reference))fail('DIRECT ต้องระบุผู้ยืนยันและหลักฐาน');
    if(row.wo_verified&&(!row.wo_number||!row.wo_model||!row.wo_reference))fail('การยืนยัน WO ต้องมีเลข WO, Model และหลักฐาน');
    if(row.wo_number){
      const other=req.store.items().find(i=>i.id!==req.params.id&&i.wo_number===row.wo_number);
      if(other)fail('WO Number นี้ถูกใช้กับรายการอื่นแล้ว',409);
    }
    req.store.confirm(req.params.id,row,author,reason,req.body.source_hash);res.json({ok:true});
  });
  app.delete('/api/items/:id/confirm',(req,res)=>{
    const author=text(req.body.author,'ผู้ยืนยัน',100),before=req.store.detail(req.params.id);
    req.store.run('DELETE FROM user_confirmations WHERE item_id=?',req.params.id);
    req.store.audit(req.params.id,'confirmation_removed',before,null,'manual',author);res.json({ok:true});
  });
  function preview(req,result,source) {
    for(const [k,p] of previews)if(p.expires<Date.now())previews.delete(k);
    if(previews.size>40)fail('มีการ Preview ค้างมาก กรุณารอสักครู่',429);
    result.errors.push(...req.store.existingErrors(result.rows));
    if(req.mode==='real'&&result.rows.some(r=>r.invoice_no.startsWith('INV-DEMO-')||r.wo_number.startsWith('WO-DEMO-')))result.errors.push({row:1,message:'พบรหัสข้อมูลสมมติ INV-DEMO / WO-DEMO กรุณาทดลองใน Demo หรือแทนแถวตัวอย่างด้วยข้อมูลจริงก่อน'});
    const token=randomUUID(),versions={};
    for(const row of result.rows){
      const old=req.store.get('SELECT id,source_hash FROM invoice_items WHERE invoice_id=(SELECT id FROM invoices WHERE invoice_no=?) AND item_ref=?',row.invoice_no,row.item_ref);
      versions[`${row.invoice_no}|${row.item_ref}`]=old?.source_hash||null;
    }
    if(!result.errors.length)previews.set(token,{rows:result.rows,source,mode:req.mode,versions,expires:Date.now()+20*60*1000});
    return {...result,token:result.errors.length?null:token,source,total:result.rows.length,rows:result.rows.slice(0,100),previewLimit:100};
  }
  app.post('/api/import/preview',upload.single('file'),async(req,res)=>{
    if(!req.file)fail('กรุณาเลือกไฟล์');
    try{res.json(preview(req,await parseFile(req.file.buffer,req.file.originalname),'file'));}
    catch(e){if(e.status)throw e;fail('อ่านไฟล์ไม่สำเร็จ กรุณาใช้ CSV UTF-8 หรือ XLSX ตามแม่แบบ');}
  });
  app.post('/api/import/pdf/extract',upload.single('file'),async(req,res)=>{
    if(!req.file)fail('กรุณาเลือก PDF');
    for(const [key,draft] of pdfDrafts)if(draft.expires<Date.now())pdfDrafts.delete(key);
    if(pdfDrafts.size>=30)fail('มี PDF รอตรวจมากเกินไป กรุณารอให้ร่างหมดอายุ',429);
    const filename=path.basename(req.file.originalname).replace(/[\r\n\x00-\x1f]/g,'').slice(0,200);
    const result=await (plService ? plService.extract(req.file.buffer,filename) : extractPDF(req.file.buffer,filename));
    if(!result||!Array.isArray(result.items)||!result.document)fail('ตัวอ่าน PDF ไม่ส่งข้อมูลที่ถูกต้อง กรุณาลองอัปโหลดผ่าน PL Brand System',422);
    if(result.items.length>1000)fail('PDF มีรายการเกิน 1,000 แถว กรุณาแยกไฟล์');
    const draftToken=randomUUID();
    pdfDrafts.set(draftToken,{filename,mode:req.mode,expires:Date.now()+20*60*1000});
    res.json({...result,draftToken});
  });
  app.get('/api/pl/documents',(req,res)=>{
    if(req.mode!=='real')return res.json({documents:[]});
    res.json({documents:(plService?.documents()||[]).map(d=>({...d.metadata,itemCount:d.items.length}))});
  });
  app.get('/api/pl/documents/:id',(req,res)=>{
    if(req.mode!=='real')fail('เปลี่ยนเป็นโหมดข้อมูลจริงเพื่อเลือกเอกสาร PL',400);
    const saved=plService?.documents().find(d=>d.metadata.documentId===req.params.id);
    if(!saved)fail('ไม่พบเอกสาร PL ที่ยืนยันแล้ว',404);
    for(const [key,draft] of pdfDrafts)if(draft.expires<Date.now())pdfDrafts.delete(key);
    if(pdfDrafts.size>=30)fail('มีร่างรอตรวจมากเกินไป กรุณารอสักครู่',429);
    const meta=saved.metadata,draftToken=randomUUID();
    pdfDrafts.set(draftToken,{filename:meta.originalName,mode:req.mode,expires:Date.now()+20*60*1000});
    const invoice=meta.invoiceNo||meta.originalName.match(/\bINV\d{2,4}[-_][A-Z0-9-]+/i)?.[0]||'';
    res.json({draftToken,filename:meta.originalName,pageCount:meta.pageCount||0,
      sourceURL:'/api/documents/'+encodeURIComponent(meta.documentId)+'/file',
      document:{invoice_no:invoice,invoice_date:'',received_date:'',owner:'',etd:'',eta:'',etr:''},
      items:saved.items.map((i,n)=>({item_ref:String(i.itemNo||`PL-${n+1}`),sap_no:String(i.sapNo||''),sap_po:String(i.sapPo||''),description:String(i.description||''),page:null,separate:false})),
      warnings:['ใช้รายการจาก PL ที่ยืนยันแล้ว ต้นฉบับและแบรนด์ยังเปิดได้ใน PL Brand System','กรอกวันรับของและผู้รับผิดชอบ ตรวจ Ref. ให้ตรง Google Sheets; ขั้นตอนนี้ยังไม่ได้ระบุผล QC หรือเปิด WO'],text:''});
  });
  app.post('/api/import/pdf/preview',(req,res)=>{
    const draft=pdfDrafts.get(req.body.draftToken);
    if(!draft||draft.expires<Date.now()||draft.mode!==req.mode)fail('ร่าง PDF หมดอายุหรือคนละโหมด กรุณาอัปโหลดใหม่',409);
    if(req.body.reviewed!==true)fail('กรุณาตรวจทุกแถวเทียบกับ PDF ก่อน Preview');
    const {document,items}=req.body;
    if(!document||typeof document!=='object'||Array.isArray(document)||!Array.isArray(items)||!items.length||items.length>1000)fail('กรุณาระบุ Invoice และรายการ 1–1,000 แถว');
    for(const key of ['invoice_no','invoice_date','etd','eta','etr','owner','received_date'])if(typeof document[key]!=='string'||document[key].length>2000)fail('ข้อมูลเอกสาร PDF ไม่ถูกต้อง');
    for(const row of items){
      if(!row||typeof row!=='object')fail('ข้อมูลรายการ PDF ไม่ถูกต้อง');
      for(const key of ['item_ref','sap_no','description','sap_po'])if(typeof row[key]!=='string'||row[key].length>2000)fail('ข้อมูลรายการ PDF ไม่ถูกต้อง');
      if(row.separate!==undefined&&typeof row.separate!=='boolean')fail('การยืนยันรายการแยกไม่ถูกต้อง');
    }
    res.json(preview(req,preparePDFImport(req.store,document,items,draft.filename),'pdf'));
  });
  app.post('/api/import/commit',(req,res)=>{
    const p=previews.get(req.body.token);
    if(!p||p.expires<Date.now()||p.mode!==req.mode)fail('Preview หมดอายุหรือคนละโหมด กรุณานำเข้าใหม่',409);
    for(const row of p.rows){
      const old=req.store.get('SELECT source_hash FROM invoice_items WHERE invoice_id=(SELECT id FROM invoices WHERE invoice_no=?) AND item_ref=?',row.invoice_no,row.item_ref);
      if((old?.source_hash||null)!==p.versions[`${row.invoice_no}|${row.item_ref}`])fail('ข้อมูลเปลี่ยนหลัง Preview กรุณานำเข้าใหม่',409);
    }
    const result=req.store.importRows(p.rows,p.source);previews.delete(req.body.token);res.json(result);
  });
  app.get('/api/settings',(req,res)=>res.json(sheetConfig(req.store)));
  app.put('/api/settings',(req,res)=>{
    const id=String(req.body.spreadsheetId||'').trim(),range=text(req.body.range,'Range',180);
    if(id&&!/^[\w-]{10,200}$/.test(id))fail('ใส่เฉพาะ Spreadsheet ID ไม่ใช่ URL');
    if(!/^[^!\r\n]{1,100}![A-Z]+\d+:[A-Z]+\d+$/.test(range))fail('Range ต้องมีชื่อแท็บ เช่น Tracking!A1:V10000');
    req.store.saveSettings({spreadsheetId:id,range});res.json({ok:true});
  });
  app.post('/api/sheets/preview',async(req,res)=>{
    if(req.mode!=='real')fail('โปรดเปลี่ยนเป็นโหมดข้อมูลจริงก่อนดึง Google Sheets');
    try {res.json(preview(req,await readSheets(req.store),'google_sheets'));}
    catch(e){req.store.run('INSERT INTO sync_history VALUES(?,?,?,?,?,?)',randomUUID(),'google_sheets','error',e.message,0,new Date().toISOString());throw e;}
  });
  app.get('/api/history',(req,res)=>res.json({sync:req.store.all('SELECT * FROM sync_history ORDER BY created_at DESC LIMIT 100'),audit:req.store.all('SELECT * FROM audit_history ORDER BY created_at DESC LIMIT 200')}));
  app.get('/api/export',async(req,res)=>{
    const {kind,status,from,to}=req.query;
    if(kind&&!['backlog','summary'].includes(kind))fail('ชนิดรายงานไม่ถูกต้อง');
    if(status&&!['waiting','pending','review','completed'].includes(status))fail('สถานะไม่ถูกต้อง');
    if(from)parseDate(from);if(to)parseDate(to);
    const buffer=await reportBuffer(req.store,{kind,status,from,to,q:String(req.query.q||'')});
    res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition',`attachment; filename="wo-${req.mode}-${kind||'backlog'}.xlsx"`);res.send(Buffer.from(buffer));
  });
  app.get('/api/template',(req,res)=>res.download(path.join(ROOT,'sample-data/google-sheets-template.xlsx')));
  app.use('/api',(req,res)=>res.status(404).json({error:'ไม่พบ API'}));
  const dist=path.join(ROOT,'frontend/dist');
  if(fs.existsSync(dist)) {app.use(express.static(dist));app.get('/{*path}',(req,res)=>res.sendFile(path.join(dist,'index.html')));}
  app.use((e,req,res,next)=>{
    const status=e.code==='LIMIT_FILE_SIZE'?413:e.status||500;
    res.status(status).json({error:e.code==='LIMIT_FILE_SIZE'?'ไฟล์ใหญ่เกิน 10 MB':status===500?'เกิดข้อผิดพลาดภายในระบบ กรุณาตรวจ Terminal':e.message});
    if(status===500)console.error(e.message);
  });
  return app;
}
