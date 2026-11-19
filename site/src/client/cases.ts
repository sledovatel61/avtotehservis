/**
 * Сравнение «как было / как стало» на странице кейса (круг 79, задание №82).
 *
 * Без этого скрипта страница честно работает: два кадра стоят друг под другом,
 * подписи читаются, картинки грузятся. Скрипт **улучшает**: накладывает кадры,
 * добавляет ползунок (клавиатура из коробки — это `input[type=range]`) и перетаскивание
 * пальцем/мышью по кадру. Никаких библиотек: только DOM.
 */
import { $$ } from './lib.ts';

interface BaEl extends HTMLElement {
  __ba?: { set: (v: number) => void };
}

const clamp = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v);

$$('[data-ba]').forEach((el) => {
  const root = el as BaEl;
  const before = root.querySelector<HTMLElement>('.ba-fig--before');
  const after = root.querySelector<HTMLElement>('.ba-fig--after');
  if (!before || !after) return;

  /* Ползунок: сначала разметка, потом класс — если что-то пойдёт не так на старом
     браузере, пользователь останется с обычной парой кадров, а не с пустой рамкой. */
  const wrap = document.createElement('div');
  wrap.className = 'ba-range-wrap';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.value = '50';
  input.className = 'ba-range';
  input.setAttribute('aria-label', 'Сравнение: как было и как стало');
  input.setAttribute('aria-valuetext', '50 % — половина кадра «как было», половина «как стало»');
  wrap.append(input);

  const divider = document.createElement('span');
  divider.className = 'ba-divider';
  divider.setAttribute('aria-hidden', 'true');

  root.append(divider, wrap);
  root.classList.add('ba--slider');

  const set = (value: number): void => {
    const v = clamp(value);
    input.value = String(Math.round(v));
    /* Верхний слой — «как стало»: он виден справа от линии, «как было» просвечивает слева. */
    after.style.clipPath = `inset(0 0 0 ${v}%)`;
    divider.style.left = `${v}%`;
    input.setAttribute('aria-valuetext', `${Math.round(v)} % — кадра «как было» слева, «как стало» справа`);
  };
  set(50);

  input.addEventListener('input', () => set(Number(input.value)));

  /* Перетаскивание по кадру: палец ставит линию туда, где он, без «прыжка» к центру. */
  let dragging = false;
  const posFromEvent = (e: PointerEvent): number => {
    const r = root.getBoundingClientRect();
    if (r.width <= 0) return 50;
    return ((e.clientX - r.left) / r.width) * 100;
  };
  root.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement | null;
    /* Ползунок ниже кадра живёт своей жизнью — не перехватываем его нажатия. */
    if (target && target.closest('.ba-range-wrap')) return;
    dragging = true;
    root.setPointerCapture(e.pointerId);
    root.classList.add('ba--drag');
    set(posFromEvent(e));
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    set(posFromEvent(e));
  });
  const stop = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    root.classList.remove('ba--drag');
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
  };
  root.addEventListener('pointerup', stop);
  root.addEventListener('pointercancel', stop);

  /* Картинки не должны включать нативное перетаскивание — оно ломает жест. */
  root.querySelectorAll('img').forEach((img) => { img.draggable = false; });
});
