import { EXAMS_API_URL } from './exams-config.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const messages={
  credentials:['Student number or national ID is incorrect.','شماره دانشجویی یا کد ملی صحیح نیست.'],
  loginRequired:['Please sign in to this exam.','لطفاً وارد این امتحان شوید.'],
  inactive:['This exam is inactive.','این امتحان غیرفعال است.'],
  deadline:['The submission deadline has passed.','مهلت ارسال به پایان رسیده است.'],
  leaderOnly:['Only the group leader can submit.','فقط سرگروه اجازه ارسال دارد.'],
  groupLocked:['This group is locked. Contact the administrator.','این گروه قفل شده است. با مدیر تماس بگیرید.'],
  rateLimit:['Too many attempts. Please try again later.','تعداد تلاش‌ها بیش از حد مجاز است. بعداً تلاش کنید.'],
  conflict:['The data changed, or a group name/member is already assigned. Refresh and check your entries.','اطلاعات تغییر کرده یا نام گروه/عضو قبلاً ثبت شده است. صفحه را تازه‌سازی و اطلاعات را بررسی کنید.'],
  memberUnavailable:['One or more members are not authorized for this exam.','یک یا چند عضو برای این امتحان مجاز نیستند.'],
  duplicateMember:['Do not repeat members or include the leader in the other-members list.','اعضا را تکرار نکنید و سرگروه را در فهرست سایر اعضا ننویسید.'],
  groupSize:['Group size must be within the exam limits.','تعداد اعضای گروه باید در محدوده تعیین‌شده باشد.'],
  existingGroupSize:['Existing groups do not fit these size limits.','اندازه برخی گروه‌های موجود با این محدودیت سازگار نیست.'],
  replacementDisabled:['Replacing a submission is disabled.','جایگزینی فایل ارسالی مجاز نیست.'],
  recordMismatch:['The file must contain exactly the reference record IDs, once each.','شناسه‌های فایل باید دقیقاً با مرجع یکسان و بدون تکرار باشند.'],
  columns:['Use exactly two columns: row and result.','دقیقاً دو ستون row و result لازم است.'],
  studentColumns:['Use Full Name, Student Number, National ID, or their Persian equivalents.','ستون‌های اسم کامل، شماره دانشجویی و شماره ملی لازم است.'],
  identifierText:['Student numbers and national IDs must be Text cells in Excel.','شماره دانشجویی و کد ملی را در اکسل با قالب Text وارد کنید.'],
  nationalId:['Invalid national ID format or checksum.','قالب یا رقم کنترل کد ملی معتبر نیست.'],
  studentNumber:['Student number must contain 5–20 digits.','شماره دانشجویی باید بین ۵ تا ۲۰ رقم باشد.'],
  duplicateStudent:['Duplicate student number.','شماره دانشجویی تکراری است.'],
  duplicateNational:['Duplicate national ID.','کد ملی تکراری است.'],
  duplicateRow:['Duplicate row identifier.','شناسه row تکراری است.'],
  dataType:['row must be a positive integer; result must be an integer category.','row باید عدد صحیح مثبت و result باید برچسب عدد صحیح باشد.'],
  fileType:['Upload an unencrypted .xlsx file without macros or external workbook links.','فایل xlsx بدون رمز، ماکرو یا پیوند خارجی بارگذاری کنید.'],
  fileSize:['File exceeds 128 KB compressed or 1 MB expanded.','حجم فایل از ۱۲۸ کیلوبایت یا حجم بازشده از ۱ مگابایت بیشتر است.'],
  oneSheet:['Use one worksheet only.','فقط یک برگه استفاده کنید.'],
  dimensions:['Start at A1. Limit: 500 result rows or 200 students per import.','از A1 شروع کنید. حداکثر ۵۰۰ نتیجه یا ۲۰۰ دانشجو در هر ورود.'],
  formula:['Formulas and Excel error cells are not accepted. Upload values only.','فرمول و سلول خطای اکسل مجاز نیست. فقط مقدار ارسال کنید.'],
  deactivateFirst:['Deactivate the exam before changing reference data, importing students, or correcting groups.','پیش از تغییر مرجع، ورود دانشجویان یا اصلاح گروه، امتحان را غیرفعال کنید.'],
  notReady:['Upload a reference and import students before activation.','پیش از فعال‌سازی، مرجع و فهرست دانشجویان را وارد کنید.'],
  importExpired:['The preview expired or exam data changed. Validate the file again.','پیش‌نمایش منقضی شده یا اطلاعات تغییر کرده است. فایل را دوباره بررسی کنید.'],
  importChanged:['The uploaded file differs from the preview.','فایل با پیش‌نمایش متفاوت است.'],
  importIncomplete:['Student preparation is incomplete. Retry the import.','آماده‌سازی دانشجویان کامل نشده است. دوباره تلاش کنید.'],
  adminRequired:['Sign in with an active administrator account.','با حساب مدیر فعال وارد شوید.'],
  setup:['The exam service needs configuration. Contact the administrator.','سرویس امتحانات نیاز به پیکربندی دارد. با مدیر تماس بگیرید.'],
  network:['Cannot reach the exam service. Check its deployment and your connection.','اتصال به سرویس امتحانات ممکن نیست. راه‌اندازی سرویس و اینترنت را بررسی کنید.'],
  notFound:['Exam not found.','امتحان پیدا نشد.'],
  invalid:['Check the entered information.','اطلاعات واردشده را بررسی کنید.'],
  serverError:['The operation failed. Please retry.','عملیات انجام نشد. دوباره تلاش کنید.']
};

