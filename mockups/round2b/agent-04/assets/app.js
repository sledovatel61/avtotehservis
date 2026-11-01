/* АвтоТехСервис Agent04 — native JS, no external requests */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const toast=(m)=>{const t=$('#toast'); if(!t) return; t.textContent=m; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),2600)}
$('#y')&&( $('#y').textContent=new Date().getFullYear());

/* header/mnav */
const burger=$('#burger'), mnav=$('#mnav');
function toggleM(open){const o=open??!mnav.classList.contains('open'); mnav.classList.toggle('open',o); mnav.setAttribute('aria-hidden',o?'false':'true'); burger.setAttribute('aria-expanded',o?'true':'false'); document.body.style.overflow=o?'hidden':''}
burger&&burger.addEventListener('click',()=>toggleM());
mnav&&mnav.addEventListener('click',e=>{if(e.target.closest('[data-close]')) toggleM(false)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mnav.classList.contains('open')) toggleM(false)});
$$('.mnav__links a').forEach(a=>a.addEventListener('click',()=>toggleM(false)));
/* compact header + sticky */
const header=$('.header'), sticky=$('#sticky');
let lastY=0;
window.addEventListener('scroll',()=>{
  const y=scrollY;
  if(header){ if(y>32) header.classList.add('is-compact'); else header.classList.remove('is-compact');}
  if(sticky){ if(y>420) sticky.classList.add('show'); else sticky.classList.remove('show');}
},{passive:true});
/* toasters demo */
$$('.js-toaster').forEach(el=> el.addEventListener('click',e=>{e.preventDefault(); toast(el.dataset.msg||'Демо')}))
/* reveal on scroll */
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting) e.target.classList.add('in')}),{threshold:.1});
$$('.reveal').forEach(el=> io.observe(el));

/* hero slider - 3 slides, autoplay, arrows dots swipe pause */
(function(){
  const track=$('#heroTrack'); if(!track) return;
  const slides=[...track.querySelectorAll('.hero__slide')], dots=[...$$('.dot')], prev=$('#heroPrev'), next=$('#heroNext');
  let idx=0, timer=null, paused=false;
  const dur=5200;
  function go(i){ idx=(i+slides.length)%slides.length; slides.forEach((s,k)=> s.classList.toggle('is-active',k===idx)); dots.forEach((d,k)=> d.classList.toggle('is-active',k===idx));}
  function start(){ if(matchMedia('(prefers-reduced-motion: reduce)').matches) return; stop(); timer=setInterval(()=>{if(!paused) go(idx+1)},dur)}
  function stop(){clearInterval(timer)}
  prev&&prev.addEventListener('click',()=>{go(idx-1); start()});
  next&&next.addEventListener('click',()=>{go(idx+1); start()});
  dots.forEach((d,k)=> d.addEventListener('click',()=>{go(k); start()}));
  track.addEventListener('mouseenter',()=> paused=true);
  track.addEventListener('mouseleave',()=> paused=false);
  track.addEventListener('focusin',()=> paused=true);
  track.addEventListener('focusout',()=> paused=false);
  let sx=0; track.addEventListener('touchstart',e=> sx=e.touches[0].clientX,{passive:true});
  track.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx; if(Math.abs(dx)>40) go(idx+(dx<0?1:-1)); start()},{passive:true});
  go(0); start();
})();

/* generic carousel */
function initCarousel(root){
  if(!root) return;
  const vp=root.querySelector('.carousel__viewport'), track=root.querySelector('.carousel__track'), prev=root.querySelector('[data-prev]'), next=root.querySelector('[data-next]');
  let idx=0, per=1;
  function calcPer(){ const w=vp.clientWidth; if(w>=900) per=3; else if(w>=640) per=2; else per=1; }
  function maxIdx(){ const items=track.children.length; return Math.max(0, items - per); }
  function update(){ calcPer(); if(idx>maxIdx()) idx=maxIdx(); const gap=12; const itemW=(vp.clientWidth - (per-1)*gap)/per; track.style.transform=`translateX(${-idx*(itemW+gap)}px)`; prev.disabled=idx===0; next.disabled=idx>=maxIdx(); }
  prev&&prev.addEventListener('click',()=>{ idx=Math.max(0,idx-1); update()});
  next&&next.addEventListener('click',()=>{ idx=Math.min(maxIdx(),idx+1); update()});
  let sx=0; vp.addEventListener('touchstart',e=> sx=e.touches[0].clientX,{passive:true});
  vp.addEventListener('touchend',e=>{ const dx=e.changedTouches[0].clientX-sx; if(Math.abs(dx)>40){ if(dx<0) idx=Math.min(maxIdx(),idx+1); else idx=Math.max(0,idx-1); update()}},{passive:true});
  window.addEventListener('resize',update); update();
}
initCarousel($('#svcCarousel')); initCarousel($('#galCarousel')); initCarousel($('#revCarousel'));

