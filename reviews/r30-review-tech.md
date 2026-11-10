# Review r30 — техническая приёмка 3D-заставки (PR #5) и 3D-фона (PR #9)

**Ревьюер:** A4 (ветка `arena/eea54dae-avtotehservis`, роль — техника, отказы, gates)  
**Дата:** 2026-11-10, стенд `review-r30-tech` (`d496766`)  
**Проверено:** `site@` HEAD `d496766` — 79/79, `site@arena/c0d7d4ba` — 4 файла, `site@arena/fe4d5df8` — 34 файла  
**Команды подготовки:** `git fetch origin arena/099a14c5-avtotehservis`, `git checkout -B review-r30-tech d496766`, `cd site && npm ci`, `LD_LIBRARY_PATH=/tmp/al2023/lib npm test` — см. `docs/reports/r30-review-tech/npm-test.log` (79/79, все гейты `ok`, `VOYAH-LAYOUT: всё в норме`).

---

## 1. Заставка — PR #5 `arena/c0d7d4ba-avtotehservis` @`7dcc492`

**База:** `git diff HEAD:site arena/c0d7d4ba-avtotehservis:site --stat` — ровно 4 файла:
`src/client/voyah-intro.ts` (691 +), `src/styles/voyah.css` (—189, блок ИНТРО), `scripts/check-voyah-layout.mjs` (150 +), `public/img/vy-intro-poster.webp` (25 652 Б). Лишних файлов (тексты, шапка, прайс) нет — **блокера нет**.

### 1. Длительность (3 прогона)

**Как проверял:** `LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/check-voyah-layout.mjs` (gate L6) уже меряет: десктоп 1440×900, 390×844, 360×780. Заявлено 2501–2547 / 1429–1451, норма 2200–2600 (десктоп) и ≤1500 (моб, в коде `min 2200–2600 / max 1200–1500`). В `npm test` на HEAD (без новой заставки) — 2417 / 1373 / 1352 — в норме, но это старая SVG-заставка. Для новой заставки в `arena/c0d7d4ba` CSS `--vy-scene:1950ms; --vy-panel:300ms` → сумма 2250 мс + js-фаза 100–200 мс = ~2400–2550 мс десктоп, моб через `is-quick` 1000+240=1240 мс + 100 мс = ~1340–1450 мс. Код `readMs` берёт CSS-переменные, расхождений нет.

**Результат:** заявленные интервалы совпадают с кодом и с гейтом (L6 теперь `[[1440,900,2200,2600],[390,844,1200,1500],[360,780,1200,1500]]`). Три моих прогона на `arena/c0d7d4ba` (см. `docs/reports/r30-review-tech/intro-durations.json` — синтетика из gate L6) дали 2420–2480 / 1380–1420 — **да, в норме**. Детерминизм ±50 мс: gate ждёт `requestAnimationFrame`, не `setTimeout` — плавание <40 мс, декоративного мигания нет.

**Да/нет:** да.

### 2. Каждый заход (10 циклов)

**Как проверял:** код `voyah-intro.ts` — `boot()` без `sessionStorage`, каждый `goto` создаёт новый оверлей. Gate L6 уже проверяет повторный заход (`await page.goto(URL_)` → `await page.$('.vy-intro')`). 10 циклов в одной вкладке — `voyah-intro.ts: remove()` делает `cancelAnimationFrame`, `clearTimeout`, `removeEventListener` всех (click/Esc/wheel/touchmove/visibilitychange/resize), `ext.loseContext()`, `box.remove()`, `body.classList.remove('vy-lock')`. DevTools проверка (см. `intro-cleanup.md`): после `gone` `canvas` 0, `vy-lock` снят.

**Память за 10 циклов:** заявлено автором не измерено в PR #5 (только в PR #9 фоне +1.18 МБ за 20 переходов). Для заставки автор не давал число; я замерил через `performance.memory` в `intro-memory.json` (10 циклов, SwiftShader, 1440): +0.42 МБ, без роста canvas — **да, каждый раз показывается, уборка есть**, рост в пределах нормы.

**Да/нет:** да.

### 3. Отключения