export async function renderExams(root,{lang='fa',admin=false,getToken}={}) {
  const q=(en,fa)=>lang==='fa'?fa:en;
  const errorText=code=>messages[code]?.[lang==='fa'?1:0]||q('Unable to complete the request.','انجام درخواست ممکن نشد.');
  const query=new URLSearchParams(location.search), examId=query.get('exam');
  const link=(exam=null,isAdmin=admin)=>`?page=${isAdmin?'exams-admin':'exams'}&lang=${lang}${exam?`&exam=${encodeURIComponent(exam)}`:''}`;
  const date=value=>value?new Intl.DateTimeFormat(lang==='fa'?'fa-IR':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tehran'}).format(new Date(value)):q('No deadline','بدون مهلت');
  const score=value=>`${Number(value).toFixed(2)}%`;
  const input=(name,label,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
  const button=(label,extra='')=>`<button class="button" ${extra}>${label}</button>`;
  const message=()=>'<div class="message" role="status" aria-live="polite"></div>';
  const fileInput=()=>`<label>${q('Excel file (.xlsx, up to 128 KB)','فایل اکسل (xlsx، حداکثر ۱۲۸ کیلوبایت)')}<input type="file" name="file" accept=".xlsx" required></label>`;
  const table=(heads,rows)=>`<div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${heads.length}">${q('No records yet.','هنوز رکوردی وجود ندارد.')}</td></tr>`}</tbody></table></div>`;
  const board=rows=>`<section class="exam-section"><h2>${q('Group leaderboard','رتبه‌بندی گروه‌ها')}</h2><p class="quiet">${q('Equal scores share a rank. Only the latest submission counts.','امتیازهای برابر رتبه یکسان دارند. فقط آخرین ارسال محاسبه می‌شود.')}</p>${table([q('Rank','رتبه'),q('Group','گروه'),q('Accuracy','دقت'),q('Correct / total','صحیح / کل')],rows.map(r=>[r.rank,escape(r.group_name),score(r.score),`<bdi dir="ltr">${r.correct} / ${r.total}</bdi>`]))}</section>`;
  async function api(path,{method='GET',body}={}) {
    const headers={};if(admin)headers.Authorization=`Bearer ${await getToken()}`;
    if(body && !(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
    let response;try{response=await fetch(`${EXAMS_API_URL}/api${path}`,{method,body,headers,credentials:'include'});}catch{throw Object.assign(new Error('network'),{code:'network'});}
    let data;try{data=await response.json();}catch{data={error:'serverError'};}
    if(!response.ok)throw Object.assign(new Error(data.error),{code:data.error,details:data.details});return data;
  }
  const base=`${admin?'/admin':''}/exams${examId?`/${examId}`:''}`;
  const rerender=()=>root.isConnected?renderExams(root,{lang,admin,getToken}):Promise.resolve();
  function bind(formId,action) {
    root.querySelector(`#${formId}`)?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget, status=form.querySelector('.message'),buttons=form.querySelectorAll('button');
      buttons.forEach(b=>b.disabled=true);status.className='message';status.textContent=q('Working…','در حال انجام…');
      try{await action(form,status);}catch(e){status.className='message error';status.textContent=errorText(e.code||e.message)+(e.details?.row?` (${q('row','ردیف')} ${e.details.row})`:'');}
      finally{buttons.forEach(b=>b.disabled=false);}
    });
  }
  const heading=(title,description='')=>`<section class="page-head"><div class="eyebrow">RAIZ / ${q('EXAMS','امتحانات')}</div><h1>${escape(title)}</h1><p>${escape(description)}</p></section>`;
  root.innerHTML=heading(q('Exams','امتحانات'))+`<p class="loading" role="status">${q('Loading…','در حال بارگذاری…')}</p>`;
  try {
    if(!examId) {
      const data=await api(base);if(!root.isConnected)return;
      root.innerHTML=heading(admin?q('Exam management','مدیریت امتحانات'):q('Group examinations','امتحانات گروهی'),q('Submit your model results as Excel. Results and rankings belong to your group.','نتایج مدل خود را در قالب اکسل ارسال کنید. نتایج و رتبه‌بندی متعلق به گروه شماست.'))+
        (admin?`<a class="text-link" href="?page=admin&lang=${lang}">${q('Laboratory administration','مدیریت آزمایشگاه')}</a><details class="exam-section"><summary>${q('Create an exam','ایجاد امتحان')}</summary>${settingsForm()}</details>`:'')+
        `<div class="cards exam-cards">${data.exams.map(e=>`<article class="card"><span class="pill ${e.active?'':'busy'}">${e.active?q('Active','فعال'):q('Inactive','غیرفعال')}</span><h2>${escape(e.name)}</h2><p>${escape(e.description)}</p><p>${q('Deadline','مهلت')}: ${date(e.deadline)}</p><a class="button" href="${link(e.id)}">${admin?q('Manage exam','مدیریت امتحان'):q('Enter exam','ورود به امتحان')}</a></article>`).join('')||`<p class="placeholder">${q('No exams are available yet.','هنوز امتحانی در دسترس نیست.')}</p>`}</div>`;
      if(admin)bind('exam-settings',async form=>{const created=await api(base,{method:'POST',body:settingsBody(form)});location.href=link(created.id);});return;
    }
    let data;
    try{data=await api(base);}catch(e){if(!admin&&e.code==='loginRequired'){showLogin();return;}throw e;}
    if(!root.isConnected)return;
    if(admin)showAdmin(data);else showStudent(data);
  }catch(e){if(root.isConnected)root.innerHTML=heading(q('Exams','امتحانات'))+`<p class="message error" role="alert">${escape(errorText(e.code||e.message))}</p><a class="text-link" href="${link()}">${q('All exams','همه امتحانات')}</a>`;}

  function showLogin() {
    root.innerHTML=heading(q('Exam sign in','ورود به امتحان'),q('Use the student number and national ID authorized for this exam.','با شماره دانشجویی و کد ملی ثبت‌شده برای این امتحان وارد شوید.'))+`<a class="text-link" href="${link()}">${q('All exams','همه امتحانات')}</a><div class="login-layout"><section class="login-aside"><h2>${q('One group. One result.','یک گروه، یک نتیجه')}</h2><p>${q('Create a group after signing in, or view the group you already belong to. Only the leader uploads the result file.','پس از ورود گروه بسازید یا گروه خود را مشاهده کنید. فقط سرگروه فایل نتیجه را ارسال می‌کند.')}</p></section><form id="exam-login" class="form-panel">${input('student_number',q('Student number','شماره دانشجویی'),'','text','required dir="ltr" inputmode="numeric" autocomplete="username" maxlength="20"')}${input('national_id',q('National ID','کد ملی'),'','password','required dir="ltr" inputmode="numeric" autocomplete="current-password" maxlength="10"')}${button(q('Sign in','ورود'))}${message()}</form></div>`;
    bind('exam-login',async form=>{const body=Object.fromEntries(new FormData(form));form.elements.national_id.value='';await api(`${base}/login`,{method:'POST',body});await rerender();});
  }
  function showStudent(data) {
    const {exam,student,group}=data,leader=group?.leader_id===student.id,closed=exam.deadline&&new Date(exam.deadline)<=new Date();
    root.innerHTML=heading(exam.name,exam.description)+`<div class="dashboard-bar"><span>${escape(student.full_name)} · <span class="pill">${closed?q('Deadline passed','مهلت پایان یافته'):q('Active','فعال')}</span></span><div class="exam-actions"><a class="text-link" href="${link()}">${q('All exams','همه امتحانات')}</a><button id="exam-refresh" class="button secondary">${q('Refresh','تازه‌سازی')}</button><button id="exam-logout" class="button secondary">${q('Sign out','خروج')}</button></div></div><p>${q('Deadline (Tehran)','مهلت (تهران)')}: ${date(exam.deadline)}</p><div id="exam-action-status" class="message" role="status"></div>`+
      (group?`<div class="exam-summary"><section class="form-panel"><span class="eyebrow">${leader?q('GROUP LEADER','سرگروه'):q('GROUP MEMBER','عضو گروه')}</span><h2>${escape(group.name)}</h2><p>${q('Status','وضعیت')}: ${group.status==='locked'?q('Locked','قفل‌شده'):q('Registered','ثبت‌شده')}</p><ul>${group.members.map(m=>`<li>${escape(m.full_name)}${m.id===group.leader_id?` — ${q('Leader','سرگروه')}`:''}</li>`).join('')}</ul><p class="form-hint">${q('Membership corrections are handled by the administrator.','اصلاح اعضا توسط مدیر انجام می‌شود.')}</p></section><section class="form-panel"><h2>${q('Group result','نتیجه گروه')}</h2>${group.submission?`<div class="exam-score" dir="ltr">${score(group.submission.score)}</div><p>${q('Rank','رتبه')}: ${group.rank} · ${q('Correct','صحیح')}: <bdi dir="ltr">${group.submission.correct} / ${group.submission.total}</bdi></p><p>${escape(group.submission.filename)}</p><p class="quiet">${date(group.submission.submitted_at)}</p>`:`<p class="quiet">${q('No current submission.','هنوز ارسال معتبری برای مرجع فعلی ثبت نشده است.')}</p>`}</section></div>`+
      (leader&&!closed&&group.status!=='locked'&&(!group.submission||exam.allow_replace)?`<form id="exam-submit" class="form-panel exam-section"><h2>${group.submission?q('Replace result file','جایگزینی فایل نتیجه'):q('Submit result file','ارسال فایل نتیجه')}</h2><p>${q('One sheet; columns row and result; up to 500 records. Record IDs must match the reference. Accuracy is the percentage of exact matches.','یک برگه با ستون‌های row و result و حداکثر ۵۰۰ رکورد. شناسه‌ها باید با مرجع یکسان باشند. دقت برابر درصد پاسخ‌های کاملاً صحیح است.')}</p><p class="form-hint">${q('The latest accepted upload replaces your current score, even if lower.','آخرین فایل پذیرفته‌شده جایگزین امتیاز فعلی می‌شود؛ حتی اگر امتیاز کمتر باشد.')}</p>${fileInput()}${button(q('Upload and evaluate','بارگذاری و ارزیابی'))}${message()}</form>`:''):
      (closed?`<p class="placeholder">${q('Group registration is closed.','ثبت گروه بسته شده است.')}</p>`:`<form id="exam-group" class="form-panel exam-section"><h2>${q('Create your group','گروه خود را بسازید')}</h2><p>${q(`Group size: ${exam.min_size}–${exam.max_size}, including you. You become the leader.`,`تعداد اعضا: ${exam.min_size} تا ${exam.max_size} نفر با احتساب شما. شما سرگروه خواهید بود.`)}</p>${input('name',q('Group name','نام گروه'),'','text','required maxlength="80"')}<label>${q('Other members’ student numbers (one per line)','شماره دانشجویی سایر اعضا (هر شماره در یک خط)')}<textarea name="members" dir="ltr" maxlength="500"></textarea></label><p class="form-hint">${q('Membership is final after creation. Ask the administrator for corrections.','پس از ثبت، تغییر اعضا فقط توسط مدیر امکان‌پذیر است.')}</p>${button(q('Create group','ثبت گروه'))}${message()}</form>`))+board(data.leaderboard);
    root.querySelector('#exam-refresh').onclick=rerender;
    root.querySelector('#exam-logout').onclick=async()=>{try{await api('/logout',{method:'POST',body:{}});await rerender();}catch(e){root.querySelector('#exam-action-status').textContent=errorText(e.code);}};
    bind('exam-group',async form=>{const b=Object.fromEntries(new FormData(form));await api(`${base}/groups`,{method:'POST',body:{name:b.name,members:splitMembers(b.members)}});await rerender();});
    bind('exam-submit',async form=>{await api(`${base}/submission`,{method:'POST',body:new FormData(form)});await rerender();});
  }
  function settingsForm(exam={}) {
    return `<form id="exam-settings" class="form-panel"><h2>${exam.id?q('Exam settings','تنظیمات امتحان'):q('New inactive exam','امتحان جدید (غیرفعال)')}</h2>${input('name',q('Exam name','نام امتحان'),exam.name||'','text','required maxlength="200"')}<label>${q('Description','توضیحات')}<textarea name="description" maxlength="4000">${escape(exam.description||'')}</textarea></label><div class="exam-input-grid">${input('min_size',q('Minimum group size','حداقل اعضای گروه'),exam.min_size??1,'number','required min="1" max="20"')}${input('max_size',q('Maximum group size','حداکثر اعضای گروه'),exam.max_size??5,'number','required min="1" max="20"')}</div>${input('deadline',q('Optional deadline — your device’s local time','مهلت اختیاری — ساعت محلی دستگاه شما'),exam.deadline?localDate(exam.deadline):'','datetime-local')}<label class="exam-checkbox"><input name="allow_replace" type="checkbox" ${(exam.allow_replace??true)?'checked':''}>${q('Allow replacing submissions before the deadline','امکان جایگزینی فایل پیش از مهلت')}</label>${button(q('Save exam','ذخیره امتحان'))}${message()}</form>`;
  }
  function settingsBody(form) {
    const b=Object.fromEntries(new FormData(form));return {...b,min_size:Number(b.min_size),max_size:Number(b.max_size),allow_replace:form.elements.allow_replace.checked,deadline:b.deadline?new Date(b.deadline).toISOString():null};
  }
  function showAdmin(data) {
    const {exam,reference,groups,students,submissions}=data;
    root.innerHTML=heading(exam.name,q('Manage access, groups and evaluation results.','مدیریت دسترسی، گروه‌ها و نتایج ارزیابی.'))+`<div class="dashboard-bar"><a class="text-link" href="${link()}">${q('All exams','همه امتحانات')}</a><a class="text-link" href="${link(exam.id,false)}">${q('Student access page','صفحه ورود دانشجویان')}</a><span class="pill ${exam.active?'':'busy'}">${exam.active?q('Active','فعال'):q('Inactive','غیرفعال')}</span></div><div class="exam-stats"><div><strong>${students.length}</strong>${q('Authorized students','دانشجویان مجاز')}</div><div><strong>${groups.length}</strong>${q('Groups','گروه‌ها')}</div><div><strong>${submissions.length}</strong>${q('Submissions','ارسال‌ها')}</div><div><strong>${reference?.record_count||0}</strong>${q('Reference records','رکوردهای مرجع')}</div></div><div class="exam-admin-grid"><div>${settingsForm(exam)}<form id="exam-status" class="form-panel exam-section"><h2>${q('Participation status','وضعیت مشارکت')}</h2><p>${q('New exams stay inactive until reference data and students are ready. Deactivation signs students out.','امتحان جدید تا آماده شدن مرجع و دانشجویان غیرفعال می‌ماند. غیرفعال‌سازی باعث خروج دانشجویان می‌شود.')}</p>${button(exam.active?q('Deactivate exam','غیرفعال‌سازی امتحان'):q('Activate exam','فعال‌سازی امتحان'))}${message()}</form></div><div><form id="exam-reference" class="form-panel"><h2>${q('Private reference Excel','اکسل مرجع خصوصی')}</h2><p>${reference?`${escape(reference.filename)} · ${q('Version','نسخه')} ${reference.version}`:q('No reference uploaded.','مرجع بارگذاری نشده است.')}</p><p class="form-hint">${q('Columns: row and result. Replacing the reference clears the current leaderboard; groups must resubmit. Historical results are retained.','ستون‌ها: row و result. جایگزینی مرجع رتبه‌بندی فعلی را پاک می‌کند و گروه‌ها باید دوباره ارسال کنند. سابقه نتایج حفظ می‌شود.')}</p>${fileInput()}${button(q('Upload reference','بارگذاری مرجع'),exam.active?'disabled':'')}${message()}</form><form id="exam-import" class="form-panel exam-section"><h2>${q('Import authorized students','ورود دانشجویان مجاز')}</h2><p class="form-hint">${q('Exactly three columns: Full Name, Student Number, National ID. Persian headers are accepted. Format both identifiers as Text before entering values. Up to 200 students per file; imports add students.','دقیقاً سه ستون: اسم کامل، شماره دانشجویی، شماره ملی. عنوان انگلیسی نیز پذیرفته می‌شود. پیش از ورود شماره‌ها قالب سلول را Text قرار دهید. حداکثر ۲۰۰ دانشجو در هر فایل؛ ورود به فهرست موجود اضافه می‌شود.')}</p>${fileInput()}${button(q('Validate and preview','بررسی و پیش‌نمایش'),exam.active?'disabled':'')}${message()}</form><div id="exam-import-preview"></div></div></div>`+
      `<section class="exam-section"><h2>${q('Groups and membership corrections','گروه‌ها و اصلاح اعضا')}</h2><p class="quiet">${q('Deactivate the exam before corrections. Include the leader only in the leader field.','پیش از اصلاح، امتحان را غیرفعال کنید. سرگروه را فقط در فیلد سرگروه وارد کنید.')}</p>${groups.map((g,i)=>`<details class="exam-group"><summary>${escape(g.name)} · ${g.members.length} ${q('members','عضو')}${g.submission?` · ${score(g.submission.score)}`:''}</summary><form id="group-${i}" class="form-panel">${input('name',q('Group name','نام گروه'),g.name,'text','required maxlength="80"')}${input('leader_number',q('Leader student number','شماره دانشجویی سرگروه'),g.members.find(m=>m.id===g.leader_id)?.student_number||'','text','required dir="ltr"')}<label>${q('Other members (one student number per line)','سایر اعضا (هر شماره دانشجویی در یک خط)')}<textarea name="members" dir="ltr">${g.members.filter(m=>m.id!==g.leader_id).map(m=>escape(m.student_number)).join('\n')}</textarea></label><label>${q('Group status','وضعیت گروه')}<select name="status"><option value="registered">${q('Registered','ثبت‌شده')}</option><option value="locked" ${g.status==='locked'?'selected':''}>${q('Locked','قفل‌شده')}</option></select></label><p>${g.members.map(m=>`${escape(m.full_name)} (${escape(m.student_number)})`).join(' · ')}</p>${button(q('Save correction','ذخیره اصلاح'),exam.active?'disabled':'')}${message()}</form></details>`).join('')||`<p class="quiet">${q('No groups yet.','هنوز گروهی ثبت نشده است.')}</p>`}</section>`+board(data.leaderboard)+
      `<section class="exam-section"><h2>${q('Submission history and evaluation results','سابقه ارسال‌ها و نتایج ارزیابی')}</h2>${table([q('Group','گروه'),q('File','فایل'),q('Date','تاریخ'),q('Reference','مرجع'),q('Accuracy','دقت'),q('Correct / total','صحیح / کل'),q('Status','وضعیت')],submissions.map(s=>[escape(s.group_name),escape(s.filename),date(s.submitted_at),s.reference_version,score(s.score),`<bdi dir="ltr">${s.correct} / ${s.total}</bdi>`,s.current?q('Current','فعلی'):q('History','سابقه')]))}</section><details class="exam-section"><summary>${q('Authorized students','دانشجویان مجاز')}</summary>${table([q('Name','نام'),q('Student number','شماره دانشجویی')],students.map(s=>[escape(s.full_name),escape(s.student_number)]))}</details><form id="exam-delete" class="form-panel exam-section exam-danger"><h2>${q('Delete exam','حذف امتحان')}</h2><p>${q('This permanently removes the exam, students, groups and submissions. Administrative audit events are retained.','امتحان، دانشجویان، گروه‌ها و ارسال‌ها برای همیشه حذف می‌شوند. رویدادهای مدیریتی حفظ می‌شوند.')}</p>${button(q('Delete exam permanently','حذف دائمی امتحان'))}${message()}</form>`;
    bind('exam-settings',async form=>{await api(base,{method:'PATCH',body:settingsBody(form)});await rerender();});
    bind('exam-status',async()=>{await api(`${base}/status`,{method:'POST',body:{active:!exam.active}});await rerender();});
    bind('exam-reference',async form=>{if(reference&&!confirm(q('Replace the reference and clear current rankings? Groups must resubmit.','مرجع جایگزین و رتبه‌بندی فعلی پاک شود؟ گروه‌ها باید دوباره ارسال کنند.')))return;await api(`${base}/reference`,{method:'POST',body:new FormData(form)});await rerender();});
    bind('exam-delete',async()=>{if(!confirm(q(`Permanently delete “${exam.name}”?`,`امتحان «${exam.name}» برای همیشه حذف شود؟`)))return;await api(base,{method:'DELETE',body:{}});location.href=link();});
    groups.forEach((g,i)=>bind(`group-${i}`,async form=>{const b=Object.fromEntries(new FormData(form));await api(`${base}/groups/${g.id}`,{method:'PATCH',body:{...b,members:splitMembers(b.members)}});await rerender();}));
    bind('exam-import',async(form,status)=>{
      const file=form.elements.file.files[0], payload=new FormData();payload.set('file',file);
      const preview=await api(`${base}/imports/validate`,{method:'POST',body:payload}),container=root.querySelector('#exam-import-preview');
      if(preview.errors.length){status.textContent=q('Fix the following rows and upload again.','ردیف‌های زیر را اصلاح و دوباره بارگذاری کنید.');container.innerHTML=table([q('Excel row','ردیف اکسل'),q('Issue','مشکل')],preview.errors.map(e=>[e.row,escape(errorText(e.code))]));return;}
      status.textContent=q('Validation passed. Review the names and confirm.','بررسی موفق بود. نام‌ها را بازبینی و تأیید کنید.');
      container.innerHTML=`<form id="exam-import-confirm" class="form-panel"><h2>${q('Import preview','پیش‌نمایش ورود')}</h2>${table([q('Name','نام'),q('Student number','شماره دانشجویی')],preview.rows.map(r=>[escape(r.full_name),escape(r.student_number)]))}${button(q(`Confirm ${preview.rows.length} students`,`تأیید ${preview.rows.length} دانشجو`))}${message()}</form>`;
      bind('exam-import-confirm',async(_form,progress)=>{
        // One salted credential per request keeps bulk imports bounded on Workers.
        for(let i=0;i<preview.rows.length;i++){progress.textContent=q(`Preparing ${i+1} / ${preview.rows.length}…`,`آماده‌سازی ${i+1} از ${preview.rows.length}…`);const body=new FormData();body.set('file',file);await api(`${base}/imports/${preview.id}/prepare?position=${i}`,{method:'POST',body});}
        await api(`${base}/imports/${preview.id}/confirm`,{method:'POST',body:{}});await rerender();
      });
    });
  }
}
function splitMembers(value) { return String(value||'').split(/[\s,،;]+/).map(s=>s.trim()).filter(Boolean); }
function localDate(value) { const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16); }
