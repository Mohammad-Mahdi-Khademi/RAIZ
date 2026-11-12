import { reject, text, digits, studentNumber } from './core.js';
import { adminIdentity, credential, verifyCredential, randomToken, sha256, keyed, limit } from './security.js';

const stamp=()=>new Date().toISOString();
const seconds=()=>Math.floor(Date.now()/1000);
const sql=(db,q,...args)=>db.prepare(q).bind(...args);
const rows=async(db,q,...args)=>(await sql(db,q,...args).all()).results;
const cookie=(token,age=28800)=>`__Host-raiz-portal=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const tokenFrom=request=>(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-raiz-portal='))?.slice(19)||'';
const reply=(body,status=200,headers={})=>Response.json(body,{status,headers});
const audit=(db,uid,action,detail={})=>sql(db,'INSERT INTO audit_logs VALUES(?,?,NULL,?,?,?)',crypto.randomUUID(),uid,action,JSON.stringify(detail),stamp());
const assertion=(db,q,...args)=>sql(db,`INSERT INTO transaction_assertions SELECT CASE WHEN ${q} THEN 1 ELSE 0 END`,...args);
const clean=db=>db.prepare('DELETE FROM transaction_assertions');
const publicMember=m=>({id:m.id,name:m.name,login:m.login,role:m.role,active:!!m.active,needs_credential:!m.credential});
function secret(value) {
  const normalized=digits(value);
  // Preserve the original portal's ten-digit credential format, including leading zeros.
  if(!/^\d{10}$/.test(normalized))reject(400,'nationalFormat');
  return normalized;
}
async function identity(request,db) {
  const token=tokenFrom(request);if(!/^[a-f0-9]{64}$/.test(token))reject(401,'loginRequired');
  const hash=await sha256(token);
  const m=await sql(db,`SELECT m.* FROM portal_sessions s JOIN portal_members m ON m.id=s.member_id
    WHERE s.token_hash=? AND s.expires_at>? AND m.active=1 AND m.role='student'`,hash,seconds()).first();
  if(!m)reject(401,'loginRequired');return {...m,session_hash:hash};
}
const sessionGuard=(db,m)=>assertion(db,`EXISTS(SELECT 1 FROM portal_members m JOIN portal_sessions s ON s.member_id=m.id WHERE m.id=? AND m.version=? AND m.active=1 AND s.token_hash=? AND s.expires_at>?)`,m.id,m.version,m.session_hash,seconds());
const identifier=value=>{if(typeof value!=='string'||!value.trim()||new TextEncoder().encode(value).length>1500||/[\/\u0000-\u001f\u007f]/.test(value)||['.','..'].includes(value))reject(400,'invalid');return value;};
const timestamp=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))reject(400,'invalid');return new Date(value).toISOString();};

// Import a reviewed administrator snapshot once. No Firebase credentials or hashes are accepted.
export function migrationSnapshot(body) {
  const {members,equipment,logs}=body;
  if(![members,equipment,logs].every(Array.isArray)||members.length>2000||equipment.length>2000||logs.length>10000)reject(400,'migrationSize');
  // Include only a collection, row number and field name in validation errors.
  // Never return source values or credentials in error responses.
  const field=(collection,row,record,key,validate)=>{
    try{return validate(record?.[key]);}
    catch{reject(400,'migrationField',{collection,row:row+1,field:key});}
  };
  const choice=choices=>value=>{if(!choices.includes(value))reject(400,'invalid');return value;};
  const users=members.map((m,i)=>{
    const get=(key,validate)=>field('members',i,m,key,validate);
    const role=get('role',choice(['student','admin']));
    return {id:get('id',identifier),name:get('name',text),login:get('login',role==='student'?studentNumber:text),role,active:Number(get('active',choice([true,false])))};
  });
  if(new Set(users.map(m=>m.id)).size!==users.length||new Set(users.map(m=>m.login)).size!==users.length)reject(400,'duplicate');
  const ids=new Set(users.map(m=>m.id));
  const items=equipment.map((e,i)=>{
    const get=(key,validate)=>field('equipment',i,e,key,validate);
    const holder=get('holder',value=>value===null?null:identifier(value));
    if(holder&&!ids.has(holder))reject(400,'migrationHolder');
    return {id:get('id',identifier),name:get('name',text),location:get('location',text),holder};
  });
  const events=logs.map((l,i)=>{
    const get=(key,validate)=>field('logs',i,l,key,validate);
    return {id:get('id',identifier),equipment_id:get('equipmentId',identifier),user_id:get('userId',identifier),equipment:get('equipment',text),student:get('student',text),action:get('action',choice(['borrow','return'])),created_at:get('created',timestamp)};
  });
  if(new Set(items.map(e=>e.id)).size!==items.length||new Set(events.map(e=>e.id)).size!==events.length)reject(400,'duplicate');
  return {users,items,events};
}

export async function portalRoute(request,env,json) {
  const db=env.DB,path=new URL(request.url).pathname.replace(/\/$/,''),method=request.method;
  const admin=path.startsWith('/api/portal/admin/');
  const uid=admin?await adminIdentity(request,env):null;
  if(path==='/api/portal/logout'&&method==='POST') {
    await sql(db,'DELETE FROM portal_sessions WHERE token_hash=?',await sha256(tokenFrom(request))).run();
    return reply({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  const initialized=!!await sql(db,'SELECT id FROM portal_state WHERE id=1').first();
  if(path==='/api/portal/admin/data'&&method==='GET') {
    const users=await rows(db,'SELECT * FROM portal_members ORDER BY name');
    return reply({initialized,users:users.filter(m=>m.role==='student').map(publicMember),
      equipment:await rows(db,`SELECT e.id,e.name,e.location,e.holder,m.name AS holder_name FROM portal_equipment e LEFT JOIN portal_members m ON m.id=e.holder ORDER BY e.name`),
      logs:await rows(db,'SELECT equipment,student,action,created_at AS created FROM portal_logs ORDER BY created_at DESC,id DESC LIMIT 200')});
  }
  if(path==='/api/portal/admin/migrate'&&method==='POST') {
    if(initialized)reject(409,'migrationDone');
    const {users,items,events}=migrationSnapshot(await json(request,8*1024*1024));
    // Each JSON parameter stays below D1's value limit; the entire batch is atomic.
    const chunks=(records,size=100)=>Array.from({length:Math.ceil(records.length/size)},(_,i)=>JSON.stringify(records.slice(i*size,(i+1)*size)));
    const batches=[...chunks(users).map(chunk=>sql(db,`INSERT INTO portal_members(id,name,login,role,active,created_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.login'),json_extract(value,'$.role'),json_extract(value,'$.active'),? FROM json_each(?)`,stamp(),chunk)),
      ...chunks(items).map(chunk=>sql(db,`INSERT INTO portal_equipment(id,name,location,holder,updated_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.location'),json_extract(value,'$.holder'),? FROM json_each(?)`,stamp(),chunk)),
      ...chunks(events).map(chunk=>sql(db,`INSERT INTO portal_logs SELECT json_extract(value,'$.id'),json_extract(value,'$.equipment_id'),json_extract(value,'$.user_id'),json_extract(value,'$.equipment'),json_extract(value,'$.student'),json_extract(value,'$.action'),json_extract(value,'$.created_at') FROM json_each(?)`,chunk))];
    // Workers Free allows 50 D1 queries/request. Refuse oversized imports before writing anything.
    if(batches.length>40)reject(400,'migrationSize');
    await db.batch([assertion(db,'NOT EXISTS(SELECT 1 FROM portal_state) AND NOT EXISTS(SELECT 1 FROM portal_members) AND NOT EXISTS(SELECT 1 FROM portal_equipment) AND NOT EXISTS(SELECT 1 FROM portal_logs)'),...batches,sql(db,'INSERT INTO portal_state VALUES(1,?)',stamp()),audit(db,uid,'portal.migrate',{members:users.length,equipment:items.length,logs:events.length}),clean(db)]);
    return reply({ok:true});
  }
  if(!initialized)reject(503,'portalSetup');
  if(path==='/api/portal/login'&&method==='POST') {
    const body=await json(request),number=studentNumber(body.login),value=secret(body.secret);
    await limit(db,await keyed(env.PRIVACY_KEY,`portal:ip:${request.headers.get('CF-Connecting-IP')||'local'}`),120,900);
    await limit(db,await keyed(env.PRIVACY_KEY,`portal:login:${number}`),5,900);
    const member=await sql(db,"SELECT * FROM portal_members WHERE login=? AND role='student'",number).first();
    const stored=member?.credential||`pbkdf2-sha256:100000:${'0'.repeat(32)}:${'0'.repeat(64)}`;
    const valid=await verifyCredential('portal:'+value,env.NATIONAL_ID_PEPPER,stored);
    if(!member?.active||!member.credential||!valid)reject(401,'credentials');
    const token=randomToken();
    await db.batch([assertion(db,'EXISTS(SELECT 1 FROM portal_members WHERE id=? AND active=1 AND version=?)',member.id,member.version),sql(db,'DELETE FROM portal_sessions WHERE member_id=?',member.id),sql(db,'INSERT INTO portal_sessions VALUES(?,?,?)',await sha256(token),member.id,seconds()+28800),clean(db)]);
    return reply({name:member.name,role:'student'},200,{'Set-Cookie':cookie(token)});
  }
  if(admin) {
    if(path==='/api/portal/admin/users'&&method==='POST') {
      const b=await json(request),name=text(b.name),login=studentNumber(b.login),hash=await credential('portal:'+secret(b.secret),env.NATIONAL_ID_PEPPER),id=crypto.randomUUID();
      if(await sql(db,'SELECT 1 FROM portal_members WHERE login=?',login).first())reject(409,'duplicate');
      await db.batch([sql(db,"INSERT INTO portal_members(id,name,login,role,active,credential,created_at) VALUES(?,?,?,'student',1,?,?)",id,name,login,hash,stamp()),audit(db,uid,'portal.member.create',{id})]);return reply({ok:true},201);
    }
    if(path==='/api/portal/admin/member'&&method==='PATCH') {
      const b=await json(request),id=identifier(b.id);
      if(!await sql(db,"SELECT 1 FROM portal_members WHERE id=? AND role='student'",id).first())reject(404,'notFound');
      const operations=[];
      if(b.secret!==undefined)operations.push(sql(db,'UPDATE portal_members SET credential=?,version=version+1 WHERE id=?',await credential('portal:'+secret(b.secret),env.NATIONAL_ID_PEPPER),id));
      if(b.active!==undefined){if(typeof b.active!=='boolean')reject(400,'invalid');operations.push(sql(db,'UPDATE portal_members SET active=?,version=version+1 WHERE id=?',Number(b.active),id));}
      if(!operations.length)reject(400,'invalid');
      await db.batch([...operations,sql(db,'DELETE FROM portal_sessions WHERE member_id=?',id),audit(db,uid,'portal.member.update',{id,credential_changed:b.secret!==undefined,...(b.active!==undefined?{active:b.active}:{})})]);return reply({ok:true});
    }
    if(path==='/api/portal/admin/equipment'&&method==='POST') {
      const b=await json(request),id=crypto.randomUUID();
      await db.batch([sql(db,'INSERT INTO portal_equipment(id,name,location,updated_at) VALUES(?,?,?,?)',id,text(b.name),text(b.location),stamp()),audit(db,uid,'portal.equipment.create',{id})]);return reply({ok:true},201);
    }
    if(path==='/api/portal/admin/release'&&method==='POST') {
      const b=await json(request),item=await sql(db,'SELECT * FROM portal_equipment WHERE id=?',identifier(b.id)).first();
      if(!item?.holder)reject(409,'conflict');
      const member=await sql(db,'SELECT name FROM portal_members WHERE id=?',item.holder).first();
      await db.batch([assertion(db,'EXISTS(SELECT 1 FROM portal_equipment WHERE id=? AND version=?)',item.id,item.version),sql(db,'UPDATE portal_equipment SET holder=NULL,version=version+1,updated_at=? WHERE id=?',stamp(),item.id),sql(db,'INSERT INTO portal_logs VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),item.id,item.holder,item.name,member.name,'return',stamp()),audit(db,uid,'portal.equipment.release',{id:item.id}),clean(db)]);return reply({ok:true});
    }
    reject(404,'notFound');
  }
  if(path==='/api/portal/session'&&method==='GET') {
    try{const m=await identity(request,db);return reply({name:m.name,role:'student'});}catch(error){if(error.code==='loginRequired')return reply(null);throw error;}
  }
  const member=await identity(request,db);
  if(path==='/api/portal/equipment'&&method==='GET') {
    return reply((await rows(db,'SELECT id,name,location,holder FROM portal_equipment ORDER BY name')).map(e=>({id:e.id,name:e.name,location:e.location,borrowed:e.holder!==null,mine:e.holder===member.id})));
  }
  if(path==='/api/portal/operation'&&method==='POST') {
    const b=await json(request);if(!['borrow','return'].includes(b.action))reject(400,'invalid');
    await limit(db,await keyed(env.PRIVACY_KEY,`portal:operation:${member.id}`),60,60);
    const item=await sql(db,'SELECT * FROM portal_equipment WHERE id=?',identifier(b.id)).first();
    if(!item)reject(404,'notFound');
    if(b.action==='borrow'?item.holder!==null:item.holder!==member.id)reject(409,'conflict');
    await db.batch([sessionGuard(db,member),assertion(db,'EXISTS(SELECT 1 FROM portal_equipment WHERE id=? AND version=?)',item.id,item.version),sql(db,'UPDATE portal_equipment SET holder=?,version=version+1,updated_at=? WHERE id=?',b.action==='borrow'?member.id:null,stamp(),item.id),sql(db,'INSERT INTO portal_logs VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),item.id,member.id,item.name,member.name,b.action,stamp()),clean(db)]);
    return reply({ok:true});
  }
  reject(404,'notFound');
}
