import fs from 'node:fs';import path from 'node:path';
const required=['server.mjs','print.mjs','package-lock.json','frontend/dist/index.html','pl/server.js','pl/storage.cjs','pl/bom-lookup.js','pl/public/index.html','pl/public/app.js','pl/public/brand-rules.js','pl/public/history.html','pl/public/memory.html','pl/public/assets/pl.css','pl/public/assets/lucide.min.js','pl/public/assets/sweetalert2.all.min.js','pl/public/assets/thai-400.woff2','pl/eng.traineddata','pl/sample-data/database.csv','pl/sample-data/Project01 - Ex.BOM.csv','pl/sample-data/Project01 - Ex.Production Model.csv','pl/sample-data/sap-memory.json','pl/uploads/documents.json','database/migrations/001_initial.sql'];
for(const file of required)if(!fs.existsSync(file))throw Error('ไฟล์จำเป็นหาย: '+file);
const documents=JSON.parse(fs.readFileSync('pl/uploads/documents.json','utf8'));
const memories=JSON.parse(fs.readFileSync('pl/sample-data/sap-memory.json','utf8'));
if(!Array.isArray(documents)||!Array.isArray(memories))throw Error('โครงสร้างข้อมูลเอกสาร / SAP Memory ไม่ถูกต้อง');
for(const d of documents){if(!Array.isArray(d.items))throw Error('รายการเอกสารไม่ถูกต้อง');if(!fs.existsSync(path.join('pl/uploads',path.basename(d.metadata.storedFileName||''))))throw Error('PDF ต้นฉบับหาย: '+d.metadata.documentId);}
console.log(`Files OK · PL ${documents.length} ใบ · ${documents.reduce((n,d)=>n+d.items.length,0)} รายการ · SAP Memory ${memories.length} รหัส`);
