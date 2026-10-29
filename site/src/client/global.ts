/* Общее поведение публичных страниц — перенос утверждённой логики (jsdom 122/122). */
import { $, $$, reducedMotion, track } from './lib.ts';

/* ---------- компактная шапка при скролле ---------- */
const hdr = $('#hdr');
if (hdr) {
  const onScroll = (): void => { hdr.classList.toggle('is-compact', window.scrollY > 24); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ---------- мобильное меню: на весь экран, Esc, фокус-ловушка ---------- */
const burger = $('#burger');
const mmenu = $('#m-menu');
let lastFocus: HTMLElement | null = null;

function focusables(root: HTMLElement): HTMLElement[] {
  return $$<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])', root)
    .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

function openMenu(): void {
  if (!mmenu) return;
  lastFocus = document.activeElement as HTMLElement | null;
  document.body.classList.add('menu-open', 'no-scroll');
  burger?.setAttribute('aria-expanded', 'true');
  track('menu_open');
  const first = focusables(mmenu)[0];
  first?.focus();
}
function closeMenu(): void {
  if (!mmenu || !document.body.classList.contains('menu-open')) return;
  document.body.classList.remove('menu-open', 'no-scroll');
  burger?.setAttribute('aria-expanded', 'false');
  lastFocus?.focus();
}
burger?.addEventListener('click', () => {
  if (document.body.classList.contains('menu-open')) closeMenu(); else openMenu();
});
$('#m-close')?.addEventListener('click', closeMenu);
mmenu?.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t === mmenu) closeMenu();
  if (t.closest('a')) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
  if (e.key === 'Tab' && document.body.classList.contains('menu-open') && mmenu) {
    const items = focusables(mmenu);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

/* ---------- sticky-док только на узких экранах ---------- */
function syncDock(): void {
  const wide = window.matchMedia ? window.matchMedia('(max-width:860px)').matches : window.innerWidth <= 860;
  document.body.classList.toggle('has-dock', wide && !!$('.dock'));
}
window.addEventListener('resize', syncDock);
syncDock();

/* ---------- появление секций при скролле (каскад 0/80/160/240) ---------- */
const reveals = $$('.reveal');
if (reducedMotion() || !('IntersectionObserver' in window)) {
  reveals.forEach((el) => el.classList.add('is-in'));
} else {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  reveals.forEach((el) => io.observe(el));
}

/* ---------- модалки: политика и согласие ---------- */
let modalLastFocus: HTMLElement | null = null;
function openModal(id: string | null): void {
  if (!id) return;
  const m = document.getElementById('modal-' + id);
  if (!m) return;
  modalLastFocus = document.activeElement as HTMLElement | null;
  m.classList.add('is-open');
  document.body.classList.add('no-scroll');
  const f = m.querySelector<HTMLElement>('button,a[href]');
  f?.focus();
  track('modal_open', { modal: id });
}
function closeModal(m: HTMLElement | null): void {
  if (!m) return;
  m.classList.remove('is-open');
  if (!$$('.modal.is-open').length) document.body.classList.remove('no-scroll');
  modalLastFocus?.focus();
}
$$('[data-modal]').forEach((b) => {
  b.addEventListener('click', () => openModal(b.getAttribute('data-modal')));
});
$$<HTMLElement>('.modal').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
  m.querySelector('.modal-close')?.addEventListener('click', () => closeModal(m));
  m.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = focusables(m);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.modal.is-open').forEach(closeModal);
});

/* ---------- клики-события: позвонить / telegram / маршрут ---------- */
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest?.('[data-track]');
  if (t) track(t.getAttribute('data-track') ?? 'click');
});

/* ---------- общая карусель: сдвиг на transform, стрелки, свайп ---------- */
export interface CarouselInst { go(n: number): void; render(animate?: boolean): void }

