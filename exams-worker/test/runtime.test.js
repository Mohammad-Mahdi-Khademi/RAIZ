import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import * as XLSX from 'xlsx';
import { credential } from '../src/security.js';

test('Cloudflare workerd + D1: secure login, atomic groups, Excel scoring and shared ranks',async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/index.js',import.meta.url))],bundle:true,format:'esm',platform:'browser',write:false});
  const text=value=>({type:'text',value});
  const mf=new Miniflare({workers:[{config:{name:'test-exams',compatibilityDate:'2026-10-30',
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:bundle.outputFiles[0].text}}},
    env:{DB:{type:'d1',id:'test-d1'},NATIONAL_ID_PEPPER:text('p'.repeat(64)),PRIVACY_KEY:text('k'.repeat(64)),FIREBASE_PROJECT_ID:text('test-project'),ALLOWED_ORIGINS:text('https://www.raizlab.ir')}
  }}]});
  try{
    const db=await mf.getD1Database('DB');
    const schema=(await readFile(new URL('../migrations/0001_exams.sql',import.meta.url),'utf8')).replace(/^--.*$/gm,'');
    await db.batch(schema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
    const exam='22222222-2222-4222-8222-222222222222',timestamp=new Date().toISOString(),hash=await credential('0013540874','p'.repeat(64));
    await db.batch([
      db.prepare('INSERT INTO exams(id,name,active,reference_version,created_at,updated_at) VALUES(?,?,1,1,?,?)').bind(exam,'Runtime test',timestamp,timestamp),
      db.prepare('INSERT INTO reference_versions VALUES(?,1,?,?,?)').bind(exam,'reference.xlsx','digest',timestamp),
      db.prepare('INSERT INTO reference_records VALUES(?,1,1,0),(?,1,2,1)').bind(exam,exam),
      ...['12345','12346'].map((number,i)=>db.prepare('INSERT INTO exam_students VALUES(?,?,?,?,?,?,1,?)').bind(`s${i}`,exam,`Student ${i}`,number,hash,`fingerprint${i}`,timestamp))
    ]);
    async function request(path,{method='GET',body,session}={}){
      const headers={Origin:'https://www.raizlab.ir'};if(session)headers.Cookie=session;
      if(body&&!(body instanceof FormData)){body=JSON.stringify(body);headers['Content-Type']='application/json';}
      const req=new Request(`http://localhost/api/exams/${exam}${path}`,{method,body,headers});
      const result=await mf.dispatchFetch(req.url,{method,headers:Object.fromEntries(req.headers),...(body?{body:await req.arrayBuffer()}:{})});
      return {status:result.status,body:await result.json(),cookie:result.headers.get('Set-Cookie')?.split(';')[0]};
    }
    const sessions=[];
    for(const number of ['12345','12346']){
      const response=await request('/login',{method:'POST',body:{student_number:number,national_id:'0013540874'}});
      assert.equal(response.status,200,JSON.stringify(response.body));sessions.push(response.cookie);
    }
    // Both requests may read the same version. A conflict is safe and retriable.
    let created=await Promise.all(sessions.map((session,i)=>request('/groups',{method:'POST',session,body:{name:`Group ${i}`,members:[]}})));
    for(let i=0;i<created.length;i++)if(created[i].status===409)created[i]=await request('/groups',{method:'POST',session:sessions[i],body:{name:`Group ${i}`,members:[]}});
    assert.deepEqual(created.map(r=>r.status),[201,201]);
    const duplicate=await request('/groups',{method:'POST',session:sessions[0],body:{name:'Forbidden second group',members:[]}});assert.equal(duplicate.status,409);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM groups').first()).n,2);
    for(const session of sessions){
      const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['row','result'],[2,9],[1,0]]),'Sheet1');
      const form=new FormData();form.set('file',new File([XLSX.write(wb,{type:'buffer',bookType:'xlsx',compression:true})],'student.xlsx'));
      const uploaded=await request('/submission',{method:'POST',session,body:form});assert.equal(uploaded.status,200,JSON.stringify(uploaded.body));assert.equal(uploaded.body.score,50);
    }
    const result=await request('',{session:sessions[0]});assert.deepEqual(result.body.leaderboard.map(r=>r.rank),[1,1]);
    assert.equal(result.body.group.rank,1);assert.ok(!JSON.stringify(result.body).includes('student_number'));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM transaction_assertions').first()).n,0);
    // Exercise the new portal in actual workerd/D1, including WebCrypto and competing loans.
    const portalSchema=await readFile(new URL('../migrations/0002_portal.sql',import.meta.url),'utf8');
    await db.batch(portalSchema.split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
    const portalHash=await credential('portal:0013540874','p'.repeat(64));
    await db.batch([
      db.prepare('INSERT INTO portal_state VALUES(1,?)').bind(timestamp),
      ...['12345','12346'].map((number,i)=>db.prepare("INSERT INTO portal_members(id,name,login,role,active,credential,created_at) VALUES(?,?,?,'student',1,?,?)").bind(`p${i}`,`Member ${i}`,number,portalHash,timestamp)),
      db.prepare("INSERT INTO portal_equipment(id,name,location,updated_at) VALUES('robot','Robot','Lab',?)").bind(timestamp)
    ]);
    async function portal(path,body,session){
      const response=await mf.dispatchFetch(`http://localhost/api/portal/${path}`,{method:body?'POST':'GET',headers:{Origin:'https://www.raizlab.ir',...(body?{'Content-Type':'application/json'}:{}),...(session?{Cookie:session}:{})},...(body?{body:JSON.stringify(body)}:{})});
      return {status:response.status,body:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
    }
    const portalSessions=[];
    for(const number of ['12345','12346']){
      const login=await portal('login',{login:number,secret:'0013540874'});assert.equal(login.status,200,JSON.stringify(login.body));portalSessions.push(login.cookie);
    }
    const loans=await Promise.all(portalSessions.map(session=>portal('operation',{id:'robot',action:'borrow'},session)));
    assert.deepEqual(loans.map(r=>r.status).sort(),[200,409]);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM portal_logs').first()).n,1);
    const winner=loans.findIndex(r=>r.status===200),loser=1-winner;
    assert.equal((await portal('operation',{id:'robot',action:'return'},portalSessions[loser])).status,409);
    assert.equal((await portal('equipment',null,portalSessions[winner])).body[0].mine,true);
    assert.equal((await portal('operation',{id:'robot',action:'return'},portalSessions[winner])).status,200);
    assert.equal((await portal('logout',{},portalSessions[winner])).status,200);
    assert.equal((await portal('equipment',null,portalSessions[winner])).status,401);
  }finally{await mf.dispose();}
});
