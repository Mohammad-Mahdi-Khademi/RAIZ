export class ApiError extends Error {
  constructor(status, code, details) { super(code); this.status = status; this.code = code; this.details = details; }
}
export const reject = (status, code, details) => { throw new ApiError(status, code, details); };
export const digits = value => String(value ?? '').trim().replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
export function text(value, max=200) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) reject(400,'invalid');
  return value.trim();
}
export function studentNumber(value) {
  const n=digits(value); if (!/^\d{5,20}$/.test(n)) reject(400,'studentNumber'); return n;
}
export function nationalId(value) {
  const n=digits(value);
  if (!/^\d{10}$/.test(n) || /^(\d)\1{9}$/.test(n)) reject(400,'nationalId');
  const remainder=[...n.slice(0,9)].reduce((sum,c,i)=>sum+Number(c)*(10-i),0)%11;
  if (Number(n[9]) !== (remainder<2 ? remainder : 11-remainder)) reject(400,'nationalId');
  return n;
}
export function groupKey(value) { return text(value,80).normalize('NFKC').replace(/ي/g,'ی').replace(/ك/g,'ک').replace(/\s+/g,' ').toLowerCase(); }
export function evaluate(reference, submitted) {
  const lookup=new Map(reference.map(r=>[r.row,r.result]));
  if (!reference.length || lookup.size!==reference.length || submitted.length!==reference.length || new Set(submitted.map(r=>r.row)).size!==submitted.length || submitted.some(r=>!lookup.has(r.row))) reject(400,'recordMismatch');
  const correct=submitted.reduce((sum,r)=>sum+Number(lookup.get(r.row)===r.result),0);
  return { correct,total:reference.length,score:correct/reference.length*100,engine:'exact-accuracy-v1' };
}
export function examSettings(body) {
  const name=text(body.name,200), description=typeof body.description==='string' ? body.description.trim() : '';
  if(description.length>4000) reject(400,'invalid');
  const min=Number(body.min_size ?? 1), max=Number(body.max_size ?? 5);
  if(!Number.isInteger(min)||!Number.isInteger(max)||min<1||max<min||max>20) reject(400,'groupSize');
  let deadline=null;
  if(body.deadline) { const d=new Date(body.deadline); if(!Number.isFinite(d.getTime())) reject(400,'invalid'); deadline=d.toISOString(); }
  if(typeof body.allow_replace!=='boolean') reject(400,'invalid');
  return {name,description,min,max,deadline,replace:Number(body.allow_replace)};
}