export function initCarousel(root: HTMLElement | null): CarouselInst | null {
  if (!root) return null;
  const trackFound = $('.carousel-track', root);
  if (!trackFound) return null;
  const trackEl: HTMLElement = trackFound;
  let idx = 0;
  /* стрелки — внутри корня или в том же контейнере (sec-head) */
  const navScope: HTMLElement = $('[data-car="prev"],[data-car="next"]', root)
    ? root : (root.closest('.container') ?? root.parentElement ?? root);
  const cards = (): HTMLElement[] => $$('.carousel-track > *', root);
  const perView = (): number => {
    const c = cards()[0];
    if (!c) return 1;
    const w = root.querySelector('.carousel-win');
    const ww = w ? w.clientWidth : root.clientWidth;
    const cw = c.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(trackEl).columnGap || getComputedStyle(trackEl).gap || '18') || 18;
    return Math.max(1, Math.round((ww + gap) / (cw + gap)));
  };
  const maxIdx = (): number => Math.max(0, cards().length - perView());
  function render(animate?: boolean): void {
    const c = cards()[0];
    if (!c) return;
    const gap = parseFloat(getComputedStyle(trackEl).columnGap || '18') || 18;
    const stepW = c.getBoundingClientRect().width + gap;
    if (animate === false) trackEl.style.transition = 'none';
    trackEl.style.transform = `translateX(${-idx * stepW}px)`;
    if (animate === false) { void trackEl.offsetWidth; trackEl.style.transition = ''; }
    const prev = $<HTMLButtonElement>('[data-car="prev"]', navScope);
    const next = $<HTMLButtonElement>('[data-car="next"]', navScope);
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx >= maxIdx();
  }
  const go = (n: number): void => { idx = Math.min(Math.max(0, n), maxIdx()); render(true); };
  const p = $<HTMLButtonElement>('[data-car="prev"]', navScope);
  const n = $<HTMLButtonElement>('[data-car="next"]', navScope);
  p?.addEventListener('click', () => { go(idx - 1); track('carousel_prev'); });
  n?.addEventListener('click', () => { go(idx + 1); track('carousel_next'); });
  /* свайп */
  let x0: number | null = null, y0 = 0, dx = 0, dragging = false;
  const win = root.querySelector('.carousel-win') ?? root;
  win.addEventListener('pointerdown', (e) => {
    const pe = e as PointerEvent;
    if (pe.pointerType === 'mouse' && pe.button !== 0) return;
    x0 = pe.clientX; y0 = pe.clientY; dx = 0; dragging = true;
  });
  win.addEventListener('pointermove', (e) => {
    if (!dragging || x0 === null) return;
    const pe = e as PointerEvent;
    dx = pe.clientX - x0;
    if (Math.abs(pe.clientY - y0) > Math.abs(dx)) dragging = false;
  });
  win.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (dx < -44) go(idx + 1);
    else if (dx > 44) go(idx - 1);
  });
  win.addEventListener('pointercancel', () => { dragging = false; });
  window.addEventListener('resize', () => { idx = Math.min(idx, maxIdx()); render(false); });
  /* раунд 21: клавиатура Home/End/стрелки и aria-live счётчик («Услуга 1 из 6») */
  let live = $<HTMLElement>('[data-carousel-live]', root);
  if (!live) {
    live = document.createElement('span');
    live.className = 'sr-only'; live.setAttribute('data-carousel-live', '');
    live.setAttribute('aria-live', 'polite');
    root.appendChild(live);
  }
  const word = root.dataset.liveWord ?? 'Экран';
  const say = (): void => { if (live) live.textContent = `${word} ${idx + 1} из ${cards().length}`; };
  root.addEventListener('keydown', (e) => {
    const k = e as KeyboardEvent;
    if (k.key === 'Home') { k.preventDefault(); go(0); }
    else if (k.key === 'End') { k.preventDefault(); go(maxIdx()); }
    else if (k.key === 'ArrowLeft') { go(idx - 1); }
    else if (k.key === 'ArrowRight') { go(idx + 1); }
  });
  const sayAll = (): void => { say(); };
  const origRender = render;
  render = (animate?: boolean) => { origRender(animate); sayAll(); };
  render(false);
  return { go, render };
}

$$<HTMLElement>('[data-carousel]').forEach((root) => {
  const inst = initCarousel(root);
  if (inst) (root as HTMLElement & { __carousel?: CarouselInst }).__carousel = inst;
});
