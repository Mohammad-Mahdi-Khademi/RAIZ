import * as XLSX from 'xlsx';
import { reject, studentNumber, nationalId, text } from './core.js';
import { sha256 } from './security.js';
export const MAX_FILE=128*1024;
export const MAX_RESULTS=500;
export const MAX_STUDENTS=200;
// Inspect ZIP central-directory sizes before SheetJS decompresses anything.
export async function checkZip(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length<22 || view.getUint32(0,true)!==0x04034b50) reject(400,'fileType');
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--) if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0 || view.getUint16(end+4,true)!==0 || view.getUint16(end+6,true)!==0) reject(400,'fileType');
  if(end+22+view.getUint16(end+20,true)!==bytes.length)reject(400,'fileType');
  const entries=view.getUint16(end+10,true); let offset=view.getUint32(end+16,true), expanded=0, actualExpanded=0;
  const directoryStart=offset, names=new Set();
  if(entries>100 || entries===0 || view.getUint16(end+8,true)!==entries) reject(400,'fileSize');
  for(let i=0;i<entries;i++) {
    if(offset+46>bytes.length || view.getUint32(offset,true)!==0x02014b50) reject(400,'fileType');
    if(view.getUint16(offset+8,true)&1) reject(400,'fileType');
    const expected=view.getUint32(offset+24,true), compressed=view.getUint32(offset+20,true), method=view.getUint16(offset+10,true);
    expanded+=expected;
    if(expanded>1024*1024) reject(400,'fileSize');
    const len=view.getUint16(offset+28,true);
    if(offset+46+len+view.getUint16(offset+30,true)+view.getUint16(offset+32,true)>end)reject(400,'fileType');
    const path=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+len));
    if(names.has(path))reject(400,'fileType');names.add(path);
    if(/vbaProject|externalLinks|\.bin$/i.test(path)) reject(400,'fileType');
    const local=view.getUint32(offset+42,true);
    if(local+30>directoryStart || view.getUint32(local,true)!==0x04034b50 || view.getUint16(local+8,true)!==method || ![0,8].includes(method))reject(400,'fileType');
    const localNameLength=view.getUint16(local+26,true),start=local+30+localNameLength+view.getUint16(local+28,true);
    if(new TextDecoder().decode(bytes.subarray(local+30,local+30+localNameLength))!==path || start+compressed>directoryStart)reject(400,'fileType');
    // Check real decompressed size too: ZIP size declarations are attacker-controlled.
    let actual=0;
    if(method===0)actual=compressed;
    else {
      const stream=new Blob([bytes.subarray(start,start+compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader=stream.getReader();
      try{while(true){const {value,done}=await reader.read();if(done)break;actual+=value.length;if(actual>expected||actualExpanded+actual>1024*1024){await reader.cancel();reject(400,'fileSize');}}}
      catch(error){if(error.code)throw error;reject(400,'fileType');}
    }
    if(actual!==expected)reject(400,'fileType');actualExpanded+=actual;
    offset+=46+len+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
  }
  if(offset!==end) reject(400,'fileType');
}
export async function readUpload(request,kind) {
  // Bound the stream before formData allocation (Content-Length is not trusted).
  const reader=request.body?.getReader(); if(!reader) reject(400,'fileType');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_FILE+16384){await reader.cancel();reject(413,'fileSize');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let form;
  try{form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('Content-Type')||''}}).formData();}catch{reject(400,'fileType');}
  const file=form.get('file');
  if(!file || typeof file.arrayBuffer!=='function' || !/\.xlsx$/i.test(file.name) || file.size>MAX_FILE || !file.size) reject(400,'fileType');
  const data=new Uint8Array(await file.arrayBuffer());
  try{await checkZip(data);}catch(error){if(error.code)throw error;reject(400,'fileType');}
  let wb;
  try{wb=XLSX.read(data,{type:'array',cellFormula:true,cellDates:false,bookVBA:false});}catch{reject(400,'fileType');}
  if(wb.SheetNames.length!==1) reject(400,'oneSheet');
  const sheet=wb.Sheets[wb.SheetNames[0]];
  if(!sheet['!ref'] || sheet['!merges']?.length) reject(400,'columns');
  const range=XLSX.utils.decode_range(sheet['!ref']);
  const max=kind==='students'?MAX_STUDENTS:MAX_RESULTS, columns=kind==='students'?3:2;
  if(range.s.r!==0||range.s.c!==0||range.e.c!==columns-1||range.e.r<1||range.e.r>max) reject(400,'dimensions');
  for(const [address,cell] of Object.entries(sheet)) if(!address.startsWith('!') && (cell.f || cell.t==='e')) reject(400,'formula');
  const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,blankrows:true});
  const headers=rows.shift().map(v=>String(v??'').trim());
  const digest=await sha256(data);
  if(kind==='students') {
    const aliases=[['Full Name','اسم کامل'],['Student Number','شماره دانشجویی'],['National ID','شماره ملی']];
    const indices=aliases.map(a=>headers.findIndex(h=>a.includes(h)));
    if(indices.includes(-1)||new Set(indices).size!==3) reject(400,'studentColumns');
    const students=[],errors=[],numbers=new Set(),nationalIds=new Set();
    rows.forEach((r,i)=>{
      try {
        const full_name=text(r[indices[0]],200);
        // Text is mandatory for identifiers: numeric Excel cells can lose leading zeros.
        if(typeof r[indices[1]]!=='string'||typeof r[indices[2]]!=='string') reject(400,'identifierText');
        const student_number=studentNumber(r[indices[1]]), national_id=nationalId(r[indices[2]]);
        if(numbers.has(student_number)) reject(400,'duplicateStudent');
        if(nationalIds.has(national_id)) reject(400,'duplicateNational');
        numbers.add(student_number);nationalIds.add(national_id);
        students.push({full_name,student_number,national_id});
      }catch(e){errors.push({row:i+2,code:e.code||'invalid'});}
    });
    return {students,errors,digest,filename:file.name.slice(0,200),size:file.size};
  }
  const ri=headers.indexOf('row'), vi=headers.indexOf('result');
  if(ri<0||vi<0) reject(400,'columns');
  const ids=new Set();
  const records=rows.map((r,i)=>{
    const row=r[ri], result=r[vi];
    if(!Number.isSafeInteger(row)||row<1||!Number.isSafeInteger(result)) reject(400,'dataType',{row:i+2});
    if(ids.has(row)) reject(400,'duplicateRow',{row:i+2}); ids.add(row);
    return {row,result};
  });
  return {records,digest,filename:file.name.slice(0,200),size:file.size};
}