/* gallery lightbox */
(function(){
  const lb=$('#lb'); if(!lb) return;
  const lbImg=$('#lbImg'), lbTitle=$('#lbTitle'), lbDesc=$('#lbDesc');
  const cards=[...$$('[data-lb]')];
  const data=cards.map(c=>({t:c.dataset.title||c.querySelector('h3')?.textContent||'', d:c.dataset.desc||'', img:c.dataset.img||''}));
  let cur=0;
  function open(i){ cur=i; const d=data[i]; lbTitle.textContent=d.t; lbDesc.textContent=d.d; lbImg.innerHTML=d.img?`<img src="${d.img}" alt="" style="width:100%;height:100%;object-fit:cover">`:`<div style="width:100%;height:100%;display:grid;place-items:center;background:#F3F4F6;font-weight:800">${d.t}</div>`; lb.classList.add('open'); lb.setAttribute('aria-hidden','false'); document.body.style.overflow='hidden';}
  function close(){ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); document.body.style.overflow='';}
  function nav(dir){ open((cur+dir+data.length)%data.length)}
  cards.forEach((c,i)=> c.addEventListener('click',()=> open(i)));
  lb.addEventListener('click',e=>{if(e.target.closest('[data-close-lb]')) close()});
  $('#lbPrev')?.addEventListener('click',()=> nav(-1)); $('#lbNext')?.addEventListener('click',()=> nav(1));
  document.addEventListener('keydown',e=>{if(!lb.classList.contains('open')) return; if(e.key==='Escape') close(); if(e.key==='ArrowLeft') nav(-1); if(e.key==='ArrowRight') nav(1)});
  let sx=0; lbImg&&lbImg.addEventListener('touchstart',e=> sx=e.touches[0].clientX,{passive:true});
  lbImg&&lbImg.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx; if(Math.abs(dx)>40) nav(dx<0?1:-1)});
  window.__lbClose=close;
})();

/* FAQ */
$('#faqList')?.addEventListener('click',e=>{
  const btn=e.target.closest('.faq-q'); if(!btn) return;
  const item=btn.closest('.faq-item'); const open=item.classList.contains('open');
  item.classList.toggle('open',!open); btn.setAttribute('aria-expanded',!open?'true':'false');
});

/* contacts map lazy - no iframe, just SVG toggle */
$('#loadMapBtn')?.addEventListener('click',()=>{
  const c=$('#mapCanvas'); if(!c) return;
  c.innerHTML='<div style="position:absolute;inset:0;display:grid;place-items:center;background:#fff;border-radius:12px;margin:12px;padding:12px;text-align:center">Карта загружена как SVG-схема — без внешних запросов. Для маршрута используйте кнопки Яндекс / 2ГИС / Google (внешние ссылки открываются отдельно).</div>';
  toast('Схема — без внешних запросов');
});

/* View Transitions fallback */
document.addEventListener('click',e=>{
  const a=e.target.closest('a[href]'); if(!a) return;
  const url=new URL(a.href, location.href);
  if(url.origin!==location.origin) return;
  if(a.target==='_blank') return;
  if(!document.startViewTransition) return;
  // disable for reduced-motion users prefer instant
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // only for internal html navigation
  if(!url.pathname.endsWith('.html') && url.pathname!=='/') return;
  // allow default; API will handle if needed - we keep instant fallback
});

