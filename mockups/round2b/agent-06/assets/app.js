/* ============================================================
   АвтоТехСервис · раунд 2Б · app.js
   Нативный JS, без библиотек. Никаких сетевых вызовов:
   fetch, XMLHttpRequest, sendBeacon, WebSocket не используются.
   Отправка форм имитируется таймером 700–1200 мс.
   ============================================================ */
(function () {
  'use strict';

  document.documentElement.classList.remove('no-js');

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 0. Демо-аналитика (только в память) ---------- */
  var EVENTS = [];
  function track(name, data) {
    EVENTS.push({ t: new Date().toISOString(), name: name, data: data || null });
    if (EVENTS.length > 300) EVENTS.shift();
  }
  window.__atsEvents = EVENTS;
  track('page_view', { page: document.body.getAttribute('data-page') || 'unknown' });

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-ev]');
    if (!el) return;
    var name = el.getAttribute('data-ev');
    if (name === 'quiz_open') return; // отдельный обработчик ниже
    track(name, { label: el.getAttribute('data-ev-label') || null });
  }, true);

  /* ---------- 1. Модальные окна ---------- */
  var openLayer = null, lastFocus = null;

  function focusables(root) {
    return $$('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])', root)
      .filter(function (el) { return el.offsetParent !== null || el === document.activeElement; });
  }

  function openModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (openLayer) closeModal(true);
    lastFocus = document.activeElement;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add('is-open'); });
    document.body.style.overflow = 'hidden';
    openLayer = el;
    $$('[data-open="' + id + '"]').forEach(function (b) { if (b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', 'true'); });
    var f = focusables(el);
    (f[0] || el).focus();
  }

  function closeModal(silent) {
    if (!openLayer) return;
    var el = openLayer;
    el.classList.remove('is-open');
    openLayer = null;
    document.body.style.overflow = '';
    $$('[data-open="' + el.id + '"]').forEach(function (b) { if (b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', 'false'); });
    setTimeout(function () { if (!openLayer) el.hidden = true; }, reduced ? 0 : 180);
    if (!silent && lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('click', function (e) {
    var opener = e.target.closest && e.target.closest('[data-open]');
    if (opener) {
      e.preventDefault();
      openModal(opener.getAttribute('data-open'));
      return;
    }
    var closer = e.target.closest && e.target.closest('[data-close]');
    if (closer) {
      e.preventDefault();
      closeModal();
      return;
    }
    if (openLayer && e.target === openLayer) closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (!openLayer) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key !== 'Tab') return;
    var f = focusables(openLayer);
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  $$('[data-open]').forEach(function (b) {
    if (b.tagName === 'BUTTON' && !b.hasAttribute('type')) b.setAttribute('type', 'button');
  });

  /* ---------- 2. Шапка и мобильное меню ---------- */
  var hdr = $('#hdr');
  if (hdr) {
    var onScroll = function () {
      if (window.scrollY > 24) hdr.classList.add('is-compact');
      else hdr.classList.remove('is-compact');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  var burger = $('#burger'), mnav = $('#mnav');
  if (burger && mnav) {
    var closeMnav = function () {
      mnav.classList.remove('is-open');
      burger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      setTimeout(function () { if (!mnav.classList.contains('is-open')) mnav.hidden = true; }, reduced ? 0 : 220);
    };
    var openMnav = function () {
      lastFocus = document.activeElement;
      mnav.hidden = false;
      requestAnimationFrame(function () { mnav.classList.add('is-open'); });
      burger.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      var f = focusables(mnav);
      (f[0] || mnav).focus();
    };
    burger.addEventListener('click', function () {
      if (mnav.classList.contains('is-open')) closeMnav(); else openMnav();
    });
    $$('#mnav-close', mnav).forEach(function (b) { b.addEventListener('click', closeMnav); });
    $$('a', mnav).forEach(function (a) { a.addEventListener('click', closeMnav); });
    document.addEventListener('keydown', function (e) {
      if (!mnav.classList.contains('is-open')) return;
      if (e.key === 'Escape') { e.preventDefault(); closeMnav(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables(mnav);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth >= 900 && mnav.classList.contains('is-open')) closeMnav();
    });
  }

  /* ---------- 3. Слайдер-герой ---------- */
  $$('[data-slider]').forEach(function (root) {
    var slides = $$('.hero__slide', root);
    if (!slides.length) return;
    var dots = $$('.hero__dot', root);
    var counter = $('.hero__count', root);
    var i = 0, timer = null, paused = false;

    function show(n, fromUser) {
      i = (n + slides.length) % slides.length;
      slides.forEach(function (s, k) {
        s.classList.toggle('is-active', k === i);
        s.setAttribute('aria-hidden', k === i ? 'false' : 'true');
      });
      dots.forEach(function (d, k) { d.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
      if (counter) counter.textContent = ('0' + (i + 1)).slice(-2) + ' / ' + ('0' + slides.length).slice(-2);
      if (fromUser) track('hero_slide', { index: i });
    }
    function play() {
      if (reduced || paused || timer) return;
      timer = setInterval(function () { show(i + 1); }, 6500);
    }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }

    show(0);
    play();
    root.addEventListener('mouseenter', function () { paused = true; stop(); });
    root.addEventListener('mouseleave', function () { paused = false; play(); });
    root.addEventListener('focusin', function () { paused = true; stop(); });
    root.addEventListener('focusout', function () { paused = false; play(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else play();
    });

    $$('[data-hero-prev]', root).forEach(function (b) { b.addEventListener('click', function () { show(i - 1, true); }); });
    $$('[data-hero-next]', root).forEach(function (b) { b.addEventListener('click', function () { show(i + 1, true); }); });
    dots.forEach(function (d, k) { d.addEventListener('click', function () { show(k, true); }); });

    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { show(i - 1, true); }
      if (e.key === 'ArrowRight') { show(i + 1, true); }
    });

    var sx = 0, sy = 0, swiping = false;
    root.addEventListener('touchstart', function (e) {
      if (!e.touches.length) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; swiping = true;
    }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (!swiping || !e.changedTouches.length) return;
      swiping = false;
      var dx = e.changedTouches[0].clientX - sx;
      var dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 46 && Math.abs(dx) > Math.abs(dy)) show(i + (dx < 0 ? 1 : -1), true);
    }, { passive: true });
  });

  /* ---------- 4. Карусели (услуги, галерея, отзывы) ---------- */
  $$('[data-carousel]').forEach(function (root) {
    var track = $('.carousel__track', root);
    if (!track) return;
    var prev = $('[data-car-prev]', root), next = $('[data-car-next]', root);
    var step = function () {
      var first = track.firstElementChild;
      if (!first) return 0;
      return first.getBoundingClientRect().width + 16;
    };
    var update = function () {
      var max = track.scrollWidth - track.clientWidth - 4;
      if (prev) prev.disabled = track.scrollLeft <= 2;
      if (next) next.disabled = track.scrollLeft >= max;
    };
    if (prev) prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: reduced ? 'auto' : 'smooth' }); });
    if (next) next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: reduced ? 'auto' : 'smooth' }); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    setTimeout(update, 60);
  });

  /* ---------- 5. Лайтбокс галереи ---------- */
  var lb = $('#lightbox');
  if (lb) {
    var items = $$('[data-gallery]');
    var lbStage = $('#lb-stage'), lbTitle = $('#lb-title'), lbMeta = $('#lb-meta'), lbCount = $('#lb-counter');
    var idx = 0, lbOpener = null;

    function render(n) {
      if (!items.length) return;
      idx = (n + items.length) % items.length;
      var it = items[idx];
      var art = $('.gal__art', it);
      lbStage.innerHTML = art ? art.innerHTML : '';
      lbTitle.textContent = it.getAttribute('data-title') || '';
      lbMeta.textContent = it.getAttribute('data-meta') || '';
      lbCount.textContent = (idx + 1) + ' / ' + items.length;
      track('gallery_open', { index: idx });
    }
    function openLb(n, opener) {
      lbOpener = opener || document.activeElement;
      lb.hidden = false;
      requestAnimationFrame(function () { lb.classList.add('is-open'); });
      document.body.style.overflow = 'hidden';
      render(n);
      var f = focusables(lb);
      (f[0] || lb).focus();
      track('gallery_item', { index: n });
    }
    function closeLb() {
      lb.classList.remove('is-open');
      document.body.style.overflow = '';
      setTimeout(function () { lb.hidden = true; }, reduced ? 0 : 200);
      if (lbOpener && lbOpener.focus) lbOpener.focus();
    }
    items.forEach(function (it, k) {
      it.addEventListener('click', function () { openLb(k, it); });
    });
    $$('[data-lb-close]', lb).forEach(function (b) { b.addEventListener('click', closeLb); });
    var lp = $('#lb-prev'), ln = $('#lb-next');
    if (lp) lp.addEventListener('click', function () { render(idx - 1); });
    if (ln) ln.addEventListener('click', function () { render(idx + 1); });
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (lb.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); closeLb(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); render(idx + 1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); render(idx - 1); return; }
      if (e.key === 'Tab') {
        var ff = focusables(lb);
        if (!ff.length) return;
        if (e.shiftKey && document.activeElement === ff[0]) { e.preventDefault(); ff[ff.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === ff[ff.length - 1]) { e.preventDefault(); ff[0].focus(); }
      }
    });
    var lx = 0, ly = 0;
    lb.addEventListener('touchstart', function (e) {
      if (!e.touches.length) return; lx = e.touches[0].clientX; ly = e.touches[0].clientY;
    }, { passive: true });
    lb.addEventListener('touchend', function (e) {
      if (!e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - lx, dy = e.changedTouches[0].clientY - ly;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) render(idx + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

  /* ---------- 6. Появление секций ---------- */
  var rv = $$('.rv');
  if (rv.length) {
    if (!('IntersectionObserver' in window) || reduced) {
      rv.forEach(function (el) { el.classList.add('in'); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      rv.forEach(function (el) { io.observe(el); });
    }
  }

  /* ---------- 7. Sticky-панель после первого экрана ---------- */
  var sticky = $('#sticky');
  if (sticky) {
    var hero = $('.hero') || $('.phead');
    var toggleSticky = function () {
      var h = hero ? hero.offsetHeight : 400;
      if (window.scrollY > h * 0.7) sticky.classList.add('is-on');
      else sticky.classList.remove('is-on');
    };
    window.addEventListener('scroll', toggleSticky, { passive: true });
    toggleSticky();
  }

  /* ---------- 8. Мастер записи ---------- */
  var BODY_3 = [
    { t: 'Колёса и шиномонтаж', slug: 'shinomontazh', items: [['Переобувка', 'perobuvka'], ['Балансировка', 'balansirovka'], ['Правка диска', 'pravka'], ['Порез или грыжа', 'porez-gryzha'], ['Хранение шин', 'hranenie']] },
    { t: 'ТО и ремонт', slug: 'to', items: [['ТО и масло', 'to-maslo'], ['Тормоза', 'tormoza'], ['Ходовая', 'hodovaya'], ['Двигатель', 'dvigatel'], ['КПП', 'kpp'], ['Электрика', 'elektrika'], ['Кондиционер', 'kondicioner']] }
  ];
  var BRANDS = ['Лада', 'Kia', 'Hyundai', 'Toyota', 'Volkswagen', 'Renault', 'Nissan', 'Chevrolet', 'Ford', 'Haval', 'Chery', 'Geely', 'Skoda', 'Mazda', 'Daewoo', 'УАЗ', 'ГАЗ', 'Mercedes-Benz', 'BMW', 'Audi'];
  var BUSY = ['11:00', '15:00'];

  var wiz = $('#wiz');
  if (wiz) {
    var state = {
      brand: '', model: '', year: '', yearUnknown: false, vin: '', vinUnknown: false,
      mileage: '', mileageUnknown: false, services: [], diagnose: false,
      date: '', slot: '', asap: false, name: '', phone: '', channel: 'call', consent: false,
      photos: [], key: makeKey()
    };
    var step = 1, TOTAL = 5;
    var KEY = 'ats-draft-v1';

    function makeKey() {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      return 'k-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    var stepEls = $$('.wstep', wiz);
    var numEl = $('#wiz-num'), progress = $('#wiz-progress');
    var nextBtn = $('#wiz-next'), backBtn = $('#wiz-back');

    function showStep(n, silent) {
      step = n;
      stepEls.forEach(function (s) { s.classList.toggle('is-active', Number(s.getAttribute('data-step')) === n); });
      if (numEl) numEl.textContent = n;
      if (progress) progress.style.transform = 'scaleX(' + (n / TOTAL) + ')';
      if (backBtn) backBtn.hidden = n === 1;
      if (nextBtn) {
        nextBtn.textContent = n === TOTAL ? 'Отправить заявку' : 'Далее';
        nextBtn.classList.toggle('btn--acid', n !== TOTAL);
      }
      if (n === 5) renderSummary();
      if (!silent) track('step_view', { step: n });
      var head = $('.wstep.is-active h2', wiz);
      if (head) { head.setAttribute('tabindex', '-1'); head.focus({ preventScroll: true }); }
      updateNext();
      if (!silent) wiz.dispatchEvent(new CustomEvent('wiz:step'));
      saveDraft();
    }

    /* --- поля --- */
    var brandIn = $('#brand'), brandList = $('#brand-list'), vinIn = $('#vin');
    var yearIn = $('#year'), yearUnknown = $('#year-unknown');
    var mileageIn = $('#mileage'), mileageUnknown = $('#mileage-unknown');
    var phoneIn = $('#phone'), nameIn = $('#name');
    var consent = $('#consent');

    function setErr(id, msg) {
      var e = document.getElementById('err-' + id);
      var f = document.getElementById(id);
      if (e) { e.textContent = msg || ''; e.classList.toggle('is-on', !!msg); }
      if (f) f.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }

    function normPhone(v) {
      var d = (v || '').replace(/\D/g, '');
      if (d[0] === '8') d = '7' + d.slice(1);
      if (d[0] === '9') d = '7' + d;
      if (d[0] !== '7') d = '7' + d;
      return d.slice(0, 11);
    }
    function fmtPhone(d) {
      if (!d) return '';
      var s = '+7';
      if (d.length > 1) s += ' (' + d.slice(1, 4);
      if (d.length >= 4) s += ') ' + d.slice(4, 7);
      if (d.length >= 7) s += '-' + d.slice(7, 9);
      if (d.length >= 9) s += '-' + d.slice(9, 11);
      return s.replace(/[- ]+$/, '');
    }
    if (phoneIn) {
      phoneIn.addEventListener('input', function () {
        var d = normPhone(phoneIn.value);
        phoneIn.value = fmtPhone(d);
        state.phone = d.length === 11 ? d : '';
        setErr('phone', '');
        updateNext(); saveDraft();
      });
    }

    if (brandIn && brandList) {
      function drawBrands(q) {
        var query = (q || '').toLowerCase().trim();
        var list = BRANDS.filter(function (b) { return !query || b.toLowerCase().indexOf(query) > -1; });
        brandList.innerHTML = '';
        if (!list.length) {
          var none = document.createElement('div');
          none.className = 'ac__opt';
          none.textContent = 'Такой марки нет — впишите её в поле выше';
          brandList.appendChild(none);
        }
        list.forEach(function (b) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'ac__opt';
          btn.setAttribute('role', 'option');
          btn.innerHTML = '<span>' + b + '</span><span>выбрать</span>';
          btn.addEventListener('click', function () {
            brandIn.value = b;
            state.brand = b;
            brandList.classList.remove('is-open');
            setErr('brand', '');
            updateNext(); saveDraft();
            brandIn.focus();
          });
          brandList.appendChild(btn);
        });
        brandList.classList.add('is-open');
      }
      brandIn.addEventListener('input', function () {
        state.brand = brandIn.value.trim();
        drawBrands(brandIn.value);
        setErr('brand', '');
        updateNext(); saveDraft();
      });
      brandIn.addEventListener('focus', function () { drawBrands(brandIn.value); });
      brandIn.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') brandList.classList.remove('is-open');
        if (e.key === 'Enter') {
          e.preventDefault();
          var first = $('.ac__opt', brandList);
          if (brandList.classList.contains('is-open') && first) first.click();
        }
      });
      document.addEventListener('click', function (e) {
        if (!e.target.closest('.ac')) brandList.classList.remove('is-open');
      });
    }

    if (vinIn) {
      vinIn.addEventListener('input', function () {
        var clean = vinIn.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);
        if (vinIn.value !== clean) {
          vinIn.value = clean;
          var note = $('#vin-note');
          if (note) note.textContent = 'В VIN нет букв I, O и Q — эти символы мы убрали.';
        }
        state.vin = clean;
        setErr('vin', '');
        updateNext(); saveDraft();
      });
    }
    var vinSkip = $('#vin-unknown');
    if (vinSkip) {
      vinSkip.addEventListener('click', function () {
        state.vinUnknown = true;
        if (vinIn) { vinIn.value = ''; vinIn.disabled = true; }
        setErr('vin', '');
        track('skip_vin', {});
        var n = $('#vin-note');
        if (n) n.textContent = 'Хорошо, VIN не нужен — подберём по марке, модели и году.';
        vinSkip.disabled = true;
        updateNext(); saveDraft();
      });
    }

    if (yearIn) {
      yearIn.addEventListener('input', function () {
        state.year = yearIn.value.trim();
        setErr('year', '');
        updateNext(); saveDraft();
      });
    }
    if (yearUnknown) {
      yearUnknown.addEventListener('change', function () {
        state.yearUnknown = yearUnknown.checked;
        if (yearIn) { yearIn.disabled = yearUnknown.checked; if (yearUnknown.checked) { yearIn.value = ''; state.year = ''; } }
        setErr('year', '');
        updateNext(); saveDraft();
      });
    }
    if (mileageIn) {
      mileageIn.addEventListener('input', function () {
        mileageIn.value = mileageIn.value.replace(/\D/g, '').slice(0, 7);
        state.mileage = mileageIn.value;
        setErr('mileage', '');
        saveDraft();
      });
    }
    var mileageSkip = $('#mileage-unknown');
    if (mileageSkip) {
      mileageSkip.addEventListener('change', function () {
        state.mileageUnknown = mileageSkip.checked;
        if (mileageIn) { mileageIn.disabled = mileageSkip.checked; if (mileageSkip.checked) { mileageIn.value = ''; state.mileage = ''; } }
        saveDraft();
      });
    }

    $$('input[data-service]', wiz).forEach(function (cb) {
      cb.addEventListener('change', function () {
        state.services = $$('input[data-service]:checked', wiz).map(function (x) { return x.value; });
        if (state.services.length) {
          state.diagnose = false;
          var dg = $('#diagnose');
          if (dg) dg.checked = false;
          setErr('services', '');
        }
        updateNext(); saveDraft();
      });
    });
    var diagnose = $('#diagnose');
    if (diagnose) {
      diagnose.addEventListener('change', function () {
        state.diagnose = diagnose.checked;
        if (diagnose.checked) {
          $$('input[data-service]:checked', wiz).forEach(function (x) { x.checked = false; });
          state.services = [];
          setErr('services', '');
        }
        updateNext(); saveDraft();
      });
    }

    /* фото */
    var photoIn = $('#photos'), photoList = $('#photo-list');
    function drawPhotos() {
      if (!photoList) return;
      photoList.innerHTML = '';
      state.photos.forEach(function (p, i) {
        var fig = document.createElement('figure');
        fig.className = 'file';
        var img = document.createElement('img');
        img.src = p.src; img.alt = 'Фото ' + (i + 1);
        var cap = document.createElement('figcaption');
        cap.textContent = p.name;
        var del = document.createElement('button');
        del.type = 'button';
        del.setAttribute('aria-label', 'Удалить фото ' + (i + 1));
        del.innerHTML = '×';
        del.addEventListener('click', function () {
          state.photos.splice(i, 1);
          drawPhotos(); updateNext(); saveDraft();
        });
        fig.appendChild(img); fig.appendChild(cap); fig.appendChild(del);
        photoList.appendChild(fig);
      });
    }
    if (photoIn) {
      photoIn.addEventListener('change', function () {
        var files = Array.prototype.slice.call(photoIn.files || []);
        var room = 3 - state.photos.length;
        if (room <= 0) { toast('Можно приложить не больше трёх фото'); photoIn.value = ''; return; }
        files.slice(0, room).forEach(function (f) {
          if (!/^image\//.test(f.type)) return;
          var r = new FileReader();
          r.onload = function () {
            state.photos.push({ name: f.name.slice(0, 14), src: r.result });
            drawPhotos(); saveDraft();
          };
          r.readAsDataURL(f);
        });
        photoIn.value = '';
      });
    }

    /* календарь и слоты */
    var cal = $('#cal'), slots = $('#slots'), dateNote = $('#date-note'), asapBtn = $('#asap');
    var MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    var DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    var days = [];
    if (cal) {
      for (var d = 1; d <= 14; d++) {
        var dt = new Date();
        dt.setDate(dt.getDate() + d);
        days.push(isoDate(dt));
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cal__day';
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-label', DOW[dt.getDay()] + ', ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()]);
        b.innerHTML = '<i>' + DOW[dt.getDay()] + '</i><b>' + dt.getDate() + '</b><small>' + MONTHS[dt.getMonth()] + '</small>';
        b.addEventListener('click', function (date, btn) {
          return function () {
            state.date = date;
            state.asap = false;
            if (asapBtn) asapBtn.setAttribute('aria-pressed', 'false');
            $$('.cal__day', cal).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
            btn.setAttribute('aria-pressed', 'true');
            drawSlots();
            setErr('when', '');
            if (dateNote) dateNote.textContent = 'Выбрано: ' + fmtDate(date);
            updateNext(); saveDraft();
          };
        }(isoDate(dt), b));
        cal.appendChild(b);
        if (d === 1) b.click();
      }
    }
    function isoDate(d) {
      var m = String(d.getMonth() + 1), dd = String(d.getDate());
      return d.getFullYear() + '-' + (m.length < 2 ? '0' + m : m) + '-' + (dd.length < 2 ? '0' + dd : dd);
    }
    function fmtDate(iso) {
      var p = iso.split('-');
      return p[2] + '.' + p[1] + '.' + p[0];
    }
    function drawSlots() {
      if (!slots) return;
      slots.innerHTML = '';
      /* слот — начало работ; последний в 19:00 закрывает день */
      for (var h = 9; h <= 19; h++) {
        var t = (h < 10 ? '0' + h : h) + ':00';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'slot';
        btn.textContent = t;
        btn.setAttribute('aria-pressed', state.slot === t ? 'true' : 'false');
        var busy = ((state.date === days[0] || state.date === days[1]) && BUSY.indexOf(t) > -1)
          || (state.date === days[3] && t === '12:00')
          || (state.date === days[6] && t === '09:00');
        if (busy) {
          btn.disabled = true;
          btn.setAttribute('aria-label', t + ' — занято');
          btn.title = 'Занято';
        } else {
          btn.addEventListener('click', function (time, b2) {
            return function () {
              state.slot = time;
              $$('.slot', slots).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
              b2.setAttribute('aria-pressed', 'true');
              setErr('when', '');
              updateNext(); saveDraft();
            };
          }(t, btn));
        }
        slots.appendChild(btn);
      }
    }
    if (asapBtn) {
      asapBtn.addEventListener('click', function () {
        state.asap = !state.asap;
        asapBtn.setAttribute('aria-pressed', state.asap ? 'true' : 'false');
        if (state.asap) { state.date = ''; state.slot = ''; $$('.cal__day', cal).forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); drawSlots(); if (dateNote) dateNote.textContent = 'Свяжемся и предложим ближайшее окно'; }
        setErr('when', '');
        updateNext(); saveDraft();
      });
    }

    var modelIn = $('#model');
    if (modelIn) modelIn.addEventListener('input', function () { state.model = modelIn.value.trim(); saveDraft(); });
    if (nameIn) nameIn.addEventListener('input', function () { state.name = nameIn.value.trim(); saveDraft(); });
    $$('input[name="channel"]').forEach(function (r) {
      r.addEventListener('change', function () { state.channel = r.value; saveDraft(); });
    });
    if (consent) {
      consent.addEventListener('change', function () {
        state.consent = consent.checked;
        setErr('consent', '');
        updateNext(); saveDraft();
      });
    }

    /* валидация: сначала собираем ошибки, показываем только по запросу */
    function errorsFor(n) {
      var out = [];
      if (n === 1) {
        if (!state.brand) out.push(['brand', 'Напишите марку — хотя бы одно слово. Если не знаете, укажите «не знаю».']);
        if (!state.yearUnknown) {
          if (!state.year) out.push(['year', 'Укажите год выпуска или отметьте «не помню год».']);
          else if (!/^\d{4}$/.test(state.year) || +state.year < 1980 || +state.year > 2026) out.push(['year', 'Год — четырёхзначное число от 1980 до 2026.']);
        }
        if (state.vin && state.vin.length !== 17) out.push(['vin', 'В VIN должно быть 17 символов, сейчас ' + state.vin.length + '.']);
      }
      if (n === 2) {
        if (!state.services.length && !state.diagnose) out.push(['services', 'Отметьте хотя бы одну услугу или «нужна диагностика».']);
      }
      if (n === 3) {
        if (!state.asap && !state.date) out.push(['when', 'Выберите день в календаре или «как можно раньше».']);
      }
      if (n === 4) {
        if (!state.phone || state.phone.length !== 11) out.push(['phone', 'Телефон нужен целиком: 11 цифр, начиная с +7.']);
        if (!state.consent) out.push(['consent', 'Без согласия на обработку данных заявку принять не можем.']);
      }
      return out;
    }

    function validate(n, showErrors) {
      var errs = errorsFor(n);
      if (showErrors) {
        ['brand', 'year', 'vin', 'services', 'when', 'phone', 'consent'].forEach(function (id) { setErr(id, ''); });
        errs.forEach(function (e) { setErr(e[0], e[1]); });
        if (errs.length) {
          var f = document.getElementById(errs[0][0]);
          if (f) { f.focus(); if (f.scrollIntoView) f.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' }); }
        }
      }
      return errs.length === 0;
    }

    function updateNext() {
      if (!nextBtn) return;
      var ok = step === 5 ? true : validate(step, false);
      nextBtn.disabled = !ok;
      var hint = $('#next-hint');
      if (hint) {
        if (step === 1) hint.textContent = !state.brand ? 'Выберите или впишите марку' : (!state.yearUnknown && !state.year ? 'Нужен год или отметка «не помню»' : '');
        else if (step === 2) hint.textContent = (!state.services.length && !state.diagnose) ? 'Отметьте услугу или диагностику' : '';
        else if (step === 3) hint.textContent = (!state.date && !state.asap) ? 'Выберите день' : '';
        else if (step === 4) hint.textContent = !state.phone ? 'Введите телефон' : (!state.consent ? 'Поставьте согласие' : '');
        else hint.textContent = '';
        hint.hidden = !hint.textContent;
      }
    }

    /* сводка и payload */
    function serviceTitles() {
      var out = [];
      BODY_3.forEach(function (g) { g.items.forEach(function (it) { if (state.services.indexOf(it[1]) > -1) out.push(it[0]); }); });
      if (state.diagnose) out.push('Нужна диагностика');
      return out;
    }
    function payload() {
      return {
        name: state.name || null,
        phone: state.phone ? '+' + state.phone : null,
        contact_method: state.channel,
        car: {
          brand: state.brand || null,
          model: state.model || null,
          year: state.yearUnknown || !state.year ? null : Number(state.year),
          vin: state.vin || null,
          mileage: state.mileageUnknown || !state.mileage ? null : Number(state.mileage)
        },
        services: state.services,
        needs_diagnostics: state.diagnose,
        preferred: { date: state.asap || !state.date ? null : state.date, slot: state.slot || null, asap: state.asap },
        photos_count: state.photos.length,
        consent: state.consent,
        page: 'appointment',
        idempotency_key: state.key
      };
    }
    function renderSummary() {
      var sum = $('#summary');
      if (sum) {
        var rows = [
          ['Авто', (state.brand || '—') + (state.model ? ' ' + state.model : '')],
          ['Год', state.yearUnknown ? 'не помню' : (state.year || '—')],
          ['VIN', state.vinUnknown ? 'нет под рукой' : (state.vin || 'не указан')],
          ['Пробег', state.mileageUnknown ? 'не знаю' : (state.mileage ? state.mileage + ' км' : 'не указан')],
          ['Услуги', serviceTitles().join(', ') || '—'],
          ['Когда', state.asap ? 'как можно раньше' : (state.date ? fmtDate(state.date) + (state.slot ? ', ' + state.slot : '') : '—')],
          ['Связь', state.channel === 'call' ? 'звонок' : 'Telegram'],
          ['Телефон', state.phone ? fmtPhone(state.phone) : '—'],
          ['Фото', state.photos.length ? state.photos.length + ' шт.' : 'нет']
        ];
        sum.innerHTML = rows.map(function (r) {
          return '<div class="sum__r"><span class="sum__k">' + r[0] + '</span><span class="sum__v">' + escapeHtml(r[1]) + '</span></div>';
        }).join('');
      }
      var pre = $('#payload-json');
      if (pre) pre.textContent = JSON.stringify(payload(), null, 2);
      var sumBtn = $('#wiz-send');
      if (sumBtn) sumBtn.disabled = false;
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    /* черновик */
    var draftNote = $('#draft-note');
    function saveDraft() {
      try {
        var data = JSON.parse(JSON.stringify(state));
        data.photos = state.photos.map(function (p) { return { name: p.name }; });
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch (err) { /* приватный режим или file:// — молча продолжаем без черновика */ }
    }
    function loadDraft() {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return;
        var d = JSON.parse(raw);
        if (!d || !d.brand) return;
        Object.keys(state).forEach(function (k) { if (k in d && k !== 'photos') state[k] = d[k]; });
        if (brandIn) brandIn.value = state.brand || '';
        if (yearIn) { yearIn.value = state.year || ''; yearIn.disabled = !!state.yearUnknown; }
        if (yearUnknown) yearUnknown.checked = !!state.yearUnknown;
        if (vinIn) { vinIn.value = state.vin || ''; vinIn.disabled = !!state.vinUnknown; }
        if (mileageIn) { mileageIn.value = state.mileage || ''; mileageIn.disabled = !!state.mileageUnknown; }
        if (mileageUnknown) mileageUnknown.checked = !!state.mileageUnknown;
        if (phoneIn && state.phone) phoneIn.value = fmtPhone(state.phone);
        if (nameIn) nameIn.value = state.name || '';
        if (consent) consent.checked = !!state.consent;
        $$('input[data-service]', wiz).forEach(function (cb) { cb.checked = state.services.indexOf(cb.value) > -1; });
        if (diagnose) diagnose.checked = !!state.diagnose;
        $$('input[name="channel"]').forEach(function (r) { r.checked = r.value === state.channel; });
        if (state.date && cal) {
          $$('.cal__day', cal).forEach(function (x, i) { if (days[i] && isoDate(days[i]) === state.date) x.setAttribute('aria-pressed', 'true'); });
        }
        drawSlots();
        if (draftNote) { draftNote.hidden = false; }
      } catch (err) { /* битый черновик — начинаем с чистого */ }
    }
    var draftClear = $('#draft-clear');
    if (draftClear) {
      draftClear.addEventListener('click', function () {
        try { localStorage.removeItem(KEY); } catch (e) {}
        window.location.reload();
      });
    }

    /* отправка */
    var sending = $('#st-sending'), success = $('#st-success'), failure = $('#st-failure');
    function submitForm() {
      if (!validate(4, true)) { showStep(4, true); return; }
      track('submit_attempt', { services: state.services.length });
      wiz.querySelector('.wiz__body').hidden = true;
      wiz.querySelector('.wiz__foot').hidden = true;
      var t = $('#wiz .wiz__top');
      if (t) t.hidden = true;
      if (sending) sending.classList.add('is-on');
      var wait = 700 + Math.floor(Math.random() * 500);
      setTimeout(function () {
        if (sending) sending.classList.remove('is-on');
        if (failure && failure.classList.contains('is-on')) return;
        if (success) { success.classList.add('is-on'); success.focus(); }
        var num = 'АТС-' + (2400 + Math.floor(Math.random() * 90));
        $$('[data-ticket]').forEach(function (el) { el.textContent = num; });
        var d = $('#ticket-date');
        if (d) d.textContent = state.asap ? 'ближайшее окно' : (state.date ? fmtDate(state.date) + (state.slot ? ', ' + state.slot : '') : '—');
        var ph = $('#ticket-phone');
        if (ph) ph.textContent = state.phone ? fmtPhone(state.phone) : '—';
        track('success', { ticket: num });
        try { localStorage.removeItem(KEY); } catch (e) {}
      }, wait);
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (step === TOTAL) { submitForm(); return; }
        if (!validate(step, true)) return;
        track('step_next', { from: step });
        showStep(step + 1);
      });
    }
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (step > 1) { track('step_back', { from: step }); showStep(step - 1); }
      });
    }
    var errDemo = $('#sim-error');
    if (errDemo) {
      errDemo.addEventListener('click', function () {
        if (sending) sending.classList.remove('is-on');
        if (wiz.querySelector('.wiz__body')) wiz.querySelector('.wiz__body').hidden = true;
        if (success) success.classList.remove('is-on');
        if (failure) failure.classList.add('is-on');
        track('error_shown', {});
      });
    }
    var retry = $('#retry');
    if (retry) {
      retry.addEventListener('click', function () {
        if (failure) failure.classList.remove('is-on');
        if (wiz.querySelector('.wiz__body')) wiz.querySelector('.wiz__body').hidden = false;
        if (wiz.querySelector('.wiz__foot')) wiz.querySelector('.wiz__foot').hidden = false;
        var t = $('#wiz .wiz__top');
        if (t) t.hidden = false;
        showStep(5, true);
        toast('Данные на месте — можно отправлять снова');
      });
    }
    var again = $('#again');
    if (again) {
      again.addEventListener('click', function () {
        try { localStorage.removeItem(KEY); } catch (e) {}
        window.location.reload();
      });
    }

    loadDraft();
    showStep(1, true);
    drawSlots();

    /* перерисовка при смене даты */
    wiz.addEventListener('wiz:step', function () { if (step === 5) renderSummary(); });
  }

  /* ---------- 9. Короткая форма на контактах ---------- */
  var cform = $('#cform');
  if (cform) {
    var cPhone = $('#c-phone'), cName = $('#c-name'), cText = $('#c-msg'), cConsent = $('#c-consent');
    function cErr(id, msg) {
      var e = document.getElementById('err-' + id), f = document.getElementById(id);
      if (e) { e.textContent = msg || ''; e.classList.toggle('is-on', !!msg); }
      if (f) f.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
    if (cPhone) {
      cPhone.addEventListener('input', function () {
        var d = cPhone.value.replace(/\D/g, '');
        if (d[0] === '8') d = '7' + d.slice(1);
        if (d[0] === '9') d = '7' + d;
        if (d[0] !== '7') d = '7' + d;
        d = d.slice(0, 11);
        var s = '+7';
        if (d.length > 1) s += ' (' + d.slice(1, 4);
        if (d.length >= 4) s += ') ' + d.slice(4, 7);
        if (d.length >= 7) s += '-' + d.slice(7, 9);
        if (d.length >= 9) s += '-' + d.slice(9, 11);
        cPhone.value = s;
        cPhone.setAttribute('data-digits', d.length);
        cErr('c-phone', '');
      });
    }
    cform.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      if (!cName || !cName.value.trim()) { cErr('c-name', 'Как к вам обращаться?'); ok = false; }
      var digits = cPhone ? Number(cPhone.getAttribute('data-digits') || 0) : 0;
      if (digits !== 11) { cErr('c-phone', 'Телефон нужен целиком: 11 цифр.'); ok = false; }
      if (!cText || cText.value.trim().length < 5) { cErr('c-msg', 'Пара слов о вопросе — так ответ будет точнее.'); ok = false; }
      if (!cConsent || !cConsent.checked) { cErr('c-consent', 'Поставьте согласие на обработку данных.'); ok = false; }
      if (!ok) {
        var first = $('[aria-invalid="true"]', cform);
        if (first) first.focus();
        return;
      }
      var btn = $('button[type="submit"]', cform);
      if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }
      track('contact_submit', {});
      setTimeout(function () {
        var ok2 = $('#c-ok');
        if (ok2) { ok2.hidden = false; ok2.focus(); }
        if (btn) { btn.disabled = false; btn.textContent = 'Отправить'; }
        cform.reset();
        cPhone.setAttribute('data-digits', '0');
      }, 900);
    });
  }

  /* ---------- 10. Новости: фильтр и пагинация ---------- */
  var newsRoot = $('#news-list');
  if (newsRoot) {
    var cards = $$('.news', newsRoot);
    var fBtns = $$('.filter', document);
    var pager = $('#pager');
    var perPage = 6, page = 1, cat = 'all';

    function filtered() {
      return cards.filter(function (c) { return cat === 'all' || c.getAttribute('data-cat') === cat; });
    }
    function render() {
      var list = filtered();
      var pages = Math.max(1, Math.ceil(list.length / perPage));
      if (page > pages) page = 1;
      cards.forEach(function (c) { c.hidden = true; });
      list.slice((page - 1) * perPage, page * perPage).forEach(function (c) { c.hidden = false; });
      if (pager) {
        pager.innerHTML = '';
        for (var p = 1; p <= pages; p++) {
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = p;
          b.setAttribute('aria-current', p === page ? 'true' : 'false');
          b.addEventListener('click', function (n) {
            return function () { page = n; render(); track('news_page', { page: n }); };
          }(p));
          pager.appendChild(b);
        }
        pager.hidden = pages < 2;
      }
      var empty = $('#news-empty');
      if (empty) empty.hidden = list.length > 0;
    }
    fBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        cat = b.getAttribute('data-cat');
        page = 1;
        fBtns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        render();
        track('news_filter', { cat: cat });
      });
    });
    render();
  }

  /* ---------- 11. Демо-админка ---------- */
  var adm = $('#admin');
  if (adm) {
    var t0 = null, timerEl = $('#adm-timer'), pubList = $('#adm-published');
    var fileIn = $('#adm-file'), prev = $('#adm-prev'), capIn = $('#adm-caption'), catIn = $('#adm-cat');
    var pubBtn = $('#adm-publish');

    function startTimer() {
      if (t0 || !timerEl) return;
      t0 = Date.now();
      timerEl.textContent = '0 с';
      var iv = setInterval(function () {
        if (!t0) { clearInterval(iv); return; }
        timerEl.textContent = Math.round((Date.now() - t0) / 1000) + ' с';
      }, 250);
    }
    var form = $('#adm-form');
    if (form) form.addEventListener('focusin', startTimer, { once: true });

    if (fileIn) {
      fileIn.addEventListener('change', function () {
        startTimer();
        var f = fileIn.files && fileIn.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          if (prev) { prev.innerHTML = ''; var img = document.createElement('img'); img.src = r.result; img.alt = 'Превью выбранного фото'; prev.appendChild(img); }
        };
        r.readAsDataURL(f);
        track('admin_photo_selected', { name: f.name });
      });
    }
    if (pubBtn) {
      pubBtn.addEventListener('click', function () {
        var cap = capIn ? capIn.value.trim() : '';
        var e = $('#err-adm-caption');
        if (cap.length < 3) {
          if (e) { e.textContent = 'Подпись нужна: по ней человек ищет свою работу.'; e.classList.add('is-on'); }
          if (capIn) capIn.focus();
          return;
        }
        if (e) { e.classList.remove('is-on'); e.textContent = ''; }
        var secs = t0 ? Math.round((Date.now() - t0) / 1000) : 0;
        var item = document.createElement('div');
        item.className = 'lead';
        item.innerHTML = '<div><div class="lead__t">' + cap.replace(/[<>&]/g, '') + '</div><div class="lead__m">' + (catIn ? catIn.value : 'колёса') + ' · опубликовано только что</div></div><div class="lead__side"><span class="tag tag--acid">в галерее</span><span>' + secs + ' с</span></div>';
        if (pubList) pubList.prepend(item);
        track('admin_publish', { seconds: secs });
        toast('Опубликовано за ' + secs + ' с (цель — не больше 60)');
        t0 = null;
        if (fileIn) fileIn.value = '';
        if (capIn) capIn.value = '';
        if (prev) prev.innerHTML = '<span class="muted">Превью появится здесь</span>';
      });
    }
    var q = $('#adm-queue');
    if (q) {
      $$('[data-queue]', q).forEach(function (b) {
        b.addEventListener('click', function () {
          var st = b.getAttribute('data-queue');
          var dot = $('.dot', q);
          if (st === 'wait') { if (dot) dot.className = 'dot dot--wait'; q.setAttribute('data-state', 'wait'); }
          else { if (dot) dot.className = 'dot dot--ok'; q.setAttribute('data-state', 'ok'); }
        });
      });
    }
  }

  /* ---------- 12. Мелочи ---------- */
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('is-on'); });
    clearTimeout(t._tm);
    t._tm = setTimeout(function () {
      t.classList.remove('is-on');
      setTimeout(function () { t.hidden = true; }, reduced ? 0 : 200);
    }, 3600);
  }
  window.atsToast = toast;

  $$('[data-quiz-open]').forEach(function (a) {
    a.addEventListener('click', function () { track('quiz_open', { entry: a.getAttribute('data-quiz-open') }); });
  });

  $$('[data-ev="call_click"]').forEach(function (a) {
    a.addEventListener('click', function () { track('call_click', { label: a.getAttribute('data-ev-label') || a.className || 'link' }); });
  });

  $$('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  /* пересчёт disabled для «Далее» при загрузке */
  if (wiz) {
    var ev = new Event('change');
    if (brandIn) brandIn.dispatchEvent(new Event('input'));
  }
})();
