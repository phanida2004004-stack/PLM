import { GoogleAuth } from 'google-auth-library';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './database.js';
import { validateRows } from './validation.js';
export function sheetConfig(store) {
  const local=store.settings();
  const keyFile=process.env.GOOGLE_APPLICATION_CREDENTIALS||'';
  return {spreadsheetId:local.spreadsheetId??process.env.GOOGLE_SPREADSHEET_ID??'',range:local.range??process.env.GOOGLE_SHEET_RANGE??'Tracking!A1:V10000',
    credentialsReady:!!keyFile&&fs.existsSync(path.resolve(ROOT,keyFile))};
}
export async function readSheets(store) {
  const config=sheetConfig(store);
  if(!config.credentialsReady) throw Object.assign(Error('ยังไม่มีไฟล์ Service Account กรุณาทำตาม docs/GOOGLE-SHEETS.md'),{status:400});
  if(!config.spreadsheetId) throw Object.assign(Error('ยังไม่ได้ตั้ง Spreadsheet ID'),{status:400});
  try {
    const auth=new GoogleAuth({keyFile:path.resolve(ROOT,process.env.GOOGLE_APPLICATION_CREDENTIALS),scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
    const client=await auth.getClient();
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(config.range)}`;
    const response=await client.request({url,params:{valueRenderOption:'FORMATTED_VALUE',dateTimeRenderOption:'FORMATTED_STRING'},timeout:20000,retry:false});
    const values=response.data.values||[];
    if(!values.length) throw Error('ไม่พบข้อมูลในช่วงที่เลือก');
    return validateRows(values[0],values.slice(1));
  }catch(e){
    const code=Number(e.response?.status||e.code);
    const messages={400:'ช่วงข้อมูลไม่ถูกต้อง ตรวจชื่อแท็บและ Range',401:'Credentials ไม่ถูกต้อง',403:'อ่านชีตไม่ได้ ตรวจว่าเปิด Sheets API และแชร์ให้ Service Account เป็น Viewer แล้ว',404:'ไม่พบ Spreadsheet หรือบัญชีไม่มีสิทธิ์',429:'ดึงข้อมูลถี่เกินไป โปรดลองใหม่ภายหลัง'};
    throw Object.assign(Error(messages[code]||'เชื่อม Google Sheets ไม่สำเร็จ ตรวจอินเทอร์เน็ต / Credentials / รูปแบบข้อมูล'),{status:502});
  }
}
