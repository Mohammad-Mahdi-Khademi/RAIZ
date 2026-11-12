import { reject,text } from './core.js';
import { adminIdentity,adminCookie,adminToken,credential,verifyCredential,randomToken,sha256,keyed,limit } from './security.js';
const now=()=>new Date().toISOString(),seconds=()=>Math.floor(Date.now()/1000);
const q=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=async(db,sql,...args)=>(await q(db,sql,...args).all()).results;
const audit=(db,uid,action,detail={})=>q(db,'INSERT INTO audit_logs VALUES(?,?,NULL,?,?,?)',crypto.randomUUID(),uid,action,JSON.stringify(detail),now());
const assert=(db,sql,...args)=>q(db,`INSERT INTO transaction_assertions SELECT CASE WHEN ${sql} THEN 1 ELSE 0 END`,...args);
const clean=db=>db.prepare('DELETE FROM transaction_assertions');
const reply=(value,status=200,headers={})=>Response.json(value,{status,headers});
const email=value=>{const v=text(value,254).toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))reject(400,'invalid');return v;};
const password=value=>{if(typeof value!=='string'||value.length<12||value.length>128)reject(400,'passwordLength');return value;};
const pages=['about','projects','apply','contact','publications'];
const contentRow=b=>{if(!b||!pages.includes(b.key))reject(400,'invalid');return {key:b.key,en:text(b.en,12000),fa:text(b.fa,12000)};};
const sessionGuard=(db,uid,hash)=>assert(db,'EXISTS(SELECT 1 FROM site_admins a JOIN admin_sessions s ON s.admin_id=a.id WHERE a.id=? AND a.active=1 AND s.token_hash=? AND s.expires_at>?)',uid,hash,seconds());

