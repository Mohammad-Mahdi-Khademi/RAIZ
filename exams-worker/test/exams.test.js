import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import worker from '../src/index.js';
import { evaluate, nationalId, groupKey } from '../src/core.js';
import { credential, sha256, verifyCredential, cookie, sessionToken } from '../src/security.js';
import { readUpload, checkZip } from '../src/excel.js';

const origin='https://www.raizlab.ir';
function workbook(rows) {
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Sheet1');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx',compression:true});
}
function upload(rows) {
  const form=new FormData();form.set('file',new File([workbook(rows)],'results.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return form;
}
const resultRows=[['row','result'],...Array.from({length:10},(_,i)=>[i+1,i%3])];
const predictionRows=resultRows.map((r,i)=>i===2||i===5||i===7?[r[0],9]:[...r]);
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

test('accuracy is keyed by row and rejects missing/duplicate IDs',()=>{
  const ref=resultRows.slice(1).map(([row,result])=>({row,result}));
  const submitted=predictionRows.slice(1).reverse().map(([row,result])=>({row,result}));
  assert.deepEqual(evaluate(ref,submitted),{correct:7,total:10,score:70,engine:'exact-accuracy-v1'});
  assert.throws(()=>evaluate(ref,submitted.slice(1)),/recordMismatch/);
  assert.throws(()=>evaluate(ref,[...submitted.slice(1),submitted[1]]),/recordMismatch/);
});
test('national ID validation, group normalization and salted peppered hashing',async()=>{
  assert.equal(nationalId('۰۰۱۳۵۴۰۸۷۴'),'0013540874');
  assert.throws(()=>nationalId('0000000000'),/nationalId/);
  assert.throws(()=>nationalId('0013540878'),/nationalId/);
  assert.equal(groupKey('  ALPHA   team '),'alpha team');
  const secret='a'.repeat(64),a=await credential('0013540874',secret),b=await credential('0013540874',secret);
  assert.notEqual(a,b);assert.equal(await verifyCredential('0013540874',secret,a),true);
  assert.equal(await verifyCredential('0013540878',secret,a),false);
  assert.equal(await verifyCredential('0013540874','b'.repeat(64),a),false);
  assert.equal(sessionToken(new Request('https://example.com',{headers:{Cookie:cookie('a'.repeat(64))}})),'a'.repeat(64));
});
test('Excel validation rejects bad types, duplicate IDs, headers, formulas and invalid imports',async()=>{
  const parse=(rows,kind='results')=>readUpload(new Request('https://example.com',{method:'POST',body:upload(rows)}),kind);
  assert.equal((await parse(resultRows)).records.length,10);
  await assert.rejects(parse([['row','result'],[1,0],[1,2]]),/duplicateRow/);
  await assert.rejects(parse([['row','result'],[1,'1']]),/dataType/);
  await assert.rejects(parse([['row','result'],[1,null]]),/dataType/);
  await assert.rejects(parse([['id','prediction'],[1,1]]),/columns/);
  await assert.rejects(parse([['row','result'],[1,{t:'n',f:'1+1',v:2}]]),/formula/);
  await assert.rejects(parse([['row','result'],...Array.from({length:501},(_,i)=>[i+1,0])]),/dimensions/);
  const forged=new Uint8Array(workbook(resultRows));
  const view=new DataView(forged.buffer);
  for(let i=0;i<forged.length-46;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,1,true);break;}
  await assert.rejects(checkZip(forged),/fileSize|fileType/);
  const rows=[['Full Name','Student Number','National ID'],['Student A','12345','0013540874']];
  assert.equal((await parse(rows,'students')).errors.length,0);
  assert.equal((await parse([...rows,['Student B','12345','0013540874']],'students')).errors[0].code,'duplicateStudent');
  assert.equal((await parse([...rows,['Student B','12346','0013540874']],'students')).errors[0].code,'duplicateNational');
  assert.equal((await parse([rows[0],['Student A',12345,'0013540874']],'students')).errors[0].code,'identifierText');
});

test('API lifecycle, authorization, privacy and transactional integrity',async t=>{
  const DB=sqliteD1(), env={DB,NATIONAL_ID_PEPPER:'p'.repeat(64),PRIVACY_KEY:'k'.repeat(64),ALLOWED_ORIGINS:origin,FIREBASE_PROJECT_ID:'test-raiz'};
  const token='a'.repeat(64);
  DB.sqlite.prepare("INSERT INTO site_admins(id,name,email,credential,created_at) VALUES('admin-uid','Admin','admin@example.com','unused','now')").run();
  DB.sqlite.prepare('INSERT INTO admin_sessions VALUES(?,?,?)').run(await sha256(token),'admin-uid',Math.floor(Date.now()/1000)+3600);
  const originalFetch=globalThis.fetch;let googleRequests=0;
  globalThis.fetch=async()=>{googleRequests++;throw new Error('No Google calls permitted');};
  t.after(()=>{globalThis.fetch=originalFetch;DB.sqlite.close();});
  async function call(path,{method='GET',body,admin=false,session,requestOrigin=origin}={}) {
    const headers={};if(requestOrigin)headers.Origin=requestOrigin;if(admin)headers.Cookie=`__Host-raiz-admin=${token}`;if(session)headers.Cookie=session;
    if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
    const response=await worker.fetch(new Request(`https://exams-api.raizlab.ir/api${path}`,{method,body,headers}),env);
    return {status:response.status,body:await response.json(),cookie:response.headers.get('Set-Cookie')?.split(';')[0]};
  }
  let examId,leaderCookie,memberCookie;
  await t.test('admin endpoints require verified active Cloudflare administrator',async()=>{
    assert.equal((await call('/admin/exams')).status,401);
    DB.sqlite.exec("UPDATE site_admins SET active=0");assert.equal((await call('/admin/exams',{admin:true})).status,401);DB.sqlite.exec("UPDATE site_admins SET active=1");
    const created=await call('/admin/exams',{method:'POST',admin:true,body:{name:'Test exam',description:'Example',min_size:2,max_size:3,allow_replace:true}});
    assert.equal(created.status,201,JSON.stringify(created.body));examId=created.body.id;
    assert.equal((await call('/exams')).body.exams.length,0);
    assert.equal((await call(`/admin/exams/${examId}/status`,{method:'POST',admin:true,body:{active:true}})).body.error,'notReady');
  });
  await t.test('CORS and CSRF checks are independent of authentication',async()=>{
    assert.equal((await call('/admin/exams',{admin:true,requestOrigin:'https://evil.example'})).status,403);
    assert.equal((await call('/admin/exams',{method:'POST',admin:true,requestOrigin:null,body:{}})).status,403);
  });
  await t.test('reference upload, reviewed student import and confidential responses',async()=>{
    assert.equal((await call(`/admin/exams/${examId}/reference`,{method:'POST',admin:true,body:upload(resultRows)})).status,200);
    const students=[['Full Name','Student Number','National ID'],['Leader','12345','0013540874']];
    const preview=await call(`/admin/exams/${examId}/imports/validate`,{method:'POST',admin:true,body:upload(students)});
    assert.equal(preview.status,200);assert.equal(preview.body.rows.length,1);assert.ok(!JSON.stringify(preview.body).includes('0013540874'));
    const imp=preview.body.id;
    assert.equal((await call(`/admin/exams/${examId}/imports/${imp}/confirm`,{method:'POST',admin:true,body:{}})).body.error,'importIncomplete');
    assert.equal((await call(`/admin/exams/${examId}/imports/${imp}/prepare?position=0`,{method:'POST',admin:true,body:upload(students)})).status,200);
    assert.equal((await call(`/admin/exams/${examId}/imports/${imp}/confirm`,{method:'POST',admin:true,body:{}})).status,200);
    const stored=DB.sqlite.prepare('SELECT * FROM exam_students').get();assert.match(stored.credential,/^pbkdf2/);assert.ok(!JSON.stringify(stored).includes('0013540874'));
    const duplicate=await call(`/admin/exams/${examId}/imports/validate`,{method:'POST',admin:true,body:upload(students)});assert.equal(duplicate.body.errors[0].code,'duplicateStudent');
    const adminData=await call(`/admin/exams/${examId}`,{admin:true});assert.ok(!JSON.stringify(adminData.body).includes('credential'));assert.ok(!JSON.stringify(adminData.body).includes('national_fingerprint'));assert.ok(!JSON.stringify(adminData.body).includes('"result":'));
  });
  await t.test('inactive, invalid, authorized and brute-force login',async()=>{
    assert.equal((await call(`/exams/${examId}/login`,{method:'POST',body:{student_number:'12345',national_id:'0013540874'}})).body.error,'inactive');
    assert.equal((await call(`/admin/exams/${examId}/status`,{method:'POST',admin:true,body:{active:true}})).status,200);
    assert.equal((await call(`/exams/${examId}/login`,{method:'POST',body:{student_number:'12345',national_id:'0013540878'}})).body.error,'credentials');
    assert.equal((await call(`/exams/${examId}/login`,{method:'POST',body:{student_number:'99999',national_id:'0013540874'}})).body.error,'credentials');
    const login=await call(`/exams/${examId}/login`,{method:'POST',body:{student_number:'12345',national_id:'0013540874'}});assert.equal(login.status,200);leaderCookie=login.cookie;
    for(let i=0;i<5;i++)await call(`/exams/${examId}/login`,{method:'POST',body:{student_number:'88888',national_id:'0013540874'}});
    assert.equal((await call(`/exams/${examId}/login`,{method:'POST',body:{student_number:'88888',national_id:'0013540874'}})).status,429);
    DB.sqlite.prepare('INSERT INTO exam_students VALUES(?,?,?,?,?,?,1,?)').run('member-id',examId,'Member','12346','unused','unique-fingerprint',new Date().toISOString());
    const memberToken='b'.repeat(64);DB.sqlite.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await sha256(memberToken),examId,'member-id',Math.floor(Date.now()/1000)+3600);memberCookie=cookie(memberToken).split(';')[0];
  });
  await t.test('group creation rejects unauthorized/duplicate members and conflicting membership',async()=>{
    const create=members=>call(`/exams/${examId}/groups`,{method:'POST',session:leaderCookie,body:{name:'Alpha',members}});
    assert.equal((await create(['77777'])).body.error,'memberUnavailable');
    assert.equal((await create(['12345'])).body.error,'duplicateMember');
    assert.equal((await create(['12346','12346'])).body.error,'duplicateMember');
    assert.equal((await create(['12346'])).status,201);
    assert.equal((await create(['12346'])).status,409);
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM groups').get().n,1);
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM group_members').get().n,2);
  });
  await t.test('leader-only upload, row validation, scoring, member visibility and private leaderboard',async()=>{
    const submit=(session,rows)=>call(`/exams/${examId}/submission`,{method:'POST',session,body:upload(rows)});
    assert.equal((await submit(memberCookie,predictionRows)).status,403);
    assert.equal((await submit(leaderCookie,predictionRows.slice(0,-1))).body.error,'recordMismatch');
    const accepted=await submit(leaderCookie,predictionRows);assert.equal(accepted.status,200,JSON.stringify(accepted.body));assert.equal(accepted.body.score,70);
    const leader=await call(`/exams/${examId}`,{session:leaderCookie}), member=await call(`/exams/${examId}`,{session:memberCookie});
    assert.equal(leader.body.group.submission.score,70);assert.equal(member.body.group.submission.score,70);
    assert.equal(member.body.group.rank,1);assert.equal(member.body.leaderboard[0].group_name,'Alpha');
    assert.ok(!JSON.stringify(member.body).includes('student_number'));assert.ok(!JSON.stringify(member.body).includes('credential'));assert.ok(!JSON.stringify(member.body).includes('"result":'));
    assert.equal((await call(`/exams/${crypto.randomUUID()}`,{session:leaderCookie})).status,404);
    assert.equal((await call(`/admin/exams/${examId}`,{session:leaderCookie})).status,401);
    assert.equal((await submit(leaderCookie,resultRows)).body.score,100);
    assert.equal((await call(`/exams/${examId}`,{session:memberCookie})).body.group.submission.score,100);
  });
  await t.test('replacement rules, deadline and exam isolation are enforced on backend',async()=>{
    DB.sqlite.prepare('UPDATE exams SET allow_replace=0 WHERE id=?').run(examId);
    assert.equal((await call(`/exams/${examId}/submission`,{method:'POST',session:leaderCookie,body:upload(resultRows)})).body.error,'replacementDisabled');
    DB.sqlite.prepare('UPDATE exams SET deadline=? WHERE id=?').run('2000-01-01T00:00:00.000Z',examId);
    assert.equal((await call(`/exams/${examId}/submission`,{method:'POST',session:leaderCookie,body:upload(resultRows)})).body.error,'deadline');
    const other=crypto.randomUUID();DB.sqlite.prepare('INSERT INTO exams(id,name,active,created_at,updated_at) VALUES(?,?,1,?,?)').run(other,'Other',new Date().toISOString(),new Date().toISOString());
    assert.equal((await call(`/exams/${other}`,{session:leaderCookie})).status,401);
  });
  await t.test('reference replacement invalidates rankings, preserves history, and deactivation revokes sessions',async()=>{
    assert.equal((await call(`/admin/exams/${examId}/reference`,{method:'POST',admin:true,body:upload(resultRows)})).body.error,'deactivateFirst');
    await call(`/admin/exams/${examId}/status`,{method:'POST',admin:true,body:{active:false}});
    assert.equal((await call(`/exams/${examId}`,{session:memberCookie})).body.error,'inactive');
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE exam_id=?').get(examId).n,0);
    assert.equal((await call(`/admin/exams/${examId}/reference`,{method:'POST',admin:true,body:upload(resultRows)})).status,200);
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM current_submissions').get().n,0);
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM submissions').get().n,2);
  });
  await t.test('administrator group correction preserves one-group-per-student and leader membership',async()=>{
    const group=DB.sqlite.prepare('SELECT id FROM groups WHERE exam_id=?').get(examId);
    const corrected=await call(`/admin/exams/${examId}/groups/${group.id}`,{method:'PATCH',admin:true,body:{name:'Corrected',leader_number:'12346',members:['12345'],status:'locked'}});
    assert.equal(corrected.status,200);assert.equal(DB.sqlite.prepare('SELECT leader_id FROM groups WHERE id=?').get(group.id).leader_id,'member-id');
    assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id=?').get(group.id).n,2);
  });
  await t.test('deletion cascades through private exam data while retaining administrative audit',async()=>{
    const deleted=await call(`/admin/exams/${examId}`,{method:'DELETE',admin:true,body:{}});assert.equal(deleted.status,200,JSON.stringify(deleted.body));
    for(const name of ['exam_students','groups','submissions','reference_versions','imports'])assert.equal(DB.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE exam_id=?`).get(examId).n,0);
    assert.ok(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE exam_id=?').get(examId).n>0);
  });
});
