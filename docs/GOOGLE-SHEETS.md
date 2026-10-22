# คู่มือเชื่อม Google Sheets

Service Account คือบัญชีสำหรับโปรแกรมอ่านชีต ระบบใช้บัญชีนี้เฉพาะ Backend และขอสิทธิ์ `spreadsheets.readonly` ไม่เขียนทับชีต ไม่เชื่อม SAP โดยตรง

## เตรียม Spreadsheet

1. ใช้ Spreadsheet ส่วนตัว/ขององค์กรที่บริษัทอนุญาต ไม่ต้องตั้ง Anyone with the link
2. ดาวน์โหลดแม่แบบจากหน้าระบบหรือเปิด sample-data/google-sheets-template.xlsx
3. สำหรับ Spreadsheet ใหม่ คุณสามารถนำเข้า XLSX เองผ่านเมนู File > Import ของ Google Sheets หรือคัดลอกหัวตารางจาก sample-data/template.csv
4. ใช้แท็บชื่อ Tracking แถว 1 เป็นชื่อคอลัมน์ภาษาอังกฤษทั้ง 22 ช่อง และข้อมูลเริ่มแถว 2 ให้ลบข้อมูลสมมติก่อนใช้จริง
5. ตั้งเลข Invoice, item_ref, SAP NO., WO NO. เป็น Plain text เพื่อเก็บศูนย์นำหน้า วันที่แนะนำให้แสดง YYYY-MM-DD ค่า TRUE/FALSE ใส่ตามแม่แบบ ห้าม Merge เซลล์ในข้อมูล

## สร้างสิทธิ์อ่าน

1. เปิด https://console.cloud.google.com เลือกหรือสร้าง Project ที่บริษัทอนุญาต
2. APIs & Services > Library > ค้นหา Google Sheets API > Enable
3. IAM & Admin > Service Accounts > Create Service Account ตั้งชื่อเช่น wo-tracking-reader ใน Project ไม่จำเป็นต้องเพิ่ม Project Owner หรือ Editor เพื่ออ่านชีต
4. เปิด Service Account > Keys > Add key > Create new key > JSON ถ้าองค์กรปิดการสร้าง Key ให้ติดต่อ IT ไม่ต้องเปลี่ยนนโยบายองค์กรเอง
5. เก็บ JSON ที่ดาวน์โหลดในโฟลเดอร์ `credentials/service-account.json` ข้าง package.json ให้สร้างโฟลเดอร์ credentials เอง ไฟล์นี้มี private_key ห้ามแชร์หรือส่งเข้าแชต
6. ใน JSON ให้ดูเฉพาะ client_email เช่น service-account-name@project-id.iam.gserviceaccount.com ไม่ต้องคัดลอก private_key ไปที่หน้าเว็บ
7. เปิด Spreadsheet > Share > ใส่ client_email > เลือก Viewer แชร์เฉพาะไฟล์ที่ต้องใช้และตามนโยบายองค์กร ไม่ต้องเปิดชีตสาธารณะ
8. คัดลอก .env.example เป็น .env คงค่า GOOGLE_APPLICATION_CREDENTIALS=./credentials/service-account.json ไว้
9. หยุดแล้วเปิด Server ใหม่ด้วย npm run dev เพื่อโหลด .env

## ตั้งค่าผ่านหน้าเว็บ

1. เปลี่ยนโหมดด้านบนเป็น **ข้อมูลจริง · ในเครื่อง**
2. เมนูตั้งค่าการเชื่อมต่อควรแสดง พบไฟล์ Credentials
3. เปิด URL Spreadsheet: `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit` คัดลอกเฉพาะส่วน SPREADSHEET_ID
4. ใส่ Spreadsheet ID และ Range เช่น `Tracking!A1:V10000` กดบันทึกการตั้งค่า ค่าที่บันทึกในหน้าจอมีลำดับเหนือค่าใน .env และแยกตามโหมด
5. กดดึงข้อมูลมา Preview ตรวจแถวผิดรูปแบบ/ข้อมูลซ้ำก่อนกดยืนยันนำเข้าทั้งหมด
6. ปุ่มรีเฟรชด้านบนจะดึงชีตมา Preview เมื่ออยู่โหมดข้อมูลจริงและตั้งค่าไว้ครบ การนำเข้าจะเกิดเมื่อกดยืนยันเท่านั้น รีเฟรชตารางย่อยอ่านเฉพาะฐานข้อมูลในเครื่อง
7. ถ้าเชื่อมไม่สำเร็จจะคงข้อมูลเดิมไว้ และบันทึกข้อผิดพลาดในประวัติการอัปเดต เวลาดึงข้อมูลสำเร็จจะเปลี่ยนหลังยืนยันนำเข้าแล้ว

เลือก Range ให้ครอบคลุมข้อมูลทั้งหมด หากมีเกิน 9,999 รายการ ให้แบ่งช่วงที่มีหัวตารางครบ หรือปรับขนาดชุดข้อมูลกับผู้ดูแล ระบบรับไม่เกิน 10,000 รายการต่อครั้ง คอลัมน์นอก A:V ไม่ถูกอ่านเมื่อ Range จบที่ V

## ตัวอย่าง Error

| ข้อความ / HTTP | ตรวจอะไร |
|---|---|
| ยังไม่มีไฟล์ Service Account | ชื่อไฟล์ ตำแหน่ง .env และ Restart แล้วหรือยัง |
| 400 ช่วงข้อมูลไม่ถูกต้อง | ชื่อแท็บและ A1 Range ต้องตรง |
| 401 Credentials ไม่ถูกต้อง | Key ถูกต้องและยังใช้งานได้หรือไม่ |
| 403 อ่านชีตไม่ได้ | เปิด Sheets API, แชร์ให้ client_email แบบ Viewer และนโยบายองค์กร |
| 404 ไม่พบ Spreadsheet | ID ถูกต้อง และบัญชีมีสิทธิ์อ่าน |
| 429 ดึงถี่เกินไป | รอแล้วลองอีกครั้ง ไม่ต้องกดรีเฟรชซ้ำติดกัน |
| ไม่มีคอลัมน์ | หัวตารางต้องตรงแม่แบบทั้ง 22 ช่อง ไม่อ่านจากหน้า PL โดยตรง |

ขณะส่งมอบยังไม่มี Credentials จึงทดสอบจริงกับ Google ของบริษัทไม่ได้ ไม่มีการสร้าง Spreadsheet หรือเผยแพร่ข้อมูลให้ภายนอก

เอกสารอ้างอิงทางการที่ใช้ตรวจวิธีเชื่อม:

- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get
- https://developers.google.com/workspace/sheets/api/scopes
- https://docs.cloud.google.com/iam/docs/service-accounts-create
- https://docs.cloud.google.com/iam/docs/keys-create-delete
