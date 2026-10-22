import fs from 'node:fs';import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
if(Number(process.versions.node.split('.')[0])<24)throw Error('ต้องใช้ Node.js 24 ขึ้นไป ขณะนี้คือ '+process.version);
console.log('Node.js '+process.version+' OK');
for(const name of ['express','multer','pdf-parse','pdf-lib','@google/genai','tesseract.js','react','vite'])require.resolve(name);
await import('node:sqlite');
execFileSync(process.execPath,['scripts/verify-files.mjs'],{stdio:'inherit'});
console.log('Dependencies OK · ใช้ npm run dev แล้วเปิด http://localhost:3000');
if(!fs.existsSync('.env'))console.log('ไม่มี .env: ใช้ Local PDF / BOM / Memory / Print ได้ตามปกติ');
