import React,{useEffect,useRef,useState} from 'react';
import { FileText,Upload,Plus,Trash2 } from 'lucide-react';
import { api } from './api';

const blank=()=>({item_ref:'',sap_no:'',description:'',sap_po:'',page:null,separate:false});
export default function PDFImport({mode,busy,act,setPreview,onStart}) {
  const input=useRef(null),urlRef=useRef('');
  const [documents,setDocuments]=useState([]),[selectedDoc,setSelectedDoc]=useState('');
  useEffect(()=>{if(mode!=='real'){setDocuments([]);return;}let active=true;api('/pl/documents',{},mode).then(r=>{if(active)setDocuments(r.documents||[]);}).catch(()=>{});return()=>{active=false;};},[mode]);
  async function chooseSaved(){setPreview(null);setDraft(null);setReviewed(false);setPage(1);if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current='';setURL('');await act(async()=>{const result=await api('/pl/documents/'+encodeURIComponent(selectedDoc),{},mode);setDraft(result);setURL(result.sourceURL);setReviewed(false);setPage(1);onStart?.();});}
  const [draft,setDraft]=useState(null),[url,setURL]=useState(''),[reviewed,setReviewed]=useState(false),[page,setPage]=useState(1);
  useEffect(()=>()=>{if(urlRef.current)URL.revokeObjectURL(urlRef.current);},[]);
  async function choose(file){
    if(!file)return;
    // A new file invalidates the earlier commit preview even when extraction fails.
    setPreview(null);setDraft(null);setReviewed(false);setPage(1);onStart?.();
    if(urlRef.current)URL.revokeObjectURL(urlRef.current);urlRef.current='';setURL('');
    await act(async()=>{
      if(!/\.pdf$/i.test(file.name))throw Error('กรุณาเลือกไฟล์ .pdf');
      if(file.size>10*1024*1024)throw Error('PDF ใหญ่เกิน 10 MB');
      const body=new FormData();body.append('file',file);
      const result=await api('/import/pdf/extract',{method:'POST',body},mode);
      const sourceURL=URL.createObjectURL(file);urlRef.current=sourceURL;setURL(sourceURL);
      if(!result||!Array.isArray(result.items)||!result.document)throw Error('รูปแบบผลอ่าน PDF ไม่ถูกต้อง');
      setDraft({...result,items:result.items.length?result.items:[blank()]});
    });
    if(input.current)input.current.value='';
  }
  function change(next){setDraft(next);setReviewed(false);setPreview(null);}
  function changeRow(index,key,value){change({...draft,items:draft.items.map((r,i)=>i===index?{...r,[key]:value}:r)});}
  const current=Math.min(page,Math.max(1,Math.ceil((draft?.items.length||0)/20)));
  return <section className="panel pdf-panel">
    <div className="section-heading"><div><span className="eyebrow">PACKING LIST</span><h2>อัปโหลด Packing List PDF</h2><p>อ่านรายการ → ตรวจและแก้ไข → Preview → ยืนยันบันทึก</p></div><FileText size={24}/></div>
    <div className="pl-saved-picker"><strong>ใช้เอกสารจาก PL Brand System</strong><p>อ่าน PL → หาแบรนด์ → ยืนยันข้อมูล → ส่งรายการมาติดตาม QC / WO</p>{mode==='real'?<div className="actions"><select aria-label="เลือกเอกสาร PL ที่ยืนยันแล้ว" value={selectedDoc} onChange={e=>setSelectedDoc(e.target.value)} disabled={busy}><option value="">เลือกเอกสาร PL ที่ยืนยันแล้ว ({documents.length} ใบ)</option>{documents.map(d=><option key={d.documentId} value={d.documentId}>{d.originalName} · {d.itemCount} รายการ</option>)}</select><button disabled={busy||!selectedDoc} onClick={chooseSaved}>ใช้รายการจาก PL</button><a href="/pl/">เปิด PL Brand System ↗</a></div>:<p>เปลี่ยนเป็นโหมดข้อมูลจริงเพื่อใช้เอกสาร PL</p>}</div>
    <input ref={input} type="file" accept=".pdf,application/pdf" aria-label="เลือก Packing List PDF" hidden onChange={e=>choose(e.target.files[0])}/>
    <button className="upload-area pdf-upload" disabled={busy} onClick={()=>input.current.click()}><span><Upload size={26}/></span><strong>{draft?'เลือก PDF ใหม่':'เลือกไฟล์ PDF'}</strong><small>ไม่เกิน 10 MB / 50 หน้า · อ่าน Text PDF บนเครื่อง · ภาพสแกนกรอกเองได้</small></button>
    {!draft&&<p className="pdf-caption">PDF ใช้สร้างรายการ Invoice ตั้งต้น ส่วนผล QC และ WO นำเข้าจาก Google Sheets / Excel / CSV ได้ภายหลัง</p>}
    {draft&&<div className="pdf-draft">
      <div className="pdf-file-info"><FileText size={19}/><b>{draft.filename}</b><span>{draft.pageCount} หน้า · {draft.items.length} รายการในร่าง</span></div>
      <div className="validation-list"><strong>โปรดตรวจจากเอกสารต้นฉบับ</strong>{draft.warnings.map((w,i)=><p key={i}>{w}</p>)}</div>
      <details className="pdf-source"><summary>เปิดดู PDF ต้นฉบับ / ข้อความที่อ่านได้</summary>
        <iframe title="PDF ต้นฉบับ" src={url}/><details><summary>ข้อความที่ระบบอ่านได้</summary><pre>{draft.text||'ไม่มีข้อความใน PDF (อาจเป็นภาพสแกน)'}</pre></details>
      </details>
      <fieldset disabled={busy} className="pdf-fields"><legend>ข้อมูลของ Invoice</legend><div className="form-grid">
        {[['invoice_no','Invoice No.','text'],['invoice_date','วันที่ Invoice','date'],['received_date','วันที่รับของ / เริ่มรอ QC','date'],['owner','ผู้รับผิดชอบ','text'],['etd','ETD','date'],['eta','ETA','date'],['etr','ETR','date']].map(([key,label,type])=><label key={key}>{label}<input type={type} aria-label={'PDF '+label} maxLength={key==='invoice_no'?120:200} value={draft.document[key]||''} onChange={e=>change({...draft,document:{...draft.document,[key]:e.target.value}})}/></label>)}
      </div></fieldset>
      <p className="pdf-caption">Ref. ต้องตรงกับ item_ref ใน Google Sheets เพื่ออัปเดต QC / WO ให้รายการเดียวกัน หาก SAP NO. เดิมมีหลายบรรทัด ให้แยก Ref. ชัดเจน</p>
      <fieldset disabled={busy} className="pdf-fields"><legend>รายการจาก PDF — แก้ไขได้ทุกแถว</legend><div className="table-scroll"><table className="pdf-edit-table"><thead><tr>{['แถว / หน้า','Ref.','SAP PO.','SAP NO.','DESCRIPTION','รายการแยก',''].map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>
        {draft.items.slice((current-1)*20,current*20).map((row,j)=>{const i=(current-1)*20+j;return <tr key={i}><td>{i+1}<small className="subtext">หน้า {row.page||'-'}</small></td>
          {['item_ref','sap_po','sap_no','description'].map(key=><td key={key}>{key==='description'?<textarea aria-label={`PDF DESCRIPTION แถว ${i+1}`} value={row[key]} maxLength={2000} onChange={e=>changeRow(i,key,e.target.value)}/>:<input aria-label={`PDF ${key} แถว ${i+1}`} value={row[key]} maxLength={120} onChange={e=>changeRow(i,key,e.target.value)}/>}</td>)}
          <td><input type="checkbox" aria-label={`ยืนยันเป็นรายการแยก แถว ${i+1}`} checked={!!row.separate} onChange={e=>changeRow(i,'separate',e.target.checked)}/></td>
          <td><button className="icon-button" aria-label={`ลบ PDF แถว ${i+1}`} onClick={()=>change({...draft,items:draft.items.filter((_,n)=>n!==i)})}><Trash2 size={16}/></button></td></tr>;})}
      </tbody></table></div><div className="pdf-row-actions"><button disabled={draft.items.length>=1000} onClick={()=>{change({...draft,items:[...draft.items,blank()]});setPage(Math.ceil((draft.items.length+1)/20));}}><Plus size={16}/>เพิ่มแถว</button><div className="actions"><button disabled={current===1} onClick={()=>setPage(current-1)}>ก่อนหน้า</button><span>{current} / {Math.max(1,Math.ceil(draft.items.length/20))}</span><button disabled={current*20>=draft.items.length} onClick={()=>setPage(current+1)}>ถัดไป</button></div></div></fieldset>
      <div className="pdf-confirm"><label className="checkbox"><input type="checkbox" disabled={busy} checked={reviewed} onChange={e=>{setReviewed(e.target.checked);setPreview(null);}}/>ตรวจจำนวนรายการและทุกแถวเทียบ PDF แล้ว</label><button className="primary" disabled={busy||!reviewed||!draft.items.length} onClick={()=>act(async()=>setPreview(await api('/import/pdf/preview',{method:'POST',body:JSON.stringify({draftToken:draft.draftToken,document:draft.document,items:draft.items,reviewed})},mode)))}>ตรวจข้อมูลและ Preview ก่อนบันทึก</button></div>
      <p className="pdf-caption">ยังไม่บันทึกจนกด “ยืนยันนำเข้าทั้งหมด” ด้านล่าง · ร่างหมดอายุใน 20 นาที · เก็บข้อมูลที่ยืนยันลงฐานข้อมูล แต่ไม่เก็บไฟล์ PDF ต้นฉบับ</p>
    </div>}
  </section>;
}
