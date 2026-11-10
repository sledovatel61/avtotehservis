import '../styles/bg3d.css';
/**
 * Вход 3D-фона для страниц. Импортируется только из `Bg3dLayer.astro`, поэтому
 * в бандл страниц без фона не попадает (проверка веса — scripts/bg3d-measure.mjs).
 */
import { mountAll, unmountAll } from './bg3d/index.ts';

/* Разрешение на фон решает сервер: он либо рисует `[data-bg3d]`, либо нет
   (site/src/client/bg3d/config.ts + env BG3D). Если элемента нет — mountAll не делает ничего. */
mountAll(true);

/* Клиентский роутер Astro сейчас не включён (`@view-transition{navigation:auto}` в motion.css —
   это нативные MPA-переходы), но слушатели стоят на будущее: без них 20 переходов
   оставили бы 20 живых контекстов WebGL. */
document.addEventListener('astro:before-swap', () => { unmountAll(); });
document.addEventListener('astro:page-load', () => { mountAll(true); });
