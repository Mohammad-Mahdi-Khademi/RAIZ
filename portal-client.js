import { EXAMS_API_URL } from './exams-config.js';
import { readSnapshot } from './site-client.js';

export async function portalRequest(path,data,method) {
  const headers={};
  if(data!==undefined)headers['Content-Type']='application/json';
  let response;
  try { response=await fetch(`${EXAMS_API_URL}/api/portal/${path}`,{method:method||(data===undefined?'GET':'POST'),headers,credentials:'include',...(data===undefined?{}:{body:JSON.stringify(data)})}); }
  catch {throw new Error('network');}
  let result;try{result=await response.json();}catch{throw new Error('serverError');}
  if(!response.ok)throw Object.assign(new Error(result.error||'serverError'),{details:result.details});
  return result;
}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function attachPortalAdmin(data,{lang,refresh,translate}) {
  const t=(en,fa)=>lang==='fa'?fa:en;
  const section=document.createElement('section');section.className='form-panel wide';
  document.querySelector('.admin-grid').prepend(section);
  section.innerHTML=`<h2>${t('Student access','دسترسی دانشجویان')}</h2><div id="portal-admin-body"></div><p class="message" role="status"></p>`;
  const message=section.querySelector('.message'),body=section.querySelector('#portal-admin-body');
  const run=async(button,action)=>{
    button.disabled=true;message.textContent='';message.classList.remove('error');
    try{await action();}catch(error){if(error.message==='migrationField' && error.details){
      const {collection,row,field}=error.details;
      const collections={members:t('Members','اعضا'),equipment:t('Equipment','تجهیزات'),logs:t('History','سوابق')};
      const fields={id:t('document ID','شناسه سند'),name:t('name','نام'),login:t('login','شناسه ورود'),role:t('role','نقش'),active:t('active status','وضعیت فعال بودن'),holder:t('holder','دارنده امانت'),location:t('location','محل نگهداری'),equipmentId:t('equipment ID','شناسه تجهیز'),userId:t('member ID','شناسه عضو'),equipment:t('equipment name','نام تجهیز'),student:t('member name','نام عضو'),action:t('action','عملیات'),created:t('date','تاریخ')};
      message.textContent=t('Import stopped: ','انتقال متوقف شد: ')+(collections[collection]||'')+t(', record ', '، رکورد ')+row+t(' — missing or invalid field: ',' — فیلد نامعتبر یا خالی: ')+(fields[field]||'')+t('. No records were imported.','. هیچ رکوردی منتقل نشد.');
    }else message.textContent=translate(error.message);message.classList.add('error');}finally{button.disabled=false;}
  };
  if(!data.initialized) {
    document.querySelectorAll('#member-form input,#member-form select,#member-form button,#equipment-form input,#equipment-form button').forEach(e=>e.disabled=true);
    body.innerHTML=`<p>${t('Preview the existing members, equipment and complete borrowing history before importing. Existing passwords are not copied. Set each student’s credential after import. Firebase data is retained.','پیش از انتقال، اعضا، تجهیزات و تمام سوابق امانت را بررسی کنید. رمزهای قبلی منتقل نمی‌شوند. پس از انتقال، کد ورود هر دانشجو را تنظیم کنید. داده‌های فایربیس حذف نمی‌شوند.')}</p><p><a class="text-link" href="./migration/export.html" target="_blank" rel="noopener">${t('Export existing Firebase data first','ابتدا از داده‌های فایربیس خروجی بگیرید')}</a></p><input id="portal-snapshot" type="file" accept=".json,application/json"><button type="button" class="button" id="migration-preview">${t('Preview Firebase import','پیش‌نمایش انتقال از فایربیس')}</button><div id="migration-review"></div>`;
    body.querySelector('#migration-preview').addEventListener('click',event=>run(event.currentTarget,async()=>{
      const snapshot=await readSnapshot(body.querySelector('#portal-snapshot').files[0]);
      if(!['members','equipment','logs'].every(key=>Array.isArray(snapshot[key])))throw new Error('invalid');
      const review=body.querySelector('#migration-review');
      review.innerHTML=`<p>${t('Members / Equipment / History records','اعضا / تجهیزات / سوابق')}: ${snapshot.members.length} / ${snapshot.equipment.length} / ${snapshot.logs.length}</p><div class="record-list">${snapshot.members.map(m=>`<div class="record">${escape(m.name)} · <span dir="ltr">${escape(m.login)}</span> · ${escape(m.role)}</div>`).join('')}</div><label class="exam-checkbox"><input type="checkbox" id="migration-frozen"> ${t('I have published the updated Firestore rules to stop equipment changes in the old portal, and reviewed this import.','قوانین جدید فایراستور را برای توقف تغییر تجهیزات در پنل قدیمی منتشر کرده‌ام و اطلاعات انتقال را بررسی کرده‌ام.')}</label><button type="button" class="button" id="migration-confirm" disabled>${t('Confirm import','تأیید انتقال')}</button>`;
      const confirm=review.querySelector('#migration-confirm');
      review.querySelector('#migration-frozen').addEventListener('change',event=>{confirm.disabled=!event.target.checked;});
      confirm.addEventListener('click',event=>run(event.currentTarget,async()=>{await portalRequest('admin/migrate',snapshot);await refresh();}));
    }));
    return;
  }
  const students=data.users.filter(m=>m.role==='student');
  body.innerHTML=`<p>${t('Set a ten-digit sign-in credential for imported students. Resetting it or changing account access signs the student out.','برای دانشجویان منتقل‌شده کد ورود ده‌رقمی تنظیم کنید. تغییر کد ورود یا وضعیت دسترسی، نشست دانشجو را پایان می‌دهد.')}</p>
    <form id="portal-credential-form"><label for="portal-member">${t('Student','دانشجو')}</label><select id="portal-member" name="id" required>${students.map(m=>`<option value="${escape(m.id)}">${escape(m.name)} · ${escape(m.login)}${m.needs_credential?t(' — credential required',' — نیازمند تنظیم کد ورود'):''}${!m.active?t(' — inactive',' — غیرفعال'):''}</option>`).join('')}</select><label for="portal-secret">${t('New ten-digit credential','کد ورود جدید ده‌رقمی')}</label><input id="portal-secret" name="secret" type="password" inputmode="numeric" autocomplete="new-password" maxlength="10" minlength="10" required><button class="button" ${students.length?'':'disabled'}>${t('Set credential','تنظیم کد ورود')}</button></form>
    <div class="record-list">${students.map(m=>`<div class="record">${escape(m.name)} · <span dir="ltr">${escape(m.login)}</span> · ${m.needs_credential?t('Credential required','نیازمند کد ورود'):t('Credential set','کد ورود تنظیم شده')} <button type="button" class="button secondary" data-member="${escape(m.id)}" data-active="${m.active?'false':'true'}">${m.active?t('Deactivate','غیرفعال کردن'):t('Activate','فعال کردن')}</button></div>`).join('')}</div>
    <h3>${t('Current equipment loans','امانت‌های جاری تجهیزات')}</h3><div class="record-list">${data.equipment.filter(e=>e.holder).map(e=>`<div class="record">${escape(e.name)} · ${escape(e.holder_name)} <button type="button" class="button secondary" data-release="${escape(e.id)}">${t('Record return','ثبت بازگشت')}</button></div>`).join('')||t('No current loans.','امانت جاری وجود ندارد.')}</div>`;
  body.querySelector('form').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;
    run(form.querySelector('button'),async()=>{await portalRequest('admin/member',Object.fromEntries(new FormData(form)),'PATCH');form.reset();await refresh();});
  });
  body.querySelectorAll('[data-member]').forEach(button=>button.addEventListener('click',()=>run(button,async()=>{await portalRequest('admin/member',{id:button.dataset.member,active:button.dataset.active==='true'},'PATCH');await refresh();})));
  body.querySelectorAll('[data-release]').forEach(button=>button.addEventListener('click',()=>run(button,async()=>{await portalRequest('admin/release',{id:button.dataset.release});await refresh();})));
}
