/* ============================================================
   АвтоТехСервис — Ростов-на-Дону, ул. Портовая, 439.
   Весь JS многостраничного мокапа (Агент 5, раунд 2Б).
   Без jQuery, без внешних запросов, без fetch/XHR/sendBeacon:
   отправка форм имитируется на клиенте. Демо-события — только
   console.debug('[demo-event]', …).
   ============================================================ */
(function () {
  'use strict';

  /* ---------- утилиты ---------- */
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reducedMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  function reduced() { return !!reducedMQ.matches; }
  function track(name, data) {
    try { console.debug('[demo-event]', name, data === undefined ? '' : JSON.stringify(data)); } catch (e) { /* тишина */ }
  }
  /* localStorage может быть недоступен (приватный режим, file://) — не падаем */
  var safeLS = (function () {
    try { var k = '__ats_t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return localStorage; }
    catch (e) { return null; }
  })();
  function lsGet(k) { try { return safeLS ? safeLS.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (safeLS) safeLS.setItem(k, v); } catch (e) { /* игнор */ } }
  function lsDel(k) { try { if (safeLS) safeLS.removeItem(k); } catch (e) { /* игнор */ } }
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* fallback ниже */ }
    var h = '';
    for (var i = 0; i < 32; i++) h += Math.floor(Math.random() * 16).toString(16);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' + h.slice(16, 19) + '-' + h.slice(19);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function qs(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }

  /* ---------- фокус-ловушка (меню, модалки, лайтбокс) ---------- */
  function trapFocus(container, ev) {
    var f = $$('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])', container)
      .filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  /* ---------- активный пункт меню ---------- */
  var page = document.body.getAttribute('data-page') || '';
  $$('[data-nav]').forEach(function (a) {
    if (a.getAttribute('data-nav') === page) {
      a.classList.add('is-active');
      if (a.closest('nav') && a.closest('nav').id === 'nav') a.setAttribute('aria-current', 'page');
    }
  });

  /* ---------- компактная шапка при скролле ---------- */
  var hdr = $('#hdr');
  if (hdr) {
    var onScroll = function () { hdr.classList.toggle('is-compact', window.scrollY > 24); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- мобильное меню: на весь экран, Esc, фокус-ловушка ---------- */
  var burger = $('#burger'), mmenu = $('#m-menu');
  var lastFocus = null;
  function openMenu() {
    if (!mmenu) return;
    lastFocus = document.activeElement;
    document.body.classList.add('menu-open', 'no-scroll');
    burger && burger.setAttribute('aria-expanded', 'true');
    track('menu_open');
    var first = mmenu.querySelector('a,button');
    if (first) first.focus();
  }
  function closeMenu() {
    if (!mmenu || !document.body.classList.contains('menu-open')) return;
    document.body.classList.remove('menu-open', 'no-scroll');
    burger && burger.setAttribute('aria-expanded', 'false');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  if (burger) burger.addEventListener('click', function () {
    document.body.classList.contains('menu-open') ? closeMenu() : openMenu();
  });
  var mClose = $('#m-close');
  if (mClose) mClose.addEventListener('click', closeMenu);
  if (mmenu) mmenu.addEventListener('click', function (e) {
    if (e.target === mmenu) closeMenu();
    var a = e.target.closest && e.target.closest('a');
    if (a) closeMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeMenu();
    if (e.key === 'Tab' && document.body.classList.contains('menu-open') && mmenu) trapFocus(mmenu, e);
  });

  /* ---------- sticky-док только на узких экранах ---------- */
  function syncDock() {
    var wide = window.matchMedia ? window.matchMedia('(max-width:860px)').matches : window.innerWidth <= 860;
    document.body.classList.toggle('has-dock', wide && !!$('.dock'));
  }
  window.addEventListener('resize', syncDock);
  syncDock();

  /* ---------- появление секций при скролле (каскад 0/80/160/240) ---------- */
  var reveals = $$('.reveal');
  if (reduced() || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* ---------- модалки: политика и согласие ---------- */
  var modalLastFocus = null;
  function openModal(id) {
    var m = document.getElementById('modal-' + id);
    if (!m) return;
    modalLastFocus = document.activeElement;
    m.classList.add('is-open');
    document.body.classList.add('no-scroll');
    var f = m.querySelector('button,a[href]');
    if (f) f.focus();
    track('modal_open', { modal: id });
  }
  function closeModal(m) {
    if (!m) return;
    m.classList.remove('is-open');
    if (!$$('.modal.is-open').length) document.body.classList.remove('no-scroll');
    if (modalLastFocus && modalLastFocus.focus) modalLastFocus.focus();
  }
  $$('[data-modal]').forEach(function (b) {
    b.addEventListener('click', function () { openModal(b.getAttribute('data-modal')); });
  });
  $$('.modal').forEach(function (m) {
    m.addEventListener('click', function (e) { if (e.target === m) closeModal(m); });
    var c = m.querySelector('.modal-close');
    if (c) c.addEventListener('click', function () { closeModal(m); });
    m.addEventListener('keydown', function (e) { if (e.key === 'Tab') trapFocus(m, e); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') $$('.modal.is-open').forEach(closeModal);
  });

  /* ---------- маска телефона +7 (999) 999-99-99 (вставка из буфера не ломает) ---------- */
  function digits(v) { return String(v).replace(/\D/g, ''); }
  function formatPhone(d) {
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (!d.startsWith('7')) d = '7' + d;
    d = d.slice(0, 11);
    var out = '+7';
    if (d.length > 1) out += ' (' + d.slice(1, 4);
    if (d.length >= 4) out += ')';
    if (d.length >= 5) out += ' ' + d.slice(4, 7);
    if (d.length >= 8) out += '-' + d.slice(7, 9);
    if (d.length >= 10) out += '-' + d.slice(9, 11);
    return out;
  }
  function phoneValue(v) { var d = digits(v); return d.length < 2 ? '' : formatPhone(d); }
  function phoneOK(v) { return digits(v).length === 11; }
  function attachMask(inp) {
    if (!inp) return;
    var sync = function () {
      var pos = inp.selectionStart, before = inp.value;
      var d = digits(before);
      if (!d.length) { inp.value = ''; return; }
      inp.value = phoneValue(d);
      /* курсор — в конец, если был в конце */
      try { if (pos === null || pos >= before.length - 1) inp.setSelectionRange(inp.value.length, inp.value.length); } catch (e) { /* игнор */ }
    };
    inp.addEventListener('input', sync);
    inp.addEventListener('focus', function () { if (!inp.value) inp.value = '+7 ('; });
    inp.addEventListener('blur', function () { if (digits(inp.value).length < 2) inp.value = ''; });
    inp.addEventListener('paste', function (e) {
      e.preventDefault();
      var t = '';
      try { t = (e.clipboardData || window.clipboardData).getData('text'); } catch (err) { t = ''; }
      inp.value = phoneValue(digits(t));
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (err) { /* игнор */ }
    });
  }
  $$('input[type="tel"][data-mask]').forEach(attachMask);

  /* ---------- VIN: 17 символов, I/O/Q запрещены ---------- */
  function vinOK(v) { return /^[A-HJ-NPR-Z0-9]{17}$/.test(v); }
  function attachVin(inp) {
    if (!inp) return;
    inp.addEventListener('input', function () {
      var v = inp.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);
      if (v !== inp.value) { inp.value = v; }
      var hint = inp.closest('.field') ? $('.hint', inp.closest('.field')) : null;
      if (hint) hint.textContent = v.length ? v.length + ' из 17 · буквы I, O, Q в VIN не используются' : '17 символов · буквы I, O, Q в VIN не используются';
    });
  }
  $$('input[data-vin]').forEach(attachVin);

  /* ---------- клики-события: позвонить / telegram / маршрут ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-track]') : null;
    if (t) track(t.getAttribute('data-track'));
  });

  /* ---------- общая карусель: сдвиг на transform, стрелки, свайп ---------- */
  function initCarousel(root) {
    if (!root) return null;
    var trackEl = $('.carousel-track', root);
    if (!trackEl) return null;
    var idx = 0;
    /* стрелки — внутри корня или в том же контейнере (sec-head) */
    var navScope = $('[data-car="prev"],[data-car="next"]', root) ? root
      : (root.closest ? (root.closest('.container') || root.parentElement || root) : root);
    function cards() { return $$('.carousel-track > *', root); }
    function perView() {
      var c = cards()[0];
      if (!c) return 1;
      var w = root.querySelector('.carousel-win');
      var ww = w ? w.clientWidth : root.clientWidth;
      var cw = c.getBoundingClientRect().width;
      var gap = parseFloat(getComputedStyle(trackEl).columnGap || getComputedStyle(trackEl).gap || '18') || 18;
      return Math.max(1, Math.round((ww + gap) / (cw + gap)));
    }
    function maxIdx() { return Math.max(0, cards().length - perView()); }
    function render(animate) {
      var c = cards()[0];
      if (!c) return;
      var gap = parseFloat(getComputedStyle(trackEl).columnGap || '18') || 18;
      var stepW = c.getBoundingClientRect().width + gap;
      if (animate === false) trackEl.style.transition = 'none';
      trackEl.style.transform = 'translateX(' + (-idx * stepW) + 'px)';
      if (animate === false) { void trackEl.offsetWidth; trackEl.style.transition = ''; }
      var prev = $('[data-car="prev"]', navScope), next = $('[data-car="next"]', navScope);
      if (prev) prev.disabled = idx <= 0;
      if (next) next.disabled = idx >= maxIdx();
    }
    function go(n) { idx = Math.min(Math.max(0, n), maxIdx()); render(true); }
    var p = $('[data-car="prev"]', navScope), n = $('[data-car="next"]', navScope);
    if (p) p.addEventListener('click', function () { go(idx - 1); track('carousel_prev'); });
    if (n) n.addEventListener('click', function () { go(idx + 1); track('carousel_next'); });
    /* свайп */
    var x0 = null, y0 = null, dx = 0, dragging = false;
    var win = root.querySelector('.carousel-win') || root;
    win.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      x0 = e.clientX; y0 = e.clientY; dx = 0; dragging = true;
    });
    win.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dx = e.clientX - x0;
      if (Math.abs(e.clientY - y0) > Math.abs(dx)) { dragging = false; }
    });
    win.addEventListener('pointerup', function () {
      if (!dragging) return;
      dragging = false;
      if (dx < -44) go(idx + 1);
      else if (dx > 44) go(idx - 1);
    });
    win.addEventListener('pointercancel', function () { dragging = false; });
    window.addEventListener('resize', function () { idx = Math.min(idx, maxIdx()); render(false); });
    render(false);
    return { go: go, render: render };
  }
  $$('[data-carousel]').forEach(function (root) {
    var inst = initCarousel(root);
    if (inst) root.__carousel = inst;
  });

  /* ---------- слайдер-герой: автопрокрутка, стрелки, точки, свайп,
     пауза при наведении и фокусе, остановка при reduced-motion ---------- */
  (function initHero() {
    var hero = $('#hero');
    if (!hero) return;
    var slides = $$('.slide', hero);
    if (slides.length < 2) return;
    var dotsBox = $('#hero-dots');
    var idx = 0, timer = null, paused = false;
    var DELAY = 6000;

    slides.forEach(function (s, i) {
      s.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
      if (dotsBox) {
        var b = document.createElement('button');
        b.className = 'hero-dot' + (i === 0 ? ' is-on' : '');
        b.type = 'button';
        b.setAttribute('aria-label', 'Слайд ' + (i + 1) + ' из ' + slides.length);
        b.addEventListener('click', function () { go(i, true); });
        dotsBox.appendChild(b);
      }
    });
    var dots = dotsBox ? $$('.hero-dot', dotsBox) : [];

    function go(n, user) {
      idx = (n + slides.length) % slides.length;
      slides.forEach(function (s, i) {
        s.classList.toggle('is-active', i === idx);
        s.setAttribute('aria-hidden', i === idx ? 'false' : 'true');
        /* ссылки и кнопки неактивного слайда — вне таб-порядка */
        $$('a,button', s).forEach(function (el) { el.tabIndex = i === idx ? 0 : -1; });
      });
      dots.forEach(function (d, i) { d.classList.toggle('is-on', i === idx); });
      if (user) track('hero_slide', { index: idx });
      restart();
    }
    function restart() {
      if (timer) { clearInterval(timer); timer = null; }
      if (reduced()) return;           /* reduced-motion: автопрокрутка выключена */
      timer = setInterval(function () { if (!paused && !document.hidden) go(idx + 1); }, DELAY);
    }
    var prev = $('#hero-prev'), next = $('#hero-next');
    if (prev) prev.addEventListener('click', function () { go(idx - 1, true); });
    if (next) next.addEventListener('click', function () { go(idx + 1, true); });
    hero.addEventListener('mouseenter', function () { paused = true; });
    hero.addEventListener('mouseleave', function () { paused = false; });
    hero.addEventListener('focusin', function () { paused = true; });
    hero.addEventListener('focusout', function (e) { if (!hero.contains(e.relatedTarget)) paused = false; });
    document.addEventListener('keydown', function (e) {
      if (!$('#hero') || document.body.classList.contains('menu-open') || $$('.modal.is-open,.lightbox.is-open').length) return;
      /* стрелки управляют слайдером, только когда он во вьюпорте */
      var r = hero.getBoundingClientRect();
      var hasLayout = r.width > 0 || r.height > 0;
      if (hasLayout && (r.bottom < 80 || r.top > window.innerHeight - 80)) return;
      if (e.key === 'ArrowLeft') { go(idx - 1, true); e.preventDefault(); }
      if (e.key === 'ArrowRight') { go(idx + 1, true); e.preventDefault(); }
    });
    /* свайп */
    var x0 = null, y0 = null;
    hero.addEventListener('pointerdown', function (e) { x0 = e.clientX; y0 = e.clientY; });
    hero.addEventListener('pointerup', function (e) {
      if (x0 === null) return;
      var dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) go(idx + (dx < 0 ? 1 : -1), true);
    });
    go(0);
  })();

  /* ---------- галерея работ: данные и лайтбокс ---------- */
  var GALLERY = [
    { id: 'case-1', t: 'Боковой порез шины — ремонт, R16', s: 'Колёса · вулканизация', img: 'assets/case-1.svg' },
    { id: 'case-2', t: 'Грыжа на боковине — восстановили', s: 'Колёса · ремонт шин', img: 'assets/case-2.svg' },
    { id: 'case-3', t: 'Правка литого диска, R17', s: 'Колёса · правка и прокатка', img: 'assets/case-3.svg' },
    { id: 'case-4', t: 'Замена тормозных колодок', s: 'Ходовая и тормоза', img: 'assets/case-4.svg' },
    { id: 'case-5', t: 'ТО: масло и фильтры', s: 'ТО и расходники', img: 'assets/case-5.svg' },
    { id: 'case-6', t: 'Замена лобового стекла', s: 'Стёкла', img: 'assets/case-6.svg' }
  ];
  var lb = $('#lightbox'), lbLastFocus = null, lbIdx = 0;
  function lbRender() {
    var it = GALLERY[lbIdx];
    if (!it || !lb) return;
    $('#lb-img', lb).innerHTML = '<img src="' + it.img + '" alt="Заглушка: ' + esc(it.t) + ' — фото «до/после» появится после съёмки">';
    $('#lb-title', lb).textContent = it.t;
    $('#lb-sub', lb).textContent = it.s;
    $('#lb-count', lb).textContent = (lbIdx + 1) + ' / ' + GALLERY.length;
  }
  function lbOpen(i) {
    if (!lb) return;
    lbLastFocus = document.activeElement;
    lbIdx = (i + GALLERY.length) % GALLERY.length;
    lbRender();
    lb.classList.add('is-open');
    document.body.classList.add('no-scroll');
    var c = $('#lb-close', lb);
    if (c) c.focus();
    track('lightbox_open', { case: GALLERY[lbIdx].id });
  }
  function lbClose() {
    if (!lb || !lb.classList.contains('is-open')) return;
    lb.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
    if (lbLastFocus && lbLastFocus.focus) lbLastFocus.focus();
  }
  function lbGo(d) { lbIdx = (lbIdx + d + GALLERY.length) % GALLERY.length; lbRender(); track('lightbox_nav', { case: GALLERY[lbIdx].id }); }
  $$('[data-gal]').forEach(function (b) {
    b.addEventListener('click', function () { lbOpen(parseInt(b.getAttribute('data-gal'), 10) || 0); });
  });
  if (lb) {
    $('#lb-close', lb).addEventListener('click', lbClose);
    $('#lb-prev', lb).addEventListener('click', function () { lbGo(-1); });
    $('#lb-next', lb).addEventListener('click', function () { lbGo(1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) lbClose(); });
    lb.addEventListener('keydown', function (e) { if (e.key === 'Tab') trapFocus(lb, e); });
    var lx0 = null, ly0 = null;
    lb.addEventListener('pointerdown', function (e) { lx0 = e.clientX; ly0 = e.clientY; });
    lb.addEventListener('pointerup', function (e) {
      if (lx0 === null) return;
      var dx = e.clientX - lx0, dy = e.clientY - ly0;
      lx0 = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) lbGo(dx < 0 ? 1 : -1);
    });
  }
  document.addEventListener('keydown', function (e) {
    if (!lb || !lb.classList.contains('is-open')) return;
    if (e.key === 'Escape') lbClose();
    if (e.key === 'ArrowLeft') lbGo(-1);
    if (e.key === 'ArrowRight') lbGo(1);
  });

  /* ---------- услуги: данные для service.html (подстановка по ?s=slug) ---------- */
  var SERVICES = {
    'shinomontazh': {
      t: 'Шиномонтаж — легковой и грузовой',
      lead: 'Снятие, установка, накачка и доводка колёс: легковые, кроссоверы, коммерческий транспорт.',
      img: 'assets/svc-1.svg',
      body: '<p>Шиномонтаж — самая частая операция в сервисе на Портовой, 439. Принимаем легковые автомобили, кроссоверы и коммерческий транспорт; работаем и с грузовыми колёсами. Сезонная переобувка, снятие и установка колёс, накачка, проверка давления — всё на месте, в одном боксе.</p><p>Если колесо спустило в дороге — позвоните: подскажем, можно ли доехать самостоятельно или лучше не рисковать боковиной.</p>',
      list: ['Снятие и установка колёс, накачка', 'Сезонная переобувка двух комплектов', 'Легковые, кроссоверы, коммерческий транспорт', 'Грузовой шиномонтаж'],
      tag: 'Колёса'
    },
    'balansirovka': {
      t: 'Балансировка и ремонт дисков',
      lead: 'Уберём биение и вибрацию: точная балансировка, правка и прокатка литых и штампованных дисков.',
      img: 'assets/svc-2.svg',
      body: '<p>Вибрация на руле или кузове на скорости — чаще всего дисбаланс колеса либо «повело» диск после ямы. Сначала диагностируем: снимаем показатели, показываем, где проблема. Затем балансируем колесо или правим/прокатываем диск — и снова проверяем результат.</p><p>Балансировку делаем на легковых, кроссоверах, джипах и коммерческом транспорте.</p>',
      list: ['Балансировка колёс любых диаметров', 'Правка и прокатка литых дисков', 'Прокатка штампованных дисков', 'Проверка биения после работ'],
      tag: 'Колёса'
    },
    'remont-shin': {
      t: 'Ремонт шин: порезы, грыжи, вулканизация',
      lead: 'Боковые порезы, грыжи, проколы — восстанавливаем там, где это безопасно, и честно говорим, когда шину пора менять.',
      img: 'assets/svc-3.svg',
      body: '<p>Прокол саморезом — это часто ремонт на месте за один визит. Боковой порез или грыжа — сложнее: сначала осматриваем, потом говорим, подлежит ли шина восстановлению. Если ремонт небезопасен — скажем прямо и объясним почему; навязывать замену не будем.</p><p>Применяем вулканизацию и ремонт жгутами/заплатками в зависимости от повреждения.</p>',
      list: ['Ремонт проколов протектора', 'Боковые порезы — оценка и вулканизация', 'Грыжи: диагностика, восстановление боковины', 'Сохранение ресурса шины, когда это безопасно'],
      tag: 'Колёса'
    },
    'to-maslo': {
      t: 'ТО и аппаратная замена масла',
      lead: 'Плановое обслуживание: масло, фильтры, колодки, проверка узлов — с фиксацией того, что сделано и что скоро потребует внимания.',
      img: 'assets/svc-4.svg',
      body: '<p>На ТО меняем масло и фильтры (аппаратная замена — для АКПП), проверяем тормоза, ходовую, уровни жидкостей, свет. По итогам показываем, что в порядке, а что подойдёт к замене через несколько тысяч километров — без запугивания и «найдённых» неисправностей.</p><p>Перед началом любых работ согласуем перечень и стоимость — это правило действует для всех услуг.</p>',
      list: ['Замена масла и фильтров', 'Аппаратная замена масла АКПП', 'Проверка тормозов, ходовой, жидкостей, света', 'Рекомендации по ресурсу узлов — письменно'],
      tag: 'Ремонт и ТО'
    },
    'hodovaya-tormoza': {
      t: 'Ходовая, тормоза и рулевое',
      lead: 'Стук, люфт, увод, вибрация при торможении: диагностика, ремонт ходовой, тормозной системы и рулевых реек.',
      img: 'assets/svc-5.svg',
      body: '<p>Стуки и люфты в подвеске, увод в сторону, вибрация педали тормоза — с этим приезжают чаще всего. Поднимаем автомобиль, проверяем узлы, показываем изношенные детали до их замены. Согласуем перечень работ и только потом начинаем.</p><p>Делаем развал-схождение после вмешательства в геометрию подвески.</p>',
      list: ['Диагностика подвески и рулевого', 'Замена колодок, дисков, суппортов', 'Ремонт рулевых реек', 'Развал-схождение'],
      tag: 'Ремонт и ТО'
    },
    'elektrika': {
      t: 'Электрика, диагностика, кондиционеры',
      lead: 'Двигатель, АКПП/МКПП, автоэлектрика, заправка и ремонт кондиционеров, замена лобовых стёкол.',
      img: 'assets/svc-6.svg',
      body: '<p>«Горит чек», не заводится, не работает стеклоподъёмник или кондиционер — начинаем с диагностики: считываем ошибки, проверяем цепи, показываем причину. Дальше — смета и решение владельца. Ремонтируем бензиновые и дизельные двигатели, АКПП и МКПП, дизельные форсунки, меняем лобовые стёкла, в том числе панорамные.</p>',
      list: ['Компьютерная диагностика', 'Автоэлектрика: от цепей до оборудования', 'Ремонт и заправка кондиционеров', 'Двигатель, АКПП/МКПП, форсунки, стёкла'],
      tag: 'Диагностика'
    }
  };
  var SERVICE_ORDER = ['shinomontazh', 'balansirovka', 'remont-shin', 'to-maslo', 'hodovaya-tormoza', 'elektrika'];

  (function initServicePage() {
    var page = $('#svc-detail');
    if (!page) return;
    var slug = qs('s') || 'shinomontazh';
    var s = SERVICES[slug] || SERVICES['shinomontazh'];
    if (!SERVICES[slug]) slug = 'shinomontazh';
    /* заполнение контента выбранной услуги */
    $('#svc-title').textContent = s.t;
    $('#svc-lead').textContent = s.lead;
    $('#svc-img').innerHTML = '<img src="' + s.img + '" alt="Заглушка: ' + esc(s.t) + '. Фото появятся после съёмки в сервисе">';
    $('#svc-tag').textContent = s.tag;
    $('#svc-body').innerHTML = s.body;
    $('#svc-list').innerHTML = s.list.map(function (li) { return '<li>' + esc(li) + '</li>'; }).join('');
    document.title = s.t + ' — АвтоТехСервис, Ростов-на-Дону';
    var crumb = $('#svc-crumb');
    if (crumb) crumb.textContent = s.t;
    /* кнопка записи — с предвыбранной услугой */
    var cta = $('#svc-book');
    if (cta) cta.setAttribute('href', 'appointment.html?s=' + slug);
    /* блок «другие услуги» */
    var others = $('#svc-others');
    if (others) {
      others.innerHTML = SERVICE_ORDER.filter(function (k) { return k !== slug; }).slice(0, 3).map(function (k) {
        var o = SERVICES[k];
        return '<a class="svc-card" href="service.html?s=' + k + '">' +
          '<span class="svc-img"><img src="' + o.img + '" alt=""></span>' +
          '<span class="svc-body"><span class="svc-tag">' + esc(o.tag) + '</span><h3>' + esc(o.t) + '</h3><p>' + esc(o.lead) + '</p></span></a>';
      }).join('');
    }
    track('service_view', { slug: slug });
  })();

  /* ---------- статьи: данные для news.html и post.html ---------- */
  var POSTS = {
    'temperatura-plus-7': {
      d: '12 октября 2026', cat: 'Сезонное', catSlug: 'sezonnoe',
      t: 'Когда менять шины: правило +7 °C',
      lead: 'Среднесуточная температура держится около +7 °C — пора записываться на переобувку. Объясняем, почему не стоит ждать первого снега.',
      img: 'assets/news-1.svg', cap: 'Заглушка: фото сезонной переобувки появится после съёмки',
      body: '<p>Ориентир для смены летней резины на зимнюю — среднесуточная температура около <b>+7 °C</b>. Ниже этой границы летняя смесь дубеет: тормозной путь растёт, а сцепление ухудшается ещё до того, как выпал первый снег.</p><p>Обратная граница весной — те же +7 °C, но уже устойчиво в плюс: зимняя резина на тёплом асфальте изнашивается быстрее и «плывёт» в поворотах.</p><h2>Почему не стоит ждать очередей</h2><p>В первые холодные выходные на шиномонтажи города встают очереди: люди приезжают одновременно. Если записаться заранее, переобувка занимает меньше времени — и для вас, и для мастеров.</p><ul><li>Следите за прогнозом: как только ночные температуры стабильно около нуля — планируйте визит;</li><li>Проверьте комплект: глубина протектора, возраст шины, наличие всех четырёх колёс;</li><li>Заодно сделайте балансировку — после хранения она нужна почти всегда;</li><li>Если храните шины у нас — привозите автомобиль, колёса уже ждут вас.</li></ul><p>Записаться можно через форму на сайте: выберите дату и удобный час с 9:00 до 19:00 — мы работаем ежедневно.</p>'
    },
    'gryzha-bokovina': {
      d: '28 сентября 2026', cat: 'Советы', catSlug: 'sovety',
      t: 'Грыжа на боковине: ехать можно или вызывать эвакуатор',
      lead: 'Вздутие на боковине — это не косметический дефект. Разбираем, когда можно доехать до сервиса самому, а когда шину лучше не нагружать.',
      img: 'assets/news-2.svg', cap: 'Заглушка: фото «до/после» ремонта боковины появится после съёмки',
      body: '<p>Грыжа (вздутие на боковине) появляется после удара — яма с острыми краями, бордюр на скорости. Внутри рвётся корд, и давление выдавливает резину пузырём. Шина при этом часто остаётся накачанной и «вроде едет».</p><h2>Когда можно доехать самому</h2><p>Если грыжа небольшая, колесо держит давление, а ехать недалеко — можно аккуратно добраться до сервиса: без резких манёвров, на умеренной скорости. Перед поездкой проверьте давление и запаситесь насосом.</p><h2>Когда лучше не рисковать</h2><ul><li>Вздутие больше 3–4 см или растёт на глазах;</li><li>Колесо спускает — значит, повреждение сквозное;</li><li>Впереди трасса и высокие скорости;</li><li>Повреждение рядом с бортовым кольцом.</li></ul><p>В сервисе шину осмотрят и честно скажут, подлежит ли она восстановлению. Часть грыж ремонтируется вулканизацией с усилением каркаса, часть — только под замену: мы не будем «продавать ремонт» там, где он небезопасен.</p>'
    },
    'hranenie-shin': {
      d: '5 октября 2026', cat: 'Сезонное', catSlug: 'sezonnoe',
      t: 'Сезонное хранение шин: пять правил',
      lead: 'Как хранить комплект до следующего сезона, чтобы резина не потрескалась и не потеряла форму. И зачем отдавать хранение сервису.',
      img: 'assets/news-3.svg', cap: 'Заглушка: фото склада хранения появится после съёмки',
      body: '<p>Неправильное хранение убивает комплект медленно и незаметно: к весне шины могут потрескаться, деформироваться или «запомнить» форму, в которой лежали полгода.</p><h2>Пять правил</h2><ul><li><b>Чистыми и сухими.</b> Перед хранением вымыть, высушить, удалить камни из протектора;</li><li><b>Вдали от солнца и тепла.</b> Ультрафиолет и батареи старят резину быстрее пробега;</li><li><b>Без химии рядом.</b> Растворители, масла, краски — подальше;</li><li><b>Правильное положение.</b> Шины без дисков — стоя, с периодическим поворотом; колёса в сборе — лёжа стопкой или подвешенными;</li><li><b>Стабильность.</b> Резкие перепады температуры и влажности вредят корду.</li></ul><p>В гараже или на балконе выполнить все пять пунктов сложно. Сезонное хранение в сервисе решает вопрос: комплект принимают чистым, маркируют и отдают к переобувке — вам не нужно искать место и таскать колёса.</p>'
    },
    'to-ili-remont': {
      d: '14 сентября 2026', cat: 'Советы', catSlug: 'sovety',
      t: 'ТО или ремонт: когда визит в сервис нельзя откладывать',
      lead: 'Шесть симптомов, с которыми не стоит ездить «ещё месяц»: от стука в подвеске до горящего «чека».',
      img: 'assets/news-4.svg', cap: 'Заглушка: фото диагностики появится после съёмки',
      body: '<p>Плановое ТО можно сдвинуть на пару недель. Но есть симптомы, при которых отложенный визит превращается в дорогой ремонт.</p><h2>Не откладывайте, если:</h2><ul><li><b>Стук или люфт в подвеске</b> — разбитая деталь быстрее «съедает» соседние;</li><li><b>Вибрация руля на скорости</b> — дисбаланс или повреждение диска/шины;</li><li><b>Горит «чек» двигателя</b> — ошибка может быть мелочью, а может — пропуски зажигания и катализатор;</li><li><b>Педаль тормоза стала «ватной» или проваливается</b> — с тормозами не шутят;</li><li><b>АКПП пинается или затягивает переключения</b> — ранняя диагностика дешевле капремонта;</li><li><b>Машина «ест» масло или охлаждающую жидкость</b> — течь и угар сами не проходят.</li></ul><p>Порядок работы у нас всегда одинаковый: диагностика — смета — согласование — ремонт. Никаких работ «втихую»: до начала вы знаете, что и зачем делается.</p>'
    },
    'zapis-bez-ocheredey': {
      d: '1 октября 2026', cat: 'Сервис', catSlug: 'servis',
      t: 'Сезон переобувки без очередей: запишитесь на своё время',
      lead: 'В пик сезона живая очередь съедает час-полтора. Форма записи на сайте решает проблему: выбираете день и час — к вашему приезду бокс свободен.',
      img: 'assets/news-1.svg', cap: 'Заглушка: фото бокса появится после съёмки',
      body: '<p>Октябрь–ноябрь и март–апрель — два пика шиномонтажного сезона. В эти недели сервисы работают на пределе, и приезд «без записи» означает ожидание: иногда час, иногда больше.</p><h2>Как работает запись</h2><ul><li>Открываете страницу «Запись» — пять коротких шагов: автомобиль, услуги, дата и время, контакты, сводка;</li><li>Выбираете день в ближайшие две недели и час с 9:00 до 19:00 — занятые слоты видны сразу и недоступны для выбора;</li><li>Оставляете имя и телефон — после отправки получаете номер заявки;</li><li>Мы перезваниваем и подтверждаем визит: если что-то пойдёт не так, время сдвинем заранее, а не в момент приезда.</li></ul><p>Не уверены, какие работы нужны? Отметьте «Не знаю — нужна диагностика»: мастер осмотрит автомобиль и согласует перечень до начала ремонта.</p>'
    },
    'gruzovoy-shinomontazh': {
      d: '22 августа 2026', cat: 'Сервис', catSlug: 'servis',
      t: 'Грузовой шиномонтаж: чем он отличается от легкового',
      lead: 'Коммерческий транспорт не может позволить себе простой. Рассказываем про особенности грузовых колёс и как планировать визит парка.',
      img: 'assets/news-2.svg', cap: 'Заглушка: фото грузового поста появится после съёмки',
      body: '<p>Колесо «Газели» и колесо фуры — разные миры: диаметр, давление, вес, требования к оборудованию. Грузовой шиномонтаж требует иных станков и иного опыта — поэтому его делают далеко не везде.</p><h2>Что важно владельцу парка</h2><ul><li><b>Планирование.</b> Простой машины — это сорванные рейсы. Записывайте визит заранее и, если машин несколько, распределяйте их по разным дням;</li><li><b>Давление и износ.</b> У коммерческого транспорта неправильное давление съедает ресурс покрышек быстрее плохих дорог;</li><li><b>Документы.</b> Работаем с юридическими лицами: заказ-наряд, закрывающие документы — по договорённости;</li><li><b>Сезонность.</b> Переобувка парка в межсезонье — отдельная задача: согласуйте график, чтобы машины не встали в один день.</li></ul><p>Для парков, маршруток и коммерческого транспорта у нас отдельная ветка записи — отметьте «грузовой шиномонтаж» в форме, и мы подготовим пост к вашему приезду.</p>'
    },
    'akkum-zima': {
      d: '18 октября 2026', cat: 'Советы', catSlug: 'sovety',
      t: 'Готовим электрику к зиме: аккумулятор, контакты, свет',
      lead: 'Первый мороз проверяет батарею на прочность. Простой чек-лист, который спасает от «не заводится» январским утром.',
      img: 'assets/news-3.svg', cap: 'Заглушка: фото проверки аккумулятора появится после съёмки',
      body: '<p>Зимой нагрузка на электрику растёт: стартеру труднее прокрутить холодный двигатель, а обогревы стёкол, сидений и зеркал высаживают батарею быстрее, чем генератор успевает её восполнить.</p><h2>Чек-лист до первых морозов</h2><ul><li><b>Аккумулятор.</b> Проверьте напряжение и ток холодной прокрутки; батарее старше 4–5 лет — повышенное внимание;</li><li><b>Клеммы и масса.</b> Окислы и плохой контакт на «минусе» — частая причина зимних сюрпризов;</li><li><b>Свет.</b> Запотевшие или мутные фары зимой — минус к видимости; проверьте лампы и регулировку;</li><li><b>Свечи и катушки.</b> Пропуски зажигания на холодную — повод проверить до морозов, а не в −20;</li><li><b>Печка и обогревы.</b> Проверьте, что всё включается и греет: чинить в декабре — с очередями.</li></ul><p>Диагностика электрики занимает немного времени, а по итогам вы получаете список: что в порядке, что доживёт до весны, что лучше сделать сейчас.</p>'
    },
    'razval-priznaki': {
      d: '6 сентября 2026', cat: 'Советы', catSlug: 'sovety',
      t: 'Развал-схождение: четыре признака, что пора на регулировку',
      lead: 'Машину тянет в сторону, резина изнашивается «ступеньками»? Рассказываем, когда нужен развал и чем опасна отложенная регулировка.',
      img: 'assets/news-4.svg', cap: 'Заглушка: фото стенда развал-схождения появится после съёмки',
      body: '<p>Углы установки колёс сбиваются постепенно: ямы, бордюры, ремонт подвески. Машина при этом продолжает ехать — но уже не так, как задумано.</p><h2>Признаки</h2><ul><li><b>Увод в сторону</b> на ровной дороге при отпущенном руле;</li><li><b>Неравномерный износ шин</b> — «ступеньки», подпилы кромки, износ одной стороны;</li><li><b>Кривой руль</b> при движении прямо;</li><li><b>Любой ремонт ходовой</b> — замена рычагов, рулевых наконечников, реек требует последующей регулировки.</li></ul><h2>Чем грозит откладывание</h2><p>Главная цена — резина: комплект шин при сбитых углах может «съесться» за несколько тысяч километров. Плюс хуже управляемость и длиннее тормозной путь в экстренной ситуации.</p><p>Регулировку делаем на стенде, а перед ней обязательно проверяем подвеску: регулировать углы на разбитых сайлентблоках бессмысленно.</p>'
    }
  };
  var POST_ORDER = ['temperatura-plus-7', 'akkum-zima', 'hranenie-shin', 'zapis-bez-ocheredey', 'gryzha-bokovina', 'to-ili-remont', 'razval-priznaki', 'gruzovoy-shinomontazh'];
  var CATS = [
    { slug: 'sezonnoe', t: 'Сезонное' },
    { slug: 'sovety', t: 'Советы' },
    { slug: 'servis', t: 'Сервис' }
  ];

  (function initPostPage() {
    var main = $('#post-main');
    if (!main) return;
    var slug = qs('p') || POST_ORDER[0];
    var p = POSTS[slug];
    if (!p) { slug = POST_ORDER[0]; p = POSTS[slug]; }
    $('#post-date').textContent = p.d;
    $('#post-cat').textContent = p.cat;
    $('#post-title').textContent = p.t;
    $('#post-img').innerHTML = '<img src="' + p.img + '" alt="' + esc(p.t) + '"><figcaption>' + esc(p.cap) + '</figcaption>';
    $('#post-text').innerHTML = p.body;
    var crumb = $('#post-crumb');
    if (crumb) crumb.textContent = p.t;
    document.title = p.t + ' — Новости — АвтоТехСервис';
    /* подсветка категории в сайдбаре */
    $$('.side-box [data-cat]').forEach(function (a) {
      a.classList.toggle('is-on', a.getAttribute('data-cat') === p.catSlug);
    });
    /* другие статьи: три ближайших, кроме текущей */
    var othersBox = $('#post-others');
    if (othersBox) {
      othersBox.innerHTML = POST_ORDER.filter(function (k) { return k !== slug; }).slice(0, 3).map(function (k) {
        var o = POSTS[k];
        return '<li><a href="post.html?p=' + k + '">' + esc(o.t) + '<span class="c">' + esc(o.d.split(' ').slice(-1)[0]) + '</span></a></li>';
      }).join('');
    }
    track('post_view', { slug: slug });
  })();

  /* ---------- новости: фильтр категорий + пагинация ---------- */
  (function initNews() {
    var grid = $('#news-grid');
    if (!grid) return;
    var cards = $$('.news-card', grid);
    var PER = 4;
    var state = { cat: 'all', page: 1 };
    var chips = $$('.filter-chip');
    var pager = $('#pager');
    var empty = $('#news-empty');

    function visible() {
      return cards.filter(function (c) {
        return state.cat === 'all' || c.getAttribute('data-cat') === state.cat;
      });
    }
    function render() {
      var vis = visible();
      var pages = Math.max(1, Math.ceil(vis.length / PER));
      if (state.page > pages) state.page = pages;
      cards.forEach(function (c) { c.classList.add('is-hidden'); });
      var from = (state.page - 1) * PER;
      vis.slice(from, from + PER).forEach(function (c) { c.classList.remove('is-hidden'); });
      if (empty) empty.classList.toggle('is-on', vis.length === 0);
      /* пагинация */
      if (pager) {
        var html = '';
        html += '<button type="button" data-pg="prev"' + (state.page <= 1 ? ' disabled' : '') + ' aria-label="Предыдущая страница">←</button>';
        for (var i = 1; i <= pages; i++) {
          html += '<button type="button" data-pg="' + i + '" class="' + (i === state.page ? 'is-on' : '') + '" aria-label="Страница ' + i + '"' + (i === state.page ? ' aria-current="page"' : '') + '>' + i + '</button>';
        }
        html += '<button type="button" data-pg="next"' + (state.page >= pages ? ' disabled' : '') + ' aria-label="Следующая страница">→</button>';
        pager.innerHTML = html;
      }
      chips.forEach(function (b) {
        var on = b.getAttribute('data-filter') === state.cat;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var count = $('#news-count');
      if (count) count.textContent = 'Показано ' + Math.min(PER, Math.max(0, vis.length - from)) + ' из ' + vis.length;
    }
    chips.forEach(function (b) {
      b.addEventListener('click', function () {
        state.cat = b.getAttribute('data-filter');
        state.page = 1;
        render();
        track('news_filter', { cat: state.cat });
      });
    });
    if (pager) pager.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-pg]');
      if (!b || b.disabled) return;
      var pg = b.getAttribute('data-pg');
      var pages = Math.max(1, Math.ceil(visible().length / PER));
      if (pg === 'prev') state.page = Math.max(1, state.page - 1);
      else if (pg === 'next') state.page = Math.min(pages, state.page + 1);
      else state.page = parseInt(pg, 10);
      render();
      track('news_page', { page: state.page });
      grid.scrollIntoView ? grid.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }) : null;
    });
    render();
  })();

  /* ============================================================
     ФОРМА ЗАПИСИ — мастер из 5 экранов (appointment.html)
     ============================================================ */
  (function initWizard() {
    var wiz = $('#wiz');
    if (!wiz) return;

    var BRANDS = ['Лада (LADA)', 'Toyota', 'Kia', 'Hyundai', 'Renault', 'Volkswagen', 'Škoda', 'Nissan',
      'Chevrolet', 'Ford', 'Mitsubishi', 'BMW', 'Mercedes-Benz', 'Audi', 'Mazda',
      'Chery', 'Haval', 'Geely', 'ГАЗ', 'УАЗ'];
    var SVC_GROUPS = [
      { g: 'Колёса', items: [
        { slug: 'shinomontazh', t: 'Шиномонтаж (легковой)' },
        { slug: 'shinomontazh-gruz', t: 'Грузовой шиномонтаж' },
        { slug: 'balansirovka', t: 'Балансировка' },
        { slug: 'pravka-diskov', t: 'Правка / прокатка дисков' },
        { slug: 'porezy-gryzhi', t: 'Порезы и грыжи' },
        { slug: 'vulkanizaciya', t: 'Вулканизация' },
        { slug: 'hranenie-shin', t: 'Сезонное хранение шин' }
      ] },
      { g: 'Ремонт и ТО', items: [
        { slug: 'to-maslo', t: 'ТО и замена масла' },
        { slug: 'razval-shozhdenie', t: 'Развал-схождение' },
        { slug: 'hodovaya-tormoza', t: 'Ходовая и тормоза' },
        { slug: 'rulevye-reyki', t: 'Рулевые рейки' },
        { slug: 'dvigatel', t: 'Двигатель' },
        { slug: 'akpp-mkpp', t: 'АКПП / МКПП' },
        { slug: 'stekla', t: 'Замена стёкол' }
      ] },
      { g: 'Электрика и комфорт', items: [
        { slug: 'elektrika', t: 'Автоэлектрика' },
        { slug: 'kondicionery', t: 'Кондиционеры' }
      ] }
    ];
    var STEPS = [
      { t: 'Автомобиль' }, { t: 'Что нужно' }, { t: 'Когда' }, { t: 'Контакты' }, { t: 'Проверка' }
    ];
    var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    var WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    var DRAFT_KEY = 'ats_wiz_draft_v1';
    var LEADS_KEY = 'ats_leads_demo';

    var st = {
      step: 1, brand: '', model: '', year: '', yearSkip: false, vin: '', vinSkip: false,
      mileage: '', mileageSkip: false, services: [], dontknow: false, photos: [],
      date: '', slot: '', asap: false,
      name: '', phone: '', channel: 'call', consent: false,
      key: uuid(), sent: false, ticket: null
    };

    /* ---------- загрузка/восстановление черновика ---------- */
    var draftNote = $('#draft-note');
    (function restore() {
      var raw = lsGet(DRAFT_KEY);
      if (!raw) return;
      try {
        var d = JSON.parse(raw);
        ['brand', 'model', 'year', 'vin', 'mileage', 'date', 'slot', 'name', 'phone', 'channel'].forEach(function (k) {
          if (typeof d[k] === 'string') st[k] = d[k];
        });
        ['yearSkip', 'vinSkip', 'mileageSkip', 'dontknow', 'asap', 'consent'].forEach(function (k) {
          if (typeof d[k] === 'boolean') st[k] = d[k];
        });
        if (Array.isArray(d.services)) st.services = d.services.filter(function (s) { return typeof s === 'string'; });
        if (typeof d.key === 'string' && d.key) st.key = d.key;
        if (draftNote) draftNote.classList.add('is-on');
      } catch (e) { lsDel(DRAFT_KEY); }
    })();
    var draftTimer = null;
    function saveDraft() {
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = setTimeout(function () {
        var d = {};
        Object.keys(st).forEach(function (k) { if (k !== 'photos' && k !== 'sent' && k !== 'ticket') d[k] = st[k]; });
        lsSet(DRAFT_KEY, JSON.stringify(d));
      }, 500);
    }
    var clearDraft = $('#clear-draft');
    if (clearDraft) clearDraft.addEventListener('click', function () {
      lsDel(DRAFT_KEY);
      if (draftNote) draftNote.classList.remove('is-on');
      track('draft_clear');
    });

    /* ---------- предвыбор услуги из ?s= ---------- */
    (function prefill() {
      var s = qs('s');
      if (s && st.services.indexOf(s) === -1) {
        var all = {};
        SVC_GROUPS.forEach(function (grp) { grp.items.forEach(function (it) { all[it.slug] = 1; }); });
        if (all[s]) st.services.push(s);
      }
    })();

    /* ---------- шаги: переходы, прогресс ---------- */
    var steps = $$('.step', wiz);
    var bar = $('#wiz-bar', wiz);
    var lbl = $('#wiz-step-label', wiz);
    var cnt = $('#wiz-count', wiz);
    var btnBack = $('#wiz-back'), btnNext = $('#wiz-next'), btnSubmit = $('#wiz-submit');
    var lastDir = 1;

    function goStep(n, dir) {
      n = Math.min(Math.max(1, n), 5);
      lastDir = dir || (n >= st.step ? 1 : -1);
      st.step = n;
      steps.forEach(function (s, i) {
        var on = i === n - 1;
        s.classList.toggle('is-on', on);
        s.classList.toggle('go-back', on && lastDir === -1);
        s.setAttribute('aria-hidden', on ? 'false' : 'true');
        $$('input,button,a,select,textarea', s).forEach(function (el) { el.tabIndex = on ? 0 : -1; });
      });
      if (bar) bar.style.transform = 'scaleX(' + (n / 5) + ')';
      if (lbl) lbl.textContent = 'Шаг ' + n + ' из 5 — ' + STEPS[n - 1].t;
      if (cnt) cnt.textContent = n + ' / 5';
      if (btnBack) btnBack.style.visibility = n === 1 ? 'hidden' : 'visible';
      var isLast = n === 5;
      if (btnNext) btnNext.style.display = isLast ? 'none' : '';
      if (btnSubmit) btnSubmit.style.display = isLast ? '' : 'none';
      if (isLast) renderSummary();
      syncNextState();
      saveDraft();
      if (typeof wiz.scrollIntoView === 'function' && dir) {
        try { wiz.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }); } catch (e) { /* jsdom */ }
      }
      track('step_view', { step: n });
    }

    /* ---------- валидация шагов ---------- */
    function setErr(inp, msg) {
      if (!inp) return false;
      var f = inp.closest('.field') || inp.closest('.consent-row') || inp;
      var e = f.querySelector ? f.querySelector('.err') : null;
      if (msg) {
        inp.classList.add('is-bad');
        if (e) { e.textContent = msg; e.classList.add('is-on'); }
        inp.setAttribute('aria-invalid', 'true');
        return false;
      }
      inp.classList.remove('is-bad');
      if (e) e.classList.remove('is-on');
      inp.removeAttribute('aria-invalid');
      return true;
    }
    function yearOK(v) { var n = parseInt(v, 10); return String(n) === String(v).trim() && n >= 1980 && n <= 2026; }
    function validate(n, show) {
      var ok = true, firstBad = null;
      function chk(cond, inp, msg) {
        if (cond) { if (show) setErr(inp, msg); ok = false; if (!firstBad) firstBad = inp; }
        else if (show) setErr(inp, '');
      }
      if (n === 1) {
        var brand = $('#f-brand');
        chk(!st.brand.trim(), brand, 'Укажите марку — начните вводить или выберите из списка');
        var year = $('#f-year');
        if (!st.yearSkip) {
          var yv = String(year.value).trim();
          chk(yv !== '' && !yearOK(yv), year, 'Год выпуска — от 1980 до 2026');
        }
        var vin = $('#f-vin');
        if (!st.vinSkip) {
          var vv = vin.value.trim();
          chk(vv !== '' && !vinOK(vv), vin, 'VIN — ровно 17 символов, без I, O и Q');
        }
        var mil = $('#f-mileage');
        if (!st.mileageSkip) {
          var mv = String(mil.value).trim();
          chk(mv !== '' && (!/^\d+$/.test(mv) || +mv > 1500000), mil, 'Пробег — число километров, например 84000');
        }
      }
      if (n === 2) {
        chk(st.services.length === 0 && !st.dontknow, $('#svc-err-anchor'), 'Отметьте хотя бы одну услугу или «Не знаю — нужна диагностика»');
      }
      if (n === 3) {
        chk(!st.asap && !(st.date && st.slot), $('#when-err-anchor'), 'Выберите дату и время или нажмите «Как можно скорее»');
      }
      if (n === 4) {
        var name = $('#f-name');
        chk(name.value.trim().length < 2, name, 'Как к вам обращаться? Минимум 2 символа');
        var ph = $('#f-phone');
        chk(!phoneOK(ph.value), ph, 'Телефон — 11 цифр, формат +7 (999) 999-99-99');
        chk(!st.consent, $('#f-consent'), 'Без согласия на обработку данных отправить заявку нельзя');
      }
      return { ok: ok, firstBad: firstBad };
    }
    function syncNextState() {
      var v = validate(st.step, false);
      var btn = st.step === 5 ? btnSubmit : btnNext;
      if (btn) {
        btn.setAttribute('aria-disabled', v.ok ? 'false' : 'true');
        btn.classList.toggle('is-off', !v.ok);
      }
    }

    /* ---------- шаг 1: марка (поиск), модель, год, VIN, пробег ---------- */
    var brand = $('#f-brand'), sugg = $('#brand-sugg');
    var suggIdx = -1;
    function renderSugg(q) {
      if (!sugg) return;
      var ql = q.trim().toLowerCase();
      var list = ql ? BRANDS.filter(function (b) { return b.toLowerCase().indexOf(ql) !== -1; }) : BRANDS.slice(0, 8);
      var html = list.map(function (b, i) {
        return '<button type="button" data-b="' + esc(b) + '" class="' + (i === suggIdx ? 'is-cursor' : '') + '">' + esc(b) + '</button>';
      }).join('');
      html += '<div class="more">Нет вашей марки? Впишите её прямо в поле — мы обслуживаем любые автомобили. <button type="button" data-b="__other" class="skip-chip" style="margin-left:6px">Другая марка</button></div>';
      sugg.innerHTML = html;
      sugg.classList.add('is-open');
    }
    function closeSugg() { if (sugg) sugg.classList.remove('is-open'); suggIdx = -1; }
    if (brand) {
      brand.value = st.brand;
      brand.addEventListener('focus', function () { suggIdx = -1; renderSugg(brand.value); });
      brand.addEventListener('input', function () {
        st.brand = brand.value; suggIdx = -1; renderSugg(brand.value); saveDraft(); syncNextState(); setErr(brand, '');
      });
      brand.addEventListener('keydown', function (e) {
        if (!sugg || !sugg.classList.contains('is-open')) return;
        var btns = $$('button[data-b]', sugg);
        if (e.key === 'ArrowDown') { e.preventDefault(); suggIdx = (suggIdx + 1) % btns.length; btns.forEach(function (b, i) { b.classList.toggle('is-cursor', i === suggIdx); }); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); suggIdx = (suggIdx - 1 + btns.length) % btns.length; btns.forEach(function (b, i) { b.classList.toggle('is-cursor', i === suggIdx); }); }
        else if (e.key === 'Enter' && suggIdx >= 0 && btns[suggIdx]) { e.preventDefault(); e.stopPropagation(); btns[suggIdx].click(); }
        else if (e.key === 'Escape') { closeSugg(); }
      });
      if (sugg) sugg.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-b]');
        if (!b) return;
        var v = b.getAttribute('data-b');
        if (v === '__other') { brand.value = ''; brand.focus(); st.brand = ''; return; }
        brand.value = v; st.brand = v; closeSugg(); setErr(brand, ''); saveDraft(); syncNextState();
      });
      document.addEventListener('click', function (e) {
        if (sugg && !e.target.closest('.combo')) closeSugg();
      });
    }
    var model = $('#f-model');
    if (model) { model.value = st.model; model.addEventListener('input', function () { st.model = model.value; saveDraft(); }); }
    var year = $('#f-year');
    if (year) {
      year.value = st.year;
      year.addEventListener('input', function () {
        year.value = year.value.replace(/[^\d]/g, '').slice(0, 4);
        st.year = year.value;
        if (yearOK(year.value)) setErr(year, '');
        saveDraft(); syncNextState();
      });
    }
    bindSkip('skip-year', 'yearSkip', year, 'Год не указан — уточним на месте');
    var vin = $('#f-vin');
    if (vin) { vin.value = st.vin; vin.addEventListener('input', function () { st.vin = vin.value; saveDraft(); syncNextState(); }); }
    bindSkip('skip-vin', 'vinSkip', vin, 'VIN не указан — найдём по документам');
    var mil = $('#f-mileage');
    if (mil) {
      mil.value = st.mileage;
      mil.addEventListener('input', function () {
        mil.value = mil.value.replace(/[^\d]/g, '').slice(0, 7);
        st.mileage = mil.value; setErr(mil, ''); saveDraft(); syncNextState();
      });
    }
    bindSkip('skip-mileage', 'mileageSkip', mil, 'Пробег не указан');
    function bindSkip(btnId, key, inp, offText) {
      var b = document.getElementById(btnId);
      if (!b) return;
      b.setAttribute('aria-pressed', st[key] ? 'true' : 'false');
      b.addEventListener('click', function () {
        st[key] = !st[key];
        b.setAttribute('aria-pressed', st[key] ? 'true' : 'false');
        if (inp) {
          inp.disabled = !!st[key];
          if (st[key]) { inp.dataset.prev = inp.value; inp.value = ''; }
          else if (inp.dataset.prev) { inp.value = inp.dataset.prev; delete inp.dataset.prev; }
          setErr(inp, '');
        }
        if (key === 'yearSkip' && !st[key] ) { /* ничего */ }
        b.textContent = st[key] ? offText + ' · вернуть поле' : b.dataset.label;
        saveDraft(); syncNextState();
        track('skip_field', { field: key.replace('Skip', ''), on: st[key] });
      });
      b.dataset.label = b.textContent.trim();
      /* восстановление после черновика */
      if (st[key]) { b.setAttribute('aria-pressed', 'true'); if (inp) inp.disabled = true; b.textContent = offText + ' · вернуть поле'; }
    }

    /* ---------- шаг 2: чипы услуг + фото ---------- */
    var chipBox = $('#svc-chips');
    if (chipBox) {
      var html = SVC_GROUPS.map(function (grp) {
        return '<div class="chip-group"><h3>' + esc(grp.g) + '</h3><div class="chips">' +
          grp.items.map(function (it) {
            var on = st.services.indexOf(it.slug) !== -1;
            return '<label class="chip"><input type="checkbox" name="svc" value="' + it.slug + '"' + (on ? ' checked' : '') + '><span>' + esc(it.t) + '</span></label>';
          }).join('') + '</div></div>';
      }).join('');
      html += '<div class="chip-group"><h3>Не определились?</h3><div class="chips">' +
        '<label class="chip chip--dk"><input type="checkbox" id="svc-dontknow" value="diagnostika"' + (st.dontknow ? ' checked' : '') + '><span>Не знаю — нужна диагностика</span></label>' +
        '</div></div>';
      chipBox.innerHTML = html;
      chipBox.addEventListener('change', function (e) {
        var cb = e.target;
        if (cb.id === 'svc-dontknow') {
          st.dontknow = cb.checked;
        } else if (cb.name === 'svc') {
          var v = cb.value;
          if (cb.checked && st.services.indexOf(v) === -1) st.services.push(v);
          if (!cb.checked) st.services = st.services.filter(function (x) { return x !== v; });
        }
        setErr($('#svc-err-anchor'), '');
        saveDraft(); syncNextState();
      });
    }
    /* фото: до 3 файлов, превью, удаление (dataURL живёт только в памяти) */
    var photoBox = $('#photos'), photoInp = $('#f-photos');
    function renderPhotos() {
      if (!photoBox) return;
      photoBox.innerHTML = st.photos.map(function (p, i) {
        return '<span class="photo-item"><img src="' + p.url + '" alt="Превью: ' + esc(p.name) + '"><button type="button" class="photo-del" data-del="' + i + '" aria-label="Удалить фото ' + esc(p.name) + '">✕</button></span>';
      }).join('') + (st.photos.length < 3
        ? '<button type="button" class="photo-add" id="photo-add"><span class="plus">+</span>Фото<br>(до 3)</button>'
        : '');
      var add = $('#photo-add');
      if (add) add.addEventListener('click', function () { photoInp && photoInp.click(); });
      $$('.photo-del', photoBox).forEach(function (b) {
        b.addEventListener('click', function () {
          st.photos.splice(+b.getAttribute('data-del'), 1);
          renderPhotos(); saveDraft();
          track('photo_removed');
        });
      });
    }
    if (photoInp) {
      photoInp.addEventListener('change', function () {
        var files = Array.prototype.slice.call(photoInp.files || []);
        files.forEach(function (f) {
          if (st.photos.length >= 3) return;
          if (!/^image\//.test(f.type)) return;
          try {
            var fr = new FileReader();
            fr.onload = function () {
              st.photos.push({ name: f.name, url: String(fr.result) });
              renderPhotos();
              track('photo_added', { count: st.photos.length });
            };
            fr.readAsDataURL(f);
          } catch (e) { /* FileReader недоступен — пропускаем */ }
        });
        photoInp.value = '';
      });
    }
    renderPhotos();

    /* ---------- шаг 3: календарь на 14 дней + слоты 09:00–19:00 ---------- */
    var calBox = $('#cal'), slotBox = $('#slots'), slotTitle = $('#slot-title');
    function dayKey(d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function dayLabel(d) {
      return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
    }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var DAYS = [];
    for (var di = 0; di < 14; di++) {
      var dd = new Date(today.getTime()); dd.setDate(dd.getDate() + di); DAYS.push(dd);
    }
    function busyFor(key) {
      /* детерминированные «занятые» слоты: 2–4 на день, без сети */
      var h = 0;
      for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 100003;
      var n = 2 + (h % 3), set = {};
      for (var j = 0; j < n; j++) set[(h * (j + 7)) % 10] = 1;
      return set;
    }
    function renderCal() {
      if (!calBox) return;
      calBox.innerHTML = DAYS.map(function (d, i) {
        var k = dayKey(d);
        var cls = 'cal-day' + (k === st.date ? ' is-on' : '') + (i === 0 ? ' is-today' : '');
        return '<button type="button" class="' + cls + '" data-day="' + k + '" aria-pressed="' + (k === st.date) + '">' +
          '<span class="wd">' + (i === 0 ? 'сегодня' : WD[d.getDay()]) + '</span>' +
          '<span class="dd">' + d.getDate() + '</span>' +
          '<span class="mm">' + MONTHS[d.getMonth()] + '</span></button>';
      }).join('');
    }
    function renderSlots() {
      if (!slotBox) return;
      if (!st.date || st.asap) {
        slotBox.innerHTML = '<p class="hint">' + (st.asap ? 'Выбран режим «как можно скорее» — слот не нужен.' : 'Сначала выберите дату — появятся свободные часы.') + '</p>';
        if (slotTitle) slotTitle.textContent = 'Время визита';
        return;
      }
      var busy = busyFor(st.date);
      var html = '';
      for (var h = 9; h <= 18; h++) {
        var t = String(h).padStart(2, '0') + ':00';
        var isBusy = !!busy[h - 9];
        var on = st.slot === t;
        html += '<button type="button" class="slot' + (on ? ' is-on' : '') + '" data-slot="' + t + '"' +
          (isBusy ? ' disabled aria-label="' + t + ' — занято"' : ' aria-pressed="' + on + '"') + '>' + t + '</button>';
      }
      slotBox.innerHTML = html;
      if (slotTitle) slotTitle.textContent = 'Время визита · ' + dayLabel(new Date(st.date + 'T00:00:00')) + ' · занятое время недоступно';
    }
    if (calBox) calBox.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-day]');
      if (!b) return;
      st.date = b.getAttribute('data-day');
      st.asap = false;
      var asapBtn = $('#asap-btn');
      if (asapBtn) asapBtn.setAttribute('aria-pressed', 'false');
      st.slot = '';
      renderCal(); renderSlots(); setErr($('#when-err-anchor'), ''); saveDraft(); syncNextState();
      track('date_pick', { date: st.date });
    });
    if (slotBox) slotBox.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-slot]');
      if (!b || b.disabled) return;
      st.slot = b.getAttribute('data-slot');
      renderSlots(); setErr($('#when-err-anchor'), ''); saveDraft(); syncNextState();
      track('slot_pick', { slot: st.slot });
    });
    var asapBtn = $('#asap-btn');
    if (asapBtn) {
      asapBtn.setAttribute('aria-pressed', st.asap ? 'true' : 'false');
      asapBtn.addEventListener('click', function () {
        st.asap = !st.asap;
        asapBtn.setAttribute('aria-pressed', st.asap ? 'true' : 'false');
        if (st.asap) { st.date = ''; st.slot = ''; }
        renderCal(); renderSlots(); setErr($('#when-err-anchor'), ''); saveDraft(); syncNextState();
        track('asap_toggle', { on: st.asap });
      });
    }

    /* ---------- шаг 4: контакты ---------- */
    var nameI = $('#f-name'), phoneI = $('#f-phone'), consentI = $('#f-consent');
    if (nameI) { nameI.value = st.name; nameI.addEventListener('input', function () { st.name = nameI.value; setErr(nameI, ''); saveDraft(); syncNextState(); }); }
    if (phoneI) { phoneI.value = st.phone; phoneI.addEventListener('input', function () { st.phone = phoneI.value; setErr(phoneI, ''); saveDraft(); syncNextState(); }); }
    $$('input[name="channel"]').forEach(function (r) {
      r.checked = r.value === st.channel;
      r.addEventListener('change', function () { if (r.checked) { st.channel = r.value; saveDraft(); } });
    });
    if (consentI) {
      consentI.checked = st.consent;
      consentI.addEventListener('change', function () {
        st.consent = consentI.checked;
        setErr(consentI, '');
        var row = consentI.closest('.consent-row');
        if (row) row.classList.remove('is-bad');
        saveDraft(); syncNextState();
      });
    }

    /* ---------- шаг 5: сводка ---------- */
    function svcNames() {
      var names = [];
      SVC_GROUPS.forEach(function (grp) { grp.items.forEach(function (it) { if (st.services.indexOf(it.slug) !== -1) names.push(it.t); }); });
      if (st.dontknow) names.push('Не знаю — нужна диагностика');
      return names;
    }
    function whenText() {
      if (st.asap) return 'Как можно скорее — подберём ближайшее окно и перезвоним';
      if (!st.date) return 'Не выбрано';
      return dayLabel(new Date(st.date + 'T00:00:00')) + (st.slot ? ', ' + st.slot : '');
    }
    function carText() {
      var parts = [];
      if (st.brand) parts.push(st.brand);
      if (st.model) parts.push(st.model);
      if (st.yearSkip) parts.push('год не помню');
      else if (st.year) parts.push(st.year + ' г.');
      if (st.vinSkip) parts.push('VIN не знаю');
      else if (st.vin) parts.push('VIN ' + st.vin);
      if (st.mileageSkip) parts.push('пробег не знаю');
      else if (st.mileage) parts.push(st.mileage + ' км');
      return parts.join(' · ') || 'Не заполнено';
    }
    function renderSummary() {
      var box = $('#summary');
      if (!box) return;
      box.innerHTML =
        sumRow('Авто', carText(), 1) +
        sumRow('Услуги', svcNames().join(', ') || 'Не выбраны', 2, st.photos.length ? st.photos.length + ' фото прикреплено' : '') +
        sumRow('Когда', whenText(), 3) +
        sumRow('Контакты', (st.name || '—') + ' · ' + (st.phone || '—'), 4, st.channel === 'telegram' ? 'Канал: Telegram' : 'Канал: звонок') +
        sumRow('Согласие', st.consent ? 'Дано — обработка данных разрешена' : 'НЕ ДАНО', 4);
      $$('.edit', box).forEach(function (b) {
        b.addEventListener('click', function () { goStep(+b.getAttribute('data-edit'), -1); track('summary_edit', { step: +b.getAttribute('data-edit') }); });
      });
      function sumRow(k, v, step, small) {
        return '<div class="sum-row"><span class="k">' + k + '</span><span class="v">' + esc(v) + (small ? '<small>' + esc(small) + '</small>' : '') + '</span><button type="button" class="edit" data-edit="' + step + '">изменить</button></div>';
      }
    }

    /* ---------- payload ---------- */
    function buildPayload() {
      return {
        name: st.name.trim(),
        phone: '+7' + digits(st.phone).slice(1),
        contact_method: st.channel === 'telegram' ? 'telegram' : 'call',
        car: {
          brand: st.brand.trim(),
          model: st.model.trim() || null,
          year: st.yearSkip || !st.year ? null : parseInt(st.year, 10),
          vin: st.vinSkip || !st.vin ? null : st.vin.trim(),
          mileage: st.mileageSkip || !st.mileage ? null : parseInt(st.mileage, 10)
        },
        services: st.dontknow ? st.services.concat(['diagnostika']) : st.services.slice(),
        preferred: { date: st.asap ? null : (st.date || null), slot: st.asap ? null : (st.slot || null), asap: !!st.asap },
        photos_count: st.photos.length,
        consent: !!st.consent,
        page: 'appointment',
        idempotency_key: st.key
      };
    }
    var payBtn = $('#payload-btn'), payPre = $('#payload-pre'), payBox = $('#payload');
    function renderPayload() { if (payPre) payPre.textContent = JSON.stringify(buildPayload(), null, 2); }
    if (payBtn) payBtn.addEventListener('click', function () {
      var open = payBox.classList.toggle('is-open');
      payBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { renderPayload(); track('payload_view'); }
    });

    /* ---------- отправка: имитация 700–1200 мс, без сети ---------- */
    var wizStepsBox = $('#wiz-steps'), wizFoot = $('.wiz-foot');
    var stateSending = $('#state-sending'), stateOK = $('#state-ok'), stateErr = $('#state-err');
    function showState(which) {
      if (wizStepsBox) wizStepsBox.style.display = which === 'form' ? '' : 'none';
      if (wizFoot) wizFoot.style.display = which === 'form' ? '' : 'none';
      [stateSending, stateOK, stateErr].forEach(function (el) { if (el) el.classList.remove('is-on'); });
      if (which === 'sending' && stateSending) stateSending.classList.add('is-on');
      if (which === 'ok' && stateOK) stateOK.classList.add('is-on');
      if (which === 'err' && stateErr) stateErr.classList.add('is-on');
    }
    function ticketNo(key) {
      var d = new Date();
      var dm = String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0');
      var h = 0;
      for (var i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) % 9973;
      return 'A-' + dm + '-' + String(1000 + h).slice(-4);
    }
    function saveLeadDemo(no) {
      try {
        var leads = JSON.parse(lsGet(LEADS_KEY) || '[]');
        if (!Array.isArray(leads)) leads = [];
        if (leads.some(function (l) { return l.no === no; })) return;
        leads.unshift({
          no: no, name: st.name.trim(), phone: st.phone, services: svcNames(),
          when: whenText(), ts: new Date().toISOString(), status: 'new', key: st.key
        });
        lsSet(LEADS_KEY, JSON.stringify(leads.slice(0, 20)));
      } catch (e) { /* приватный режим — не падаем */ }
    }
    function renderSuccess(no) {
      if (stateOK) {
        $('#ok-no', stateOK).textContent = no;
        var dl = $('#ok-dl', stateOK);
        if (dl) {
          dl.innerHTML = '<dt>Когда</dt><dd>' + esc(whenText()) + '</dd>' +
            '<dt>Услуги</dt><dd>' + esc(svcNames().join(', ') || 'уточним по телефону') + '</dd>' +
            '<dt>Свяжемся через</dt><dd>' + (st.channel === 'telegram' ? 'Telegram' : 'звонок на ' + esc(st.phone)) + '</dd>';
        }
      }
    }
    function submit() {
      if (st.sent && st.ticket) {
        /* повторная отправка той же заявки — дубль не создаём (идемпотентность) */
        renderSuccess(st.ticket);
        showState('ok');
        var dup = $('#ok-dup');
        if (dup) dup.hidden = false;
        track('submit_duplicate_blocked', { ticket: st.ticket });
        return;
      }
      /* на шаге 5 все предыдущие шаги должны быть валидны */
      for (var i = 1; i <= 4; i++) {
        var v = validate(i, false);
        if (!v.ok) { goStep(i, -1); var v2 = validate(i, true); if (v2.firstBad && v2.firstBad.focus) v2.firstBad.focus(); track('step_blocked', { step: i }); return; }
      }
      track('submit_attempt', { key: st.key.slice(0, 8) });
      showState('sending');
      var delay = 700 + Math.round(Math.random() * 500);
      setTimeout(function () {
        /* демо-триггер ошибки: телефон +7 (900) 000-00-00 */
        var isDemoError = digits(st.phone) === '79000000000';
        if (isDemoError) {
          showState('err');
          track('submit_error_demo');
          return;
        }
        st.sent = true;
        st.ticket = ticketNo(st.key);
        renderSuccess(st.ticket);
        saveLeadDemo(st.ticket);
        lsDel(DRAFT_KEY);
        showState('ok');
        track('submit_success', { ticket: st.ticket });
      }, delay);
    }
    var retryBtn = $('#err-retry'), againBtn = $('#ok-again'), homeBtn = $('#ok-home');
    if (retryBtn) retryBtn.addEventListener('click', function () {
      showState('form');
      goStep(4, -1);
      track('submit_retry');
    });
    if (againBtn) againBtn.addEventListener('click', function () {
      /* новая заявка: новый ключ идемпотентности */
      st = Object.assign({}, st, { step: 1, brand: '', model: '', year: '', yearSkip: false, vin: '', vinSkip: false, mileage: '', mileageSkip: false, services: [], dontknow: false, photos: [], date: '', slot: '', asap: false, name: '', phone: '', channel: 'call', consent: false, key: uuid(), sent: false, ticket: null });
      if (brand) brand.value = ''; if (model) model.value = ''; if (year) year.value = '';
      if (vin) vin.value = ''; if (mil) mil.value = ''; if (nameI) nameI.value = ''; if (phoneI) phoneI.value = '';
      if (consentI) consentI.checked = false;
      $$('input[name="svc"],#svc-dontknow').forEach(function (c) { c.checked = false; });
      renderPhotos(); renderCal(); renderSlots();
      showState('form'); goStep(1, -1);
    });
    if (homeBtn) homeBtn.addEventListener('click', function () { location.href = 'index.html'; });

    /* ---------- кнопки «Назад / Далее / Отправить» ---------- */
    if (btnBack) btnBack.addEventListener('click', function () {
      goStep(st.step - 1, -1);
      track('step_back', { from: st.step + 1 });
    });
    if (btnNext) btnNext.addEventListener('click', function () {
      var v = validate(st.step, true);
      if (!v.ok) {
        if (v.firstBad && v.firstBad.focus) {
          v.firstBad.focus({ preventScroll: true });
          if (typeof v.firstBad.scrollIntoView === 'function') { try { v.firstBad.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); } catch (e) { /* jsdom */ } }
        }
        track('step_blocked', { step: st.step });
        return;
      }
      goStep(st.step + 1, 1);
      track('step_next', { to: st.step });
    });
    if (btnSubmit) btnSubmit.addEventListener('click', submit);
    wiz.addEventListener('keydown', function (e) {
      var tag = e.target.tagName, ty = (e.target.type || '').toLowerCase();
      var skip = tag === 'TEXTAREA' || tag === 'BUTTON' || (tag === 'INPUT' && (ty === 'checkbox' || ty === 'radio' || ty === 'file')) || e.target.closest('.sugg');
      if (e.key === 'Enter' && !skip) {
        e.preventDefault();
        if (st.step < 5) { if (btnNext) btnNext.click(); } else submit();
      }
    });

    /* старт */
    renderCal(); renderSlots(); renderPayload(); goStep(st.step || 1, 0);
    if (st.brand || st.services.length || st.date) track('draft_restored');
  })();

  /* ============================================================
     КОРОТКАЯ ФОРМА (contacts.html): имя, телефон, сообщение, согласие
     ============================================================ */
  (function initContactForm() {
    var form = $('#cform');
    if (!form) return;
    var name = $('#c-name'), phone = $('#c-phone'), msg = $('#c-msg'), consent = $('#c-consent');
    var send = $('#c-send'), box = $('#cform-box'), stOk = $('#cform-ok'), stSend = $('#cform-sending');
    var sent = false, key = uuid();
    function setErr(inp, m) {
      var f = inp.closest('.field') || inp.closest('.consent-row');
      var e = f && f.querySelector ? f.querySelector('.err') : null;
      if (m) { inp.classList.add('is-bad'); if (e) { e.textContent = m; e.classList.add('is-on'); } inp.setAttribute('aria-invalid', 'true'); return false; }
      inp.classList.remove('is-bad'); if (e) e.classList.remove('is-on'); inp.removeAttribute('aria-invalid'); return true;
    }
    function validate(show) {
      var ok = true, first = null;
      if (name.value.trim().length < 2) { ok = false; if (show) setErr(name, 'Минимум 2 символа'); if (!first) first = name; } else if (show) setErr(name, '');
      if (!phoneOK(phone.value)) { ok = false; if (show) setErr(phone, 'Телефон — 11 цифр, формат +7 (999) 999-99-99'); if (!first) first = phone; } else if (show) setErr(phone, '');
      if (!consent.checked) { ok = false; if (!first) first = consent; var row = consent.closest('.consent-row'); if (row && show) row.classList.add('is-bad'); }
      else { var row2 = consent.closest('.consent-row'); if (row2) row2.classList.remove('is-bad'); }
      return { ok: ok, first: first };
    }
    [name, phone].forEach(function (i) { i.addEventListener('input', function () { validate(false); }); });
    consent.addEventListener('change', function () { validate(false); });
    send.addEventListener('click', function () {
      var v = validate(true);
      if (!v.ok) { if (v.first && v.first.focus) v.first.focus(); track('contact_blocked'); return; }
      if (sent) { box.hidden = true; stOk.classList.add('is-on'); return; }
      track('contact_submit_attempt');
      var prevErr = $('#cform-err');
      if (prevErr) prevErr.classList.remove('is-on');
      box.hidden = true; stSend.classList.add('is-on');
      setTimeout(function () {
        var isDemoError = digits(phone.value) === '79000000000';
        stSend.classList.remove('is-on');
        if (isDemoError) {
          box.hidden = false;
          $('#cform-err').classList.add('is-on');
          track('contact_error_demo');
          return;
        }
        sent = true;
        var d = new Date();
        var no = 'K-' + String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(Math.floor(Math.random() * 9000) + 1000);
        $('#c-ok-no').textContent = no;
        stOk.classList.add('is-on');
        track('contact_success', { no: no });
      }, 700 + Math.round(Math.random() * 500));
    });
    var payloadBtn = $('#c-payload-btn'), payloadPre = $('#c-payload-pre');
    if (payloadBtn) payloadBtn.addEventListener('click', function () {
      payloadPre.textContent = JSON.stringify({
        name: name.value.trim(), phone: '+7' + digits(phone.value).slice(1),
        message: msg.value.trim() || null, consent: consent.checked,
        page: 'contacts', idempotency_key: key
      }, null, 2);
      var wrap = payloadPre.closest('.payload');
      var open = wrap.classList.toggle('is-open');
      payloadBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) track('payload_view', { page: 'contacts' });
    });
  })();

  /* ============================================================
     ДЕМО-АДМИНКА (admin.html) — без сети, состояние в localStorage
     ============================================================ */
  (function initAdmin() {
    var root = $('#adm');
    if (!root) return;
    var LEADS_KEY = 'ats_leads_demo', LOG_KEY = 'ats_admin_log', PUB_KEY = 'ats_admin_pub';
    function leads() {
      var out = [];
      try { out = JSON.parse(lsGet(LEADS_KEY) || '[]'); } catch (e) { out = []; }
      if (!Array.isArray(out)) out = [];
      var seeds = [
        { no: 'A-1910-2841', name: 'Сергей', phone: '+7 (900) 000-00-01', services: ['Шиномонтаж (легковой)', 'Балансировка'], when: '21.10.2026, 11:00', status: 'work', demo: true },
        { no: 'A-1910-7710', name: 'Марина', phone: '+7 (900) 000-00-02', services: ['ТО и замена масла'], when: 'Как можно скорее', status: 'new', demo: true },
        { no: 'A-1810-5533', name: 'Игорь', phone: '+7 (900) 000-00-03', services: ['Правка / прокатка дисков'], when: '18.10.2026, 15:00', status: 'done', demo: true }
      ];
      var real = out.map(function (l) { return { no: l.no, name: l.name, phone: l.phone, services: l.services, when: l.when, status: l.status || 'new', demo: false }; });
      return real.concat(seeds);
    }
    var STAT = { 'new': ['badge--new', 'Новая'], 'work': ['badge--work', 'В работе'], 'done': ['badge--done', 'Готово'] };
    function log(s) {
      var arr = [];
      try { arr = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { arr = []; }
      var d = new Date();
      arr.unshift({ t: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0'), s: s });
      lsSet(LOG_KEY, JSON.stringify(arr.slice(0, 40)));
      renderLog();
    }
    function renderLog() {
      var box = $('#adm-log');
      if (!box) return;
      var arr = [];
      try { arr = JSON.parse(lsGet(LOG_KEY) || '[]'); } catch (e) { arr = []; }
      box.innerHTML = arr.length ? arr.map(function (l) { return '<li><time>' + esc(l.t) + '</time>' + esc(l.s) + '</li>'; }).join('') : '<li>Пока пусто — действия появятся здесь.</li>';
    }
    function renderLeads() {
      var tb = $('#adm-leads');
      if (!tb) return;
      tb.innerHTML = leads().map(function (l) {
        var s = STAT[l.status] || STAT['new'];
        return '<tr data-no="' + esc(l.no) + '">' +
          '<td><b>' + esc(l.no) + '</b><span class="sub">' + esc(l.when) + '</span></td>' +
          '<td>' + esc(l.name) + '<span class="sub">' + esc(l.phone) + (l.demo ? ' · демо-заявка' : '') + '</span></td>' +
          '<td>' + l.services.map(esc).join(', ') + '</td>' +
          '<td><span class="badge ' + s[0] + '">' + s[1] + '</span>' +
          '<span class="adm-actions">' +
          ['new', 'work', 'done'].map(function (k) {
            return '<button type="button" data-st="' + k + '"' + (l.status === k ? ' class="is-on"' : '') + '>' + STAT[k][1] + '</button>';
          }).join('') + '</span></td></tr>';
      }).join('');
    }
    root.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-st]');
      if (!b) return;
      var tr = b.closest('tr');
      var no = tr.getAttribute('data-no');
      /* меняем статус только у заявок из localStorage (демо-сиды — статичны) */
      var arr = [];
      try { arr = JSON.parse(lsGet(LEADS_KEY) || '[]'); } catch (err) { arr = []; }
      var hit = arr.filter(function (l) { return l.no === no; })[0];
      if (hit) { hit.status = b.getAttribute('data-st'); lsSet(LEADS_KEY, JSON.stringify(arr)); }
      renderLeads();
      log('Статус ' + no + ' → ' + (STAT[b.getAttribute('data-st')] || [])[1]);
      track('admin_status', { no: no, status: b.getAttribute('data-st') });
    });

    /* публикация кейса: таймер 60 с, «в продакшне — сразу в галерее» */
    var pubTitle = $('#pub-title'), pubBtn = $('#pub-btn'), pubT = $('#pub-t'), pubState = $('#pub-state');
    var timer = null;
    var left = parseInt(lsGet(PUB_KEY) || '0', 10);
    if (left > 0) startPub(true);
    function startPub(resume) {
      if (!resume) { left = 60; pubTitle.value = pubTitle.value.trim() || 'Новый кейс: правка диска R17'; lsSet(PUB_KEY, String(left)); log('Кейс «' + pubTitle.value + '» поставлен в очередь публикации'); track('admin_publish_start'); }
      pubBtn.disabled = true;
      pubState.textContent = 'Публикуем…';
      render();
      timer = setInterval(function () {
        left--;
        lsSet(PUB_KEY, String(Math.max(0, left)));
        if (left <= 0) {
          clearInterval(timer); timer = null;
          pubBtn.disabled = false;
          pubState.innerHTML = '<b style="color:var(--emerald)">Опубликовано (демо)</b> — на живом сайте кейс уже виден в галерее на главной. KPI: публикация ≤ 60 с — выполнено.';
          log('Кейс опубликован за 60 с (демо)');
          track('admin_publish_done');
        }
        render();
      }, 1000);
    }
    function render() { if (pubT) pubT.textContent = (timer ? left + ' с' : '—'); }
    if (pubBtn) pubBtn.addEventListener('click', function () { startPub(false); });
    render(); renderLeads(); renderLog();
  })();
})();
