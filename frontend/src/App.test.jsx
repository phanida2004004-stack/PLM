import React from 'react';
import { render,screen,waitFor,cleanup,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {vi,beforeEach,afterEach,test,expect} from 'vitest';
import App from './App';
import ItemsTable from './ItemsTable';
import fixture from '../../sample-data/demo.json';
import { evaluate,summarize,invoiceStatus } from '../../backend/src/logic.js';
import {api,download} from './api';
vi.mock('./api',()=>({api:vi.fn(),download:vi.fn()}));
const items=fixture.rows.map((r,n)=>({...evaluate(r),id:'item-'+n,invoice_id:r.invoice_no,source_hash:'hash-'+n,updated_at:'2026-10-21T03:00:00Z',daysWaiting:2}));
const invoices=[...new Set(items.map(i=>i.invoice_no))].map(no=>{const first=items.find(i=>i.invoice_no===no),s=summarize(items.filter(i=>i.invoice_no===no));return {...first,id:no,summary:s,status:invoiceStatus(s)};});
let apiOverrides={};
beforeEach(()=>{
  localStorage.clear();localStorage.setItem('wo-mode','demo');apiOverrides={};api.mockReset();download.mockReset();
  api.mockImplementation(async(path,options={},mode='demo')=>{
    if(path in apiOverrides)return apiOverrides[path];
    if(path==='/dashboard')return mode==='real'?{summary:{invoices:0,...summarize([])},invoices:[]}:{summary:{invoices:5,...summarize(items)},invoices};
    if(path==='/items')return mode==='real'?[]:items;
    if(path==='/settings')return {spreadsheetId:'',range:'Tracking!A1:V10000',credentialsReady:false};
    if(path==='/history')return {sync:[],audit:[]};
    if(path.startsWith('/items/item-')){const i=items.find(i=>path==='/items/'+i.id);if(i)return {...i,sourceData:i,source:'demo_seed',notes:[],history:[]};return {ok:true};}
    return {ok:true};
  });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function ready(){render(<App/>);await screen.findByText('Packing Lists');}
test('global cards use all invoices; review remains separate',async()=>{
  await ready();const cards=[...document.querySelectorAll('.global .stat')];
  expect(cards.map(c=>c.querySelector('.stat-number').textContent)).toEqual(['5','12','4','6']);
  expect(screen.getByText(/มี 3 รายการต้องตรวจสอบ/)).toBeTruthy();
});
test('Invoice selection updates local cards; search and status filters work',async()=>{
  const user=userEvent.setup();await ready();await user.click(screen.getByRole('button',{name:'รายการ Invoice'}));
  expect(document.querySelector('.invoice-title').textContent).toBe('INV-DEMO-105');
  expect([...document.querySelectorAll('.local .stat-number')].map(c=>c.textContent)).toEqual(['8','2','1','2']);
  const search=screen.getByRole('textbox',{name:'ค้นหา Invoice'});await user.type(search,'103');
  expect(document.querySelectorAll('.invoice-card').length).toBe(1);await user.click(document.querySelector('.invoice-card'));
  expect(document.querySelector('.invoice-title').textContent).toBe('INV-DEMO-103');
  expect([...document.querySelectorAll('.local .stat-number')].map(c=>c.textContent)).toEqual(['4','0','2','2']);
  await user.clear(search);await user.selectOptions(screen.getByRole('combobox',{name:'กรองสถานะ Invoice'}),'เปิดครบแล้ว');expect(document.querySelectorAll('.invoice-card').length).toBe(2);
});
test('item search, status filter, pagination and row opening use stable item IDs',async()=>{
  const user=userEvent.setup(),select=vi.fn();render(<ItemsTable items={items} onSelect={select} onRefresh={()=>{}}/>);
  expect(document.querySelectorAll('tbody tr').length).toBe(8);await user.click(screen.getByRole('button',{name:'หน้าถัดไป'}));expect(screen.getByText('2 / 4')).toBeTruthy();
  await user.type(screen.getByRole('textbox',{name:'ค้นหา SAP NO., รายละเอียด, WO NO.'}),'7000108');expect(document.querySelectorAll('tbody tr').length).toBe(1);
  await user.click(screen.getByRole('button',{name:'7000108'}));expect(select).toHaveBeenCalledWith('item-7');
  await user.selectOptions(screen.getByRole('combobox',{name:'กรองสถานะรายการ'}),'completed');expect(screen.getByText('ไม่พบข้อมูล')).toBeTruthy();
});
test('changing to real data shows an empty database instead of Demo',async()=>{
  const user=userEvent.setup();await ready();await user.selectOptions(screen.getByRole('combobox',{name:'โหมดข้อมูล'}),'real');await screen.findByText('ยังไม่มีรายการติดตาม QC / WO');expect(document.querySelector('.global .stat-number').textContent).toBe('0');expect(localStorage.getItem('wo-mode')).toBe('real');
});
test('Import validates first; errors disable commit, valid preview enables actual commit',async()=>{
  const user=userEvent.setup();await ready();await user.click(within(screen.getByRole('navigation')).getByRole('button',{name:'นำเข้าข้อมูล',exact:true}));
  apiOverrides['/import/preview']={total:1,source:'file',previewLimit:100,rows:[fixture.rows[0]],errors:[{row:2,message:'รหัสไม่ครบ'}],warnings:[],token:null};
  let input=document.querySelector('input[accept=".csv,.xlsx"]');await user.upload(input,new File(['test'],'invalid.csv',{type:'text/csv'}));await screen.findByText('แถว 2: รหัสไม่ครบ');expect(screen.getByRole('button',{name:'ยืนยันนำเข้าทั้งหมด'}).disabled).toBe(true);
  apiOverrides['/import/preview']={...apiOverrides['/import/preview'],errors:[],token:'valid-preview'};apiOverrides['/import/commit']={inserted:1,updated:0,unchanged:0};
  await user.upload(input,new File(['valid'],'good.csv',{type:'text/csv'}));await screen.findByText('ตรวจรูปแบบผ่าน');await user.click(screen.getByRole('button',{name:'ยืนยันนำเข้าทั้งหมด'}));
  await screen.findByText('Packing Lists');expect(api.mock.calls.some(([p,o])=>p==='/import/commit'&&JSON.parse(o.body).token==='valid-preview')).toBe(true);
});
test('follow-up filters and exports include selected status and dates',async()=>{
  const user=userEvent.setup();await ready();await user.click(screen.getByRole('button',{name:'ติดตามการเปิด WO'}));
  expect(document.querySelectorAll('tbody tr').length).toBe(6);await user.click(screen.getByRole('button',{name:/รอเปิด WO\s*4/}));expect(document.querySelectorAll('tbody tr').length).toBe(4);
  await user.type(screen.getByRole('textbox',{name:'ค้นหา Invoice, SAP NO., ผู้รับผิดชอบ'}),'INV-DEMO-105');expect(document.querySelectorAll('tbody tr').length).toBe(1);
  await user.click(screen.getByRole('button',{name:'ส่งออก Excel'}));await waitFor(()=>expect(download).toHaveBeenCalled());expect(download.mock.calls[0][0]).toContain('status=pending');expect(download.mock.calls[0][0]).toContain('q=INV-DEMO-105');
});
test('drawer notes save to the selected item and preserve author identity',async()=>{
  const user=userEvent.setup();await ready();await user.click(screen.getByRole('button',{name:'รายการ Invoice'}));await user.click(screen.getByRole('button',{name:'7000101'}));
  const dialog=await screen.findByRole('dialog');await within(dialog).findByText('บันทึกการติดตาม');
  await user.type(within(dialog).getByLabelText('ผู้บันทึก'),'ผู้ทดสอบ');await user.type(within(dialog).getByLabelText('หมายเหตุ'),'ติดตาม QC แล้ว');await user.click(within(dialog).getByRole('button',{name:'บันทึกหมายเหตุ / วันที่ติดตาม'}));
  await waitFor(()=>expect(api.mock.calls.some(([p,o])=>p==='/items/item-0/notes'&&JSON.parse(o.body).note==='ติดตาม QC แล้ว')).toBe(true));
  expect(localStorage.getItem('wo-author')).toBe('ผู้ทดสอบ');
});
test('Copy LINE copies filtered follow-up text without a send operation',async()=>{
  const user=userEvent.setup();const copy=vi.spyOn(navigator.clipboard,'writeText').mockResolvedValue();await ready();
  await user.click(screen.getByRole('button',{name:'ติดตามการเปิด WO'}));await user.click(screen.getByRole('button',{name:'Copy ข้อความ LINE'}));
  await waitFor(()=>expect(copy).toHaveBeenCalled());expect(copy.mock.calls[0][0]).toContain('INV-DEMO-105');expect(copy.mock.calls[0][0]).toContain('รอผล');
});
test('settings saves Spreadsheet ID and Range using backend API',async()=>{
  const user=userEvent.setup();await ready();await user.click(screen.getByRole('button',{name:'ตั้งค่าการเชื่อมต่อ'}));
  await user.type(screen.getByLabelText('Spreadsheet ID'),'example-sheet-id-123');await user.click(screen.getByRole('button',{name:'บันทึกการตั้งค่า'}));
  await waitFor(()=>expect(api.mock.calls.some(([p,o])=>p==='/settings'&&o.method==='PUT'&&JSON.parse(o.body).spreadsheetId==='example-sheet-id-123')).toBe(true));
});
test('manual confirmation sends source version, human name and evidence fields',async()=>{
  const user=userEvent.setup();await ready();await user.click(screen.getByRole('button',{name:'รายการ Invoice'}));await user.click(screen.getByRole('button',{name:'7000101'}));
  const dialog=await screen.findByRole('dialog');await within(dialog).findByText('บันทึกการติดตาม');await user.click(within(dialog).getByRole('button',{name:'ตรวจและยืนยัน'}));
  await user.type(within(dialog).getByLabelText('ผู้ยืนยัน'),'ผู้ตรวจสอบ');await user.type(within(dialog).getByLabelText('เหตุผล / รายละเอียดที่ตรวจสอบ'),'ตรวจ SAP Export แล้ว');await user.click(within(dialog).getByRole('button',{name:'ยืนยันข้อมูลที่ตรวจแล้ว'}));
  await waitFor(()=>expect(api.mock.calls.some(([p,o])=>p==='/items/item-0/confirm'&&JSON.parse(o.body).source_hash==='hash-0'&&JSON.parse(o.body).payload.wo_verified===true)).toBe(true));
});

test('new installation defaults to the isolated real database and links to PL',async()=>{localStorage.clear();await ready();expect(screen.getByRole('combobox',{name:'โหมดข้อมูล'}).value).toBe('real');expect(screen.getAllByRole('link').some(a=>a.getAttribute('href')==='/pl/')).toBe(true);});
