// Recoverable JSON transaction: stage both document and memory before replacing either.
const fs = require('node:fs');
const path = require('node:path');
const journal = path.join(__dirname, 'uploads', 'pending-save.json');
function readArray(file) {
  const result = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(result)) throw Error(`ข้อมูลไม่ใช่รายการ: ${path.basename(file)} — หยุดเพื่อป้องกันข้อมูลเดิม`);
  return result;
}
function recover() {
  if (!fs.existsSync(journal)) return;
  const entries = JSON.parse(fs.readFileSync(journal, 'utf8'));
  for (const {file, value} of entries) {
    const target = path.resolve(__dirname, file);
    if (!target.startsWith(__dirname + path.sep)) throw Error('Invalid recovery path');
    const temp = target + '.recover';
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, target);
  }
  fs.unlinkSync(journal);
}
function writeBundle(entries) {
  recover();
  for (const {file} of entries) if (fs.existsSync(file)) {
    readArray(file); // Fail closed: never overwrite a damaged existing file with [].
    fs.copyFileSync(file, file + '.bak');
  }
  const prepared = journal + '.tmp';
  fs.writeFileSync(prepared, JSON.stringify(entries.map(({file,value}) => ({file:path.relative(__dirname,file),value}))), 'utf8');
  fs.renameSync(prepared, journal);
  recover();
}
module.exports = {readArray, writeBundle, recover};