/* ===== Appointment form 5 screens ===== */
(function(){
  const root=$('#appointmentRoot'); if(!root) return;
  const body=$('#formBody'), prog=$('#formProg'), stepLabel=$('#stepLabel'), branchLabel=$('#branchLabel');
  let branch=localStorage.getItem('ats_branch')||'';
  let step=parseInt(localStorage.getItem('ats_step')||'1',10)||1;
  let draft={}; try{draft=JSON.parse(localStorage.getItem('ats_draft')||'{}')}catch{}
  let idem=localStorage.getItem('ats_idem')||(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random());
  localStorage.setItem('ats_idem',idem);
  const brands=["Lada","Kia","Hyundai","Renault","Toyota","Volkswagen","Skoda","Chevrolet","Nissan","Ford","Mazda","BMW","Mercedes-Benz","ГАЗ","УАЗ","Chery","Geely","Haval","Другая"];
  const modelsByBrand={
    "Lada":["Vesta","Granta","Largus","Niva","XRAY","Другая"],
    "Kia":["Rio","Ceed","Sportage","Sorento","Seltos","Другая"],
    "Hyundai":["Solaris","Creta","Tucson","Elantra","Другая"],
    "Renault":["Logan","Duster","Kaptur","Arkana","Другая"],
    "Toyota":["Camry","Corolla","RAV4","LC Prado","Другая"],
    "default":["Модель — не помню","Другая"]
  };
  const servicesGroups={
    "Колёса":["shinomontazh","Шиномонтаж","balansirovka","Балансировка","pravka","Правка/прокатка дисков","porez","Ремонт порезов и грыж","vulkan","Вулканизация","hranenie","Сезонное хранение шин"],
    "ТО и ремонт":["to","ТО и масло","razval","Развал-схождение","hodovaya","Ходовая и тормоза","rulevoe","Рулевые рейки","dvigatel","Двигатель","akpp","АКПП/МКПП","electrik","Автоэлектрика","condition","Кондиционеры","steklo","Замена стёкол","forsunki","Дизельные форсунки"]
  };
  // helpers
  function save(){ try{localStorage.setItem('ats_draft',JSON.stringify(draft)); localStorage.setItem('ats_step',String(step)); localStorage.setItem('ats_branch',branch);}catch(e){/* private mode/file:// may fail — continue without persistence */}}
  function total(){return 5}
  function updateProgress(){ const p=step/total(); if(prog) prog.style.setProperty('--p',p); if(stepLabel) stepLabel.textContent=`Шаг ${step} из ${total()}`; if(branchLabel) branchLabel.textContent=branch? (branch==='wheel'?'Колеса':branch==='repair'?'Ремонт':'Не знаю'):'Авто';}
  function isValidStep(s){
    if(s===1) return !!draft.brand;
    if(s===2) return (draft.services&&draft.services.length>0);
    if(s===3) return !!(draft.preferred_date || draft.asap);
    if(s===4) return !!(draft.phone && draft.phone.replace(/\D/g,'').length===11 && draft.name && draft.name.trim().length>=2 && draft.consent);
    return true;
  }
  function render(){
    updateProgress();
    const nextDisabled = !isValidStep(step);
    // show nav disable state
    // render by step
    if(step===1){
      const b=draft.brand||'', m=draft.model||'', y=draft.year||'', vin=draft.vin||'', mileage=draft.mileage||'';
      const filtered=brands.filter(x=> x.toLowerCase().includes((draft.brandQuery||'').toLowerCase()));
      const models=modelsByBrand[b]||modelsByBrand.default;
      body.innerHTML=`
        <p class="q-title">Авто</p><p class="q-hint">Марка — обязательно. Остальное — по желанию. VIN — 17 знаков без I, O, Q.</p>
        <div class="field"><label for="brandQ">Марка — поиск</label>
          <input class="input" id="brandQ" placeholder="Начните вводить — Lada, Kia, Toyota…" value="${draft.brandQuery||b}" autocomplete="off">
          <div class="chips" id="brandChips" style="margin-top:8px">${filtered.slice(0,12).map(x=>`<button type="button" class="chip-btn ${b===x?'is-active':''}" data-brand="${x}">${x}</button>`).join('')}${!filtered.length?`<span class="hint">Ничего не найдено — выберите «Другая»</span>`:''}</div>
          <span class="err" id="brandErr">Выберите марку</span>
        </div>
        <div class="grid2">
          <div class="field"><label for="modelSel">Модель</label><select class="input" id="modelSel"><option value="">На выбор</option>${models.map(mo=>`<option ${m===mo?'selected':''}>${mo}</option>`).join('')}<option value="__other">Другая (впишу)</option></select><input class="input hidden" id="modelOther" placeholder="Ваша модель" value="${draft.modelOther||''}"></div>
          <div class="field"><label for="yearSel">Год</label><div style="display:flex;gap:8px"><select class="input" id="yearSel"><option value="">Не помню</option>${Array.from({length:47},(_,i)=>2026-i).map(v=>`<option value="${v}" ${String(y)===String(v)?'selected':''}>${v}</option>`).join('')}<option value="1980-1990">1980–1990</option></select><label class="chip-btn" style="align-self:center"><input type="checkbox" id="yearUnknown" ${draft.yearUnknown?'checked':''} hidden> Не помню</label></div></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="vin">VIN (необязательно)</label><div style="display:flex;gap:8px"><input class="input" id="vin" maxlength="17" placeholder="17 знаков, без I,O,Q" value="${vin}" style="text-transform:uppercase; flex:1"> <button type="button" class="btn btn--ghost" id="noVin">Не знаю VIN</button></div><span class="hint">Где найти: СТС, ПТС, под лобовым, на стойке.</span><span class="err" id="vinErr">VIN — 17 символов, без I, O, Q</span></div>
          <div class="field"><label for="mileage">Пробег, км (необязательно)</label><div style="display:flex;gap:8px"><input class="input" id="mileage" inputmode="numeric" placeholder="например, 84000" value="${mileage}"><label class="chip-btn" style="align-self:center"><input type="checkbox" id="mileageUnknown" ${draft.mileageUnknown?'checked':''} hidden> Не знаю</label></div></div>
        </div>
        <div class="form__nav"><button type="button" class="btn btn--ghost" disabled>Назад</button><button type="button" class="btn ${nextDisabled?'btn--ghost':'btn--accent'}" id="next" ${nextDisabled?'disabled':''}>Далее</button></div>`;
      bind1(); return;
    }
    if(step===2){
      const active=new Set(draft.services||[]);
      body.innerHTML=`
        <p class="q-title">Что нужно сделать</p><p class="q-hint">Чипы с явными значениями. Минимум одна услуга или «не знаю — нужна диагностика».</p>
        ${Object.entries(servicesGroups).map(([g,arr])=>`
          <div style="margin-top:12px"><b style="font-size:13px">${g}</b><div class="chips" style="margin-top:8px">${Array.from({length:arr.length/2},(_,i)=>{
            const slug=arr[i*2], label=arr[i*2+1]; const on=active.has(slug);
            return `<button type="button" class="chip-btn ${on?'is-active':''}" data-slug="${slug}">${label}</button>`
          }).join('')}</div></div>
        `).join('')}
        <div style="margin-top:12px"><button type="button" class="chip-btn ${active.has('diagnostika')?'is-active':''}" data-slug="diagnostika">Не знаю — нужна диагностика</button></div>
        <div class="field" style="margin-top:14px"><label>Фото — до 3, с превью</label>
          <input type="file" id="photos" accept="image/*" multiple hidden>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button type="button" class="btn btn--ghost" id="pickPhotos">Выбрать фото</button><span class="hint" id="photoHint">${draft.photos?draft.photos.length+' файл(ов)':''} EXIF GPS удалим на сервере.</span></div>
          <div id="photoPreview" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${(draft.photos||[]).map((p,i)=>`<span class="chip" style="display:inline-flex;gap:8px;align-items:center">${p.name}<button type="button" data-rm="${i}" style="border:0;background:transparent;cursor:pointer">×</button></span>`).join('')}</div>
        </div>
        <span class="err" id="svcErr">Выберите хотя бы одну услугу или «не знаю»</span>
        <div class="form__nav"><button type="button" class="btn btn--ghost" id="prev">Назад</button><button type="button" class="btn ${nextDisabled?'btn--ghost':'btn--accent'}" id="next" ${nextDisabled?'disabled':''}>Далее</button></div>`;
      bind2(); return;
    }
    if(step===3){
      const dates=Array.from({length:14},(_,i)=>{const d=new Date(); d.setDate(d.getDate()+i); return d});
      function fmt(d){ return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}` }
      function wday(d){ return ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d.getDay()]}
      const selDate=draft.preferred_date||'';
      const selSlot=draft.preferred_slot||'';
      const slots=["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"];
      const busy=new Set(["12:00","15:00"]);
      body.innerHTML=`
        <p class="q-title">Когда вам удобно</p><p class="q-hint">Календарь 14 дней, русский формат ДД.ММ.ГГГГ, слоты 09:00–19:00. «Занято» недоступно.</p>
        <div class="field"><label>Дата</label>
          <div class="calendar" id="cal">${dates.map(d=>{const ds=fmt(d); const isActive=selDate===ds; const isWeekend=[0,6].includes(d.getDay()); return `<button type="button" class="day ${isActive?'is-active':''}" data-date="${ds}"><b>${String(d.getDate()).padStart(2,'0')}</b><div style="font-size:11px">${wday(d)}</div><div style="font-size:11px;opacity:.7">${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}</div></button>`}).join('')}</div>
          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap"><button type="button" class="chip-btn ${draft.asap?'is-active':''}" id="asap">Как можно раньше</button><span class="hint">Выбор даты или «как можно раньше» — обязательно.</span></div>
          <span class="err" id="dateErr">Выберите дату или «как можно раньше»</span>
        </div>
        <div class="field"><label>Время — 09:00–19:00, шаг 1 час</label>
          <div class="slots" id="slots">${slots.map(s=>`<button type="button" class="slot ${selSlot===s?'is-active':''} ${busy.has(s)?'is-busy':''}" data-slot="${s}" ${busy.has(s)?'disabled':''}>${s} ${busy.has(s)?'· занято':''}</button>`).join('')}</div>
        </div>
        <div class="form__nav"><button type="button" class="btn btn--ghost" id="prev">Назад</button><button type="button" class="btn ${nextDisabled?'btn--ghost':'btn--accent'}" id="next" ${nextDisabled?'disabled':''}>Далее</button></div>`;
      bind3(); return;
    }
    if(step===4){
      body.innerHTML=`
        <p class="q-title">Контакты</p><p class="q-hint">Телефон с маской +7 (999) 999-99-99. Вставка из буфера не ломает поле.</p>
        <div class="grid2">
          <div class="field"><label for="name">Имя *</label><input class="input" id="name" placeholder="Как к вам обращаться" value="${draft.name||''}" autocomplete="name"><span class="err" id="nameErr">Имя — от 2 букв</span></div>
          <div class="field"><label for="phone">Телефон *</label><input class="input" id="phone" placeholder="+7 (___) ___-__-__" inputmode="tel" value="${draft.phone||''}" autocomplete="tel"><span class="err" id="phoneErr">Нужно 11 цифр</span></div>
        </div>
        <div class="field" style="margin-top:12px"><label>Как связаться</label>
          <div class="chips"><label class="chip-btn ${draft.contact_method!=='telegram'?'is-active':''}"><input type="radio" name="cm" value="call" ${draft.contact_method!=='telegram'?'checked':''} hidden> Звонок</label><label class="chip-btn ${draft.contact_method==='telegram'?'is-active':''}"><input type="radio" name="cm" value="telegram" ${draft.contact_method==='telegram'?'checked':''} hidden> Telegram</label></div>
        </div>
        <div style="margin-top:12px; display:grid; gap:8px; background:#F9FAFB; border:1px solid var(--line); border-radius:12px; padding:12px">
          <label class="choice" style="background:transparent;border:0;padding:0"><input type="checkbox" id="consent" ${draft.consent?'checked':''}> <span style="font-size:13px">Я даю согласие ИП Яковенко П.И. (ИНН 341010400388) на обработку моих данных (телефон, имя, VIN, фото) для обработки заявки. Ознакомлен с <a href="#" data-open-policy>Политикой</a>. <span style="color:var(--err)">*</span></span></label>
          <span class="err" id="consentErr">Отметьте согласие (152-ФЗ)</span>
          <div style="font-size:12px;color:var(--muted)">Чекбокс не предустановлен. Храним 1 год, отозвать — по телефону/e-mail.</div>
        </div>
        <div class="form__nav"><button type="button" class="btn btn--ghost" id="prev">Назад</button><button type="button" class="btn ${nextDisabled?'btn--ghost':'btn--accent'}" id="next" ${nextDisabled?'disabled':''}>Далее</button></div>`;
      bind4(); return;
    }
    if(step===5){
      const payload=buildPayload();
      body.innerHTML=`
        <p class="q-title">Сводка</p><p class="q-hint">Проверьте и нажмите «Отправить». Демо: данные никуда не отправляются.</p>
        <div style="display:grid; gap:10px; background:#F9FAFB; border:1px solid var(--line); border-radius:12px; padding:14px">
          <div><b>Авто:</b> ${payload.car.brand||'—'} ${payload.car.model||''} ${payload.car.year||''} ${payload.car.vin? '· VIN '+payload.car.vin.slice(0,6)+'***':''} ${payload.car.mileage? '· пробег '+payload.car.mileage+' км':''}</div>
          <div><b>Услуги:</b> ${payload.services.join(', ')||'—'}</div>
          <div><b>Когда:</b> ${payload.preferred.asap?'Как можно раньше': (payload.preferred.date+' '+payload.preferred.slot)}</div>
          <div><b>Контакты:</b> ${payload.name}, ${payload.phone} · ${payload.contact_method==='telegram'?'Telegram':'звонок'}</div>
        </div>
        <div class="form__nav"><button type="button" class="btn btn--ghost" id="prev">Назад</button><button type="button" class="btn btn--accent" id="submit">Отправить — не потеряем</button><button type="button" class="btn btn--ghost" id="payloadBtn">Что уйдёт на сервер</button></div>
        <div style="font-size:12px; color:var(--muted); margin-top:8px">Демо: данные никуда не отправляются. Токен бота и пароль почты — только в переменных окружения.</div>
        <pre class="payload hidden" id="payloadPre">${JSON.stringify(payload,null,2)}</pre>
        <div id="result" class="hidden" style="margin-top:12px; background:#ECFDF3; border:1px solid #ABEFC6; border-radius:12px; padding:14px">
          <b>Заявка <span id="ticket"></span> принята</b> — статус accepted
          <div style="margin-top:8px; font-size:13px; color:var(--muted)">Что дальше: приезжайте к 9:00–19:00 на Портовая, 439, 1 этаж, база «Бум». Возьмите СТС/ПТС, ключи. Перезвоним за 5 мин в рабочее время. Сохраните номер.</div>
          <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap"><a href="contacts.html" class="btn btn--ghost">Маршрут</a><a href="tel:+79289065700" class="btn btn--dark">Позвонить</a></div>
        </div>
        <div id="errBox" class="hidden" style="margin-top:12px; background:#FEF3F2; border:1px solid #FECDC5; border-radius:12px; padding:14px"><b>Не отправилось — сеть</b><div style="font-size:13px">Данные сохранены, повторите. Идемпотентность не даст дубля.</div><button type="button" class="btn btn--ghost" id="retry" style="margin-top:8px">Попробовать снова</button></div>
      `;
      bind5(); return;
    }
  }
  function bind1(){
    const q=$('#brandQ');
    q && q.addEventListener('input',()=>{ draft.brandQuery=q.value; // save query, filter
      const filtered=brands.filter(x=> x.toLowerCase().includes((q.value||'').toLowerCase()));
      const chipsEl=$('#brandChips'); if(chipsEl) chipsEl.innerHTML=filtered.slice(0,12).map(x=>`<button type="button" class="chip-btn ${draft.brand===x?'is-active':''}" data-brand="${x}">${x}</button>`).join('') + (!filtered.length?`<span class="hint">Ничего не найдено — выберите «Другая»</span>`:'');
      save();
    });
    $$('#brandChips .chip-btn').forEach(b=> b.addEventListener('click',()=>{ draft.brand=b.dataset.brand; draft.brandQuery=b.dataset.brand; save(); render();}));
    $('#modelSel')?.addEventListener('change',e=>{
      if(e.target.value==='__other'){ $('#modelOther').classList.remove('hidden'); draft.model='Другая'; } else {draft.model=e.target.value; draft.modelOther='';} save(); render();
    });
    $('#modelOther')?.addEventListener('input',e=>{draft.modelOther=e.target.value; draft.model=e.target.value; save();});
    $('#yearSel')?.addEventListener('change',e=>{ draft.year=e.target.value; draft.yearUnknown=false; $('#yearUnknown').checked=false; save(); render();});
    $('#yearUnknown')?.addEventListener('change',e=>{ draft.yearUnknown=e.target.checked; if(e.target.checked) draft.year=''; save(); render();});
    $('#vin')?.addEventListener('input',e=>{ let v=e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g,'').slice(0,17); e.target.value=v; if(v&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)){ e.target.classList.add('is-invalid'); $('#vinErr')?.classList.add('show');} else {e.target.classList.remove('is-invalid'); $('#vinErr')?.classList.remove('show');} draft.vin=v; save();});
    $('#noVin')?.addEventListener('click',()=>{ draft.vin=''; save(); step=2; save(); render();});
    $('#mileage')?.addEventListener('input',e=>{ let v=e.target.value.replace(/\D/g,'').slice(0,6); e.target.value=v; draft.mileage=v?parseInt(v,10):''; draft.mileageUnknown=false; save();});
    $('#mileageUnknown')?.addEventListener('change',e=>{ draft.mileageUnknown=e.target.checked; if(e.target.checked) draft.mileage=''; save(); render();});
    $('#next')?.addEventListener('click',()=>{ if(!draft.brand){ $('#brandErr').classList.add('show'); toast('Выберите марку'); return;} // VIN validate if present
      if(draft.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(draft.vin)){ $('#vinErr').classList.add('show'); toast('VIN — 17 без I,O,Q'); return;} step=2; save(); render();});
  }
  function bind2(){
    $$('.chip-btn[data-slug]').forEach(b=> b.addEventListener('click',()=>{
      const s=b.dataset.slug; let arr=new Set(draft.services||[]);
      if(arr.has(s)) arr.delete(s); else arr.add(s);
      draft.services=[...arr]; save(); render();
    }));
    $('#pickPhotos')?.addEventListener('click',()=> $('#photos').click());
    $('#photos')?.addEventListener('change',e=>{
      const files=[...e.target.files].slice(0,3); draft.photos=files.map(f=>({name:f.name, size:f.size})); save(); render();
    });
    $('#photoPreview')?.addEventListener('click',e=>{
      const btn=e.target.closest('[data-rm]'); if(!btn) return; const idx=parseInt(btn.dataset.rm,10); draft.photos.splice(idx,1); save(); render();
    });
    $('#prev')?.addEventListener('click',()=>{step=1; save(); render();});
    $('#next')?.addEventListener('click',()=>{
      if(!draft.services||!draft.services.length){ $('#svcErr').classList.add('show'); toast('Выберите услугу или «не знаю»'); return;}
      step=3; save(); render();
    });
  }
  function bind3(){
    $$('#cal .day').forEach(b=> b.addEventListener('click',()=>{
      $$('#cal .day').forEach(x=> x.classList.remove('is-active')); b.classList.add('is-active');
      draft.preferred_date=b.dataset.date; draft.asap=false; save(); render();
    }));
    $('#asap')?.addEventListener('click',()=>{ draft.asap=!draft.asap; if(draft.asap) draft.preferred_date=''; save(); render();});
    $$('#slots .slot').forEach(b=> b.addEventListener('click',()=>{ $$('#slots .slot').forEach(x=> x.classList.remove('is-active')); b.classList.add('is-active'); draft.preferred_slot=b.dataset.slot; save(); render();}));
    $('#prev')?.addEventListener('click',()=>{step=2; save(); render();});
    $('#next')?.addEventListener('click',()=>{
      if(!draft.preferred_date && !draft.asap){ $('#dateErr').classList.add('show'); toast('Выберите дату или «как можно раньше»'); return;}
      step=4; save(); render();
    });
  }
  function bind4(){
    const phone=$('#phone');
    function format(v){
      let d=v.replace(/\D/g,''); if(d.startsWith('8')) d='7'+d.slice(1); if(d&&!d.startsWith('7')) d='7'+d; d=d.slice(0,11);
      let out='+7'; if(d.length>1) out+=' ('+d.slice(1,4); if(d.length>=4) out+=') '+d.slice(4,7); if(d.length>=7) out+='-'+d.slice(7,9); if(d.length>=9) out+='-'+d.slice(9,11);
      return d.length?out:'';
    }
    phone&&phone.addEventListener('input',()=>{ phone.value=format(phone.value); draft.phone=phone.value; save(); phone.classList.remove('is-invalid'); $('#phoneErr')?.classList.remove('show')});
    phone&&phone.addEventListener('paste',e=>{ e.preventDefault(); const t=(e.clipboardData||window.clipboardData).getData('text'); phone.value=format(t); draft.phone=phone.value; save();});
    $('#name')?.addEventListener('input',e=>{draft.name=e.target.value; save(); $('#nameErr')?.classList.remove('show'); e.target.classList.remove('is-invalid')});
    $$('input[name="cm"]').forEach(r=> r.addEventListener('change',()=>{ draft.contact_method=r.value; save(); render();}));
    $('#consent')?.addEventListener('change',e=>{draft.consent=e.target.checked; save(); render();});
    // chips cm visual
    $$('.chip-btn').forEach(c=> c.addEventListener('click',()=>{
      const inp=c.querySelector('input'); if(!inp) return; inp.checked=true; draft.contact_method=inp.value; save(); render();
    }));
    $('#prev')?.addEventListener('click',()=>{step=3; save(); render();});
    $('#next')?.addEventListener('click',()=>{
      let ok=true;
      if(!draft.name||draft.name.trim().length<2){ $('#nameErr').classList.add('show'); $('#name').classList.add('is-invalid'); ok=false}
      const d=(draft.phone||'').replace(/\D/g,''); if(d.length!==11){ $('#phoneErr').classList.add('show'); $('#phone').classList.add('is-invalid'); ok=false}
      if(!draft.consent){ $('#consentErr').classList.add('show'); ok=false}
      if(!ok){ toast('Проверьте имя, телефон и согласие'); return;}
      step=5; save(); render();
    });
  }
  function buildPayload(){
    const services=(draft.services||[]).map(s=> s);
    const car={brand:draft.brand||null, model:draft.model||draft.modelOther||null, year:draft.year?parseInt(draft.year,10):null, vin:draft.vin||null, mileage:draft.mileage?parseInt(draft.mileage,10):null};
    return {name:draft.name||'', phone:(draft.phone||'').replace(/\D/g,'').replace(/^7/,'+7')||draft.phone||'', contact_method:draft.contact_method||'call', car, services, preferred:{date:draft.preferred_date? draft.preferred_date.split('.').reverse().join('-'):null, slot:draft.preferred_slot||null, asap:!!draft.asap}, photos_count:(draft.photos||[]).length, consent:!!draft.consent, page:'appointment', idempotency_key:idem};
  }
  function bind5(){
    $('#prev')?.addEventListener('click',()=>{step=4; save(); render();});
    $('#payloadBtn')?.addEventListener('click',()=>{ const pre=$('#payloadPre'); pre.classList.toggle('hidden')});
    $('#submit')?.addEventListener('click',()=>{
      const btn=$('#submit'); btn.textContent='Отправляем…'; btn.disabled=true;
      // simulate 700-1200ms
      setTimeout(()=>{
        // 12% error simulation
        if(Math.random()<0.12){ $('#errBox').classList.remove('hidden'); btn.textContent='Отправить — не потеряем'; btn.disabled=false; return;}
        const ticket='ATS-'+Math.floor(1000+Math.random()*9000);
        $('#ticket').textContent=ticket; $('#result').classList.remove('hidden'); btn.textContent='Отправлено'; 
        // store offline queue demo
        try{ const q=JSON.parse(localStorage.getItem('ats_queue')||'[]'); q.push({ticket, payload:buildPayload(), at:new Date().toISOString()}); localStorage.setItem('ats_queue',JSON.stringify(q)); localStorage.setItem('ats_idem',crypto.randomUUID?crypto.randomUUID():String(Date.now()));}catch{}
        toast('Заявка '+ticket+' — идемпотентность ок');
      }, 800+Math.random()*400);
    });
    $('#retry')?.addEventListener('click',()=>{ $('#errBox').classList.add('hidden'); $('#submit').textContent='Отправить — не потеряем'; $('#submit').disabled=false;});
  }
  // policy modal
  const policyModal=$('#policyModal');
  document.addEventListener('click',e=>{
    if(e.target.closest('[data-open-policy]')){ e.preventDefault(); policyModal.classList.add('open'); policyModal.setAttribute('aria-hidden','false');}
    if(e.target.closest('[data-close-policy]')){ policyModal.classList.remove('open'); policyModal.setAttribute('aria-hidden','true');}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&policyModal.classList.contains('open')){policyModal.classList.remove('open');}});

  render();
  // expose for debug
  window.__atsDraft=draft;
})();
