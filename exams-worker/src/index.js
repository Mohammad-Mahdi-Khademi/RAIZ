import { ApiError, reject, text, digits, studentNumber, groupKey, evaluate, examSettings } from './core.js';
import { adminIdentity, credential, verifyCredential, keyed, sha256, randomToken, limit, cookie, sessionToken } from './security.js';
import { readUpload } from './excel.js';
import { portalRoute } from './portal.js';

const now=()=>new Date().toISOString();
const seconds=()=>Math.floor(Date.now()/1000);
const id=()=>crypto.randomUUID();
const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
const one=(db,sql,...args)=>statement(db,sql,...args).first();
const all=async(db,sql,...args)=>(await statement(db,sql,...args).all()).results;
const publicExam=e=>({id:e.id,name:e.name,description:e.description,active:!!e.active,deadline:e.deadline,min_size:e.min_size,max_size:e.max_size,allow_replace:!!e.allow_replace,created_at:e.created_at});
const respond=(value,status=200,headers={})=>Response.json(value,{status,headers});
async function json(request,maximum=16384) {
  if(!request.headers.get('Content-Type')?.startsWith('application/json')) reject(415,'invalid');
  const reader=request.body?.getReader(); if(!reader) reject(400,'invalid');
  let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>maximum){await reader.cancel();reject(413,'invalid');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!value || Array.isArray(value)||typeof value!=='object')reject(400,'invalid');return value;}catch{reject(400,'invalid');}
}
function audit(db,uid,exam,action,detail={}) {
  return statement(db,'INSERT INTO audit_logs VALUES(?,?,?,?,?,?)',id(),uid,exam,action,JSON.stringify(detail),now());
}
// D1 batch transactions plus optimistic exam versions prevent TOCTOU races.
async function mutate(db,exam,operations,{uid,action,detail={},participation=false}={}) {
  const guard=participation?' AND active=1 AND (deadline IS NULL OR deadline>?)':'';
  const params=[exam.id,exam.version];if(participation)params.push(now());
  const batch=[statement(db,`INSERT INTO transaction_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM exams WHERE id=? AND version=?${guard}) THEN 1 ELSE 0 END`,...params),...operations];
  if(uid)batch.push(audit(db,uid,exam.id,action,detail));
  batch.push(statement(db,'UPDATE exams SET version=version+1,updated_at=? WHERE id=?',now(),exam.id),db.prepare('DELETE FROM transaction_assertions'));
  await db.batch(batch);
}
function participation(exam) {
  if(!exam.active)reject(403,'inactive');
  if(exam.deadline && exam.deadline<=now())reject(403,'deadline');
}
async function getExam(db,examId) {
  const e=await one(db,'SELECT * FROM exams WHERE id=?',examId);if(!e)reject(404,'notFound');return e;
}
async function studentIdentity(request,db,exam) {
  if(!exam.active)reject(403,'inactive');
  const token=sessionToken(request);if(!/^[a-f0-9]{64}$/.test(token))reject(401,'loginRequired');
  const student=await one(db,`SELECT s.id,s.full_name,s.student_number FROM sessions x JOIN exam_students s ON s.id=x.student_id AND s.exam_id=x.exam_id
    WHERE x.token_hash=? AND x.exam_id=? AND x.expires_at>? AND s.authorized=1`,await sha256(token),exam.id,seconds());
  if(!student)reject(401,'loginRequired');return student;
}
async function getGroup(db,examId,studentId) {
  return one(db,'SELECT g.* FROM groups g JOIN group_members m ON m.group_id=g.id WHERE m.exam_id=? AND m.student_id=?',examId,studentId);
}
async function leaderboard(db,examId) {
  return all(db,`SELECT RANK() OVER(ORDER BY e.correct DESC) AS rank,g.name AS group_name,e.final_score AS score,e.correct,e.total
    FROM groups g JOIN current_submissions c ON c.group_id=g.id JOIN submissions s ON s.id=c.submission_id
    JOIN evaluation_results e ON e.submission_id=s.id JOIN exams x ON x.id=g.exam_id
    WHERE g.exam_id=? AND s.reference_version=x.reference_version ORDER BY e.correct DESC,g.name_key,g.id`,examId);
}
async function groupView(db,examId,group,admin=false) {
  if(!group)return null;
  const members=await all(db,`SELECT s.id,s.full_name${admin?',s.student_number':''} FROM group_members m JOIN exam_students s ON s.id=m.student_id WHERE m.group_id=? ORDER BY s.full_name`,group.id);
  const submission=await one(db,`SELECT s.id,s.filename,s.submitted_at,e.final_score AS score,e.correct,e.total FROM current_submissions c JOIN submissions s ON s.id=c.submission_id JOIN evaluation_results e ON e.submission_id=s.id WHERE c.group_id=?`,group.id);
  let rank=null;
  if(submission)rank=(await one(db,`SELECT 1+COUNT(*) AS rank FROM groups g JOIN current_submissions c ON c.group_id=g.id JOIN evaluation_results e ON e.submission_id=c.submission_id WHERE g.exam_id=? AND e.correct>?`,examId,submission.correct)).rank;
  return {id:group.id,name:group.name,leader_id:group.leader_id,status:group.status,members,submission,rank};
}
async function memberIds(db,exam,leader,numbers) {
  if(!Array.isArray(numbers) || numbers.length>19)reject(400,'groupSize');
  const normalized=numbers.map(studentNumber);
  if(new Set(normalized).size!==normalized.length || normalized.includes(leader.student_number))reject(400,'duplicateMember');
  const members=[leader];
  for(const number of normalized){const m=await one(db,'SELECT id,student_number FROM exam_students WHERE exam_id=? AND student_number=? AND authorized=1',exam.id,number);if(!m)reject(400,'memberUnavailable');members.push(m);}
  if(members.length<exam.min_size||members.length>exam.max_size)reject(400,'groupSize');
  return members.map(m=>m.id);
}
async function route(request,env) {
  const db=env.DB, url=new URL(request.url), path=url.pathname.replace(/\/$/,'');
  const method=request.method;
  if(!env.NATIONAL_ID_PEPPER || !env.PRIVACY_KEY)reject(503,'setup');
  if(path.startsWith('/api/portal/'))return portalRoute(request,env,json);
  if(path==='/api/exams'&&method==='GET') {
    return respond({exams:(await all(db,'SELECT id,name,description,deadline,min_size,max_size,allow_replace,active,created_at FROM exams WHERE active=1 ORDER BY created_at DESC')).map(publicExam)});
  }
  if(path==='/api/logout'&&method==='POST') {
    const token=sessionToken(request);if(token)await statement(db,'DELETE FROM sessions WHERE token_hash=?',await sha256(token)).run();
    return respond({ok:true},200,{'Set-Cookie':cookie('',0)});
  }
  const adminRoute=path.startsWith('/api/admin/');
  let uid;
  if(adminRoute)uid=await adminIdentity(request,env);
  if(path==='/api/admin/exams') {
    if(method==='GET')return respond({exams:await all(db,`SELECT e.*,(SELECT COUNT(*) FROM exam_students WHERE exam_id=e.id) AS student_count,
      (SELECT COUNT(*) FROM groups WHERE exam_id=e.id) AS group_count FROM exams e ORDER BY created_at DESC`)});
    if(method==='POST') {
      const b=examSettings(await json(request)), examId=id(), created=now();
      await db.batch([statement(db,'INSERT INTO exams(id,name,description,deadline,min_size,max_size,allow_replace,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',examId,b.name,b.description,b.deadline,b.min,b.max,b.replace,created,created),audit(db,uid,examId,'exam.create')]);
      return respond({id:examId},201);
    }
  }
  const match=path.match(/^\/api\/(admin\/)?exams\/([a-f0-9-]{36})(?:\/(.*))?$/);
  if(!match)reject(404,'notFound');
  const exam=await getExam(db,match[2]), tail=match[3]||'';
  if(adminRoute) {
    if(!tail&&method==='GET') {
      const groups=await all(db,'SELECT * FROM groups WHERE exam_id=? ORDER BY created_at',exam.id);
      // Fetch in bulk: one query per group would exceed Workers Free's D1 query cap.
      const roster=await all(db,'SELECT m.group_id,s.id,s.full_name,s.student_number FROM group_members m JOIN exam_students s ON s.id=m.student_id WHERE m.exam_id=? ORDER BY s.full_name',exam.id);
      const latest=await all(db,'SELECT c.group_id,s.id,s.filename,s.submitted_at,e.final_score AS score,e.correct,e.total FROM current_submissions c JOIN submissions s ON s.id=c.submission_id JOIN evaluation_results e ON e.submission_id=s.id WHERE s.exam_id=?',exam.id);
      const result=groups.map(g=>({id:g.id,name:g.name,leader_id:g.leader_id,status:g.status,members:roster.filter(m=>m.group_id===g.id),submission:latest.find(s=>s.group_id===g.id)||null}));
      return respond({exam,groups:result,students:await all(db,'SELECT id,full_name,student_number,authorized FROM exam_students WHERE exam_id=? ORDER BY full_name',exam.id),
        submissions:await all(db,`SELECT s.id,s.group_id,g.name AS group_name,s.filename,s.size,s.submitted_at,s.reference_version,e.correct,e.total,e.final_score AS score,s.uploaded_by,
          CASE WHEN c.submission_id=s.id THEN 1 ELSE 0 END AS current FROM submissions s JOIN groups g ON g.id=s.group_id JOIN evaluation_results e ON e.submission_id=s.id LEFT JOIN current_submissions c ON c.submission_id=s.id WHERE s.exam_id=? ORDER BY s.submitted_at DESC`,exam.id),
        reference:await one(db,'SELECT version,filename,created_at,(SELECT COUNT(*) FROM reference_records WHERE exam_id=? AND version=?) AS record_count FROM reference_versions WHERE exam_id=? AND version=?',exam.id,exam.reference_version,exam.id,exam.reference_version),
        leaderboard:await leaderboard(db,exam.id)});
    }
    if(!tail&&method==='PATCH') {
      const b=examSettings(await json(request));
      const invalid=await one(db,'SELECT COUNT(*) AS n FROM (SELECT COUNT(*) AS size FROM group_members WHERE exam_id=? GROUP BY group_id) WHERE size<? OR size>?',exam.id,b.min,b.max);
      if(invalid.n)reject(409,'existingGroupSize');
      await mutate(db,exam,[statement(db,'UPDATE exams SET name=?,description=?,deadline=?,min_size=?,max_size=?,allow_replace=? WHERE id=?',b.name,b.description,b.deadline,b.min,b.max,b.replace,exam.id)],{uid,action:'exam.update'});return respond({ok:true});
    }
    if(!tail&&method==='DELETE') {
      await mutate(db,exam,[statement(db,'DELETE FROM exams WHERE id=?',exam.id)],{uid,action:'exam.delete'});return respond({ok:true});
    }
    if(tail==='status'&&method==='POST') {
      const b=await json(request);if(typeof b.active!=='boolean')reject(400,'invalid');
      const count=await one(db,'SELECT COUNT(*) AS n FROM exam_students WHERE exam_id=? AND authorized=1',exam.id);
      if(b.active&&(!exam.reference_version||!count.n))reject(400,'notReady');
      await mutate(db,exam,[statement(db,'UPDATE exams SET active=? WHERE id=?',Number(b.active),exam.id),...(!b.active?[statement(db,'DELETE FROM sessions WHERE exam_id=?',exam.id)]:[])],{uid,action:b.active?'exam.activate':'exam.deactivate'});return respond({ok:true});
    }
    if(tail==='reference'&&method==='POST') {
      if(exam.active)reject(409,'deactivateFirst');
      const upload=await readUpload(request,'results'),version=exam.reference_version+1;
      await mutate(db,exam,[statement(db,'INSERT INTO reference_versions VALUES(?,?,?,?,?)',exam.id,version,upload.filename,upload.digest,now()),
        statement(db,`INSERT INTO reference_records SELECT ?,?,json_extract(value,'$.row'),json_extract(value,'$.result') FROM json_each(?)`,exam.id,version,JSON.stringify(upload.records)),
        statement(db,'DELETE FROM current_submissions WHERE group_id IN(SELECT id FROM groups WHERE exam_id=?)',exam.id),
        statement(db,'UPDATE exams SET reference_version=? WHERE id=?',version,exam.id)],{uid,action:'reference.replace',detail:{version,records:upload.records.length}});
      return respond({ok:true,version,records:upload.records.length});
    }
    if(tail==='imports/validate'&&method==='POST') {
      if(exam.active)reject(409,'deactivateFirst');
      const upload=await readUpload(request,'students');
      const existing=await all(db,'SELECT student_number,national_fingerprint FROM exam_students WHERE exam_id=?',exam.id);
      const numbers=new Set(existing.map(s=>s.student_number)), fingerprints=new Set(existing.map(s=>s.national_fingerprint));
      if(upload.errors.length)return respond({errors:upload.errors,rows:[]});
      for(let i=0;i<upload.students.length;i++) {
        const s=upload.students[i];
        if(numbers.has(s.student_number))upload.errors.push({row:i+2,code:'duplicateStudent'});
        if(fingerprints.has(await keyed(env.PRIVACY_KEY,`national:${exam.id}:${s.national_id}`)))upload.errors.push({row:i+2,code:'duplicateNational'});
      }
      if(upload.errors.length)return respond({errors:upload.errors,rows:[]});
      const importId=id();await statement(db,'INSERT INTO imports VALUES(?,?,?,?,?,?,?)',importId,exam.id,uid,upload.digest,upload.students.length,exam.version,seconds()+3600).run();
      return respond({id:importId,errors:[],rows:upload.students.map((s,i)=>({row:i+2,full_name:s.full_name,student_number:s.student_number}))});
    }
    const impMatch=tail.match(/^imports\/([a-f0-9-]{36})\/(prepare|confirm)$/);
    if(impMatch&&method==='POST') {
      if(exam.active)reject(409,'deactivateFirst');
      const imp=await one(db,'SELECT * FROM imports WHERE id=? AND exam_id=? AND admin_uid=? AND expires_at>?',impMatch[1],exam.id,uid,seconds());
      if(!imp||imp.base_version!==exam.version)reject(409,'importExpired');
      if(impMatch[2]==='prepare') {
        const position=Number(url.searchParams.get('position'));
        if(!Number.isInteger(position)||position<0||position>=imp.total)reject(400,'invalid');
        const upload=await readUpload(request,'students');
        if(upload.digest!==imp.digest||upload.errors.length)reject(400,'importChanged');
        const s=upload.students[position];
        const hash=await credential(s.national_id,env.NATIONAL_ID_PEPPER),fingerprint=await keyed(env.PRIVACY_KEY,`national:${exam.id}:${s.national_id}`);
        await statement(db,`INSERT INTO import_rows VALUES(?,?,?,?,?,?,?) ON CONFLICT(import_id,position) DO NOTHING`,imp.id,position,id(),s.full_name,s.student_number,hash,fingerprint).run();
        return respond({prepared:position+1,total:imp.total});
      }
      const count=await one(db,'SELECT COUNT(*) AS n FROM import_rows WHERE import_id=?',imp.id);
      if(count.n!==imp.total)reject(409,'importIncomplete');
      await mutate(db,exam,[statement(db,`INSERT INTO exam_students(id,exam_id,full_name,student_number,credential,national_fingerprint,created_at)
        SELECT student_id,?,full_name,student_number,credential,national_fingerprint,? FROM import_rows WHERE import_id=?`,exam.id,now(),imp.id),statement(db,'DELETE FROM imports WHERE id=?',imp.id)],{uid,action:'students.import',detail:{count:imp.total}});
      return respond({ok:true,count:imp.total});
    }
    const groupMatch=tail.match(/^groups\/([a-f0-9-]{36})$/);
    if(groupMatch&&method==='PATCH') {
      if(exam.active)reject(409,'deactivateFirst');
      const group=await one(db,'SELECT * FROM groups WHERE id=? AND exam_id=?',groupMatch[1],exam.id);if(!group)reject(404,'notFound');
      const b=await json(request),leaderNumber=studentNumber(b.leader_number);
      const leader=await one(db,'SELECT id,student_number FROM exam_students WHERE exam_id=? AND student_number=? AND authorized=1',exam.id,leaderNumber);if(!leader)reject(400,'memberUnavailable');
      const members=await memberIds(db,exam,leader,b.members);
      const name=text(b.name,80);if(!['registered','locked'].includes(b.status))reject(400,'invalid');
      await mutate(db,exam,[statement(db,'DELETE FROM group_members WHERE group_id=?',group.id),
        statement(db,'UPDATE groups SET name=?,name_key=?,leader_id=?,status=? WHERE id=?',name,groupKey(name),leader.id,b.status,group.id),
        statement(db,'INSERT INTO group_members SELECT ?,?,value FROM json_each(?)',exam.id,group.id,JSON.stringify(members)),
        statement(db,'DELETE FROM sessions WHERE exam_id=?',exam.id)],{uid,action:'group.correct',detail:{group:group.id}});
      return respond({ok:true});
    }
    reject(404,'notFound');
  }
  if(tail==='login'&&method==='POST') {
    const ip=request.headers.get('CF-Connecting-IP')||'local';
    await limit(db,await keyed(env.PRIVACY_KEY,`login-ip:${ip}`),30,900);
    const b=await json(request),number=studentNumber(b.student_number),secret=digits(b.national_id);
    await limit(db,await keyed(env.PRIVACY_KEY,`login-account:${exam.id}:${number}`),5,900);
    if(!exam.active)reject(403,'inactive');
    if(!/^\d{10}$/.test(secret))reject(401,'credentials');
    const student=await one(db,'SELECT id,credential FROM exam_students WHERE exam_id=? AND student_number=? AND authorized=1',exam.id,number);
    // Unknown identities take the same slow KDF path and return the same error.
    const stored=student?.credential||`pbkdf2-sha256:100000:${'0'.repeat(32)}:${'0'.repeat(64)}`;
    const valid=await verifyCredential(secret,env.NATIONAL_ID_PEPPER,stored);
    if(!student||!valid)reject(401,'credentials');
    const token=randomToken();
    await db.batch([statement(db,'INSERT INTO transaction_assertions SELECT CASE WHEN EXISTS(SELECT 1 FROM exams WHERE id=? AND active=1 AND version=?) THEN 1 ELSE 0 END',exam.id,exam.version),statement(db,'DELETE FROM sessions WHERE exam_id=? AND student_id=?',exam.id,student.id),statement(db,'INSERT INTO sessions VALUES(?,?,?,?)',await sha256(token),exam.id,student.id,seconds()+28800),db.prepare('DELETE FROM transaction_assertions')]);
    return respond({ok:true},200,{'Set-Cookie':cookie(token)});
  }
  const student=await studentIdentity(request,db,exam);
  if(!tail&&method==='GET') {
    const group=await getGroup(db,exam.id,student.id);
    return respond({exam:publicExam(exam),student:{id:student.id,full_name:student.full_name},group:await groupView(db,exam.id,group),leaderboard:await leaderboard(db,exam.id)});
  }
  if(tail==='leaderboard'&&method==='GET')return respond({leaderboard:await leaderboard(db,exam.id)});
  if(tail==='groups'&&method==='POST') {
    participation(exam);const b=await json(request),name=text(b.name,80);
    const members=await memberIds(db,exam,student,b.members),groupId=id();
    await mutate(db,exam,[statement(db,'INSERT INTO groups(id,exam_id,name,name_key,leader_id,created_at) VALUES(?,?,?,?,?,?)',groupId,exam.id,name,groupKey(name),student.id,now()),
      statement(db,'INSERT INTO group_members SELECT ?,?,value FROM json_each(?)',exam.id,groupId,JSON.stringify(members))],{participation:true});
    return respond({id:groupId},201);
  }
  if(tail==='submission'&&method==='POST') {
    participation(exam);
    const group=await getGroup(db,exam.id,student.id);if(!group||group.leader_id!==student.id)reject(403,'leaderOnly');
    if(group.status==='locked')reject(403,'groupLocked');
    await limit(db,await keyed(env.PRIVACY_KEY,`submission:${group.id}`),10,3600);
    if(!exam.allow_replace&&await one(db,'SELECT 1 AS yes FROM current_submissions WHERE group_id=?',group.id))reject(409,'replacementDisabled');
    const upload=await readUpload(request,'results');
    const reference=await all(db,'SELECT row_id AS row,result FROM reference_records WHERE exam_id=? AND version=?',exam.id,exam.reference_version);
    const result=evaluate(reference,upload.records),submissionId=id(),timestamp=now();
    await mutate(db,exam,[statement(db,'INSERT INTO submissions VALUES(?,?,?,?,?,?,?,?,?)',submissionId,exam.id,group.id,student.id,exam.reference_version,upload.filename,upload.size,upload.digest,timestamp),
      statement(db,`INSERT INTO submission_records SELECT ?,json_extract(value,'$.row'),json_extract(value,'$.result') FROM json_each(?)`,submissionId,JSON.stringify(upload.records)),
      statement(db,'INSERT INTO evaluation_results VALUES(?,?,?,?,?,?)',submissionId,result.correct,result.total,result.score,result.engine,timestamp),
      statement(db,'INSERT INTO current_submissions VALUES(?,?) ON CONFLICT(group_id) DO UPDATE SET submission_id=excluded.submission_id',group.id,submissionId)],{participation:true});
    return respond({ok:true,score:result.score,correct:result.correct,total:result.total});
  }
  reject(404,'notFound');
}