export async function siteRoute(request,env,json) {
  const db=env.DB,path=new URL(request.url).pathname.replace(/\/$/,''),method=request.method;
  if(path==='/api/site/content'&&method==='GET')return reply(await rows(db,'SELECT key,en,fa FROM site_content ORDER BY key'));
  if(path==='/api/site/bootstrap'&&method==='POST') {
    await limit(db,await keyed(env.PRIVACY_KEY,'bootstrap:'+ (request.headers.get('CF-Connecting-IP')||'local')),5,900);
    if(!env.ADMIN_BOOTSTRAP_KEY||env.ADMIN_BOOTSTRAP_KEY.length<32)reject(403,'bootstrapClosed');
    const b=await json(request);
    if(typeof b.token!=='string'||await sha256(b.token)!==await sha256(env.ADMIN_BOOTSTRAP_KEY))reject(403,'bootstrapDenied');
    if(await q(db,"SELECT 1 FROM site_state WHERE key='bootstrap'").first())reject(409,'bootstrapClosed');
    const id=crypto.randomUUID(),name=text(b.name),login=email(b.login),hash=await credential('admin:'+password(b.secret),env.NATIONAL_ID_PEPPER);
    await db.batch([assert(db,'NOT EXISTS(SELECT 1 FROM site_admins)'),q(db,"INSERT INTO site_state VALUES('bootstrap',?)",now()),q(db,'INSERT INTO site_admins(id,name,email,credential,created_at) VALUES(?,?,?,?,?)',id,name,login,hash,now()),audit(db,id,'admin.bootstrap'),clean(db)]);
    return reply({ok:true},201);
  }
  if(path==='/api/site/login'&&method==='POST') {
    const b=await json(request),login=email(b.login);
    if(typeof b.secret!=='string'||b.secret.length>128)reject(401,'credentials');
    await limit(db,await keyed(env.PRIVACY_KEY,'admin-ip:'+(request.headers.get('CF-Connecting-IP')||'local')),30,900);
    await limit(db,await keyed(env.PRIVACY_KEY,'admin-email:'+login),5,900);
    const admin=await q(db,'SELECT * FROM site_admins WHERE email=?',login).first();
    const valid=await verifyCredential('admin:'+b.secret,env.NATIONAL_ID_PEPPER,admin?.credential||`pbkdf2-sha256:100000:${'0'.repeat(32)}:${'0'.repeat(64)}`);
    if(!admin?.active||!valid)reject(401,'credentials');
    const token=randomToken();
    await db.batch([assert(db,'EXISTS(SELECT 1 FROM site_admins WHERE id=? AND active=1 AND version=?)',admin.id,admin.version),q(db,'DELETE FROM admin_sessions WHERE admin_id=?',admin.id),q(db,'INSERT INTO admin_sessions VALUES(?,?,?)',await sha256(token),admin.id,seconds()+28800),clean(db)]);
    return reply({name:admin.name,role:'admin'},200,{'Set-Cookie':adminCookie(token)});
  }
  if(path==='/api/site/logout'&&method==='POST') {
    await q(db,'DELETE FROM admin_sessions WHERE token_hash=?',await sha256(adminToken(request))).run();
    return reply({ok:true},200,{'Set-Cookie':adminCookie('',0)});
  }
  if(path==='/api/site/session'&&method==='GET') {
    try{const uid=await adminIdentity(request,env),admin=await q(db,'SELECT name FROM site_admins WHERE id=?',uid).first();return reply({name:admin.name,role:'admin'});}
    catch(e){if(e.code==='adminRequired')return reply(null);throw e;}
  }
  const uid=await adminIdentity(request,env),hash=await sha256(adminToken(request));
  const mutate=operations=>db.batch([sessionGuard(db,uid,hash),...operations,clean(db)]);
  if(path==='/api/site/admin/accounts'&&method==='GET')return reply((await rows(db,"SELECT id,name,email AS login,'admin' AS role,active FROM site_admins ORDER BY name")).map(a=>({...a,active:!!a.active,self:a.id===uid})));
  if(path==='/api/site/admin/users'&&method==='POST') {
    const b=await json(request),id=crypto.randomUUID(),login=email(b.login),name=text(b.name),stored=await credential('admin:'+password(b.secret),env.NATIONAL_ID_PEPPER);
    if(await q(db,'SELECT 1 FROM site_admins WHERE email=?',login).first())reject(409,'duplicate');
    await mutate([q(db,'INSERT INTO site_admins(id,name,email,credential,created_at) VALUES(?,?,?,?,?)',id,name,login,stored,now()),audit(db,uid,'admin.create',{id})]);return reply({ok:true},201);
  }
  if(path==='/api/site/admin/account'&&method==='PATCH') {
    const b=await json(request);if(typeof b.id!=='string'||!await q(db,'SELECT 1 FROM site_admins WHERE id=?',b.id).first())reject(404,'notFound');
    const operations=[];
    if(b.active!==undefined){
      if(typeof b.active!=='boolean')reject(400,'invalid');
      if(!b.active&&b.id===uid)reject(400,'selfDeactivate');
      if(!b.active)operations.push(assert(db,'EXISTS(SELECT 1 FROM site_admins WHERE active=1 AND id<>?)',b.id));
      operations.push(q(db,'UPDATE site_admins SET active=?,version=version+1 WHERE id=?',Number(b.active),b.id));
    }
    if(b.secret!==undefined)operations.push(q(db,'UPDATE site_admins SET credential=?,version=version+1 WHERE id=?',await credential('admin:'+password(b.secret),env.NATIONAL_ID_PEPPER),b.id));
    if(!operations.length)reject(400,'invalid');
    await mutate([...operations,q(db,'DELETE FROM admin_sessions WHERE admin_id=?',b.id),audit(db,uid,'admin.update',{id:b.id,password_changed:b.secret!==undefined})]);return reply({ok:true});
  }
  if(path==='/api/site/admin/content'&&method==='POST') {
    const b=contentRow(await json(request,128*1024));
    await mutate([q(db,'INSERT INTO site_content VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET en=excluded.en,fa=excluded.fa,updated_at=excluded.updated_at',b.key,b.en,b.fa,now()),audit(db,uid,'content.update',{key:b.key})]);return reply({ok:true});
  }
  if(path==='/api/site/admin/content-import'&&method==='POST') {
    if(await q(db,"SELECT 1 FROM site_state WHERE key='content-import'").first())reject(409,'contentImported');
    const body=await json(request,512*1024);
    if(!Array.isArray(body.content)||body.content.length>5)reject(400,'invalid');
    const content=body.content.map(contentRow);
    if(new Set(content.map(c=>c.key)).size!==content.length)reject(400,'duplicate');
    // Import missing pages only: never overwrite edits made after cutover.
    await mutate([q(db,"INSERT INTO site_state VALUES('content-import',?)",now()),...content.map(c=>q(db,'INSERT INTO site_content VALUES(?,?,?,?) ON CONFLICT(key) DO NOTHING',c.key,c.en,c.fa,now())),audit(db,uid,'content.import',{count:content.length})]);return reply({ok:true});
  }
  reject(404,'notFound');
}
