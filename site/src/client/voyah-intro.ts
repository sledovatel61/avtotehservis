/* Интро «вход в раздел Voyah Free» (круг 28).
   Сцена: тёмный кадр → по центру прочерчивается световая линия → от неё
   разлетаются два «прожектора» → линией собирается силуэт кроссовера →
   вспышка по линии → шторы разъезжаются в стороны и открывают страницу.

   Принципы:
     • без JS оверлея нет вообще → нет «вспышки» непростилизованного контента;
     • играем КАЖДЫЙ заход на страницу (круг 30, требование владельца: раньше
       sessionStorage гасил заставку до конца сессии — «срабатывает 1 раз и больше
       не загружается»); повторного показа на одном заходе нет, т.к. скрипт
       выполняется один раз;
     • ?intro=0 — выключить заставку (для тех, кому мешает; ссылка на неё — в подписи),
       ?intro=1 — оставлен как синоним «показать» для старых ссылок и проверок;
     • при reduced-motion / save-data интро не показываем совсем;
     • прерывается кликом, Esc, колесом и touchmove, тогда шторы уходят сразу.

   Запуск: подключается из voyah-free.astro как module-скрипт. */

/* Круг 29 (S4): длительности больше не живут в JS — единственный источник тайминга
   CSS-переменные .vy-intro (--vy-dur, --vy-scene). Скрипт читает --vy-dur из
   computed style и снимает оверлей по animationend правой шторы, поэтому «в коде
   2400, по факту 2751» больше не разойдётся. Мобильная ветка (≤700 px) —
   класс is-quick: 1320 мс вместо плановых ≤1600. */
const DURATION_FALLBACK = 2400;
const SVG_ID = 'vy-intro-svg';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData =
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
const introParam = new URLSearchParams(location.search).get('intro');
const off = introParam === '0';

if (!reduced && !saveData && !off) {
  start();
}

function start(): void {
  if (document.querySelector('.vy-intro')) return;

  document.body.classList.add('vy-lock');

  const quick = window.matchMedia('(max-width: 700px)').matches;
  const root = document.createElement('div');
  root.className = quick ? 'vy-intro is-quick' : 'vy-intro';
  root.setAttribute('role', 'presentation');
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="vy-intro-panel vy-intro-panel--l"></div>
    <div class="vy-intro-panel vy-intro-panel--r"></div>
    <div class="vy-intro-line"></div>
    <div class="vy-intro-lamp vy-intro-lamp--l"></div>
    <div class="vy-intro-lamp vy-intro-lamp--r"></div>
    <svg class="${SVG_ID}" viewBox="0 0 1180 460" fill="none" aria-hidden="true">
      <!-- земля -->
      <path class="ground" d="M60 400h1060" pathLength="1" style="--i:0"></path>
      <!-- контур кроссовера: длинный капот, ровная крыша, отвесная корма -->
      <path class="glow" d="M150 300c0-16 8-26 24-30l96-22 56-88c8-13 22-20 38-20h368c16 0 30 7 38 20l58 88 84 24c14 4 22 14 22 28v58h-84M150 358v-58" pathLength="1" style="--i:1"></path>
      <path d="M150 300c0-16 8-26 24-30l96-22 56-88c8-13 22-20 38-20h368c16 0 30 7 38 20l58 88 84 24c14 4 22 14 22 28v58h-84M150 358v-58" pathLength="1" style="--i:2"></path>
      <!-- остекление -->
      <path d="M306 246l52-82c5-8 13-12 22-12h360c10 0 18 5 23 13l52 81z" pathLength="1" style="--i:3"></path>
      <!-- стойка B и линия дверей -->
      <path d="M566 152v94" pathLength="1" style="--i:4"></path>
      <path d="M262 300h506" pathLength="1" style="--i:5"></path>
      <!-- световые полосы: фара и фонарь -->
      <path class="bar" d="M176 286h92" pathLength="1" style="--i:6"></path>
      <path class="bar" d="M880 272h96" pathLength="1" style="--i:7"></path>
      <!-- арки и колёса 20" -->
      <path d="M242 358a72 72 0 0 1 144 0" pathLength="1" style="--i:8"></path>
      <path d="M790 358a72 72 0 0 1 144 0" pathLength="1" style="--i:9"></path>
      <circle cx="314" cy="358" r="58" pathLength="1" style="--i:10"></circle>
      <circle cx="314" cy="358" r="24" pathLength="1" style="--i:11"></circle>
      <circle cx="862" cy="358" r="58" pathLength="1" style="--i:12"></circle>
      <circle cx="862" cy="358" r="24" pathLength="1" style="--i:13"></circle>
    </svg>
    <div class="vy-intro-flash"></div>
    <span class="vy-intro-tag"><i></i>Voyah Free · клик — пропустить</span>
  `;
  document.body.appendChild(root);

  // запускаем анимации на следующем кадре, иначе браузер «схлопнет» начальное состояние
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.add('is-play'));
  });

  const timers: number[] = [];
  const skip = (): void => {
    if (!root.isConnected) return;
    root.classList.add('is-skip');
    timers.forEach(clearTimeout);
    document.body.classList.remove('vy-lock');
    remove();
  };
  const remove = (): void => {
    timers.forEach(clearTimeout);
    root.remove();
    document.body.classList.remove('vy-lock');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') skip();
  };

  root.addEventListener('click', skip, { once: true });
  document.addEventListener('keydown', onKey);
  window.addEventListener('wheel', skip, { passive: true, once: true });
  window.addEventListener('touchmove', skip, { passive: true, once: true });

  /* основной путь — конец анимации шторы; таймер только страховка */
  const raw = getComputedStyle(root).getPropertyValue('--vy-dur').trim();
  const dur = !raw ? DURATION_FALLBACK
    : raw.endsWith('ms') ? parseFloat(raw)
      : raw.endsWith('s') ? parseFloat(raw) * 1000
        : DURATION_FALLBACK;
  const panelR = root.querySelector('.vy-intro-panel--r');
  panelR?.addEventListener('animationend', () => remove(), { once: true });
  timers.push(window.setTimeout(remove, dur + 400));
}
