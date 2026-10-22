import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { validateRows } from './validation.js';
export async function parseFile(buffer,filename) {
  let values;
  if(filename.toLowerCase().endsWith('.csv')) values=parse(buffer.toString('utf8'),{bom:true,skip_empty_lines:true,relax_column_count:true});
  else if(filename.toLowerCase().endsWith('.xlsx')) {
    // OOXML allows prefixed spreadsheet tags. ExcelJS expects unprefixed tags.
    // Normalize only the main SpreadsheetML namespace in memory; never alter the source file.
    const zip=await JSZip.loadAsync(buffer);let totalSize=0;
    const workbookXML=await zip.file('xl/workbook.xml')?.async('string');
    const epoch=/date1904="(?:1|true)"/.test(workbookXML||'')?24107:25569;
    for(const [name,entry] of Object.entries(zip.files))if(!entry.dir&&name.endsWith('.xml')){
      let xml=await entry.async('string');totalSize+=xml.length;
      if(totalSize>40*1024*1024)throw Object.assign(Error('ข้อมูลภายใน XLSX ใหญ่เกิน 40 MB'),{status:400});
      const prefix=xml.match(/xmlns:([A-Za-z_][\w-]*)="http:\/\/schemas.openxmlformats.org\/spreadsheetml\/2006\/main"/);
      if(prefix){const p=prefix[1];xml=xml.replace(new RegExp('(<\\/?)'+p+':','g'),'$1').replace('xmlns:'+p+'=','xmlns=');}
      // ExcelJS also expects numeric Excel dates rather than OOXML t="d" ISO dates.
      xml=xml.replace(/(<c\b[^>]*\bt=)"d"([^>]*>)\s*<v>([^<]+)<\/v>/g,(all,before,after,value)=>{
        const ms=Date.parse(value);if(!Number.isFinite(ms))throw Object.assign(Error('วันที่ใน XLSX ไม่ถูกต้อง'),{status:400});
        return before+'"n"'+after+'<v>'+(ms/86400000+epoch)+'</v>';
      });
      zip.file(name,xml);
    }
    const wb=new ExcelJS.Workbook();await wb.xlsx.load(await zip.generateAsync({type:'nodebuffer'}),{ignoreNodes:['tableParts','drawing','extLst']});
    const sheet=wb.getWorksheet('Tracking')||wb.worksheets[0];
    if(!sheet) throw Object.assign(Error('ไม่พบ Worksheet'),{status:400});
    if(sheet.rowCount>10001||sheet.columnCount>100) throw Object.assign(Error('ไฟล์มีขนาดตารางเกินขอบเขต'),{status:400});
    values=[];sheet.eachRow({includeEmpty:true},row=>values.push(Array.from({length:Math.max(sheet.columnCount,22)},(_,i)=>row.getCell(i+1).value??'')));
  } else throw Object.assign(Error('รองรับเฉพาะ .csv และ .xlsx'),{status:400});
  if(!values?.length) throw Object.assign(Error('ไฟล์ว่าง'),{status:400});
  return validateRows(values[0],values.slice(1));
}