export default {
  async fetch(request,env) {
    const origin=request.headers.get('Origin');
    const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
    if(origin&&allowed.includes(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, OPTIONS'});
    let response;
    try {
      if(origin&&!allowed.includes(origin))reject(403,'origin');
      // Required Origin on mutations is the CSRF boundary, independently of CORS/auth.
      if(!['GET','OPTIONS'].includes(request.method)&&(!origin||!allowed.includes(origin)))reject(403,'origin');
      if(request.method==='OPTIONS')response=new Response(null,{status:204});
      else response=await route(request,env);
    }catch(error) {
      if(error instanceof ApiError)response=respond({error:error.code,...(error.details?{details:error.details}:{})},error.status);
      else if(/constraint|transaction_assertions/i.test(String(error.message)))response=respond({error:'conflict'},409);
      else response=respond({error:'serverError'},500);
      // Intentionally never log request bodies, parser exceptions, credentials or SQL values.
    }
    const result=new Response(response.body,response);for(const [key,value]of Object.entries(headers))result.headers.set(key,value);return result;
  },
  async scheduled(_event,env) {
    await env.DB.batch([statement(env.DB,'DELETE FROM portal_sessions WHERE expires_at<=?',seconds()),statement(env.DB,'DELETE FROM sessions WHERE expires_at<=?',seconds()),statement(env.DB,'DELETE FROM imports WHERE expires_at<=?',seconds()),statement(env.DB,'DELETE FROM rate_limits WHERE expires_at<=?',seconds())]);
  }
};
