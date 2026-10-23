/* Мастер записи из 5 экранов — перенос утверждённой логики (122 jsdom-теста) на реальное API:
   GET /api/slots, POST /api/uploads, POST /api/leads. Черновик в localStorage, идемпотентность,
   ошибки под полями с фокусом на первое, состояния отправка/успех/ошибка, .ics на клиенте. */
import { $, $$, safeLS, track, attachMask, attachVin, reducedMotion } from './lib.ts';

const wizEl = $('#wiz');
if (wizEl) {
  const wiz: HTMLElement = wizEl;
  const DRAFT_KEY = 'ats_wiz_draft_v2';
  const CONSENT_VERSION = wiz.getAttribute('data-consent-version') ?? '';
  const PRESELECT = wiz.getAttribute('data-preselect') ?? '';
  const BRANDS: string[] = (() => {
    try {
      const el = $('#brands-data');
      return el ? (JSON.parse(el.textContent ?? '[]') as string[]) : [];
    } catch { return []; }
  })();
  const VIN_OK = /^[A-HJ-NPR-Z0-9]{17}$/;
  const MIN_YEAR = 1980, MAX_YEAR = 2026;

  interface PhotoItem { id: string | null; url: string; name: string; state: 'uploading' | 'done' | 'error' }
  interface St {
    brand: string; model: string; year: string; yearSkip: boolean;
    vin: string; vinSkip: boolean; mileage: string; milSkip: boolean;
    services: string[]; dontknow: boolean; photos: PhotoItem[];
    date: string | null; slot: string | null; asap: boolean;
    name: string; phone: string; channel: 'call' | 'telegram'; consent: boolean;
    step: number; idem: string; startedAt: number; lastTicket: string | null;
  }

  const uuid = (): string =>
    (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }));

  function freshSt(): St {
    return {
      brand: '', model: '', year: '', yearSkip: false, vin: '', vinSkip: false, mileage: '', milSkip: false,
      services: [], dontknow: false, photos: [],
      date: null, slot: null, asap: false,
      name: '', phone: '', channel: 'call', consent: false,
      step: 1, idem: uuid(), startedAt: Date.now(), lastTicket: null,
    };
  }
  let st = freshSt();

  /* ---------- элементы ---------- */
  const bar = $('#wiz-bar i') ?? $('#wiz-bar');
  const stepLabel = $('#wiz-step-label');
  const wizCount = $('#wiz-count');
  const steps = $$('.step', wiz);
  const backBtn = $<HTMLButtonElement>('#wiz-back');
  const nextBtn = $<HTMLButtonElement>('#wiz-next');
  const submitBtn = $<HTMLButtonElement>('#wiz-submit');
  const STEP_NAMES = ['Автомобиль', 'Что нужно сделать', 'Когда удобно', 'Контакты', 'Проверка и отправка'];

  const fBrand = $<HTMLInputElement>('#f-brand');
  const fModel = $<HTMLInputElement>('#f-model');
  const fYear = $<HTMLInputElement>('#f-year');
  const fVin = $<HTMLInputElement>('#f-vin');
  const fMileage = $<HTMLInputElement>('#f-mileage');
  const fName = $<HTMLInputElement>('#f-name');
  const fPhone = $<HTMLInputElement>('#f-phone');
  const fConsent = $<HTMLInputElement>('#f-consent');
  const hp = $<HTMLInputElement>('#hp-website');

  /* ---------- ошибки под полями ---------- */
  function fieldOf(input: HTMLElement | null): HTMLElement | null {
    return input ? input.closest('.field') : null;
  }
  function setErr(input: HTMLElement | null, msg: string): void {
    const f = fieldOf(input);
    if (!f) return;
    const span = $('.err', f);
    if (span) span.textContent = msg;
    if (msg) {
      input?.setAttribute('aria-invalid', 'true');
      if (span?.id) input?.setAttribute('aria-describedby', span.id);
    } else {
      input?.removeAttribute('aria-invalid');
    }
  }
  function setErrAt(anchorId: string, msg: string): void {
    const span = $(`#${anchorId} .err`) ?? $(`#${anchorId}`);
    if (span) span.textContent = msg;
  }
  function clearErrs(): void {
    $$('.err', wiz).forEach((e) => { e.textContent = ''; });
    $$('[aria-invalid]', wiz).forEach((e) => e.removeAttribute('aria-invalid'));
  }

  /* ---------- шаги ---------- */
  function goStep(n: number): void {
    st.step = Math.min(5, Math.max(1, n));
    steps.forEach((s) => {
      const sn = Number(s.getAttribute('data-step'));
      s.classList.toggle('is-on', sn === st.step);
      s.setAttribute('aria-hidden', sn === st.step ? 'false' : 'true');
      $$('a[href],button,input,select,textarea', s).forEach((el) => { el.tabIndex = sn === st.step ? 0 : -1; });
    });
    if (bar) bar.style.transform = `scaleX(${(st.step - 1) / 4})`;
    if (stepLabel) stepLabel.textContent = STEP_NAMES[st.step - 1];
    if (wizCount) wizCount.textContent = `Шаг ${st.step} из 5`;
    if (backBtn) backBtn.classList.toggle('u-invisible', st.step === 1);
    if (nextBtn) nextBtn.classList.toggle('u-none', st.step === 5);
    if (submitBtn) submitBtn.classList.toggle('u-none', st.step !== 5);
    if (st.step === 5) renderSummary();
    track('step_view', { step: st.step });
    saveDraftSoon();
    try { wiz.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' }); } catch { /* ignore */ }
  }

  /* ---------- шаг 1: авто ---------- */
  function syncSkips(): void {
    const pairs: [HTMLInputElement | null, HTMLInputElement | null, HTMLElement | null, string, string][] = [
      [$<HTMLInputElement>('#skip-year'), fYear, $('#year-hint'), 'Год не указан — мастер уточнит при осмотре', 'например, 2019'],
      [$<HTMLInputElement>('#skip-vin'), fVin, $('#vin-hint'), 'VIN не указан — не обязательно', '17 символов, без I, O, Q'],
      [$<HTMLInputElement>('#skip-mileage'), fMileage, $('#mil-hint'), 'Пробег не указан — не обязательно', 'километры, цифрами'],
    ];
    for (const [skip, input, hint, offText, onText] of pairs) {
      if (!skip || !input) continue;
      if (skip.checked) {
        input.disabled = true; input.value = '';
        input.setAttribute('aria-disabled', 'true');
        if (hint) hint.textContent = offText;
        skip.closest('.field')?.classList.add('is-skipped');
      } else {
        input.disabled = false;
        input.removeAttribute('aria-disabled');
        if (hint) hint.textContent = input.dataset.hintDefault ?? onText;
        skip.closest('.field')?.classList.remove('is-skipped');
      }
    }
  }
  for (const id of ['#skip-year', '#skip-vin', '#skip-mileage']) {
    $(id)?.addEventListener('change', () => { syncSkips(); saveDraftSoon(); });
  }
  if (fVin) attachVin(fVin, $('#vin-hint'));
  fBrand?.addEventListener('input', () => { st.brand = fBrand.value; renderSugg(); saveDraftSoon(); });
  fModel?.addEventListener('input', () => { st.model = fModel.value; saveDraftSoon(); });
  fYear?.addEventListener('input', () => { st.year = fYear.value.replace(/\D/g, '').slice(0, 4); fYear.value = st.year; saveDraftSoon(); });
  fVin?.addEventListener('input', () => { st.vin = fVin.value; saveDraftSoon(); });
  fMileage?.addEventListener('input', () => { st.mileage = fMileage.value.replace(/\D/g, '').slice(0, 7); fMileage.value = st.mileage; saveDraftSoon(); });

  /* поиск марки (топ-20 из настроек + свободный ввод + «другая») */
  const sugg = $('#brand-sugg');
  function renderSugg(): void {
    if (!sugg || !fBrand) return;
    const q = fBrand.value.trim().toLowerCase();
    if (!q) { sugg.classList.remove('is-on'); sugg.innerHTML = ''; return; }
    const hits = BRANDS.filter((b) => b.toLowerCase().includes(q)).slice(0, 6);
    sugg.innerHTML = hits.map((b) => `<button type="button" data-b="${b.replace(/"/g, '&quot;')}">${b.replace(/</g, '&lt;')}</button>`).join('')
      + `<button type="button" data-b="${fBrand.value.replace(/"/g, '&quot;')}" class="other">Другая марка: «${fBrand.value.replace(/</g, '&lt;')}»</button>`;
    sugg.classList.add('is-on');
  }
  sugg?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-b]') as HTMLButtonElement | null;
    if (!b || !fBrand) return;
    e.stopPropagation();
    fBrand.value = b.dataset.b ?? '';
    st.brand = fBrand.value;
    sugg.classList.remove('is-on');
    saveDraftSoon();
  });
  document.addEventListener('click', (e) => {
    if (sugg && !sugg.contains(e.target as Node) && e.target !== fBrand) sugg.classList.remove('is-on');
  });

  /* ---------- шаг 2: услуги + фото ---------- */
  const chips = $('#svc-chips');
  chips?.addEventListener('change', (e) => {
    const cb = e.target as HTMLInputElement;
    if (cb.id === 'svc-dontknow') {
      st.dontknow = cb.checked;
      if (cb.checked) {
        $$('input[name="svc"]', chips).forEach((x) => { (x as HTMLInputElement).checked = false; });
        st.services = [];
      }
    } else if (cb.name === 'svc') {
      if (cb.checked) {
        if (!st.services.includes(cb.value)) st.services.push(cb.value);
        const dk = $<HTMLInputElement>('#svc-dontknow', chips);
        if (dk) { dk.checked = false; st.dontknow = false; }
      } else {
        st.services = st.services.filter((s) => s !== cb.value);
      }
    }
    setErrAt('svc-err-anchor', '');
    saveDraftSoon();
  });
  function restoreChips(): void {
    if (!chips) return;
    $$<HTMLInputElement>('input[name="svc"]', chips).forEach((x) => { x.checked = st.services.includes(x.value); });
    const dk = $<HTMLInputElement>('#svc-dontknow', chips);
    if (dk) dk.checked = st.dontknow;
  }

  const photosBox = $('#photos');
  const fPhotos = $<HTMLInputElement>('#f-photos');
  fPhotos?.addEventListener('change', () => {
    const files = Array.from(fPhotos.files ?? []);
    for (const f of files) {
      if (st.photos.length >= 3) break;
      addPhoto(f);
    }
    fPhotos.value = '';
  });
  function renderPhotos(): void {
    if (!photosBox) return;
    photosBox.innerHTML = st.photos.map((p, i) => `
      <figure class="photo${p.state === 'error' ? ' photo--error' : ''}" data-i="${i}">
        <img src="${p.url}" alt="Фото ${i + 1}: ${p.name.replace(/"/g, '&quot;')}">
        <figcaption>${p.state === 'uploading' ? '<span class="spinner" aria-hidden="true"></span> Загрузка…' : p.state === 'error' ? 'Ошибка — нажмите, чтобы убрать' : p.name.replace(/</g, '&lt;')}</figcaption>
        <button type="button" class="photo-x" aria-label="Удалить фото ${i + 1}">✕</button>
      </figure>`).join('');
    if (fPhotos) fPhotos.parentElement?.classList.toggle('is-full', st.photos.length >= 3);
  }
  function addPhoto(file: File): void {
    if (file.size > 15 * 1024 * 1024) {
      st.photos.push({ id: null, url: URL.createObjectURL(file), name: `${file.name} — больше 15 МБ`, state: 'error' });
      renderPhotos(); return;
    }
    if (/^image\/svg/i.test(file.type)) {
      st.photos.push({ id: null, url: URL.createObjectURL(file), name: `${file.name} — SVG не принимается`, state: 'error' });
      renderPhotos(); return;
    }
    const item: PhotoItem = { id: null, url: URL.createObjectURL(file), name: file.name, state: 'uploading' };
    st.photos.push(item);
    renderPhotos();
    const fd = new FormData();
    fd.append('file', file);
    fetch('/api/uploads', { method: 'POST', body: fd })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ok || !j.id) { item.state = 'error'; item.name = `${file.name} — не загрузилось`; }
        else { item.state = 'done'; item.id = String(j.id); URL.revokeObjectURL(item.url); item.url = String(j.url); }
      })
      .catch(() => { item.state = 'error'; item.name = `${file.name} — нет связи`; })
      .finally(() => { renderPhotos(); saveDraftSoon(); });
  }
  photosBox?.addEventListener('click', (e) => {
    const x = (e.target as HTMLElement).closest('.photo-x');
    const fig = (e.target as HTMLElement).closest('figure.photo');
    if (x && fig) {
      st.photos.splice(Number(fig.getAttribute('data-i')), 1);
      renderPhotos(); saveDraftSoon();
    } else if (fig && fig.classList.contains('photo--error')) {
      st.photos.splice(Number(fig.getAttribute('data-i')), 1);
      renderPhotos();
    }
  });

  /* ---------- шаг 3: дата и слоты ---------- */
  const cal = $('#cal');
  const slotsBox = $('#slots');
  const slotTitle = $('#slot-title');
  const asapBtn = $<HTMLButtonElement>('#asap-btn');
  const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function localDay(offset: number): { iso: string; d: Date } {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { iso, d };
  }
  function renderCal(): void {
    if (!cal) return;
    cal.innerHTML = Array.from({ length: 14 }).map((_, i) => {
      const { iso, d } = localDay(i);
      const on = st.date === iso;
      return `<button type="button" class="cal-day${on ? ' is-on' : ''}" data-date="${iso}" aria-pressed="${on}">
        <span class="wd">${WD[d.getDay()]}</span><span class="dd">${d.getDate()}</span><span class="mm">${MON[d.getMonth()]}</span>
      </button>`;
    }).join('');
  }
  cal?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-date]');
    if (!b) return;
    st.date = b.getAttribute('data-date');
    st.asap = false;
    asapBtn?.classList.remove('is-on');
    asapBtn?.setAttribute('aria-pressed', 'false');
    renderCal();
    void loadSlots();
    setErrAt('when-err-anchor', '');
    saveDraftSoon();
  });
  async function loadSlots(): Promise<void> {
    if (!slotsBox || !st.date) return;
    slotsBox.innerHTML = '<p class="hint">Загружаем свободное время…</p>';
    if (slotTitle) slotTitle.textContent = 'Время визита — выберите дату';
    try {
      const r = await fetch(`/api/slots?date=${st.date}`);
      const j = await r.json() as { slots?: { time: string; available: boolean; reason?: string }[] };
      renderSlots(j.slots ?? []);
    } catch {
      slotsBox.innerHTML = '<p class="hint">Не удалось получить расписание. Повторите попытку или позвоните нам.</p>';
    }
  }
  function renderSlots(slots: { time: string; available: boolean; reason?: string }[]): void {
    if (!slotsBox) return;
    slotsBox.innerHTML = slots.map((s) => {
      const on = st.slot === s.time && st.date;
      return `<button type="button" class="slot${on ? ' is-on' : ''}" data-slot="${s.time}"${s.available ? '' : ' disabled'} aria-label="${s.time}${s.available ? '' : ` — ${s.reason ?? 'занято'}`}">${s.time}</button>`;
    }).join('');
    if (slotTitle) slotTitle.textContent = `Время визита на ${st.date ? st.date.split('-').reverse().join('.') : ''}`;
  }
  slotsBox?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-slot]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    st.slot = b.getAttribute('data-slot');
    st.asap = false;
    asapBtn?.classList.remove('is-on');
    asapBtn?.setAttribute('aria-pressed', 'false');
    $$('.slot', slotsBox).forEach((x) => x.classList.remove('is-on'));
    b.classList.add('is-on');
    setErrAt('when-err-anchor', '');
    saveDraftSoon();
  });
  asapBtn?.addEventListener('click', () => {
    st.asap = !st.asap;
    if (st.asap) { st.date = null; st.slot = null; renderCal(); if (slotsBox) slotsBox.innerHTML = '<p class="hint">Приедем к ближайшему свободному времени — перезвоним и согласуем.</p>'; if (slotTitle) slotTitle.textContent = 'Время визита'; }
    else { if (slotsBox) slotsBox.innerHTML = '<p class="hint">Выберите дату на ленте выше.</p>'; }
    asapBtn.classList.toggle('is-on', st.asap);
    asapBtn.setAttribute('aria-pressed', String(st.asap));
    setErrAt('when-err-anchor', '');
    saveDraftSoon();
  });

  /* ---------- шаг 4: контакты ---------- */
  if (fPhone) attachMask(fPhone);
  fName?.addEventListener('input', () => { st.name = fName.value; setErr(fName, ''); saveDraftSoon(); });
  fPhone?.addEventListener('input', () => { st.phone = fPhone.value; setErr(fPhone, ''); saveDraftSoon(); });
  fConsent?.addEventListener('change', () => { st.consent = fConsent.checked; setErr(fConsent, ''); saveDraftSoon(); });
  $$<HTMLInputElement>('input[name="channel"]', wiz).forEach((r) => {
    r.addEventListener('change', () => { if (r.checked) st.channel = r.value as 'call' | 'telegram'; saveDraftSoon(); });
  });

  /* ---------- валидация шагов ---------- */
  function validateStep(n: number, show: boolean): HTMLElement | null {
    let firstBad: HTMLElement | null = null;
    const bad = (el: HTMLElement | null, msg: string): void => {
      if (show) setErr(el, msg);
      if (!firstBad && el) firstBad = el;
    };
    if (n === 1) {
      if (fBrand && fBrand.value.trim().length < 2) bad(fBrand, 'Укажите марку — начните вводить или выберите из списка');
      const yearSkip = $<HTMLInputElement>('#skip-year')?.checked;
      if (fYear && !yearSkip && fYear.value) {
        const y = Number(fYear.value);
        if (!Number.isInteger(y) || y < MIN_YEAR || y > MAX_YEAR) bad(fYear, `Год выпуска: ${MIN_YEAR}–${MAX_YEAR} или отметьте «не помню»`);
      }
      const vinSkip = $<HTMLInputElement>('#skip-vin')?.checked;
      if (fVin && !vinSkip && fVin.value && !VIN_OK.test(fVin.value)) bad(fVin, 'VIN: 17 символов, латиница и цифры без I, O, Q');
      const milSkip = $<HTMLInputElement>('#skip-mileage')?.checked;
      if (fMileage && !milSkip && fMileage.value) {
        const m = Number(fMileage.value);
        if (!Number.isInteger(m) || m < 0 || m > 2000000) bad(fMileage, 'Пробег: число от 0 до 2 000 000 км');
      }
    }
    if (n === 2) {
      if (st.services.length === 0 && !st.dontknow) {
        setErrAt('svc-err-anchor', 'Отметьте хотя бы одну услугу или «Не знаю — нужна диагностика»');
        if (!firstBad) firstBad = chips ?? null;
      }
      if (st.photos.some((p) => p.state === 'uploading')) {
        setErrAt('svc-err-anchor', 'Дождитесь окончания загрузки фото или удалите их');
        if (!firstBad) firstBad = photosBox ?? null;
      }
    }
    if (n === 3) {
      if (!st.asap && !(st.date && st.slot)) {
        setErrAt('when-err-anchor', 'Выберите дату и время или нажмите «Как можно скорее»');
        if (!firstBad) firstBad = cal ?? null;
      }
    }
    if (n === 4) {
      if (fName && fName.value.trim().length < 2) bad(fName, 'Укажите имя');
      const digits = (fPhone?.value ?? '').replace(/\D/g, '');
      if (digits.length !== 11) bad(fPhone, 'Телефон: +7 (999) 999-99-99');
      if (fConsent && !fConsent.checked) bad(fConsent, 'Без согласия на обработку данных отправить нельзя');
    }
    if (!firstBad) { if (n === 2) setErrAt('svc-err-anchor', ''); if (n === 3) setErrAt('when-err-anchor', ''); }
    return firstBad;
  }

  /* ---------- сводка ---------- */
  function summaryRows(): { label: string; value: string; step: number }[] {
    const car = [st.brand, st.model, st.year ? `${st.year} г.` : '', st.mileage && !st.milSkip ? `${Number(st.mileage).toLocaleString('ru-RU')} км` : '', st.vin && !st.vinSkip ? `VIN ${st.vin}` : ''].filter(Boolean).join(', ');
    const chipLabels = new Map($$<HTMLInputElement>('input[name="svc"]', wiz).map((i) => [i.value, i.closest('.chip')?.querySelector('span')?.textContent ?? i.value]));
    const svc = st.dontknow ? 'Не знаю — нужна диагностика' : st.services.map((s) => chipLabels.get(s) ?? s).join(', ');
    const when = st.asap ? 'Как можно скорее' : `${st.date ? st.date.split('-').reverse().join('.') : ''}, ${st.slot ?? ''}`;
    return [
      { label: 'Автомобиль', value: car || '—', step: 1 },
      { label: 'Услуги', value: svc || '—', step: 2 },
      { label: 'Фото', value: st.photos.length ? `${st.photos.filter((p) => p.state === 'done').length} файл(ов)` : 'не прикрепляли', step: 2 },
      { label: 'Когда', value: when, step: 3 },
      { label: 'Имя и телефон', value: `${st.name}, ${st.phone}`, step: 4 },
      { label: 'Связь', value: st.channel === 'telegram' ? 'Написать в Telegram' : 'Позвонить', step: 4 },
    ];
  }
  function renderSummary(): void {
    const box = $('#summary .sum-list') ?? $('#summary');
    if (!box) return;
    box.innerHTML = summaryRows().map((r) => `
      <div class="sum-row">
        <span class="sum-label">${r.label}</span>
        <span class="sum-value">${r.value.replace(/</g, '&lt;')}</span>
        <button type="button" class="linklike" data-gostep="${r.step}">изменить</button>
      </div>`).join('');
  }
  $('#summary')?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-gostep]');
    if (b) { clearErrs(); goStep(Number(b.getAttribute('data-gostep'))); track('step_edit', { step: st.step }); }
  });

  /* ---------- payload-панель ---------- */
  function buildPayload(): Record<string, unknown> {
    return {
      name: st.name.trim(),
      phone: st.phone.replace(/\D/g, '').replace(/^8/, '7'),
      contact_method: st.channel,
      car: {
        brand: st.brand.trim(), model: st.model.trim() || null,
        year: st.yearSkip || !st.year ? null : Number(st.year),
        vin: st.vinSkip || !st.vin ? null : st.vin,
        mileage: st.milSkip || !st.mileage ? null : Number(st.mileage),
      },
      services: st.dontknow ? ['diagnostika'] : [...st.services],
      preferred: { date: st.asap ? null : st.date, slot: st.asap ? null : st.slot, asap: st.asap },
      photos: st.photos.filter((p) => p.state === 'done' && p.id).map((p) => p.id),
      consent: st.consent,
      consent_version: CONSENT_VERSION,
      page: 'appointment',
      idempotency_key: st.idem,
      honeypot: hp?.value ?? '',
      form_started_at: st.startedAt,
    };
  }
  const payloadBtn = $('#payload-btn');
  const payloadPre = $('#payload-pre');
  payloadBtn?.addEventListener('click', () => {
    const open = payloadBtn.getAttribute('aria-expanded') === 'true';
    payloadBtn.setAttribute('aria-expanded', String(!open));
    payloadBtn.closest('.payload')?.classList.toggle('is-open', !open);
    if (!open && payloadPre) { payloadPre.textContent = JSON.stringify(buildPayload(), null, 2); track('payload_view'); }
  });

  /* ---------- навигация ---------- */
  nextBtn?.addEventListener('click', () => {
    clearErrs();
    const first = validateStep(st.step, true);
    if (first) {
      track('step_invalid', { step: st.step });
      try { first.focus(); } catch { /* ignore */ }
      return;
    }
    track('step_next', { step: st.step });
    goStep(st.step + 1);
  });
  backBtn?.addEventListener('click', () => { clearErrs(); goStep(st.step - 1); track('step_back', { step: st.step }); });
  wiz.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA' || (t as HTMLInputElement).type === 'checkbox' || (t as HTMLInputElement).type === 'radio' || (t as HTMLInputElement).type === 'file') return;
    e.preventDefault();
    if (st.step < 5) nextBtn?.click();
  });

  /* ---------- состояния ---------- */
  const wizStepsBox = $('#wiz-steps');
  const wizFoot = $('.wiz-foot', wiz);
  const stateSending = $('#state-sending');
  const stateOk = $('#state-ok');
  const stateErr = $('#state-err');
  function showState(which: 'form' | 'sending' | 'ok' | 'err'): void {
    // display переключается через CSSOM (CSP style-src 'self' это разрешает)
    if (wizStepsBox) wizStepsBox.style.display = which === 'form' ? '' : 'none';
    if (wizFoot) wizFoot.style.display = which === 'form' ? '' : 'none';
    for (const el of [stateSending, stateOk, stateErr]) el?.classList.remove('is-on');
    if (which === 'sending') stateSending?.classList.add('is-on');
    if (which === 'ok') stateOk?.classList.add('is-on');
    if (which === 'err') stateErr?.classList.add('is-on');
  }

  async function submit(): Promise<void> {
    clearErrs();
    const first = validateStep(4, true);
    if (first) { goStep(4); try { first.focus(); } catch { /* ignore */ } return; }
    track('submit_attempt');
    showState('sending');
    try {
      const r = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const j = await r.json().catch(() => null) as Record<string, unknown> | null;
      if (r.status === 201 && j && typeof j.ticket === 'string') {
        st.lastTicket = j.ticket;
        const okNo = $('#ok-no'); if (okNo) okNo.textContent = `№ ${j.ticket}`;
        const dup = $('#ok-dup'); if (dup) (dup as HTMLElement).hidden = !j.duplicate;
        const dl = $('#ok-dl');
        if (dl) dl.innerHTML = summaryRows().map((x) => `<dt>${x.label}</dt><dd>${x.value.replace(/</g, '&lt;')}</dd>`).join('');
        safeLS.del(DRAFT_KEY);
        showState('ok');
        track('submit_success', { ticket: j.ticket });
        return;
      }
      if (r.status === 409 && j?.error) {
        // слот заняли — возвращаем на шаг 3 и перерисовываем слоты
        goStep(3);
        showState('form');
        setErrAt('when-err-anchor', String((j.error as { message?: string }).message ?? 'Выбранное время занято — выберите другой слот'));
        const slots = (j.error as { slots?: { time: string; available: boolean; reason?: string }[] }).slots;
        st.slot = null;
        if (slots && st.date) renderSlots(slots);
        track('submit_error', { code: 'slot_taken' });
        return;
      }
      if (r.status === 400 && j?.error) {
        const e = j.error as { code?: string; message?: string; fields?: Record<string, string> };
        if (e.code === 'consent_version') {
          showState('err');
          const p = $('#err-text'); if (p) p.textContent = String(e.message ?? 'Обновите страницу и отправьте снова.');
          track('submit_error', { code: e.code });
          return;
        }
        applyServerFields(e.fields ?? {});
        showState('form');
        track('submit_error', { code: e.code ?? 'validation' });
        return;
      }
      showState('err');
      track('submit_error', { code: 'http_' + r.status });
    } catch {
      showState('err');
      track('submit_error', { code: 'network' });
    }
  }
  function applyServerFields(fields: Record<string, string>): void {
    const byKey: Record<string, HTMLElement | null> = {
      name: fName, phone: fPhone, consent: fConsent, 'car.brand': fBrand, 'car.year': fYear,
      'car.vin': fVin, 'car.mileage': fMileage, services: chips, preferred: cal,
    };
    let firstStep = 5;
    let firstEl: HTMLElement | null = null;
    for (const [k, msg] of Object.entries(fields)) {
      const el = byKey[k];
      if (k.startsWith('car.')) firstStep = Math.min(firstStep, 1);
      else if (k === 'services') firstStep = Math.min(firstStep, 2);
      else if (k.startsWith('preferred')) firstStep = Math.min(firstStep, 3);
      else if (k === 'name' || k === 'phone' || k === 'consent') firstStep = Math.min(firstStep, 4);
      if (el) { if (k === 'services') setErrAt('svc-err-anchor', msg); else if (k.startsWith('preferred')) setErrAt('when-err-anchor', msg); else setErr(el, msg); if (!firstEl) firstEl = el; }
    }
    goStep(firstStep);
    if (firstEl) { try { firstEl.focus(); } catch { /* ignore */ } }
  }
  submitBtn?.addEventListener('click', () => { void submit(); });
  $('#err-retry')?.addEventListener('click', () => { showState('form'); goStep(5); });
  $('#ok-again')?.addEventListener('click', () => {
    st = freshSt();
    if (fBrand) fBrand.value = ''; if (fModel) fModel.value = '';
    if (fYear) fYear.value = ''; if (fVin) fVin.value = ''; if (fMileage) fMileage.value = '';
    if (fName) fName.value = ''; if (fPhone) fPhone.value = '';
    if (fConsent) fConsent.checked = false;
    if (hp) hp.value = '';
    $$<HTMLInputElement>('#skip-year,#skip-vin,#skip-mileage').forEach((x) => { x.checked = false; });
    $$<HTMLInputElement>('input[name="channel"]').forEach((r, i) => { r.checked = i === 0; });
    syncSkips(); restoreChips(); renderPhotos(); renderCal();
    if (slotsBox) slotsBox.innerHTML = '<p class="hint">Выберите дату на ленте выше.</p>';
    asapBtn?.classList.remove('is-on'); asapBtn?.setAttribute('aria-pressed', 'false');
    clearErrs();
    showState('form');
    goStep(1);
  });

  /* ---------- .ics на клиенте (без внешних сервисов) ---------- */
  $('#ok-ics')?.addEventListener('click', () => {
    if (!st.date || !st.slot || st.asap) {
      window.alert('Дата и время не выбраны — визит ещё согласовывается. Мы добавим событие после подтверждения.');
      return;
    }
    const [hh] = st.slot.split(':');
    const start = `${st.date.replace(/-/g, '')}T${hh}0000`;
    const endH = String(Number(hh) + 1).padStart(2, '0');
    const end = `${st.date.replace(/-/g, '')}T${endH}0000`;
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//avtotehservis//ru', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
      `UID:${st.idem}@avtotehservis`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      `DTSTART:${start}`, `DTEND:${end}`,
      `SUMMARY:Визит в АвтоТехСервис (заявка ${st.lastTicket ?? ''})`,
      'LOCATION:Ростов-на-Дону, ул. Портовая, 439',
      `DESCRIPTION:Номер заявки: ${st.lastTicket ?? ''}. Возьмите СТС и ключи; для переобувки — второй комплект колёс.`,
      'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Через 2 часа — визит в автосервис', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `avtotehservis-${st.lastTicket ?? 'zayavka'}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    track('ics_download');
  });

  /* ---------- черновик ---------- */
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  function saveDraftSoon(): void {
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      const light = { ...st, photos: st.photos.filter((p) => p.state === 'done') };
      safeLS.set(DRAFT_KEY, JSON.stringify(light));
      const note = $('#draft-note');
      if (note && !note.classList.contains('is-on') && st.step === 1) { /* не показываем на свежей форме */ }
    }, 500);
  }
  function restoreDraft(): boolean {
    const raw = safeLS.get(DRAFT_KEY);
    if (!raw) return false;
    try {
      const d = JSON.parse(raw) as Partial<St>;
      if (!d || typeof d !== 'object' || !d.idem) return false;
      st = { ...freshSt(), ...d, photos: (d.photos ?? []).filter((p) => p.state === 'done') } as St;
      return true;
    } catch { return false; }
  }
  function applyStToForm(): void {
    if (fBrand) fBrand.value = st.brand;
    if (fModel) fModel.value = st.model;
    if (fYear) fYear.value = st.year;
    if (fVin) fVin.value = st.vin;
    if (fMileage) fMileage.value = st.mileage;
    if (fName) fName.value = st.name;
    if (fPhone) fPhone.value = st.phone;
    if (fConsent) fConsent.checked = st.consent;
    const skipY = $<HTMLInputElement>('#skip-year'); if (skipY) skipY.checked = st.yearSkip;
    const skipV = $<HTMLInputElement>('#skip-vin'); if (skipV) skipV.checked = st.vinSkip;
    const skipM = $<HTMLInputElement>('#skip-mileage'); if (skipM) skipM.checked = st.milSkip;
    $$<HTMLInputElement>('input[name="channel"]').forEach((r) => { r.checked = r.value === st.channel; });
    syncSkips(); restoreChips(); renderPhotos(); renderCal();
    if (st.asap) { asapBtn?.classList.add('is-on'); asapBtn?.setAttribute('aria-pressed', 'true'); }
    if (st.date && !st.asap) void loadSlots();
    if (PRESELECT && !st.services.length && !st.dontknow) {
      const cb = $<HTMLInputElement>(`#svc-chips input[value="${CSS.escape(PRESELECT)}"]`);
      if (cb) { cb.checked = true; st.services.push(PRESELECT); }
    }
  }

  const draftNote = $('#draft-note');
  const hadDraft = restoreDraft();
  applyStToForm();
  if (hadDraft && draftNote) {
    draftNote.classList.add('is-on');
    const t = $('#draft-text');
    if (t) t.textContent = 'Найден черновик прошлой записи — поля восстановлены.';
  }
  $('#clear-draft')?.addEventListener('click', () => {
    safeLS.del(DRAFT_KEY);
    st = freshSt();
    applyStToForm();
    draftNote?.classList.remove('is-on');
    goStep(1);
  });
  syncSkips();
  goStep(hadDraft ? Math.min(5, Math.max(1, st.step)) : 1);
}
