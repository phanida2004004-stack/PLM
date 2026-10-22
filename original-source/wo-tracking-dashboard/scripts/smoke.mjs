import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const url='http://127.0.0.1:'+port;let child;
async function start(){
  child=spawn(process.execPath,['backend/src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let log='';child.stderr.on('data',v=>{log+=v;});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{reject(Error('Server start timeout: '+log));},10000);child.stdout.on('data',v=>{log+=v;if(log.includes('Dashboard API:')){clearTimeout(timeout);resolve();}});child.once('exit',code=>{clearTimeout(timeout);reject(Error('Server exited '+code+': '+log));});});
}
async function stop(){if(!child||child.exitCode!==null)return;const exit=once(child,'exit');child.kill('SIGTERM');await exit;}
async function get(p,mode='demo'){const r=await fetch(url+'/api'+p,{headers:{'x-data-mode':mode}});assert.equal(r.status,200,p);return r.json();}
try{
  await start();assert.equal((await get('/health')).ok,true);const d=await get('/dashboard');assert.equal(d.summary.total,25);console.log('PASS: real backend startup + demo API (5 invoices / 25 items)');
  const html=await (await fetch(url)).text();assert.ok(html.includes('WO Tracking Dashboard'));const asset=html.match(/src="([^"]+\.js)"/)[1];assert.equal((await fetch(url+asset)).status,200);console.log('PASS: built frontend HTML and JavaScript served over HTTP');
  assert.equal((await get('/dashboard','real')).summary.total,0);console.log('PASS: real database starts empty and separate from demo');
  const item=(await get('/items'))[0],note='Smoke persistence '+Date.now();
  const result=await fetch(url+'/api/items/'+item.id+'/notes',{method:'POST',headers:{'Content-Type':'application/json','x-data-mode':'demo'},body:JSON.stringify({author:'Smoke Test (Demo)',note})});assert.equal(result.status,200);
  await stop();await start();const after=await get('/items/'+item.id);assert.ok(after.notes.some(n=>n.note===note));console.log('PASS: actual server stop/restart preserves the saved demo note');
  const template=await fetch(url+'/api/template');assert.equal(template.status,200);assert.ok((await template.arrayBuffer()).byteLength>1000);console.log('PASS: XLSX template download endpoint');
  await stop();execFileSync(process.execPath,['scripts/backup.mjs'],{stdio:'pipe'});const folders=fs.readdirSync('backups');const latest=folders.sort().at(-1);assert.ok(fs.existsSync('backups/'+latest+'/demo.sqlite'));assert.ok(fs.existsSync('backups/'+latest+'/real.sqlite'));console.log('PASS: SQLite backup command creates both database backups');
  console.log('Smoke test completed. Browser rendering was not tested.');
}finally{await stop();}
