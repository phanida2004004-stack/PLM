import React,{useState,useEffect} from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge,SearchBox,StatusSelect,Pagination,Empty } from './components';
export default function ItemsTable({items,onSelect,onRefresh,busy}) {
  const [q,setQ]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1);
  useEffect(()=>setPage(1),[q,status,items]);
  const filtered=items.filter(i=>(!status||status===i.status)&&[i.sap_no,i.description,i.item_ref,i.wo_number].join(' ').toLowerCase().includes(q.toLowerCase()));
  const pages=Math.max(1,Math.ceil(filtered.length/8)),p=Math.min(page,pages);
  return <><div className="table-toolbar"><SearchBox value={q} onChange={setQ} placeholder="ค้นหา SAP NO., รายละเอียด, WO NO."/><StatusSelect value={status} onChange={setStatus}/><button className="icon-button" onClick={onRefresh} disabled={busy} aria-label="รีเฟรชตาราง"><RefreshCw size={16}/></button></div>
    <div className="table-scroll"><table className="items-table"><thead><tr>{['#','SAP NO.','DESCRIPTION','ผล QC','WO MODEL','สถานะ WO','WO NO.','หมายเหตุ'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{filtered.slice((p-1)*8,p*8).map((i,n)=><tr key={i.id}>
      <td>{(p-1)*8+n+1}</td><td><button className="link sap" onClick={()=>onSelect(i.id)}>{i.sap_no}</button><small className="subtext">Ref. {i.item_ref}</small></td><td><button className="description link" onClick={()=>onSelect(i.id)} title={i.description}>{i.description}</button></td><td><Badge>{i.qc==='UNKNOWN'?'ตรวจผล QC':i.qc||'รอผล'}</Badge></td><td><span className="model">{i.requiredModel||'-'}</span></td><td><Badge status={i.status}/></td><td className="mono">{i.wo_number||'-'}</td><td><button className="link note-cell" onClick={()=>onSelect(i.id)} title={i.issue||i.source_note}>{i.issue||i.source_note||'ดูรายละเอียด'}</button></td>
    </tr>)}</tbody></table></div>{!filtered.length&&<Empty/>}<Pagination total={filtered.length} page={p} pages={pages} setPage={setPage}/></>;
}
