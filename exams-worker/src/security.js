import { reject } from './core.js';
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
export const randomToken=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256=async value=>hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value));
export async function keyed(secret,value) {
  if(!secret || secret.length<32) reject(503,'setup');
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
}
// Workers WebCrypto supports up to 100,000 PBKDF2 iterations. A secret pepper
// prevents offline enumeration of the small national-ID space from a D1 leak.
export async function credential(id,pepper,salt=randomToken().slice(0,32)) {
  const material=await keyed(pepper,'credential:'+id);
  const key=await crypto.subtle.importKey('raw',encoder.encode(material),'PBKDF2',false,['deriveBits']);
  const hash=hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(salt),iterations:100000},key,256));
  return `pbkdf2-sha256:100000:${salt}:${hash}`;
}
export async function verifyCredential(id,pepper,stored) {
  const parts=stored.split(':'); if(parts.length!==4 || parts[0]!=='pbkdf2-sha256'||parts[1]!=='100000') return false;
  const candidate=await credential(id,pepper,parts[2]);
  const a=encoder.encode(candidate), b=encoder.encode(stored);
  let diff=a.length^b.length; for(let i=0;i<a.length;i++) diff|=a[i]^(b[i]||0); return diff===0;
}
export const adminCookie=(token,age=28800)=>`__Host-raiz-admin=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export const adminToken=request=>(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-raiz-admin='))?.slice(18)||'';
export async function adminIdentity(request,env) {
  const token=adminToken(request);
  if(!/^[a-f0-9]{64}$/.test(token))reject(401,'adminRequired');
  const row=await env.DB.prepare(`SELECT a.id FROM admin_sessions s JOIN site_admins a ON a.id=s.admin_id
    WHERE s.token_hash=? AND s.expires_at>? AND a.active=1`).bind(await sha256(token),Math.floor(Date.now()/1000)).first();
  if(!row)reject(401,'adminRequired');
  return row.id;
}
export async function limit(db,key,maximum,seconds) {
  const now=Math.floor(Date.now()/1000);
  const row=await db.prepare(`INSERT INTO rate_limits(key,attempts,expires_at) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`).bind(key,now+seconds,now,now).first();
  if(row.attempts>maximum) reject(429,'rateLimit');
}
export function cookie(token,maxAge=28800) { return `__Host-raiz-exam=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`; }
export function sessionToken(request) { return (request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-raiz-exam='))?.slice(17)||''; }
