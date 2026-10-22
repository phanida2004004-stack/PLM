import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve('backups',new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(out,{recursive:true});
for(const mode of ['demo','real']){const source=path.resolve('database',mode+'.sqlite');if(!fs.existsSync(source))continue;const db=new DatabaseSync(source);await backup(db,path.join(out,mode+'.sqlite'));db.close();}
for(const folder of ['pl/uploads','pl/sample-data'])fs.cpSync(folder,path.join(out,folder),{recursive:true});
console.log('สำรองฐานข้อมูล WO, PDF, เอกสาร และ SAP Memory แล้ว: '+out);
