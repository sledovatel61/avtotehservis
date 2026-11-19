/* Лайтбокс галереи работ: данные — из data-атрибутов карточек (SSR из БД).
   Esc, ←/→, свайп, клик мимо, фокус-ловушка, счётчик. */
import { $, $$, track } from './lib.ts';

interface GalItem { img: string; title: string; sub: string }

const lb = $('#lightbox');
const read = (b: Element): GalItem => ({
  img: b.getAttribute('data-img') ?? '',
  title: b.getAttribute('data-title') ?? '',
  sub: b.getAttribute('data-sub') ?? '',
});
/* Галерея работ: листается стрелками, ←/→ и свайпом. */
const items: GalItem[] = $$('[data-gal]').map(read);
/* Одиночный просмотр (`data-zoom`): сертификаты и подобные документы.
   Открывается ровно тот кадр, который нажали: без стрелок, счётчика и листания —
   иначе клиент уезжает в соседние документы, а на «О компании» в ту же ленту
   попадали ещё и кейсы (было «1 / 10» на сертификате). */
const zooms: GalItem[] = $$('[data-zoom]').map(read);
let lbLastFocus: HTMLElement | null = null;
let lbIdx = 0;
let zoomItem: GalItem | null = null;

const isSingle = (): boolean => zoomItem !== null;

function lbRender(): void {
  const it = zoomItem ?? items[lbIdx];
  if (!it || !lb) return;
  const img = $('#lb-img', lb);
  if (img) img.innerHTML = `<img src="${it.img}" alt="${it.title}">`;
  const t = $('#lb-title', lb); if (t) t.textContent = it.title;
  const s = $('#lb-sub', lb); if (s) s.textContent = it.sub;
  const c = $('#lb-count', lb);
  if (c) {
    c.textContent = isSingle() ? '' : `${lbIdx + 1} / ${items.length}`;
    c.hidden = isSingle();
  }
  const prev = $('#lb-prev', lb), next = $('#lb-next', lb);
  for (const a of [prev, next]) if (a) a.hidden = isSingle();
  lb.classList.toggle('is-single', isSingle());
}
function lbOpen(i: number): void {
  if (!lb || !items.length) return;
  lbLastFocus = document.activeElement as HTMLElement | null;
  zoomItem = null;
  lbIdx = ((i % items.length) + items.length) % items.length;
  lbRender();
  lb.classList.add('is-open');
  document.body.classList.add('no-scroll');
  $('#lb-close', lb)?.focus();
  track('lightbox_open', { index: lbIdx });
}
function lbOpenSingle(item: GalItem): void {
  if (!lb || !item.img) return;
  lbLastFocus = document.activeElement as HTMLElement | null;
  zoomItem = item;
  lbRender();
  lb.classList.add('is-open');
  document.body.classList.add('no-scroll');
  $('#lb-close', lb)?.focus();
  track('lightbox_open', { index: -1 });
}
function lbClose(): void {
  if (!lb || !lb.classList.contains('is-open')) return;
  lb.classList.remove('is-open');
  lb.classList.remove('is-single');
  document.body.classList.remove('no-scroll');
  zoomItem = null;
  lbLastFocus?.focus();
}
function lbGo(d: number): void {
  if (isSingle() || !items.length) return;
  lbIdx = ((lbIdx + d) % items.length + items.length) % items.length;
  lbRender();
  track('lightbox_nav', { index: lbIdx });
}

if (lb && (items.length || zooms.length)) {
  /* круг 27: индекс берём из порядка кнопок в DOM (`idx`), а не из data-gal — иначе кнопки
     сертификатов выше блока кейсов сбивали открытие шести кейсов ниже. Теперь сертификаты
     идут отдельным списком `data-zoom` и на нумерацию галереи не влияют. */
  $$('[data-gal]').forEach((b, idx) => {
    b.addEventListener('click', () => lbOpen(idx));
  });
  $$('[data-zoom]').forEach((b) => {
    b.addEventListener('click', () => lbOpenSingle(read(b)));
  });
  $('#lb-close', lb)?.addEventListener('click', lbClose);
  $('#lb-prev', lb)?.addEventListener('click', () => lbGo(-1));
  $('#lb-next', lb)?.addEventListener('click', () => lbGo(1));
  lb.addEventListener('click', (e) => { if (e.target === lb) lbClose(); });
  lb.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
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
