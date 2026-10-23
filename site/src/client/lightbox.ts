/* Лайтбокс галереи работ: данные — из data-атрибутов карточек (SSR из БД).
   Esc, ←/→, свайп, клик мимо, фокус-ловушка, счётчик. */
import { $, $$, track } from './lib.ts';

interface GalItem { img: string; title: string; sub: string }

const lb = $('#lightbox');
const items: GalItem[] = $$('[data-gal]').map((b) => ({
  img: b.getAttribute('data-img') ?? '',
  title: b.getAttribute('data-title') ?? '',
  sub: b.getAttribute('data-sub') ?? '',
}));
let lbLastFocus: HTMLElement | null = null;
let lbIdx = 0;

function lbRender(): void {
  const it = items[lbIdx];
  if (!it || !lb) return;
  const img = $('#lb-img', lb);
  if (img) img.innerHTML = `<img src="${it.img}" alt="${it.title}">`;
  const t = $('#lb-title', lb); if (t) t.textContent = it.title;
  const s = $('#lb-sub', lb); if (s) s.textContent = it.sub;
  const c = $('#lb-count', lb); if (c) c.textContent = `${lbIdx + 1} / ${items.length}`;
}
function lbOpen(i: number): void {
  if (!lb || !items.length) return;
  lbLastFocus = document.activeElement as HTMLElement | null;
  lbIdx = ((i % items.length) + items.length) % items.length;
  lbRender();
  lb.classList.add('is-open');
  document.body.classList.add('no-scroll');
  /* 7.2: фокус только когда visibility уже visible — на следующем кадре,
     иначе браузер не focuses элемент внутри скрытого оверлея. */
  // 6.3: visibility становится visible только после кадра + кадра перехода —
  // двойной rAF, плюс страховка transitionend на самый долгий transition
  requestAnimationFrame(() => {
    requestAnimationFrame(() => { $('#lb-close', lb)?.focus(); });
  });
  const onVis = (): void => {
    $('#lb-close', lb)?.focus();
    lb?.removeEventListener('transitionend', onVis);
  };
  lb?.addEventListener('transitionend', onVis);
  track('lightbox_open', { index: lbIdx });
}
function lbClose(): void {
  if (!lb || !lb.classList.contains('is-open')) return;
  lb.classList.remove('is-open');
  document.body.classList.remove('no-scroll');
  lbLastFocus?.focus();
}
function lbGo(d: number): void {
  if (!items.length) return;
  lbIdx = ((lbIdx + d) % items.length + items.length) % items.length;
  lbRender();
  track('lightbox_nav', { index: lbIdx });
}

if (lb && items.length) {
  $$('[data-gal]').forEach((b) => {
    b.addEventListener('click', () => lbOpen(parseInt(b.getAttribute('data-gal') ?? '0', 10) || 0));
  });
  $('#lb-close', lb)?.addEventListener('click', lbClose);
  $('#lb-prev', lb)?.addEventListener('click', () => lbGo(-1));
  $('#lb-next', lb)?.addEventListener('click', () => lbGo(1));
  lb.addEventListener('click', (e) => { if (e.target === lb) lbClose(); });
  lb.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    if (!$('#lb-close', lb)?.closest('#lightbox')?.contains(document.activeElement)) {
      e.preventDefault(); $('#lb-close', lb)?.focus(); return;
    }
    const f = $$<HTMLElement>('button,a[href]', lb).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  let lx0: number | null = null, ly0 = 0;
  lb.addEventListener('pointerdown', (e) => { lx0 = (e as PointerEvent).clientX; ly0 = (e as PointerEvent).clientY; });
  lb.addEventListener('pointerup', (e) => {
    if (lx0 === null) return;
    const dx = (e as PointerEvent).clientX - lx0, dy = (e as PointerEvent).clientY - ly0;
    lx0 = null;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) lbGo(dx < 0 ? 1 : -1);
  });
}
document.addEventListener('keydown', (e) => {
  if (!lb || !lb.classList.contains('is-open')) return;
  if (e.key === 'Escape') lbClose();
  if (e.key === 'ArrowLeft') lbGo(-1);
  if (e.key === 'ArrowRight') lbGo(1);
});