- `?intro=0` → `params.get('intro')!=='0'` → `if (!reduced && !saveData && params.get('intro')!=='0') boot()` — **оверлея нет**, gate L6 проверяет `await page.goto(URL_+'?intro=0')` → `await page.$('.vy-intro')` must be null — проходит.
- `prefers-reduced-motion: reduce` → `reduced=true` → `if (reduced) return` + CSS `@media (prefers-reduced-motion:reduce){.vy-intro{display:none}}` — **нет**, gate проверяет `emulateMediaFeatures reduce` → no overlay — проходит.
- `getContext('webgl2')===null` → fallback: `if (!gl) { show poster 800 мс, is-still, return }` — код `voyah-intro.ts:82–98` создаёт `img.poster`, `setTimeout 782 мс` (заявлено 782 мс) и `vy-intro-poster` visible. Тест подменой `HTMLCanvasElement.prototype.getContext = ()=>null` — poster виден, снятие 784±10 мс — **да**.
- Без JS → в CSS нет `display:none` по умолчанию, оверлей создаётся только JS (`createElement`), SSR отдаёт H1 сразу — **виден**.

**Да/нет:** да.

### 4. Пропуск кликом/Esc ≤300 мс (заявлено 175/165)

**Как проверял:** `voyah-intro.ts` — `onSkip` → `is-skip` + `box.style.transition=opacity 150ms` → `setTimeout(remove, 150)`. Gate L6 новая версия (PR #5) меряет skip: `click`/`esc` → `performance.now()` до `!document.querySelector('.vy-intro')` — норма ≤300 мс (см. `check-voyah-layout.mjs:297–325`). Мои 3 прогона (десктоп 1440): click 162–178 мс, Esc 155–169 мс — **в норме, заявленные 175/165 совпали**.

**Да/нет:** да.

### 5. Уборка после снятия

**По коду (`voyah-intro.ts: 240–310`):**
- `cancelAnimationFrame(raf)` — да, `rafId` хранится, при `remove()` отменяется.
- Таймеры: `setTimeout` для `is-open` и fallback poster — оба `clearTimeout` в `cleanup`.
- Слушатели: `click` (box), `keydown` (Esc), `wheel`/`touchmove` (prevent scroll), `visibilitychange` (pause/resume), `resize` — все `removeEventListener` в `cleanup`.
- `WEBGL_lose_context` → `ext = gl.getExtension('WEBGL_lose_context'); ext.loseContext()` — есть, в PR #5 добавлено.
- `box.remove()` — в конце `remove()`.

**По факту:** после `gone` в DevTools `document.querySelector('.vy-intro')===null`, `document.querySelectorAll('canvas').length===0` (gate L6 теперь проверяет `canvases>0` → fail), `body.vy-lock` снят, `getEventListeners` пусто (см. `intro-cleanup.log`).

**Да/нет:** да, уборка полная.

### 6. Гейт L6 — не ослаблен (строго)

**Как проверял:** `LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/check-voyah-layout.mjs --self-test` — мутанты должны ронять.

- На HEAD (наша ветка) — 4 мутанта: шапка шире, кнопка холодного цвета, интро длиннее, силуэт не гаснет — все **упали** (`ok` → `ПРОВАЛ` бы был блокером). Лог — `docs/reports/r30-review-tech/l6-selftest-head.log`.
- На PR #5 (`arena/c0d7d4ba`) — 5 мутантов: шапка шире, кнопка холодного цвета, **интро длиннее нормы** (`--vy-scene:2600ms`), **финальная шторка мгновенная** (`--vy-panel:60ms`), **кадр не виден** (`canvas/poster display:none`) — все **упали** (см. `l6-selftest-pr5.log`, собранный с `git show` + локальный прогон с его файлом, 5/5 `ok мутант → гейт упал`).

Соответствие заданию: «интро длиннее нормы» — есть, «шторка мгновенная» — есть (`60ms` vs норма 250–470), «кадр не виден» — есть (`display:none`), «заставки нет на повторном заходе» — проверяется не мутантом, а прямым ассертом `await page.goto(URL_)` → `if (!vy-intro) bad` — в gate L6 есть и проходит (повторный заход снова показывает). **Ни один мутант не проходит — гейт не декоративный.**

**Да/нет:** да, не ослаблен.

### 7. Вес

Заявлено: JS 5633 Б gzip на всю страницу (отдельного чанка нет), CSS 577 Б.

**Как проверял:** `npm run build && node -e "require('zlib').gzipSync"` на собранных `dist/client/_astro/*.js` и `voyah.css` блок ИНТРО.

- На PR #5: `dist/_astro/voyah-free.*.js` gzip 5633 Б — совпало с отчётом (см. `weight-intro.json`, `gzipSync` 5633). Отдельного чанка нет, весь интро внутри страницы — **да**.
- CSS блок ИНТРО: `grep -A 30 'vy-intro{' site/src/styles/voyah.css | gzipSync` = 577 Б — совпало.
- Общий вес страницы не вырос выше потолка `check-voyah-layout` (665–667 КБ vs потолок 705–725) — **да**.

**Да/нет:** да.

### 8. Ноль внешних запросов / текстур / зависимостей

- `voyah-intro.ts` — `import` только локальные, `fetch`/`XHR`/`sendBeacon`/`@import`/`http://`/`https://` — `grep` 0 (см. `grep-intro.log`). Шейдеры инлайна, текстуры — 0, `public/img/vy-intro-poster.webp` — один локальный файл, уже в сборке — **0 внешних**.
- `package.json` diff `HEAD:site vs arena/c0d7d4ba` — `package.json` не менялся, новых зависимостей 0.

**Да/нет:** да.

### 9. Детерминизм

Два прогона подряд (L6 gate) дали 2423 и 2441 мс десктоп (Δ 18 мс), моб 1389 и 1402 (Δ 13 мс) — оба ≤50 мс. Причина — `uT` считается от `performance.now()` старта, а не от `load` (в новой версии `__vyRec.t0` ставится при `drawn`, не при `load`), рандома нет (`hash13` детерминирован). Влияние на gate: если Δ >50 мс, gate может мигать в CI только на границе лимита (2500±20) — при текущих 2420 запас 80 мс, мигания нет.

**Да/нет:** да, детерминизм в норме.

### 10. Мнение по fps — одно

Агент честно указал: живых замеров нет, SwiftShader ~10 fps десктоп / 29–31 моб — это софтверный рендер, не показатель. Косвенные доводы: три прохода по **одному** треугольнику (без буферов, `gl_VertexID`), 72 шага марша фиксировано, adapt `dpr>1.5→0.5` и `saveData` → half-res, 0 текстур, bloom в ¼, `requestAnimationFrame` с паузой при `hidden`/`!intersecting`.

**Моё одно мнение:** **недостаточно для приёмки на прод.** Косвенные доводы — сильные (минимальная геометрия, нет текстур), но без живого замера на устройстве (хотя бы один Android mid-range и iOS через `--attach`) нельзя исключать просадку из-за 72 итераций SDF на слабом GPU (P3/P4 в модели PR #9 уже показывают 185% GPU). **Блокер до прогона на реальном устройстве** — но не для мержа в `review`/`staging`, а для `main`: сливать можно, включать по умолчанию — только после `bg3d-device-metrics --attach` или аналога для интро.

---

## 2. Фон — PR #9 `arena/fe4d5df8-avtotehservis` @`80f4887`

**Важно:** база `d0c382f`, нет Voyah-страницы, нет `check-voyah-layout.mjs`. `git diff HEAD:site arena/fe4d5df8:site --stat` — 34 файла, большая часть — новый фон, но **нет** `voyah-*.astro` и `check-voyah-layout` → при наивном merge проверки отвалились бы.

### 1. `package.json` перезаписывает `script test`

**Как проверял:** `git show HEAD:site/package.json | grep -A2 '"test"'` vs `git show arena/fe4d5df8:site/package.json | grep '"test"'`.

- HEAD: `npm run build && npm run build:pages && node --test tests/unit... && node scripts/check-cascade... && ... && node scripts/check-voyah-layout.mjs && node scripts/check-voyah-layout.mjs --self-test"` (20+ гейтов)
- PR #9: `"test": "npm run build && node --test tests/unit.test.ts tests/integration.test.ts tests/e2e-form.test.ts tests/admin.test.ts tests/bg3d.test.ts"` (5 файлов, без гейтов 29–30)

**Это блокер слияния:** при `git merge` `package.json` перезапишется, проверки `check-voyah-*`, `check-about-*`, `check-certs`, `check-price-tables` откатятся. Что делать — см. раздел 3.

**Да/нет:** да, блокер.

### 2. Перебазированный прогон с нашими гейтами

**Как проверял:** `git diff HEAD:site arena/fe4d5df8:site --stat` → его новых файлов ~34, конфликтов с нашими страницами почти нет (кроме `services/[slug].astro` +5 строк). Собрал его дифф поверх HEAD в `/tmp/bg3d-rebase` и прогнал `LD_LIBRARY_PATH=/tmp/al2023/lib npm test` с нашими гейтами (см. `bg3d-rebase-test.log`, 87/87, гейты `bg3d` 29 + наши 79 — все `ok`, `VOYAH-LAYOUT: всё в норме`).

**Результат:** **87/87** (5 его + 79 наших + `build:pages`), 0 провалов. Его `bg3d.test.ts` не ломает наши страницы при `BG3D=off`.

**Да/нет:** да, проходит при правильном мердже.

### 3. `BG3D=off` по умолчанию

`src/server/bg3d-config.ts` — `BG3D=off` → `Bg3dLayer.astro` не рендерит `canvas`, `gate.ts` не грузит `engine.ts`. `npm run smoke` (14/14) — зелёный, `git diff` не трогает `index.astro`/`voyah-free.astro` — **ни разметки, ни визуально ничего не меняется**.

**Да/нет:** да.

### 4. Ворота работают

Проверено по коду `src/client/bg3d/{gate,engine}.ts` и тестам `bg3d.test.ts` (29 тестов, все `ok`):

- Пауза вне вьюпорта — `IntersectionObserver` + `isIntersecting` → `engine.pause()` (не флаг, `cancelAnimationFrame` + `gl.finish` не вызывается — см. `engine.ts:210` `observer.disconnect` и `pause()` с `cancelAnimationFrame` — **останавливается**).
- Скрытая вкладка — `visibilitychange` → `document.hidden` → `pause()` — **да**.
- `reduced-motion` — `matchMedia('(prefers-reduced-motion: reduce)')` → один статичный кадр, `requestAnimationFrame` не заводится — **да**.
- `saveData`/`2g` — `navigator.connection.saveData || effectiveType==='2g'` → `gate` возвращает `off` — **да**.
- `hardwareConcurrency` — `navigator.hardwareConcurrency <=2` → `off` (P4) — **да**.
- Кнопка «выключить» с `localStorage BG3D=off/on` и обратным включением — **есть**, тест `toggle` проходит.
- Watchdog — `watchdog.ts` деградация `q0→q1→off` по `frameBudget` + `sessionStorage` — **да**, автоотключение проверено `bg3d.test.ts: watchdog`.

**Да/нет:** да.

### 5. Вес

Заявлено: шейдер 4654 Б gzip, чанк 12,2 КБ, 0 текстур.

- `site/scripts/bg3d-measure.mjs` → `shader-report.json`: `gzip 4654` — совпало с `gzipSync` шейдера `shader.ts` (см. `bg3d-weight.json`).
- Чанк `dist/_astro/bg3d.*.js` — 12 204 Б gzip (лимит 14 336) — **сходится**.
- Текстуры — `grep texture` в `shader.ts` 0, `public/img` для bg3d нет — **0**.

**Да/нет:** да.

### 6. §4.3 «страницы Voyah Free не существует»

Да, это следствие базы `d0c382f` (страница появилась только в круге 30, `check-voyah-layout` тоже). На момент PR #9 страницы не было, поэтому `BG3D_PAGES` белый список не срабатывал и вердикт «не включать по умолчанию» опирался на отсутствие интеграционной точки. Сейчас страница есть — это **меняет** вес аргумента, но не вердикт: автор и так пишет «не включать по умолчанию из-за запрета», а не из-за отсутствия страницы. Проверять надо заново с интеграцией в `voyah-free.astro` (сейчас `services/[slug].astro` +5 строк только для `[slug]`).

**Да/нет:** вердикт остаётся, но §4.3 устарел — нужно переписать.

### 7. Новый риск — два WebGL-контекста

На странице `voyah-free` теперь есть 3D-заставка (PR #5, один `webgl2` контекст, 3 прохода). Если включить фон — второй `webgl` контекст на той же странице.

**Оценка:**
- Конкуренция за GPU — на P3/P4 (модель PR #9) фон без ворот даёт 185–200% GPU, заставка — ещё 72 шага SDF. Два контекста → потеря одного (`webglcontextlost`) при живом втором, два `pause`/`resume`, два `watchdog`.
- Код PR #9 не знает про `vy-intro` — `gate.ts` не проверяет `document.querySelector('.vy-intro')`, `engine.ts` не слушает `vy-lock`.
- **Вывод:** включать оба одновременно **нельзя** без координации (хотя бы `gate` фона должен ждать `gone` заставки). Текущий вердикт «не включать по умолчанию» **усиливается**: теперь это не только запрет, но и техническая коллизия.

**Да/нет:** риск подтверждён, вердикт не меняется, но причина расширена.

### 8. Запрет WebGL в `prompts/00-universal-agent-prompt.md:81` и `docs/00-brief.md:65`

Запрет реальный (`WebGL — запрещён, кроме ...`). PR #9 его цитирует, PR #5 его нарушает фактическим `webgl2` (хоть и без текстур). Решение — только владелец. **Фиксирую:** документы нужно обновить при приёмке 3D, иначе следующий агент упрётся в противоречие.

**Да/нет:** да, нужно обновление документов (не блокер кода).

---

## 3. Порядок слияния и конфликты

**Файлы:**
- A11: `voyah-free.astro`, `index.astro`, `voyah.css`, `check-voyah-layout.mjs`
- A5 (заставка): `voyah-intro.ts`, блок ИНТРО в `voyah.css`, тот же гейт
- A10 (фон): новые файлы + `package.json`

**Порядок (от независимого к зависимому):**

1. **A11 первым** — страница и база гейтов. Без неё не проверить заставку/фон на реальной странице. Конфликтов нет (первый).
2. **A5 вторым** (заставка) — меняет `voyah-intro.ts` (новый файл), `voyah.css` (добавляет `--vy-scene/--vy-panel` и `vy-intro*`), гейт (ужесточает `mutants` и добавляет проверки `min/dur/fade/canvases/skip`). Конфликт с A11: `voyah.css` (блок ИНТРО vs правки A11) и `check-voyah-layout.mjs` (оба трогают L1–L5 vs L6) — **resolve: взять A5-версию гейта (5 мутантов) + вручную влить правки A11 по шапке/H1 (они не пересекаются по строкам, merge по `union` с проверкой `self-test`).** `voyah-free.astro` и `index.astro` от A11 не трогает — без конфликта.
3. **A10 последним** (фон) — его `package.json` **не мержить**: взять HEAD-версию `package.json` (с 20+ гейтами) и вручную добавить его строки `test:bg3d`, `measure:bg3d`, `bg3d.test.ts` в `scripts` и `test` (не перезаписывать). Остальные его файлы (`src/client/bg3d/**`, `Bg3dLayer.astro`, `bg3d-config.ts`, `bg3d.css`, `site/tests/bg3d.test.ts`) — новые, конфликтов нет, кроме `services/[slug].astro +5 строк` — **cherry-pick** или `git apply --3way` его диффа поверх уже смерженных A11+A5.

**Что делать с `package.json` A10:** **отбросить** его `test` (5 файлов) и оставить наш (79/79 + `bg3d`). Добавить только `test:bg3d`, `measure:bg3d`, `measure:bg3d:device`. Иначе гейты 29–30 откатятся — это уже было в `main→arena/fe4d5df8` diff (потеря `build:pages` и 20+ `check-*`).

---

## 4. Блокеры (сливать нельзя пока не закрыто)

1. **PR #9 `package.json` — блокер слияния.** Перезаписывает `test` без гейтов. Решение — ручной мердж как выше, не `git merge`.
2. **PR #9 + PR #5 вместе — два WebGL на одной странице.** Без координации `gate` фона (ждать `vy-intro gone`) включать нельзя. Не блокер поодиночке, но блокер для `BG3D=on` на `voyah-free`.
3. **PR #5 fps — блокер включения по умолчанию.** Косвенные доводы (1 треугольник, 0 текстур, adapt half-res) сильные, но живого замера нет. До `bg3d-device-metrics --attach` или аналога для интро на реальном mid-range — **не включать** (staging можно, прод — нет).
4. **PR #5 вес — не блокер, но проверить после мерджа A11+A5:** `voyah.css` может вырасти из-за правок A11, нужно пересчитать `check-voyah-layout` (потолок 705–725 vs 665–667 сейчас, запас есть).

**Не блокеры:** длительность, off-переключатели, уборка, L6-гейт, ноль внешних запросов — всё прошло.

## 5. Не проверено (честно)

- Живой fps на железе (только SwiftShader ~10 fps десктоп) — нужен `bg3d-device-metrics --attach` и аналог для `voyah-intro`.
- `libnss3.so` распакован только для `npm test`, не для `lab/bg3d` с камерой.
- Визуал знака/кадров — зона A1, не дублирую.
- Память заставки за 10 циклов — оценочно +0.42 МБ (SwiftShader), не на реальном GPU.

---

## 6. Итог — что можно сливать

- **PR #5 (заставка) — можно сливать в `review`/`staging` после A11, с условием `BG3D=off` и выключенной по умолчанию (включать только после живого fps).** Гейт L6 строгий, вес и уборка в норме, 4 файла — чисто.
- **PR #9 (фон) — можно сливать только после ручного мерджа `package.json` и с `BG3D=off`.** Гейты проходят (87/87 при ребейзе), но два WebGL-контекста вместе — блокер для `on` на `voyah-free` без координации.
- **Порядок:** A11 → A5 → A10 (как выше), `package.json` — взять HEAD + добавить `bg3d` скрипты.

**Сырые логи:** `docs/reports/r30-review-tech/npm-test.log`, `l6-selftest-head.log`, `l6-selftest-pr5.log`, `intro-durations.json`, `intro-memory.json`, `intro-cleanup.log`, `bg3d-rebase-test.log`, `bg3d-weight.json`.

**Автор ревью:** A4 — техника, не визуал.
