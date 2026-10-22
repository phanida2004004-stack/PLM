export async function api(path,options={},mode='demo') {
  const headers={'x-data-mode':mode,...options.headers};
  if(options.body && !(options.body instanceof FormData))headers['Content-Type']='application/json';
  let response;
  try{response=await fetch('/api'+path,{...options,headers});}
  catch(e){if(e.name==='AbortError')throw e;throw Error('เชื่อม Backend ไม่ได้ กรุณาตรวจ Terminal และรัน npm run dev');}
  if(!response.ok){const data=await response.json().catch(()=>({}));throw Error(data.error||'ดำเนินการไม่สำเร็จ');}
  return response.json();
}
export async function download(path,mode,filename) {
  const r=await fetch('/api'+path,{headers:{'x-data-mode':mode}});
  if(!r.ok)throw Error('ดาวน์โหลดไม่สำเร็จ');
  const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
