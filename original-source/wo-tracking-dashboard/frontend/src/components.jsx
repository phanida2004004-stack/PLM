import React from 'react';
import { Search,ChevronLeft,ChevronRight,X,CheckCircle2,Clock3,Hourglass,AlertCircle } from 'lucide-react';
export const STATUS={completed:'เปิดแล้ว',pending:'รอเปิด WO',waiting:'รอผล',review:'ต้องตรวจสอบ'};
export const date=(v,time=false)=>v?new Intl.DateTimeFormat('th-TH-u-ca-gregory',{day:'2-digit',month:'2-digit',year:'numeric',...(time?{hour:'2-digit',minute:'2-digit'}:{}),timeZone:'Asia/Bangkok'}).format(new Date(v.length===10?v+'T00:00:00+07:00':v)):'-';
export function Badge({status,children}){const Icon={completed:CheckCircle2,pending:Clock3,waiting:Hourglass,review:AlertCircle}[status];return <span className={'badge '+(status||'neutral')}>{Icon&&<Icon size={13}/>} {children||STATUS[status]}</span>;}
export function SearchBox({value,onChange,placeholder,label}){return <label className="search"><Search size={17}/><input aria-label={label||placeholder} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}/></label>;}
export function StatusSelect({value,onChange,invoice=false}){return <select aria-label={invoice?'กรองสถานะ Invoice':'กรองสถานะรายการ'} value={value} onChange={e=>onChange(e.target.value)}><option value="">ทุกสถานะ</option>{invoice?['เปิดครบแล้ว','เปิดบางส่วน','ยังไม่เปิด WO','ต้องตรวจสอบ'].map(s=><option key={s}>{s}</option>):Object.entries(STATUS).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select>;}
export function Summary({data,global=false}) {
  const cards=global?[
    ['PACKING LIST',data.invoices,'Invoice','blue'],['สำเร็จ',data.completed,'รายการสินค้า','green'],['ยังไม่สำเร็จ',data.pending,'รายการรอเปิด WO','amber'],['รอผล',data.waiting,'รายการสินค้า','red']
  ]:[['รายการทั้งหมด',data.total,'รายการสินค้า','blue'],['เปิดสำเร็จ',data.completed,'รายการสินค้า','green'],['รอเปิด WO',data.pending,'รายการสินค้า','amber'],['รอผล',data.waiting,'รายการสินค้า','red']];
  return <div className={'summary '+(global?'global':'local')}>{cards.map(([title,n,unit,color])=><div className={'stat '+color} key={title}><div className="stat-label">{title}</div><div className="stat-number">{(n||0).toLocaleString()}</div><span>{unit}</span></div>)}</div>;
}
export function Pagination({page,pages,setPage,total}){return <div className="pagination"><span>พบ {total.toLocaleString()} รายการ</span><div><button className="icon-button" aria-label="หน้าก่อนหน้า" disabled={page<=1} onClick={()=>setPage(page-1)}><ChevronLeft size={16}/></button><span>{page} / {Math.max(1,pages)}</span><button className="icon-button" aria-label="หน้าถัดไป" disabled={page>=pages} onClick={()=>setPage(page+1)}><ChevronRight size={16}/></button></div></div>;}
export function Empty({text='ไม่พบข้อมูล',sub='ลองเปลี่ยนคำค้นหาหรือตัวกรอง'}){return <div className="empty"><Search size={30}/><h3>{text}</h3><p>{sub}</p></div>;}
export function Modal({title,children,onClose,wide=false}) {
  const closeRef=React.useRef(null);
  React.useEffect(()=>{
    const previous=document.activeElement;closeRef.current?.focus();
    const key=e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){
      const nodes=[...closeRef.current.closest('[role="dialog"]').querySelectorAll('button,input,select,textarea,a[href]')].filter(n=>!n.disabled);
      if(e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus();}
      else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus();}
    }};document.addEventListener('keydown',key);const old=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=old;previous?.focus();};
  },[]);
  return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className={'modal '+(wide?'wide':'')} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="ปิดรายละเอียด"><X size={20}/></button></header>{children}</section></div>;
}
