/* =========================================================
   АвтоТехСервис — Агент 1, Этап 3. app.js
   Нативный JS, без библиотек. Ничего никуда не отправляет:
   fetch/XHR/sendBeacon не используются нигде в этом файле.
   ========================================================= */
(function(){
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- safe storage (localStorage can throw in private mode / file://) ---------- */
  var safeStorage = {
    get:function(k){ try{ return window.localStorage.getItem(k); }catch(e){ return null; } },
    set:function(k,v){ try{ window.localStorage.setItem(k,v); return true; }catch(e){ return false; } },
    remove:function(k){ try{ window.localStorage.removeItem(k); }catch(e){} }
  };

  function track(name, detail){
    try{ console.log('[demo-analytics]', name, detail || {}); }catch(e){}
  }

  function uuid(){
    if(window.crypto && window.crypto.randomUUID){ return window.crypto.randomUUID(); }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,function(c){
      var r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8);
      return v.toString(16);
    });
  }

  /* =========================================================
     HEADER: compact on scroll + mobile menu
     ========================================================= */
  var header = document.querySelector('.site-header');
  if(header){
    var lastY = 0;
    window.addEventListener('scroll', function(){
      var y = window.scrollY || document.documentElement.scrollTop;
      if(y > 36){ header.classList.add('is-compact'); } else { header.classList.remove('is-compact'); }
      lastY = y;
    }, {passive:true});
  }

  var burger = document.getElementById('menuToggle');
  var mobileNav = document.getElementById('mobileNav');
  var mobileNavClose = document.getElementById('mobileNavClose');
  function openMobileNav(){
    if(!mobileNav) return;
    mobileNav.classList.add('open');
    burger && burger.setAttribute('aria-expanded','true');
    document.body.style.overflow = 'hidden';
    var first = mobileNav.querySelector('a,button');
    first && first.focus();
    track('menu_open');
  }
  function closeMobileNav(){
    if(!mobileNav) return;
    mobileNav.classList.remove('open');
    burger && burger.setAttribute('aria-expanded','false');
    document.body.style.overflow = '';
    burger && burger.focus();
  }
  burger && burger.addEventListener('click', function(){
    mobileNav.classList.contains('open') ? closeMobileNav() : openMobileNav();
  });
  mobileNavClose && mobileNavClose.addEventListener('click', closeMobileNav);
  mobileNav && mobileNav.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ closeMobileNav(); return; }
    if(e.key === 'Tab'){
      var focusables = mobileNav.querySelectorAll('a,button');
      if(!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length-1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
  });

  /* =========================================================
     REVEAL ON SCROLL
     ========================================================= */
  var revealEls = document.querySelectorAll('.reveal');
  if(revealEls.length){
    if('IntersectionObserver' in window && !reduceMotion){
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if(en.isIntersecting){ en.target.classList.add('in'); io.unobserve(en.target); }
        });
      }, {threshold:.14});
      revealEls.forEach(function(el){ io.observe(el); });
    } else {
      revealEls.forEach(function(el){ el.classList.add('in'); });
    }
  }

  /* =========================================================
     STICKY BOTTOM BAR
     ========================================================= */
  var stickyBar = document.getElementById('stickyBar');
  var firstScreen = document.querySelector('[data-first-screen]');
  if(stickyBar && firstScreen && 'IntersectionObserver' in window){
    var sIo = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        stickyBar.classList.toggle('show', !en.isIntersecting);
      });
    }, {threshold:0});
    sIo.observe(firstScreen);
  } else if(stickyBar){
    stickyBar.classList.add('show');
  }
  document.querySelectorAll('[data-track]').forEach(function(el){
    el.addEventListener('click', function(){ track(el.getAttribute('data-track'), {source: el.getAttribute('data-source')||null}); });
  });

  /* =========================================================
     HERO SLIDER
     ========================================================= */
  var hero = document.querySelector('.hero');
  if(hero){
    var slides = Array.prototype.slice.call(hero.querySelectorAll('.hero-slide'));
    var dotsWrap = hero.querySelector('.hero-dots');
    var prevBtn = hero.querySelector('.hero-arrow.prev');
    var nextBtn = hero.querySelector('.hero-arrow.next');
    var idx = 0, timer = null;

    function renderDots(){
      if(!dotsWrap) return;
      dotsWrap.innerHTML = '';
      slides.forEach(function(_, i){
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Слайд ' + (i+1) + ' из ' + slides.length);
        b.setAttribute('aria-current', i===idx ? 'true':'false');
        b.addEventListener('click', function(){ goTo(i); restart(); });
        dotsWrap.appendChild(b);
      });
    }
    function goTo(i){
      idx = (i + slides.length) % slides.length;
      slides.forEach(function(s, si){ s.classList.toggle('active', si===idx); });
      if(dotsWrap){
        Array.prototype.forEach.call(dotsWrap.children, function(b, bi){ b.setAttribute('aria-current', bi===idx?'true':'false'); });
      }
    }
    function next(){ goTo(idx+1); }
    function prev(){ goTo(idx-1); }
    function start(){
      if(reduceMotion) return;
      stop();
      timer = setInterval(next, 5500);
    }
    function stop(){ if(timer){ clearInterval(timer); timer = null; } }
    function restart(){ start(); }

    nextBtn && nextBtn.addEventListener('click', function(){ next(); restart(); });
    prevBtn && prevBtn.addEventListener('click', function(){ prev(); restart(); });
    hero.addEventListener('mouseenter', stop);
    hero.addEventListener('mouseleave', start);
    hero.addEventListener('focusin', stop);
    hero.addEventListener('focusout', start);

    var touchX = null;
    hero.addEventListener('touchstart', function(e){ touchX = e.touches[0].clientX; }, {passive:true});
    hero.addEventListener('touchend', function(e){
      if(touchX === null) return;
      var dx = e.changedTouches[0].clientX - touchX;
      if(Math.abs(dx) > 40){ dx < 0 ? next() : prev(); restart(); }
      touchX = null;
    }, {passive:true});

    renderDots();
    goTo(0);
    start();
  }

  /* =========================================================
     LIGHTBOX (gallery)
     ========================================================= */
  var lightbox = document.getElementById('lightbox');
  if(lightbox){
    var lbFrame = lightbox.querySelector('.frame');
    var lbCaption = document.getElementById('lightboxCaption');
    var lbCounter = document.getElementById('lightboxCounter');
    var galleryCards = Array.prototype.slice.call(document.querySelectorAll('[data-gallery-item]'));
    var lbIndex = 0;
    var lastFocused = null;

    function renderLb(){
      var card = galleryCards[lbIndex];
      if(!card) return;
      var svgMarkup = card.querySelector('.frame svg, .thumb svg');
      lbFrame.innerHTML = svgMarkup ? svgMarkup.outerHTML : '';
      lbCaption.textContent = card.getAttribute('data-caption') || '';
      lbCounter.textContent = (lbIndex+1) + ' / ' + galleryCards.length;
    }
    function openLb(i){
      lbIndex = i;
      lastFocused = document.activeElement;
      renderLb();
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
      lightbox.querySelector('.lightbox-close').focus();
      track('gallery_open', {index:i});
    }
    function closeLb(){
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
      lastFocused && lastFocused.focus();
    }
    function lbNext(){ lbIndex = (lbIndex+1) % galleryCards.length; renderLb(); }
    function lbPrev(){ lbIndex = (lbIndex-1+galleryCards.length) % galleryCards.length; renderLb(); }

    galleryCards.forEach(function(card, i){
      card.addEventListener('click', function(){ openLb(i); });
      card.setAttribute('tabindex','0');
      card.setAttribute('role','button');
      card.addEventListener('keydown', function(e){ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); openLb(i); } });
    });
    lightbox.querySelector('.lightbox-close').addEventListener('click', closeLb);
    lightbox.querySelector('.lightbox-arrow.next').addEventListener('click', lbNext);
    lightbox.querySelector('.lightbox-arrow.prev').addEventListener('click', lbPrev);
    lightbox.addEventListener('click', function(e){ if(e.target === lightbox){ closeLb(); } });
    lightbox.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){ closeLb(); }
      else if(e.key === 'ArrowRight'){ lbNext(); }
      else if(e.key === 'ArrowLeft'){ lbPrev(); }
      else if(e.key === 'Tab'){
        var f = lightbox.querySelectorAll('button');
        var first = f[0], last = f[f.length-1];
        if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
        else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
      }
    });
    var lbTouchX = null;
    lightbox.addEventListener('touchstart', function(e){ lbTouchX = e.touches[0].clientX; }, {passive:true});
    lightbox.addEventListener('touchend', function(e){
      if(lbTouchX===null) return;
      var dx = e.changedTouches[0].clientX - lbTouchX;
      if(Math.abs(dx) > 40){ dx<0 ? lbNext() : lbPrev(); }
      lbTouchX = null;
    }, {passive:true});
  }

  /* =========================================================
     MODALS (policy, consent text, etc.)
     ========================================================= */
  document.querySelectorAll('[data-modal-open]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      var id = btn.getAttribute('data-modal-open');
      var modal = document.getElementById(id);
      if(!modal) return;
      modal.classList.add('open');
      modal.querySelector('.modal-close').focus();
      document.body.style.overflow = 'hidden';
    });
  });
  document.querySelectorAll('.modal-backdrop').forEach(function(modal){
    modal.querySelector('.modal-close').addEventListener('click', function(){ closeModal(modal); });
    modal.addEventListener('click', function(e){ if(e.target===modal){ closeModal(modal); } });
    modal.addEventListener('keydown', function(e){ if(e.key==='Escape'){ closeModal(modal); } });
  });
  function closeModal(modal){
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  /* =========================================================
     NEWS FILTER + PAGINATION (demo, client-side only)
     ========================================================= */
  var newsGrid = document.getElementById('newsGrid');
  if(newsGrid){
    var filterBtns = document.querySelectorAll('[data-news-filter]');
    var cards = Array.prototype.slice.call(newsGrid.querySelectorAll('.news-card'));
    var pageSize = 6, currentPage = 1, currentCat = 'all';

    function applyFilter(){
      var filtered = cards.filter(function(c){ return currentCat==='all' || c.getAttribute('data-category')===currentCat; });
      var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      if(currentPage > totalPages) currentPage = totalPages;
      cards.forEach(function(c){ c.style.display = 'none'; });
      filtered.slice((currentPage-1)*pageSize, currentPage*pageSize).forEach(function(c){ c.style.display = ''; });
      renderPagination(totalPages);
    }
    function renderPagination(totalPages){
      var p = document.getElementById('newsPagination');
      if(!p) return;
      p.innerHTML = '';
      if(totalPages <= 1) return;
      for(var i=1;i<=totalPages;i++){
        (function(i){
          var b = document.createElement('button');
          b.type='button'; b.textContent=i;
          b.setAttribute('aria-current', i===currentPage ? 'true':'false');
          b.addEventListener('click', function(){ currentPage=i; applyFilter(); window.scrollTo({top:newsGrid.offsetTop-80, behavior: reduceMotion?'auto':'smooth'}); });
          p.appendChild(b);
        })(i);
      }
    }
    filterBtns.forEach(function(b){
      b.addEventListener('click', function(){
        filterBtns.forEach(function(x){ x.setAttribute('aria-pressed','false'); });
        b.setAttribute('aria-pressed','true');
        currentCat = b.getAttribute('data-news-filter');
        currentPage = 1;
        applyFilter();
      });
    });
    applyFilter();
  }

  /* =========================================================
     PHONE MASK  +7 (999) 999-99-99
     ========================================================= */
  function attachPhoneMask(input){
    if(!input) return;
    input.addEventListener('input', function(){
      var digits = input.value.replace(/\D/g,'');
      if(digits.startsWith('8')) digits = '7' + digits.slice(1);
      if(!digits.startsWith('7')) digits = '7' + digits;
      digits = digits.slice(0,11);
      var d = digits.slice(1);
      var out = '+7';
      if(d.length>0) out += ' (' + d.slice(0,3);
      if(d.length>=3) out += ')';
      if(d.length>3) out += ' ' + d.slice(3,6);
      if(d.length>6) out += '-' + d.slice(6,8);
      if(d.length>8) out += '-' + d.slice(8,10);
      input.value = out;
    });
    input.addEventListener('focus', function(){ if(!input.value) input.value = '+7 ('; });
  }
  document.querySelectorAll('[data-phone-mask]').forEach(attachPhoneMask);

  /* =========================================================
     VIN filter — blocks I, O, Q
     ========================================================= */
  document.querySelectorAll('[data-vin-input]').forEach(function(input){
    input.addEventListener('input', function(){
      var v = input.value.toUpperCase().replace(/[IOQ]/g,'').replace(/[^A-HJ-NPR-Z0-9]/g,'');
      input.value = v.slice(0,17);
    });
  });

  /* =========================================================
     APPOINTMENT WIZARD
     ========================================================= */
  var wizard = document.getElementById('apptWizard');
  if(wizard){
    var TOP_BRANDS = ["Lada","Hyundai","Kia","Toyota","Volkswagen","Renault","Nissan","Chevrolet","Daewoo","Mitsubishi","Mazda","Ford","Skoda","BMW","Mercedes-Benz","Audi","Honda","Opel","Peugeot","Chery","Geely","Haval"];
    var steps = Array.prototype.slice.call(wizard.querySelectorAll('.wizard-step'));
    var total = steps.length;
    var cur = 1;
    var fill = wizard.querySelector('.wizard-progress .fill');
    var label = wizard.querySelector('.wizard-progress .label .cur');
    var btnBack = document.getElementById('wizBack');
    var btnNext = document.getElementById('wizNext');
    var stateIdle = document.getElementById('wizIdle');
    var stateSending = document.getElementById('wizSending');
    var stateSuccess = document.getElementById('wizSuccess');
    var stateError = document.getElementById('wizError');

    var draftKey = 'ats_appointment_draft_v1';
    var data = {
      brand:'', model:'', year:'', yearUnknown:false, vin:'', vinUnknown:false, mileage:'',
      services:[], unsureService:false, photos:[],
      date:'', slot:'', asap:false,
      name:'', phone:'', channel:'call', consent:false,
      idempotency_key: uuid(), submitted:false
    };
    var saved = safeStorage.get(draftKey);
    if(saved){
      try{ var parsed = JSON.parse(saved); Object.assign(data, parsed); }catch(e){}
    }
    function persist(){ safeStorage.set(draftKey, JSON.stringify(data)); }

    function setStep(n, dir){
      cur = n;
      steps.forEach(function(s){ s.classList.toggle('active', parseInt(s.getAttribute('data-step'),10) === n); });
      fill.style.transform = 'scaleX(' + (n/total) + ')';
      if(label) label.textContent = n;
      btnBack.style.visibility = n===1 ? 'hidden' : 'visible';
      btnNext.textContent = n===total ? 'Отправить' : 'Далее';
      track('appt_step_view', {step:n});
      window.scrollTo({top: wizard.offsetTop - 90, behavior: reduceMotion?'auto':'smooth'});
    }

    function showError(fieldWrap, msg){
      fieldWrap.classList.add('invalid');
      var e = fieldWrap.querySelector('.error-text');
      if(e) e.textContent = msg;
    }
    function clearError(fieldWrap){ fieldWrap.classList.remove('invalid'); }

    /* ---- Step 1: brand search ---- */
    var brandInput = document.getElementById('f-brand');
    var brandResults = document.getElementById('brandResults');
    var brandField = document.getElementById('field-brand');
    if(brandInput){
      brandInput.value = data.brand || '';
      brandInput.addEventListener('input', function(){
        data.brand = brandInput.value;
        var q = brandInput.value.trim().toLowerCase();
        var matches = q ? TOP_BRANDS.filter(function(b){ return b.toLowerCase().indexOf(q) === 0; }) : TOP_BRANDS;
        brandResults.innerHTML = '';
        matches.slice(0,8).forEach(function(b){
          var btn = document.createElement('button');
          btn.type='button'; btn.textContent=b;
          btn.addEventListener('click', function(){ brandInput.value=b; data.brand=b; brandResults.classList.remove('open'); clearError(brandField); });
          brandResults.appendChild(btn);
        });
        brandResults.classList.toggle('open', matches.length>0 && document.activeElement===brandInput);
      });
      brandInput.addEventListener('focus', function(){ if(brandResults.children.length) brandResults.classList.add('open'); });
      document.addEventListener('click', function(e){ if(!brandField.contains(e.target)) brandResults.classList.remove('open'); });
    }
    var yearInput = document.getElementById('f-year');
    var yearUnknown = document.getElementById('f-year-unknown');
    yearInput && (yearInput.value = data.year || '');
    yearUnknown && (yearUnknown.checked = !!data.yearUnknown);
    yearUnknown && yearUnknown.addEventListener('change', function(){
      data.yearUnknown = yearUnknown.checked;
      yearInput.disabled = yearUnknown.checked;
      if(yearUnknown.checked) yearInput.value='';
    });
    yearInput && yearInput.addEventListener('input', function(){ data.year = yearInput.value; });

    var vinInput = document.getElementById('f-vin');
    var vinUnknownBtn = document.getElementById('vinUnknownBtn');
    vinInput && (vinInput.value = data.vin || '');
    vinInput && vinInput.addEventListener('input', function(){ data.vin = vinInput.value; });
    vinUnknownBtn && vinUnknownBtn.addEventListener('click', function(){
      data.vinUnknown = true; data.vin=''; vinInput.value=''; vinInput.disabled = true;
      track('skip_vin');
    });
    var mileageInput = document.getElementById('f-mileage');
    mileageInput && (mileageInput.value = data.mileage || '');
    mileageInput && mileageInput.addEventListener('input', function(){ data.mileage = mileageInput.value.replace(/\D/g,''); mileageInput.value = data.mileage; });

    /* ---- Step 2: services chips ---- */
    var chipInputs = Array.prototype.slice.call(wizard.querySelectorAll('[data-service-chip]'));
    var unsureChip = document.getElementById('f-unsure');
    function syncChips(){
      chipInputs.forEach(function(inp){
        inp.checked = data.services.indexOf(inp.value) !== -1;
        inp.closest('.chip').classList.toggle('checked', inp.checked);
        inp.disabled = data.unsureService;
      });
      if(unsureChip) unsureChip.checked = data.unsureService;
    }
    chipInputs.forEach(function(inp){
      inp.addEventListener('change', function(){
        if(inp.checked){ if(data.services.indexOf(inp.value)===-1) data.services.push(inp.value); }
        else { data.services = data.services.filter(function(v){ return v!==inp.value; }); }
        inp.closest('.chip').classList.toggle('checked', inp.checked);
      });
    });
    unsureChip && unsureChip.addEventListener('change', function(){
      data.unsureService = unsureChip.checked;
      if(data.unsureService){ data.services = []; }
      syncChips();
    });
    syncChips();

    /* photos (local preview only, no upload) */
    var photoInput = document.getElementById('f-photos');
    var photoWrap = document.getElementById('photoSlots');
    function renderPhotos(){
      if(!photoWrap) return;
      photoWrap.querySelectorAll('.photo-slot.filled').forEach(function(n){ n.remove(); });
      data.photos.forEach(function(src, i){
        var slot = document.createElement('div');
        slot.className = 'photo-slot filled';
        slot.innerHTML = '<img src="'+src+'" alt="Фото '+(i+1)+'"><span class="rm" role="button" tabindex="0" aria-label="Удалить фото">×</span>';
        slot.querySelector('.rm').addEventListener('click', function(){ data.photos.splice(i,1); renderPhotos(); });
        photoWrap.insertBefore(slot, photoInput ? photoInput.closest('.photo-slot') : null);
      });
    }
    photoInput && photoInput.addEventListener('change', function(){
      var files = Array.prototype.slice.call(photoInput.files||[]).slice(0, 3-data.photos.length);
      files.forEach(function(file){
        var reader = new FileReader();
        reader.onload = function(e){ data.photos.push(e.target.result); renderPhotos(); };
        reader.readAsDataURL(file);
      });
      photoInput.value = '';
    });

    /* ---- Step 3: calendar + slots ---- */
    var daysRow = document.getElementById('daysRow');
    var slotsGrid = document.getElementById('slotsGrid');
    var asapBtn = document.getElementById('asapBtn');
    var WD = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
    var MN = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    var BUSY_SLOTS = ['11:00','15:00'];
    function fmtDate(d){ return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'.'+d.getFullYear(); }
    if(daysRow){
      var today = new Date();
      for(var i=0;i<14;i++){
        (function(i){
          var d = new Date(today); d.setDate(d.getDate()+i);
          var pill = document.createElement('button');
          pill.type='button'; pill.className='day-pill';
          pill.setAttribute('aria-pressed', 'false');
          pill.innerHTML = '<b>'+d.getDate()+'</b>'+ (i===0?'Сегодня': WD[d.getDay()]+' '+MN[d.getMonth()]);
          pill.addEventListener('click', function(){
            data.date = fmtDate(d); data.asap = false;
            Array.prototype.forEach.call(daysRow.children, function(p){ p.setAttribute('aria-pressed','false'); });
            pill.setAttribute('aria-pressed','true');
            asapBtn && asapBtn.setAttribute('aria-pressed','false');
            clearError(document.getElementById('field-when'));
          });
          daysRow.appendChild(pill);
        })(i);
      }
    }
    if(slotsGrid){
      var hours = []; for(var h=9; h<=18; h++){ hours.push(('0'+h).slice(-2)+':00'); }
      hours.forEach(function(t){
        var b = document.createElement('button');
        b.type='button'; b.className='slot'; b.textContent=t; b.setAttribute('aria-pressed','false');
        if(BUSY_SLOTS.indexOf(t)!==-1){ b.disabled = true; b.title='Занято'; }
        else {
          b.addEventListener('click', function(){
            data.slot = t; data.asap=false;
            Array.prototype.forEach.call(slotsGrid.children, function(s){ s.setAttribute('aria-pressed','false'); });
            b.setAttribute('aria-pressed','true');
            asapBtn && asapBtn.setAttribute('aria-pressed','false');
            clearError(document.getElementById('field-when'));
          });
        }
        slotsGrid.appendChild(b);
      });
    }
    asapBtn && asapBtn.addEventListener('click', function(){
      data.asap = true; data.date=''; data.slot='';
      asapBtn.setAttribute('aria-pressed','true');
      if(daysRow) Array.prototype.forEach.call(daysRow.children, function(p){ p.setAttribute('aria-pressed','false'); });
      if(slotsGrid) Array.prototype.forEach.call(slotsGrid.children, function(s){ s.setAttribute('aria-pressed','false'); });
      clearError(document.getElementById('field-when'));
    });

    /* ---- Step 4: contacts ---- */
    var nameInput = document.getElementById('f-name');
    var phoneInput = document.getElementById('f-phone');
    var consentInput = document.getElementById('f-consent');
    nameInput && (nameInput.value = data.name||'');
    nameInput && nameInput.addEventListener('input', function(){ data.name = nameInput.value; });
    phoneInput && (phoneInput.value = data.phone||'');
    phoneInput && phoneInput.addEventListener('input', function(){ data.phone = phoneInput.value; });
    consentInput && (consentInput.checked = !!data.consent);
    consentInput && consentInput.addEventListener('change', function(){ data.consent = consentInput.checked; });
    wizard.querySelectorAll('[name="channel"]').forEach(function(r){
      r.checked = r.value === data.channel;
      r.addEventListener('change', function(){ if(r.checked) data.channel = r.value; });
    });

    /* ---- Step 5: summary + payload + submit ---- */
    var summaryBox = document.getElementById('summaryBox');
    var payloadPanel = document.getElementById('payloadPanel');
    var payloadPre = document.getElementById('payloadPre');
    var payloadToggle = document.getElementById('payloadToggle');

    function buildPayload(){
      return {
        name: data.name, phone: data.phone.replace(/\D/g,'').replace(/^8/,'7'),
        contact_method: data.channel,
        car: { brand:data.brand||null, model:data.model||null, year: data.yearUnknown?null:(parseInt(data.year,10)||null), vin: data.vinUnknown?null:(data.vin||null), mileage: data.mileage?parseInt(data.mileage,10):null },
        services: data.unsureService ? [] : data.services.slice(),
        unsure_service: data.unsureService,
        preferred: { date: data.asap?null:(data.date||null), slot: data.asap?null:(data.slot||null), asap: data.asap },
        photos_count: data.photos.length,
        consent: data.consent,
        page: 'appointment',
        idempotency_key: data.idempotency_key
      };
    }
    function renderSummary(){
      if(!summaryBox) return;
      var p = buildPayload();
      var rows = [
        ['Марка/модель', (p.car.brand||'—') + (data.model? ' '+data.model : '')],
        ['Год', p.car.year || (data.yearUnknown?'не помню':'—')],
        ['VIN', p.car.vin || (data.vinUnknown?'не знаю':'—')],
        ['Пробег', p.car.mileage ? p.car.mileage+' км' : 'не указан'],
        ['Услуги', p.unsure_service ? 'нужна диагностика' : (p.services.join(', ')||'—')],
        ['Фото', p.photos_count + ' шт.'],
        ['Когда', p.preferred.asap ? 'как можно раньше' : (p.preferred.date+' · '+p.preferred.slot)],
        ['Контакт', (data.name||'—') + ' · ' + (data.phone||'—') + ' · ' + (data.channel==='call'?'звонок':'Telegram')]
      ];
      summaryBox.innerHTML = rows.map(function(r){ return '<div class="row"><span>'+r[0]+'</span><b>'+ (r[1]||'—') +'</b></div>'; }).join('');
      if(payloadPre) payloadPre.textContent = JSON.stringify(p, null, 2);
    }
    payloadToggle && payloadToggle.addEventListener('click', function(){
      payloadPanel.classList.toggle('open');
      payloadToggle.setAttribute('aria-expanded', payloadPanel.classList.contains('open'));
    });

    function validateStep(n){
      if(n===1){
        if(!data.brand || !data.brand.trim()){ showError(brandField, 'Укажите марку автомобиля'); brandInput.focus(); return false; }
        clearError(brandField); return true;
      }
      if(n===2){
        var f = document.getElementById('field-services');
        if(!data.unsureService && data.services.length===0){ showError(f,'Выберите хотя бы одну услугу или «не знаю»'); return false; }
        clearError(f); return true;
      }
      if(n===3){
        var f3 = document.getElementById('field-when');
        if(!data.asap && !(data.date && data.slot)){ showError(f3, 'Выберите дату и время или «как можно раньше»'); return false; }
        clearError(f3); return true;
      }
      if(n===4){
        var okPhone = data.phone && data.phone.replace(/\D/g,'').length>=11;
        var fPhone = document.getElementById('field-phone');
        var fConsent = document.getElementById('field-consent');
        var valid = true;
        if(!okPhone){ showError(fPhone, 'Укажите телефон — 11 цифр, формат +7 (999) 999-99-99'); valid=false; } else clearError(fPhone);
        if(!data.consent){ showError(fConsent, 'Нужно согласие на обработку персональных данных'); valid=false; } else clearError(fConsent);
        if(!valid){ (!okPhone?phoneInput:consentInput).focus(); }
        return valid;
      }
      return true;
    }

    function doSubmit(forceError){
      stateIdle.classList.remove('active');
      stateSending.classList.add('active');
      btnNext.disabled = true; btnBack.disabled = true;
      track('appt_submit_attempt', {});
      var delay = 700 + Math.random()*500;
      setTimeout(function(){
        stateSending.classList.remove('active');
        if(forceError){
          stateError.classList.add('active');
          btnNext.disabled = false; btnBack.disabled = false;
          return;
        }
        data.submitted = true;
        persist();
        var ticket = 'ATS-' + Math.floor(100000 + Math.random()*900000);
        document.getElementById('ticketId').textContent = '№ ' + ticket;
        stateSuccess.classList.add('active');
        safeStorage.remove(draftKey);
        track('appt_success', {ticket:ticket});
      }, delay);
    }
    var retryBtn = document.getElementById('wizRetry');
    retryBtn && retryBtn.addEventListener('click', function(){ stateError.classList.remove('active'); stateIdle.classList.add('active'); });
    var errorSimBtn = document.getElementById('wizSimError');
    errorSimBtn && errorSimBtn.addEventListener('click', function(){ doSubmit(true); });

    btnNext.addEventListener('click', function(){
      if(!validateStep(cur)) return;
      persist();
      track('appt_step_next', {step:cur});
      if(cur < total){ setStep(cur+1); if(cur===5) renderSummary(); if(cur-1+1===5){} }
      else {
        renderSummary();
        doSubmit(false);
      }
      if(cur===total) renderSummary();
    });
    btnBack.addEventListener('click', function(){
      track('appt_step_back', {step:cur});
      if(cur>1) setStep(cur-1);
    });

    var modelInput = document.getElementById('f-model');
    modelInput && (modelInput.value = data.model||'');
    modelInput && modelInput.addEventListener('input', function(){ data.model = modelInput.value; });

    setStep(1);
    track('appt_open');
  }

  /* =========================================================
     SHORT CONTACT FORM (contacts.html)
     ========================================================= */
  var shortForm = document.getElementById('shortContactForm');
  if(shortForm){
    attachPhoneMask(shortForm.querySelector('[data-phone-mask]'));
    var sIdle = document.getElementById('scIdle');
    var sSending = document.getElementById('scSending');
    var sSuccess = document.getElementById('scSuccess');
    shortForm.addEventListener('submit', function(e){
      e.preventDefault();
      var name = shortForm.querySelector('#sc-name');
      var phone = shortForm.querySelector('#sc-phone');
      var consent = shortForm.querySelector('#sc-consent');
      var fName = document.getElementById('sc-field-name');
      var fPhone = document.getElementById('sc-field-phone');
      var fConsent = document.getElementById('sc-field-consent');
      var ok = true;
      if(!name.value.trim()){ fName.classList.add('invalid'); ok=false; } else fName.classList.remove('invalid');
      if(phone.value.replace(/\D/g,'').length<11){ fPhone.classList.add('invalid'); ok=false; } else fPhone.classList.remove('invalid');
      if(!consent.checked){ fConsent.classList.add('invalid'); ok=false; } else fConsent.classList.remove('invalid');
      if(!ok) return;
      sIdle.classList.remove('active'); sSending.classList.add('active');
      setTimeout(function(){
        sSending.classList.remove('active'); sSuccess.classList.add('active');
        track('contacts_form_success');
      }, 700+Math.random()*500);
    });
  }

  /* =========================================================
     ADMIN DEMO (admin.html) — login-less, client-only, no persistence
     ========================================================= */
  var adminGate = document.getElementById('adminGate');
  if(adminGate){
    var adminMain = document.getElementById('adminMain');
    document.getElementById('adminEnterBtn').addEventListener('click', function(){
      adminGate.style.display = 'none';
      adminMain.style.display = 'block';
      track('admin_open');
      startAdminTimer();
    });

    var timerEl = document.getElementById('adminTimer');
    var timerStart = null, timerRunning = false, timerRaf = null;
    function startAdminTimer(){
      timerStart = Date.now(); timerRunning = true;
      tick();
    }
    function tick(){
      if(!timerRunning) return;
      var sec = ((Date.now()-timerStart)/1000).toFixed(1);
      timerEl.textContent = sec + ' с';
      timerRaf = requestAnimationFrame(tick);
    }

    var weakToggle = document.getElementById('weakNetToggle');
    var queueStatus = document.getElementById('queueStatus');
    var publishBtn = document.getElementById('publishBtn');
    var captionInput = document.getElementById('pubCaption');
    var categorySelect = document.getElementById('pubCategory');
    var fileInput = document.getElementById('pubFile');
    var previewImg = document.getElementById('pubPreview');
    var previewData = null;
    var previewGrid = document.getElementById('adminPreviewGrid');

    fileInput && fileInput.addEventListener('change', function(){
      var f = fileInput.files && fileInput.files[0];
      if(!f) return;
      var reader = new FileReader();
      reader.onload = function(e){
        previewData = e.target.result;
        previewImg.src = previewData;
        previewImg.style.display = 'block';
      };
      reader.readAsDataURL(f);
    });

    function addToGrid(){
      var card = document.createElement('div');
      card.className = 'svc-card';
      card.innerHTML = '<div class="thumb">' + (previewData ? '<img src="'+previewData+'" style="width:100%;height:100%;object-fit:cover;">' : '<svg viewBox="0 0 400 300"><rect width="400" height="300" fill="#1C2024"/></svg>') + '</div><div class="body"><h3 style="font-size:15px;">'+ (captionInput.value || 'Без подписи') +'</h3><p>'+ (categorySelect.value || '—') +' · опубликовано только что</p></div>';
      previewGrid.insertBefore(card, previewGrid.firstChild);
    }

    function tryPublish(attempt){
      queueStatus.textContent = 'Отправка… попытка ' + attempt + ' из 3';
      setTimeout(function(){
        var weak = weakToggle && weakToggle.checked;
        var fail = weak && attempt < 2;
        if(fail){
          if(attempt >= 3){
            queueStatus.textContent = 'Нет связи. Публикация поставлена в очередь, повторим автоматически.';
            return;
          }
          queueStatus.textContent = 'Слабая связь — ставим в очередь, повторная попытка через секунду…';
          setTimeout(function(){ tryPublish(attempt+1); }, 1000);
          return;
        }
        queueStatus.textContent = 'Опубликовано. Работа появилась в галерее.';
        addToGrid();
        track('admin_publish', {weakNet: !!weak, attempt: attempt});
      }, 900);
    }

    publishBtn && publishBtn.addEventListener('click', function(){
      if(!captionInput.value.trim()){ captionInput.focus(); return; }
      tryPublish(1);
    });
  }

})();
