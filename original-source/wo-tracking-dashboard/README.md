# WO Tracking Dashboard

เว็บภาษาไทยสำหรับ Supply Chain เพื่อติดตามผล QC และสถานะการเปิด WO แยกตาม Invoice อัปโหลด Packing List PDF และใช้ข้อมูล Google Sheets หรือ CSV/XLSX ตามรอบที่ได้รับ ไม่ได้เปิด WO หรืออ่าน SAP โดยตรง

## เริ่มใช้งานใน VS Code

1. ติดตั้ง **Node.js รุ่น 24 LTS** จาก https://nodejs.org และติดตั้ง Visual Studio Code จาก https://code.visualstudio.com หากติดตั้ง Node ใหม่ ให้ปิดและเปิด VS Code อีกครั้ง
2. แตก ZIP ก่อนใช้งาน Windows: คลิกขวา > Extract All > Extract ส่วน macOS: ดับเบิลคลิก ZIP
3. เปิด VS Code เลือก **File > Open Folder** แล้วเลือกโฟลเดอร์ `wo-tracking-dashboard` ที่มี `package.json` อยู่โดยตรง
4. เลือก **Terminal > New Terminal** แล้วพิมพ์ทีละคำสั่ง กด Enter และรอให้แต่ละคำสั่งเสร็จ

```bash
node --version
npm install
npm run dev
```

คำสั่งแรกควรขึ้น `v24.x.x` คำสั่งติดตั้งต้องใช้อินเทอร์เน็ต ส่วน `npm run dev` จะเปิด Backend และ Frontend พร้อมกัน ให้เปิดเบราว์เซอร์ที่ **http://localhost:5173** แล้วเปิด Terminal ค้างไว้

เริ่มด้วยโหมด **DEMO · ข้อมูลสมมติ** มี 5 Invoice รวม 25 รายการ ไม่ต้องสร้าง .env และไม่ต้องมี Google Credentials ระบบสร้างฐานข้อมูลให้อัตโนมัติ เมื่อจะหยุด ให้กด **Ctrl+C** ที่ Terminal

> ถ้า Windows แจ้งว่า `npm.ps1 cannot be loaded` ให้กดลูกศรข้างปุ่ม + ใน Terminal แล้วเลือก **Command Prompt** หรือใช้ `npm.cmd install` และ `npm.cmd run dev`

## ทดลองภายใน 5 นาที

1. หน้า **ภาพรวม** จะเห็น PACKING LIST 5 Invoice, สำเร็จ 12 รายการ, ยังไม่สำเร็จ 4 รายการ และรอผล 6 รายการ มีรายการต้องตรวจสอบแยกอีก 3 รายการ
2. เปิด **รายการ Invoice** แล้วเลือก INV-DEMO-105 จะเห็นทั้งหมด 8, เปิดสำเร็จ 2, รอเปิด WO 1, รอผล 2 และต้องตรวจสอบ 3 รายการ
3. กด SAP NO. เพื่อดูหลักฐาน เพิ่มหมายเหตุ หรือเปิดแท็บตรวจและยืนยัน ระบบจะบันทึกลง SQLite
4. หน้า **ติดตามการเปิด WO** กรองกลุ่มรายการ ค้นหา เลือกช่วงวันที่เริ่มรอ แล้ว Copy ข้อความไปวางใน LINE เอง หรือส่งออก Excel
5. หน้า **นำเข้าข้อมูล** เลือก `sample-data/demo.csv` > ตรวจ Preview > ยืนยันนำเข้าทั้งหมด การนำเข้าไฟล์เดิมไม่เพิ่มรายการซ้ำ
6. ทดลอง `sample-data/invalid-duplicate.csv` ระบบต้องแสดงข้อผิดพลาดและห้ามยืนยัน
7. หยุดและรันใหม่ หมายเหตุ การยืนยัน และประวัติที่บันทึกไว้ต้องยังอยู่

## เพิ่มรายการจาก Packing List PDF

1. ไปเมนู **นำเข้าข้อมูล** แล้วกด **เลือกไฟล์ PDF** ในกรอบบนสุด
2. ทดลอง `sample-data/packing-list-demo.pdf` ในโหมด Demo ได้ทันที เป็นข้อมูลสมมติ 2 หน้า 4 รายการ
3. ระบบอ่าน Invoice No., วันที่, SAP NO., Description และ SAP PO. ที่อ่านได้ แล้วเปิดให้แก้ไข
4. กรอกวันที่รับของเพื่อเริ่มนับวันรอ QC ตรวจ Ref. ให้ตรง item_ref ของ Google Sheets
5. เปิดดูต้นฉบับ เพิ่ม/ลบ/แก้แถวให้ครบ แล้วติ๊ก **ตรวจจำนวนรายการและทุกแถวเทียบ PDF แล้ว**
6. กด **ตรวจข้อมูลและ Preview ก่อนบันทึก** แก้ข้อผิดพลาดจนผ่าน แล้วกด **ยืนยันนำเข้าทั้งหมด**

