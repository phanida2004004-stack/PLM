import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

// Add columns alongside the original page; retain every original object and page size.
export async function createPrint(sourcePath,items) {
  const {groupCoordinateRows,detectPackingListHeader}=require('./pl/server.js');
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bytes=fs.readFileSync(sourcePath),out=await PDFDocument.create();
  out.registerFontkit(fontkit);
  const latin=await out.embedFont(StandardFonts.Helvetica);
  const thai=await out.embedFont(fs.readFileSync(new URL('./pl/public/assets/thai-400.woff2',import.meta.url)),{subset:true});
  const source=await PDFDocument.load(bytes);
  const embedded=await out.embedPages(source.getPages());
  const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true});
  const queues=new Map();
  for(const item of items){const key=String(item.sapNo||'').trim();if(!queues.has(key))queues.set(key,[]);queues.get(key).push(item);}
  let annotated=0;
  try {
    const doc=await task.promise;
    for(let n=0;n<embedded.length;n++){
      const original=embedded[n],page=out.addPage([original.width,original.height]);
      const reserve=88,left=original.width-reserve;
      page.drawPage(original,{x:0,y:0,width:left,height:original.height});
      const pdfPage=await doc.getPage(n+1),content=await pdfPage.getTextContent();
      const cells=content.items.filter(i=>i.str).map(i=>({str:i.str,x:i.transform[4],y:i.transform[5],width:i.width}));
      const rows=groupCoordinateRows(cells),header=detectPackingListHeader(rows);
      if(!header){pdfPage.cleanup();continue;} // continuation pages may contain only weights or totals
      const headerY=header.row.y;
      page.drawText('BOM',{x:left+3,y:headerY,size:6,font:latin});
      page.drawText('BRAND',{x:left+31,y:headerY,size:7,font:latin});
      page.drawLine({start:{x:left+2,y:headerY-7},end:{x:original.width-4,y:headerY-7},thickness:.4,color:rgb(.5,.5,.5)});
      const sapX=header.columns.sapNo;
      const candidates=cells.filter(c=>/^\d{7,9}$/.test(c.str.trim())&&c.y<headerY-8&&c.x>=0&&Math.abs(c.x+c.width/2-sapX)<24).sort((a,b)=>b.y-a.y);
      for(const item of queues.get('')||[]){const match=cells.find(c=>c.y<headerY-8&&c.x>sapX&&c.str.toUpperCase().replace(/\s+/g,' ').includes(String(item.description||'').toUpperCase().replace(/\s+/g,' ')));if(match)candidates.push({...match,str:'',confirmed:item});}
      candidates.sort((a,b)=>b.y-a.y);
      for(const row of candidates){
        const item=row.confirmed||queues.get(row.str.trim())?.shift();if(!item)continue;annotated++;
        if(row.confirmed){const q=queues.get('');q.splice(q.indexOf(item),1);}
        const x=left+10,y=row.y;
        if(item.bomFound===true){
          page.drawLine({start:{x:x-3,y:y+2},end:{x,y:y-1},thickness:.8});
          page.drawLine({start:{x,y:y-1},end:{x:x+5,y:y+6},thickness:.8});
        }else{
          page.drawLine({start:{x:x-3,y:y-1},end:{x:x+3,y:y+5},thickness:.8});
          page.drawLine({start:{x:x-3,y:y+5},end:{x:x+3,y:y-1},thickness:.8});
        }
        const brand=item.bomFound===false?'ไม่พบ BOM':String(item.brand||'').trim();
        if(['Conflict','รอตรวจสอบ','UNRESOLVED'].includes(brand))continue;
        // Script-aware runs keep Thai glyphs and Latin abbreviations legible without Python.
        const runs=(brand.match(/[\u0e00-\u0e7f]+|[^\u0e00-\u0e7f]+/g)||[]).map(text=>({text,font:/[\u0e00-\u0e7f]/.test(text)?thai:latin}));
        const width=size=>runs.reduce((sum,r)=>sum+r.font.widthOfTextAtSize(r.text,size),0);
        let size=6.5;while(size>3.25&&width(size)>reserve-28)size-=.25;
        if(width(size)>reserve-28)throw Object.assign(Error('ชื่อแบรนด์ยาวเกินคอลัมน์ Print กรุณาตรวจชื่อก่อนพิมพ์'),{status:422});
        let textX=left+26;
        for(const run of runs){page.drawText(run.text,{x:textX,y,size,font:run.font});textX+=run.font.widthOfTextAtSize(run.text,size);}
      }
      pdfPage.cleanup();
    }
    if(annotated!==items.length)throw Object.assign(Error(`จับคู่ Print ได้ ${annotated}/${items.length} รายการ กรุณาตรวจ SAP NO. เทียบ PDF ต้นฉบับก่อนพิมพ์`),{status:422});
    return Buffer.from(await out.save());
  } finally {await task.destroy();}
}
