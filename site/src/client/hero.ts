/* Слайдер-герой: автопрокрутка 6 с, стрелки, точки, свайп, клавиши,
   пауза при наведении/фокусе, остановка при prefers-reduced-motion. */
import { $, $$, reducedMotion, track } from './lib.ts';

const hero = $('#hero');
if (hero) {
  const slides = $$('.slide', hero);
  if (slides.length >= 2) {
    const dotsBox = $('#hero-dots');
    let idx = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    let paused = false;
    const DELAY = 6000;

    slides.forEach((s, i) => {
      s.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
      if (dotsBox) {
        const b = document.createElement('button');
        b.className = 'hero-dot' + (i === 0 ? ' is-on' : '');
        b.type = 'button';
        b.setAttribute('aria-label', `Слайд ${i + 1} из ${slides.length}`);
        b.addEventListener('click', () => go(i, true));
        dotsBox.appendChild(b);
      }
    });
    const dots = dotsBox ? $$('.hero-dot', dotsBox) : [];

    function go(n: number, user?: boolean): void {
      idx = (n + slides.length) % slides.length;
      slides.forEach((s, i) => {
        s.classList.toggle('is-active', i === idx);
        s.setAttribute('aria-hidden', i === idx ? 'false' : 'true');
        $$('a,button', s).forEach((el) => { el.tabIndex = i === idx ? 0 : -1; });
      });
      dots.forEach((d, i) => d.classList.toggle('is-on', i === idx));
      if (user) track('hero_slide', { index: idx });
      restart();
    }
    function restart(): void {
      if (timer) { clearInterval(timer); timer = null; }
      if (reducedMotion()) return; /* reduced-motion: автопрокрутка выключена */
      timer = setInterval(() => { if (!paused && !document.hidden) go(idx + 1); }, DELAY);
    }
    $('#hero-prev')?.addEventListener('click', () => go(idx - 1, true));
    $('#hero-next')?.addEventListener('click', () => go(idx + 1, true));
    hero.addEventListener('mouseenter', () => { paused = true; });
    hero.addEventListener('mouseleave', () => { paused = false; });
    hero.addEventListener('focusin', () => { paused = true; });
    hero.addEventListener('focusout', (e) => { if (!hero.contains(e.relatedTarget as Node)) paused = false; });
    document.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('menu-open') || $$('.modal.is-open,.lightbox.is-open').length) return;
      const r = hero.getBoundingClientRect();
      const hasLayout = r.width > 0 || r.height > 0;
      if (hasLayout && (r.bottom < 80 || r.top > window.innerHeight - 80)) return;
      if (e.key === 'ArrowLeft') { go(idx - 1, true); e.preventDefault(); }
      if (e.key === 'ArrowRight') { go(idx + 1, true); e.preventDefault(); }
    });
    /* свайп */
    let x0: number | null = null, y0 = 0;
    hero.addEventListener('pointerdown', (e) => { x0 = (e as PointerEvent).clientX; y0 = (e as PointerEvent).clientY; });
    hero.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = (e as PointerEvent).clientX - x0, dy = (e as PointerEvent).clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) go(idx + (dx < 0 ? 1 : -1), true);
    });
    go(0);
  }
}
