import React,{useState} from 'react';
import {render,screen,cleanup,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {vi,beforeEach,afterEach,test,expect} from 'vitest';
import PDFImport from './PDFImport';
import {api} from './api';
vi.mock('./api',()=>({api:vi.fn()}));
const documentData={invoice_no:'INV-DEMO-PDF-001',invoice_date:'2026-10-21',received_date:'',owner:'',etd:'',eta:'',etr:''};
const draft={draftToken:'draft-1',filename:'demo.pdf',pageCount:2,document:documentData,items:[{item_ref:'001',sap_po:'9001',sap_no:'7000201',description:'Original',page:1}],warnings:['ตรวจทุกแถวเทียบต้นฉบับ'],text:'PDF text'};
let error;
function Wrapper(){const [preview,setPreview]=useState(null);return <><PDFImport mode="demo" busy={false} setPreview={setPreview} act={async task=>{try{await task();}catch(e){error=e.message;}}}/>{preview&&<div>Preview พร้อมยืนยัน</div>}</>;}
beforeEach(()=>{error='';api.mockReset();vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:pdf-source'),revokeObjectURL:vi.fn()}));});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
test('PDF UI: upload, edit, human review, preview; editing invalidates earlier commit preview',async()=>{
  api.mockResolvedValueOnce(draft).mockResolvedValueOnce({token:'preview-1'});const user=userEvent.setup();render(<Wrapper/>);
  await user.upload(screen.getByLabelText('เลือก Packing List PDF'),new File(['%PDF-1.7'],'demo.pdf',{type:'application/pdf'}));
  await screen.findByDisplayValue('7000201');expect(api.mock.calls[0][0]).toBe('/import/pdf/extract');expect(api.mock.calls[0][1].body.get('file').name).toBe('demo.pdf');
  const preview=screen.getByRole('button',{name:'ตรวจข้อมูลและ Preview ก่อนบันทึก'});expect(preview.disabled).toBe(true);
  const description=screen.getByLabelText('PDF DESCRIPTION แถว 1');await user.clear(description);await user.type(description,'Checked description');
  await user.click(screen.getByLabelText('ตรวจจำนวนรายการและทุกแถวเทียบ PDF แล้ว'));await user.click(preview);
  await screen.findByText('Preview พร้อมยืนยัน');const payload=JSON.parse(api.mock.calls[1][1].body);expect(payload.items[0].description).toBe('Checked description');expect(payload.reviewed).toBe(true);expect(payload.draftToken).toBe('draft-1');
  await user.type(description,' changed');expect(screen.queryByText('Preview พร้อมยืนยัน')).toBeNull();expect(preview.disabled).toBe(true);
});
test('PDF UI: textless PDF supports manual rows, correcting identity, additions and removals',async()=>{
  api.mockResolvedValue({...draft,items:[],text:'',warnings:['ไม่มี OCR']});const user=userEvent.setup();render(<Wrapper/>);
  await user.upload(screen.getByLabelText('เลือก Packing List PDF'),new File(['%PDF-1.7'],'scan.pdf',{type:'application/pdf'}));
  await screen.findByText('ไม่มี OCR');await user.type(screen.getByLabelText('PDF sap_no แถว 1'),'7000999');await user.type(screen.getByLabelText('PDF item_ref แถว 1'),'NEW-1');
  await user.click(screen.getByRole('button',{name:'เพิ่มแถว'}));expect(screen.getByLabelText('PDF sap_no แถว 2')).toBeTruthy();await user.click(screen.getByRole('button',{name:'ลบ PDF แถว 2'}));expect(screen.queryByLabelText('PDF sap_no แถว 2')).toBeNull();
  await user.click(screen.getByLabelText('ยืนยันเป็นรายการแยก แถว 1'));expect(screen.getByLabelText('ยืนยันเป็นรายการแยก แถว 1').checked).toBe(true);
});
test('PDF UI: failed replacement discards stale preview and revokes prior file URL',async()=>{
  api.mockResolvedValueOnce(draft).mockResolvedValueOnce({token:'preview-1'}).mockRejectedValueOnce(Error('อ่าน PDF ไม่สำเร็จ'));
  const user=userEvent.setup();render(<Wrapper/>);const file=screen.getByLabelText('เลือก Packing List PDF');
  await user.upload(file,new File(['%PDF-1.7'],'demo.pdf',{type:'application/pdf'}));await screen.findByDisplayValue('7000201');await user.click(screen.getByLabelText('ตรวจจำนวนรายการและทุกแถวเทียบ PDF แล้ว'));await user.click(screen.getByRole('button',{name:'ตรวจข้อมูลและ Preview ก่อนบันทึก'}));await screen.findByText('Preview พร้อมยืนยัน');
  await user.upload(file,new File(['%PDF-broken'],'broken.pdf',{type:'application/pdf'}));await waitFor(()=>expect(error).toBe('อ่าน PDF ไม่สำเร็จ'));expect(screen.queryByText('Preview พร้อมยืนยัน')).toBeNull();expect(screen.queryByDisplayValue('7000201')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-source');
});

test('PL bridge lists confirmed documents and opens the reviewed rows with the stored PDF',async()=>{api.mockImplementation(async path=>path==='/pl/documents'?{documents:[{documentId:'PL-TEST',originalName:'saved.pdf',itemCount:1}]}:{...draft,sourceURL:'/api/documents/PL-TEST/file'});const user=userEvent.setup();render(<PDFImport mode="real" busy={false} setPreview={()=>{}} act={async fn=>fn()}/>);await screen.findByRole('option',{name:'saved.pdf · 1 รายการ'});await user.selectOptions(screen.getByLabelText('เลือกเอกสาร PL ที่ยืนยันแล้ว'),'PL-TEST');await user.click(screen.getByRole('button',{name:'ใช้รายการจาก PL',exact:true}));await screen.findByDisplayValue('7000201');expect(screen.getByTitle('PDF ต้นฉบับ').getAttribute('src')).toBe('/api/documents/PL-TEST/file');expect(api.mock.calls.some(([p])=>p==='/pl/documents/PL-TEST')).toBe(true);});
