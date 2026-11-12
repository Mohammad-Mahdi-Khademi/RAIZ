import { createRemoteJWKSet, jwtVerify } from 'jose';
import { reject } from './core.js';
const encoder=new TextEncoder();
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/../g)||[],x=>parseInt(x,16));
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
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
export async function adminIdentity(request,env) {
  const token=(request.headers.get('Authorization')||'').match(/^Bearer (.+)$/)?.[1];
  if(!token) reject(401,'adminRequired');
  let payload;
  try { ({payload}=await jwtVerify(token,keys,{algorithms:['RS256'],issuer:`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,audience:env.FIREBASE_PROJECT_ID})); }
  catch { reject(401,'adminRequired'); }
  if(!payload.sub || payload.sub.length>128 || !payload.auth_time || payload.auth_time>Date.now()/1000) reject(401,'adminRequired');
  // Firebase ID tokens invoke Firestore's existing security rules, not IAM bypass.
  const response=await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/members/${encodeURIComponent(payload.sub)}`,{headers:{Authorization:`Bearer ${token}`}});
  if(!response.ok) reject(response.status>=500?503:403,'adminRequired');
  const doc=await response.json();
  if(doc.fields?.active?.booleanValue!==true || doc.fields?.role?.stringValue!=='admin') reject(403,'adminRequired');
  return payload.sub;
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