PDF ต้องไม่เกิน 10 MB / 50 หน้า / 1,000 รายการต่อครั้ง อ่าน Text PDF ที่มีหัวตาราง SAP NO. และ DESCRIPTION; ภาพสแกนหรือรูปแบบที่อ่านไม่ได้สามารถกรอกเองในหน้านี้ รุ่นนี้ยังไม่มี OCR และไม่รับรองว่าอ่านทุกรูปแบบครบอัตโนมัติ

PDF สร้างรายการรอผล QC โดยไม่เดา ACCEPT/REJECT/DIRECT หรือเลข WO ถ้านำเข้า Invoice + Ref. เดิม จะคง QC, WO และหมายเหตุเดิมไว้ ข้อมูลที่ยืนยันบันทึกใน SQLite; ไม่เก็บไฟล์ PDF ต้นฉบับ รายละเอียดเพิ่มเติมอยู่ที่ [คู่มือนำเข้า PDF](docs/PDF-IMPORT.md)

## อัปเดตจากรุ่นก่อน

หยุด Terminal เก่าด้วย Ctrl+C และรัน `npm run backup` ในโฟลเดอร์เดิมก่อน จากนั้นคัดลอกไฟล์จาก ZIP ใหม่ทับโฟลเดอร์โปรเจกต์เดิมโดยเก็บ database/*.sqlite, .env, credentials และ backups ของเดิมไว้ ZIP ไม่มีไฟล์เหล่านี้ แล้วรัน `npm install` และ `npm run dev` ใหม่ ฐานข้อมูลเดิมใช้ต่อได้ ไม่ต้องเริ่มข้อมูลใหม่

## ใช้ข้อมูลจริง

เปลี่ยนตัวเลือกมุมขวาบนเป็น **ข้อมูลจริง · ในเครื่อง** จะเริ่มด้วยฐานข้อมูลว่าง จากนั้นนำเข้าไฟล์ตามแม่แบบ หรือทำตาม [คู่มือ Google Sheets](docs/GOOGLE-SHEETS.md) ไม่มีการใส่ Credentials ปลอมไว้ใน ZIP

แม่แบบอยู่ที่ `sample-data/google-sheets-template.xlsx` มีแท็บ Tracking และคำอธิบายวิธีกรอก ให้ลบ 4 แถวตัวอย่างก่อนกรอกข้อมูลจริง ระบบป้องกันรหัส INV-DEMO / WO-DEMO ในโหมดข้อมูลจริง สำหรับชีตที่มีอยู่แล้ว ให้ฝ่ายที่ดูแลข้อมูลจัดคอลัมน์ตามแม่แบบก่อน

## เปิดแบบ Build แล้ว

ใช้เมื่อไม่ต้องการเปิด Vite ระหว่างใช้งาน ไม่ใช่การเผยแพร่เว็บไซต์

```bash
npm run build
npm start
```

เปิด **http://localhost:3000** Backend จะให้บริการ Frontend ที่ Build แล้วด้วย หยุด `npm run dev` ก่อนเพื่อไม่ให้ Port 3000 ชนกัน ZIP มีไฟล์ Build ให้แล้ว แต่ควร Build ใหม่หลังแก้ Source Code

## คำสั่งที่มี

| คำสั่ง | หน้าที่ |
|---|---|
| `npm install` | ติดตั้งเครื่องมือและแพ็กเกจ |
| `npm ci` | ติดตั้งตรงรุ่นตาม package-lock.json สำหรับทดสอบซ้ำ |
| `npm run dev` | เปิด Backend และ Frontend พร้อมกัน |
| `npm run build` | สร้าง Frontend สำหรับใช้งาน |
| `npm start` | เปิด Backend และ Frontend ที่ Build แล้ว |
| `npm test` | ทดสอบกฎ API ฐานข้อมูล และการกดหน้าจอใน DOM จำลอง |
| `npm run check` | ตรวจไวยากรณ์ JavaScript และ Build |
| `npm run smoke` | เปิด Server จริง ตรวจ HTTP ปิด/เปิดใหม่ และทดสอบข้อมูล Demo คงอยู่ |
| `npm run backup` | สำรอง SQLite ทั้งสองโหมดอย่างสอดคล้องไปที่ backups/ |

## โครงสร้างไฟล์

| โฟลเดอร์ / ไฟล์ | หน้าที่ |
|---|---|
| frontend/src | หน้าจอ React, Components, CSS และตัวเรียก API |
| backend/src/logic.js | กฎ QC และการคำนวณสถานะ |
| backend/src/validation.js | ตรวจคอลัมน์ วันที่ ค่าซ้ำ และตัวระบุรายการ |
| backend/src/database.js | อ่าน/เขียน SQLite และประวัติ |
| backend/src/imports.js | อ่าน CSV/XLSX |
| backend/src/pdf-extract.js | อ่านข้อความและตารางจาก PDF ใน Worker แยก |
| backend/src/pdf-import.js | ตรวจและเตรียมรายการ PDF โดยคง QC/WO เดิม |
| frontend/src/PDFImport.jsx | อัปโหลด PDF และตรวจแก้ร่างก่อนบันทึก |
| backend/src/sheets.js | อ่าน Google Sheets เฉพาะฝั่ง Server |
| backend/src/app.js | เส้นทาง API และการรับคำขอ |
| database/migrations | โครงสร้างตารางและ Migration |
| sample-data | ข้อมูลสมมติและแม่แบบ |
| docs | คู่มือ ข้อจำกัด และผลทดสอบ |
| package-lock.json | รุ่นแพ็กเกจที่ติดตั้งจริง |

ข้อมูลบริษัทแยกออกจาก Source Code ฐานข้อมูล Demo อยู่ที่ `database/demo.sqlite` และข้อมูลจริงอยู่ที่ `database/real.sqlite` ไฟล์เหล่านี้เกิดเมื่อเปิดระบบ ห้ามลบทิ้งหากต้องการเก็บข้อมูลเดิม และไม่ควรส่งให้ผู้อื่นพร้อม Credentials

## สำรองและกู้คืน

รัน `npm run backup` แล้วเก็บโฟลเดอร์ backups ที่สร้างขึ้นไว้ในพื้นที่ที่บริษัทอนุญาต การกู้คืนต้องหยุด Server ก่อน สำรองไฟล์ปัจจุบันไว้ แล้วย้าย `demo.sqlite` หรือ `real.sqlite` จากชุดสำรองมาแทนไฟล์ชื่อเดียวกันใน database/ ให้ลบเฉพาะไฟล์ `ชื่อเดียวกัน.sqlite-wal` และ `ชื่อเดียวกัน.sqlite-shm` ที่ตกค้าง **หลังหยุด Server และก่อนวางชุดสำรองเท่านั้น** จากนั้นเปิดระบบใหม่ หากไม่แน่ใจให้ผู้ดูแล IT ช่วยกู้คืน

## หากเปิดไม่ได้

| อาการ | วิธีแก้ |
|---|---|
| node / npm is not recognized | ติดตั้ง Node.js 24 และเปิด VS Code ใหม่ |
| หา package.json ไม่พบ | Open Folder ให้ตรงกับโฟลเดอร์ที่มีไฟล์ package.json |
| Port already in use | หยุด Terminal เก่าด้วย Ctrl+C ก่อนรันใหม่ |
| localhost:5173 เข้าไม่ได้ | ตรวจว่า npm run dev ยังทำงานและไม่มีข้อความ Error |
| เชื่อม Backend ไม่ได้ | ดูแถบ API ใน Terminal; Backend ใช้ Port 3000 |
| ต้องเปลี่ยน Port API | ตั้ง PORT ใน .env และแก้ proxy ใน frontend/vite.config.js ให้ตรงกัน |
| วันที่ผิดรูปแบบ | ใช้ YYYY-MM-DD เช่น 2026-10-21 และดูคู่มือนำเข้า |
| Preview หมดอายุ | เลือกไฟล์หรือดึงชีตมา Preview ใหม่; Preview อยู่ได้ 20 นาทีและหายเมื่อ Restart |
| ไม่เห็นข้อมูลเก่า | ตรวจว่าเลือกโหมดเดิมและเปิดโฟลเดอร์โปรเจกต์เดิม ฐานข้อมูลไม่ย้ายข้ามโหมด |

ระบบผูกกับ 127.0.0.1 เพื่อเปิดใช้บนเครื่องนี้ ยังไม่มี Login หรือสิทธิ์หลายระดับ ชื่อผู้ยืนยันเป็นชื่อที่พนักงานกรอก ดู [ข้อจำกัด](docs/LIMITATIONS.md) ก่อนนำไปใช้หลายคนในบริษัท

อ่านต่อ: [คู่มือ VS Code](docs/VSCODE.md), [การนำเข้า](docs/IMPORT.md), [โครงสร้างและกฎ](docs/ARCHITECTURE.md), [ทดสอบด้วยตนเอง](docs/TESTING.md), [ผลการทดสอบ](docs/TEST-RESULTS.md)
