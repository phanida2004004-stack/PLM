import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { Store,ROOT } from './database.js';
import { parseFile } from './imports.js';
import { createApp } from './app.js';
dotenv.config({path:path.join(ROOT,'.env'),quiet:true});
const stores={demo:new Store(path.join(ROOT,'database/demo.sqlite')),real:new Store(path.join(ROOT,'database/real.sqlite'))};
if(!stores.demo.get('SELECT COUNT(*) AS n FROM invoice_items').n){
  const demo=await parseFile(fs.readFileSync(path.join(ROOT,'sample-data/demo.csv')),'demo.csv');
  if(demo.errors.length)throw Error(JSON.stringify(demo.errors));
  stores.demo.importRows(demo.rows,'demo_seed');
}
const port=Number(process.env.PORT||3000);
const server=createApp(stores).listen(port,'127.0.0.1',()=>console.log(`WO Tracking Dashboard API: http://localhost:${port} | ข้อมูล Demo และข้อมูลจริงแยกฐานข้อมูล`));
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} ถูกใช้งานอยู่ ปิด Terminal เก่าหรือเปลี่ยน PORT ใน .env และ proxy ใน frontend/vite.config.js`:e.message);process.exit(1);});
function close(){server.close(()=>{Object.values(stores).forEach(s=>s.close());process.exit(0);});}
process.on('SIGINT',close);process.on('SIGTERM',close);
