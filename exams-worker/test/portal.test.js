import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { sha256 } from '../src/security.js';
import { migrationSnapshot } from '../src/portal.js';
const origin='https://www.raizlab.ir';
test('Cloudflare-only site: bootstrap, administrator sessions, content, and account controls',async t=>{
  const DB=sqliteD1(),env={DB,NATIONAL_ID_PEPPER:'p'.repeat(64),PRIVACY_KEY:'k'.repeat(64),ALLOWED_ORIGINS:origin,ADMIN_BOOTSTRAP_KEY:'b'.repeat(64)};
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Google must not be contacted');};
  t.after(()=>{globalThis.fetch=originalFetch;DB.sqlite.close();});
  async function call(path,{method='GET',body,session,requestOrigin=origin}={}){
    const headers={};if(requestOrigin)headers.Origin=requestOrigin;if(session)headers.Cookie=session;
    if(body!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(body);}
    const response=await worker.fetch(new Request(`https://exams-api.raizlab.ir/api/${path}`,{method,body,headers}),env);
    return {status:response.status,body:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
  }
  const post=(path,body,session)=>call(path,{method:'POST',body,session});
  const setup={token:env.ADMIN_BOOTSTRAP_KEY,name:'First Admin',login:'Admin@Example.com',secret:'Initial-password-123'};
  assert.equal((await call('site/session')).body,null);
  assert.equal((await post('site/bootstrap',{...setup,token:'wrong'})).status,403);
  assert.equal((await call('site/bootstrap',{method:'POST',body:setup,requestOrigin:null})).status,403);
  assert.equal((await post('site/bootstrap',setup)).status,201);
  assert.equal((await post('site/bootstrap',setup)).body.error,'bootstrapClosed');
  assert.equal((await post('site/login',{login:setup.login,secret:'wrong'})).status,401);
  let session=(await post('site/login',setup)).cookie;
  assert.ok(session.startsWith('__Host-raiz-admin='));
  assert.equal((await call('site/session',{session})).body.role,'admin');
  assert.equal((await call('admin/exams',{session})).status,200);
  assert.equal((await call('portal/admin/data',{session})).status,200);
  assert.equal((await call('site/admin/accounts')).status,401);
  assert.equal((await post('site/admin/content',{key:'about',en:'Hello',fa:'سلام'},session)).status,200);
  assert.deepEqual((await call('site/content')).body,[{key:'about',en:'Hello',fa:'سلام'}]);
  assert.equal((await post('site/admin/content',{key:'secret',en:'a',fa:'b'},session)).status,400);
  assert.equal((await post('site/admin/content-import',{content:[{key:'about',en:'Old',fa:'Old'},{key:'contact',en:'Contact',fa:'تماس'}]},session)).status,200);
  assert.equal((await call('site/content')).body.find(c=>c.key==='about').en,'Hello');
  assert.equal((await post('site/admin/content-import',{content:[]},session)).status,409);
  assert.equal((await post('site/admin/users',{name:'Other',login:'other@example.com',secret:'Second-password-123'},session)).status,201);
  const admins=(await call('site/admin/accounts',{session})).body;
  assert.ok(!JSON.stringify(admins).includes('credential'));
  const first=admins.find(a=>a.self),second=admins.find(a=>!a.self);
  assert.equal((await call('site/admin/account',{method:'PATCH',body:{id:first.id,active:false},session})).body.error,'selfDeactivate');
  const secondSession=(await post('site/login',{login:second.login,secret:'Second-password-123'})).cookie;
  assert.equal((await call('site/admin/account',{method:'PATCH',body:{id:second.id,active:false},session})).status,200);
  assert.equal((await call('admin/exams',{session:secondSession})).status,401);
  assert.equal((await call('site/admin/account',{method:'PATCH',body:{id:first.id,secret:'Changed-password-123'},session})).status,200);
  assert.equal((await call('site/admin/accounts',{session})).status,401);
  session=(await post('site/login',{login:setup.login,secret:'Changed-password-123'})).cookie;
  assert.equal((await post('site/logout',{},session)).status,200);
  assert.equal((await call('site/admin/accounts',{session})).status,401);
  for(let i=0;i<5;i++)await post('site/login',{login:'unknown@example.com',secret:'wrong'});
  assert.equal((await post('site/login',{login:'unknown@example.com',secret:'wrong'})).status,429);
  const persisted=JSON.stringify(DB.sqlite.prepare('SELECT * FROM site_admins').all())+JSON.stringify(DB.sqlite.prepare('SELECT * FROM audit_logs').all());
  assert.ok(!persisted.includes('Changed-password-123'));assert.ok(!persisted.includes(setup.token));
});
const snapshot={members:[{id:'s1',name:'Student One',login:'12345',role:'student',active:true},{id:'s2',name:'Student Two',login:'12346',role:'student',active:true}],equipment:[{id:'e1',name:'Robot',location:'Lab',holder:'s1'},{id:'e2',name:'Sensor',location:'Lab',holder:null}],logs:[{id:'l1',equipmentId:'e1',equipment:'Robot',userId:'s1',student:'Student One',action:'borrow',created:'2026-01-01T00:00:00Z'}]};

test('portal import rejects orphaned holders and duplicate student numbers',()=>{
  assert.throws(()=>migrationSnapshot({...snapshot,equipment:[{...snapshot.equipment[0],holder:'missing'}]}),/migrationHolder/);
  assert.throws(()=>migrationSnapshot({...snapshot,members:[snapshot.members[0],{...snapshot.members[1],login:'12345'}]}),/duplicate/);
});

test('migration preserves document IDs and reports invalid fields without source values',()=>{
  const data=structuredClone(snapshot);
  data.equipment[0].id='تجهیز شماره ۱';
  assert.equal(migrationSnapshot(data).items[0].id,'تجهیز شماره ۱');
  data.equipment[0].holder=undefined;
  assert.throws(()=>migrationSnapshot(data),error=>{
    assert.equal(error.code,'migrationField');
    assert.deepEqual(error.details,{collection:'equipment',row:1,field:'holder'});
    assert.ok(!JSON.stringify(error).includes('Student One'));
    return true;
  });
  const invalidMember=structuredClone(snapshot);invalidMember.members[1].active='true';
  assert.throws(()=>migrationSnapshot(invalidMember),error=>error.details.collection==='members'&&error.details.row===2&&error.details.field==='active');
  const invalidId=structuredClone(snapshot);invalidId.equipment[0].id='../unsafe';
  assert.throws(()=>migrationSnapshot(invalidId),error=>error.code==='migrationField'&&error.details.field==='id');
});

test('portal migration, verified administrators, credentials, privacy and loan integrity',async t=>{
  const DB=sqliteD1(),env={DB,NATIONAL_ID_PEPPER:'p'.repeat(64),PRIVACY_KEY:'k'.repeat(64),ALLOWED_ORIGINS:origin,FIREBASE_PROJECT_ID:'portal-test'};
  const token='a'.repeat(64);
  DB.sqlite.prepare("INSERT INTO site_admins(id,name,email,credential,created_at) VALUES('admin-uid','Admin','admin@example.com','unused','now')").run();
  DB.sqlite.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run(await sha256(token),'admin-uid',Math.floor(Date.now()/1000)+3600);
  const originalFetch=globalThis.fetch;let googleRequests=0;
  globalThis.fetch=async()=>{googleRequests++;throw new Error('No Google calls permitted');};
  t.after(()=>{globalThis.fetch=originalFetch;DB.sqlite.close();});
  async function call(path,{method='GET',body,admin=false,session,requestOrigin=origin}={}) {
    const headers={};if(requestOrigin)headers.Origin=requestOrigin;if(admin)headers.Cookie=`__Host-raiz-admin=${token}`;if(session)headers.Cookie=session;
    if(body!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(body);}
    const response=await worker.fetch(new Request(`https://exams-api.raizlab.ir/api/portal/${path}`,{method,body,headers}),env);
    return {status:response.status,body:await response.json(),cookie:response.headers.get('Set-Cookie')};
  }
  const post=(path,body,extra={})=>call(path,{method:'POST',body,...extra});
  const patch=body=>call('admin/member',{method:'PATCH',body,admin:true});
  let s1,s2;
  await t.test('only active Cloudflare administrators can migrate and configure the portal',async()=>{
    assert.equal((await post('admin/migrate',snapshot)).status,401);
    DB.sqlite.exec("UPDATE site_admins SET active=0");assert.equal((await post('admin/migrate',snapshot,{admin:true})).status,401);DB.sqlite.exec("UPDATE site_admins SET active=1");
    DB.sqlite.exec("UPDATE admin_sessions SET expires_at=0");assert.equal((await call('admin/data',{admin:true})).status,401);DB.sqlite.prepare('UPDATE admin_sessions SET expires_at=?').run(Math.floor(Date.now()/1000)+3600);
    assert.equal((await call('session')).body.error,'portalSetup');
    assert.equal((await call('admin/data',{admin:true})).body.initialized,false);
    assert.equal((await post('admin/migrate',snapshot,{admin:true,requestOrigin:'https://evil.example'})).status,403);
    assert.equal((await post('admin/migrate',snapshot,{admin:true,requestOrigin:null})).status,403);
  });
  await t.test('migration is atomic, one-time, preserves IDs and loans, and imports no passwords',async()=>{
    // Deliberate collision must roll back all member and history writes.
    DB.sqlite.exec("INSERT INTO portal_equipment(id,name,location,updated_at) VALUES('e2','Collision','Lab','now')");
    assert.equal((await post('admin/migrate',snapshot,{admin:true})).status,409);
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM portal_members').get().n,0);
    DB.sqlite.exec('DELETE FROM portal_equipment');
    const imported=await post('admin/migrate',snapshot,{admin:true});assert.equal(imported.status,200,JSON.stringify(imported.body));
    assert.equal((await post('admin/migrate',snapshot,{admin:true})).body.error,'migrationDone');
    assert.equal(DB.sqlite.prepare("SELECT holder FROM portal_equipment WHERE id='e1'").get().holder,'s1');
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM portal_logs').get().n,1);
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM portal_members WHERE credential IS NOT NULL').get().n,0);
    assert.equal((await post('login',{login:'12345',secret:'0013540874'})).body.error,'credentials');
  });
  await t.test('admin credential setup, secure sessions, and no Google requests for student access',async()=>{
    assert.equal((await patch({id:'s1',secret:'0013540874'})).status,200);
    assert.equal((await patch({id:'s2',secret:'0013540874'})).status,200);
    const hashes=DB.sqlite.prepare('SELECT credential FROM portal_members').all();assert.notEqual(hashes[0].credential,hashes[1].credential);
    assert.ok(!JSON.stringify(hashes).includes('0013540874'));
    const before=googleRequests;
    assert.equal((await post('login',{login:'12345',secret:'9999999999'})).status,401);
    assert.equal((await post('login',{login:'99999',secret:'0013540874'})).body.error,'credentials');
    assert.equal((await call('session')).body,null);
    const a=await post('login',{login:'۱۲۳۴۵',secret:'۰۰۱۳۵۴۰۸۷۴'}),b=await post('login',{login:'12346',secret:'0013540874'});
    assert.equal(a.status,200,JSON.stringify(a.body));assert.equal(b.status,200);
    assert.match(a.cookie,/__Host-raiz-portal=/);assert.match(a.cookie,/Secure; HttpOnly; SameSite=Strict/);
    s1=a.cookie.split(';')[0];s2=b.cookie.split(';')[0];
    assert.deepEqual((await call('session',{session:s1})).body,{name:'Student One',role:'student'});
    const items=(await call('equipment',{session:s1})).body;
    assert.equal(items.find(e=>e.id==='e1').mine,true);
    assert.ok(!JSON.stringify(items).includes('s1'));assert.ok(!JSON.stringify(items).includes('12346'));
    assert.equal(googleRequests,before,'student operations must not contact Google');
    assert.equal((await call('admin/data',{session:s1})).status,401);
    const output=JSON.stringify((await call('admin/data',{admin:true})).body);
    assert.ok(!output.includes('pbkdf2'));assert.ok(!output.includes('0013540874'));
  });
  await t.test('ownership and concurrent borrowing are enforced atomically',async()=>{
    assert.equal((await post('operation',{id:'e1',action:'return'},{session:s2})).status,409);
    assert.equal((await post('operation',{id:'e1',action:'return'},{session:s1})).status,200);
    const borrowed=await Promise.all([s1,s2].map(session=>post('operation',{id:'e2',action:'borrow',userId:'s1'},{session})));
    assert.deepEqual(borrowed.map(r=>r.status).sort(),[200,409]);
    assert.equal(DB.sqlite.prepare("SELECT COUNT(*) AS n FROM portal_logs WHERE equipment_id='e2'").get().n,1);
    assert.equal((await post('operation',{id:'e1',action:'borrow'},{session:s1,requestOrigin:null})).status,403);
    assert.equal((await post('admin/release',{id:'e2'},{admin:true})).status,200);
  });
  await t.test('reset, deactivate, expiry and logout invalidate access; login is rate limited',async()=>{
    assert.equal((await patch({id:'s1',active:false})).status,200);
    assert.equal((await call('equipment',{session:s1})).status,401);
    assert.equal((await post('login',{login:'12345',secret:'0013540874'})).status,401);
    assert.equal((await patch({id:'s2',secret:'0013540878'})).status,200);
    assert.equal((await call('equipment',{session:s2})).status,401);
    const login=await post('login',{login:'12346',secret:'0013540878'});assert.equal(login.status,200);
    s2=login.cookie.split(';')[0];DB.sqlite.exec('UPDATE portal_sessions SET expires_at=0');
    assert.equal((await call('equipment',{session:s2})).status,401);
    s2=(await post('login',{login:'12346',secret:'0013540878'})).cookie.split(';')[0];
    assert.equal((await post('logout',{}, {session:s2})).status,200);
    assert.equal((await call('equipment',{session:s2})).status,401);
    for(let i=0;i<5;i++)await post('login',{login:'88888',secret:'0000000000'});
    assert.equal((await post('login',{login:'88888',secret:'0000000000'})).status,429);
    const logs=JSON.stringify(DB.sqlite.prepare('SELECT * FROM audit_logs').all());assert.ok(!logs.includes('0013540878'));assert.ok(!logs.includes('pbkdf2'));
    await worker.scheduled(null,env);assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM transaction_assertions').get().n,0);
  });
});
function sqliteD1() {
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_exams.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0002_portal.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0003_site.sql',import.meta.url),'utf8'));
  function prepare(sql,args=[]) {
    return {bind(...values){return prepare(sql,values);}, execute(){return sqlite.prepare(sql).all(...args);},
      async first(){return this.execute()[0]||null;},async all(){return {results:this.execute()};},async run(){this.execute();return {success:true};}};
  }
  return {sqlite,prepare,async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(s=>({results:s.execute()}));sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}

