import { EXAMS_API_URL } from './exams-config.js';
export async function siteRequest(path,data,method) {
  let response;
  try{response=await fetch(`${EXAMS_API_URL}/api/site/${path}`,{method:method||(data===undefined?'GET':'POST'),credentials:'include',headers:data===undefined?{}:{'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});}
  catch{throw new Error('network');}
  let result;try{result=await response.json();}catch{throw new Error('serverError');}
  if(!response.ok)throw new Error(result.error||'serverError');return result;
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function readSnapshot(file) {
  if(!file||file.size>8*1024*1024)throw new Error('invalid');
  let data;try{data=JSON.parse(await file.text());}catch{throw new Error('invalid');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('invalid');return data;
}
export function renderSetup(root,{lang,translate}) {
  const t=(en,fa)=>lang==='fa'?fa:en;
  root.innerHTML=`<section class="form-panel exam-section"><h1>${t('Create the first administrator','ساخت اولین حساب مدیر')}</h1><p>${t('Use the one-time setup key configured in Cloudflare. This page cannot create another first administrator after setup.','از کلید راه‌اندازی یک‌بارمصرف تنظیم‌شده در کلادفلر استفاده کنید. پس از راه‌اندازی، ایجاد مجدد مدیر اولیه ممکن نیست.')}</p><form id="site-setup"><label>${t('Setup key','کلید راه‌اندازی')}<input name="token" type="password" required autocomplete="off" maxlength="200"></label><label>${t('Full name','نام کامل')}<input name="name" required maxlength="200"></label><label>${t('Email','ایمیل')}<input name="login" type="email" required autocomplete="username"></label><label>${t('New password (12–128 characters)','رمز جدید (۱۲ تا ۱۲۸ نویسه)')}<input name="secret" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></label><button class="button">${t('Create administrator','ایجاد مدیر')}</button></form><p class="message" role="status"></p></section>`;
  root.querySelector('form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),message=root.querySelector('.message');button.disabled=true;message.textContent='';
    try{await siteRequest('bootstrap',Object.fromEntries(new FormData(form)));form.reset();form.hidden=true;message.textContent=t('Administrator created. Remove the setup key in Cloudflare, then open the Admin page to sign in.','مدیر ایجاد شد. کلید راه‌اندازی را از کلادفلر حذف کنید و از صفحه مدیریت وارد شوید.');}
    catch(error){message.textContent=translate(error.message);}finally{button.disabled=false;}
  });
}
export function attachSiteAdmin(data,{lang,refresh,translate}) {
  const t=(en,fa)=>lang==='fa'?fa:en,admins=data.users.filter(m=>m.role==='admin');
  const section=document.createElement('section');section.className='form-panel wide';
  section.innerHTML=`<h2>${t('Administrator accounts','حساب‌های مدیران')}</h2><p>${t('Password changes sign the selected administrator out. Create additional administrators using the member form.','تغییر رمز، مدیر انتخاب‌شده را از حساب خارج می‌کند. مدیر جدید را از فرم ثبت عضو ایجاد کنید.')}</p><form id="admin-reset"><label>${t('Administrator','مدیر')}<select name="id">${admins.map(a=>`<option value="${esc(a.id)}">${esc(a.name)} · ${esc(a.login)}</option>`).join('')}</select></label><label>${t('New password','رمز جدید')}<input name="secret" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></label><button class="button">${t('Set password','تنظیم رمز')}</button></form><div class="record-list">${admins.map(a=>`<div class="record">${esc(a.name)} · ${esc(a.login)} ${a.self?t('(you)','(شما)'):`<button class="button secondary" data-admin="${esc(a.id)}" data-active="${a.active?'false':'true'}">${a.active?t('Deactivate','غیرفعال کردن'):t('Activate','فعال کردن')}</button>`}</div>`).join('')}</div><h2>${t('Import previous website content','انتقال محتوای قبلی سایت')}</h2><p>${t('Choose the JSON file from the temporary Firebase export page. Only missing content pages are imported; existing edits are preserved.','فایل JSON صفحه موقت خروجی فایربیس را انتخاب کنید. فقط صفحات فاقد محتوا وارد می‌شوند و ویرایش‌های موجود حفظ می‌شوند.')}</p><a class="text-link" href="./migration/export.html" target="_blank" rel="noopener">${t('Open temporary export page','باز کردن صفحه موقت خروجی')}</a><input id="content-snapshot" type="file" accept=".json,application/json"><div id="content-review"></div><p class="message" role="status"></p>`;
  document.querySelector('.admin-grid').append(section);
  const message=section.querySelector('.message');
  const run=async(button,action)=>{button.disabled=true;message.textContent='';try{await action();}catch(e){message.textContent=translate(e.message);message.classList.add('error');}finally{button.disabled=false;}};
  section.querySelector('#admin-reset').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget,b=Object.fromEntries(new FormData(form));
    run(form.querySelector('button'),async()=>{await siteRequest('admin/account',b,'PATCH');form.reset();if(admins.find(a=>a.id===b.id)?.self)location.reload();else await refresh();});
  });
  section.querySelectorAll('[data-admin]').forEach(button=>button.addEventListener('click',()=>run(button,async()=>{await siteRequest('admin/account',{id:button.dataset.admin,active:button.dataset.active==='true'},'PATCH');await refresh();})));
  section.querySelector('#content-snapshot').addEventListener('change',async event=>{
    const review=section.querySelector('#content-review');review.replaceChildren();message.textContent='';
    try{const snapshot=await readSnapshot(event.target.files[0]);if(!Array.isArray(snapshot.content)||snapshot.content.length>5)throw new Error('invalid');
      review.innerHTML=`${snapshot.content.map(c=>`<details><summary>${esc(c.key)}</summary><p dir="ltr">${esc(c.en)}</p><p dir="rtl">${esc(c.fa)}</p></details>`).join('')}<button class="button">${t('Confirm content import','تأیید انتقال محتوا')}</button>`;
      const button=review.querySelector('button');button.addEventListener('click',()=>run(button,async()=>{await siteRequest('admin/content-import',{content:snapshot.content});location.reload();}));
    }catch(e){message.textContent=translate(e.message);}
  });
}
