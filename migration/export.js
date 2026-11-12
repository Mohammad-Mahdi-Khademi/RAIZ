// Isolated one-time exporter. No normal website page imports this module.
import { firebaseConfig } from './firebase-config.js';
document.querySelector('#export-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),status=document.querySelector('#status');button.disabled=true;status.textContent='در حال دریافت اطلاعات…';
  let auth,app,a;
  try{
    const [sdk,authSdk,s]=await Promise.all([import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js')]);
    a=authSdk;app=sdk.initializeApp(firebaseConfig);auth=a.getAuth(app);await a.setPersistence(auth,a.inMemoryPersistence);
    const fields=new FormData(form);await a.signInWithEmailAndPassword(auth,fields.get('email'),fields.get('password'));form.reset();
    const db=s.getFirestore(app),profile=await s.getDoc(s.doc(db,'members',auth.currentUser.uid));
    if(!profile.exists()||profile.data().role!=='admin'||profile.data().active!==true)throw new Error('admin');
    const [members,equipment,logs,content]=await Promise.all(['members','equipment','equipmentLogs','content'].map(name=>s.getDocs(s.collection(db,name))));
    const snapshot={version:1,exported_at:new Date().toISOString(),
      members:members.docs.map(doc=>{const m=doc.data();return {id:doc.id,name:m.name,login:m.login,role:m.role,active:m.active};}),
      equipment:equipment.docs.map(doc=>{const e=doc.data();return {id:doc.id,name:e.name,location:e.location,holder:e.holder};}),
      logs:logs.docs.map(doc=>{const l=doc.data();return {id:doc.id,equipmentId:l.equipmentId,userId:l.userId,equipment:l.equipment,student:l.student,action:l.action,created:l.createdAt?.toDate?.().toISOString()};}),
      content:content.docs.map(doc=>({key:doc.id,en:doc.data().en,fa:doc.data().fa}))};
    const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='raiz-migration-private.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    status.textContent=`خروجی آماده شد: ${snapshot.members.length} عضو، ${snapshot.equipment.length} تجهیز، ${snapshot.logs.length} سابقه و ${snapshot.content.length} صفحه محتوا. فایل را در پنل جدید وارد کنید.`;
  }catch{status.textContent='خروجی تهیه نشد. VPN، حساب مدیر قبلی و مجوز خواندن فایربیس را بررسی کنید. داده‌ای حذف یا تغییر نکرد.';}
  finally{form.reset();if(auth)await a.signOut(auth).catch(()=>{});button.disabled=false;}
});
