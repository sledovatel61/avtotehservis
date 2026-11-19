# Задание №77-К. Только кадры: свои фотографии для «Полезного» с узнаваемым VOYAH FREE

Дата: 16.11.2026. **Агент: A10 (новый, только картинки).** Статьи и гейты остаются у A9 —
здесь работа ограничена генерацией и нарезкой кадров.

Владелец забраковал два круга кадров подряд:

> «Все фото не получились… у тебя нет значков ни на одном авто, последнее фото вообще другая
> марка, решётки не совсем как у воя фри… не подходит ни одно фото. Давай генерацию поручим
> кому-то из агентов».

Задача этого задания — не «красивая картинка в боксе», а **узнаваемая машина**. Кадр, где нет
знака или решётка не такая, считается браком, даже если свет, ракурс и композиция идеальны.

## 1. Сначала референсы, потом генерация

Каталог `docs/refs/r77-voyah-free/` — четыре чужие фотографии и два снимка знака отдельно.
`README.md` рядом содержит таблицу «как у Free / как нельзя» — прочитать целиком.

Обязательный минимум перед первой генерацией: `front-grille-emblem.jpg` и `front-34-mat.jpg`.
На `front-grille-emblem.jpg` поверх фото наложены жёлтые прямоугольники (это промо-кадр
товара) — форму берите, цвет нет.

**Эти файлы нельзя** копировать в `site/public/`, вставлять в статьи и публиковать. Они
задают форму, кадр должен быть сгенерирован заново.

## 2. Что именно у машины (проверять на каждом кадре)

| Признак | Как должно быть |
| --- | --- |
| Знак | Крылатая эмблема **по центру верхней части решётки**: две объёмные «крыла» расходятся вверх, между ними узкая вертикаль. Читается как «V» с крыльями |
| Решётка | Широкая трапеция по центру носа, **вертикальные хромированные ламели** на тёмном фоне, кверху чуть расширяется |
| Фары | Узкие, горизонтальные, **разнесены по краям**. Между ними светящейся полосы **нет** |
| Над решёткой | Тонкая хромированная планка по кромке капота — не светящаяся |
| Бампер | Вертикальные чёрные воздуховоды в углах, серебристая губа снизу |
| Кузов | Крупный лифтбэк-кроссовер: длинный капот, покатая крыша, хром по кромке стёкол, **утопленные** ручки дверей |
| Колёса | Многоспицевые диски 20″, низкий профиль |
| Корма | Световая полоса во всю ширину, наклонная пятая дверь, спойлер — **полоса есть только сзади** |

Чего быть не должно ни в одном кадре: читаемых надписей, номерных знаков, эмблем других
марок, логотипов дилеров, «почти похожих» решёток, светящейся линии на носу.

## 3. Восемь мастеров

16:9, ширина мастера **не меньше 1600 px**, фотореализм. Разные цвета кузова и разные
ракурсы: белый, графит, тёмно-зелёный, тёмно-красный, серебристо-голубой.

Кладите в `docs/photos-source/r77/`, имена — строго эти (PNG или JPEG):

| Мастер | Для чего | Обязательное в кадре |
| --- | --- | --- |
| `voyah-art-to-lift` | обложка «ТО Voyah Free» | Free на двухстоечном подъёмнике, **жёлтые лапы под порогами видны**, под двигателем механик с поддоном или струя сливаемого масла |
| `voyah-art-maslo-page` | обложка «Масло для Voyah Free» | Free с открытым капотом, передняя три-четверти, моторный отсек читается (пластиковая крышка, белый бачок, оранжевый кабель), рядом канистра масла и воронка |
| `voyah-art-bolezni-page` | обложка «Voyah Free с пробегом» | Free **на подъёмнике с видимыми лапами**, колесо снято, крупно тормозной диск и суппорт |
| `voyah-art-intervaly` | статья о расхождении источников | сервисная книжка с таблицей на капоте Free, рука листает страницу |
| `voyah-art-momenty` | статья о моментах и объёмах | Free на подъёмнике, механик с динамометрическим ключом у ступицы, колесо снято |
| `voyah-art-hodovaya` | статья о диагностике ходовой | Free на подъёмнике, механик на тележке снизу, лампа светит на рычаг |
| `voyah-art-kondicioner` | статья о кондиционере Free | Free с открытым капотом, станция кондиционирования с манометрами и шлангами на переднем плане |
| `voyah-art-zapravka` | статья о заправке кондиционера (общая) | **не Voyah**: нейтральный кроссовер без знаков и шильдиков, станция с манометрами, техник |

### Готовые промпты

Основа для всех: «Photorealistic 16:9 automotive service photograph, big modern Chinese
premium liftback crossover, long hood, sloping roofline, flush door handles, **wide trapezoid
front grille with vertical chrome slats**, **winged emblem centered at the top of the grille**,
slim separate headlights at the corners, **no light bar between the headlights**, thin chrome
strip on the hood edge, vertical black air intakes in the bumper corners, silver lower lip,
20-inch multi-spoke wheels». Дальше — сцена:

1. **to-lift** — «car raised on a two-post lift, yellow steel arms clearly clamped under the
   sills, mechanic in dark overalls under the engine bay holding an oil drain pan, thin dark
   used oil draining, steel trolley in the foreground with a new oil filter box and canister,
   dim repair bay, cool overhead lamps, warm lamp far behind, wet concrete floor with
   reflections, low camera angle from the floor, silver-blue body».
2. **maslo-page** — «hood fully open, camera at the front-left corner, engine bay clearly
   readable: black plastic engine cover, white translucent coolant reservoir, orange
   high-voltage cable loom, tidy hoses; in the near foreground out of focus a clear canister
   of amber engine oil and a small metal funnel; dark green body; moody workshop light, one
   warm work lamp on a tripod behind».
3. **bolezni-page** — «raised on a two-post lift, yellow arms clamped under the sills, front
   wheel removed, bare front brake disc, caliper and suspension arm in sharp focus, mechanic
   standing beside the front wing with a small inspection lamp; graphite grey body».
4. **intervaly** — «an open service booklet with a printed maintenance table resting on the
   closed hood, mechanic's hand turning a page, pen in the gutter, warm workshop light from the
   left, cool lamp above, pearl-white body softly out of focus behind».
5. **momenty** — «raised on a two-post lift, wheel removed, mechanic in dark overalls crouching
   by the front hub tightening a wheel bolt with a long torque wrench, both gloved hands on the
   handle, brake disc beside his hands; dark red body».
6. **hodovaya** — «camera low under the car, raised on a two-post lift with yellow arms clamped
   under the sills, underbody, subframe, wishbone and anti-roll bar link in sharp focus,
   mechanic lying on a wheeled creeper checking the lower control arm with a pry bar, work lamp
   lighting the spot; midnight-blue body».
7. **kondicioner** — «hood open, air-conditioning service station with two analogue pressure
   gauges and blue and red hoses connected to the car in the foreground, mechanic in dark
   clothes and nitrile gloves at the machine slightly out of focus; white body; cool daylight
   from a roller door».
8. **zapravka** — то же, но «generic modern silver-grey compact crossover, **no badges, no
   emblem, no grille lettering**, plain front end» и обязательно «no logos, no text».

К каждому промпту добавляйте: «realistic detail, shallow depth of field, no text, no logos,
no license plate».

### Как работать

1. На каждый кадр — **два варианта**. Сгенерировать, открыть оба файла и посмотреть своими
   глазами (`read_file` показывает картинку).
2. Забраковать вариант, если: нет знака; ламели не вертикальные; спереди появилась светящаяся
   полоса; ручки торчат; бампер гладкий без воздуховодов; видна чужая марка; есть читаемый
   текст; машина «висит в воздухе» без видимых лап подъёмника (для кадров на подъёмнике).
3. Если оба варианта не годятся — генерировать ещё. **Брак не сдавать**, стоковыми фото и
   скриншотами референсов не подменять.
4. Приёмка — 8 кадров, прошедших проверку по таблице §2. Меньше — хуже, чем сдать лишний
   вариант: напишите в отчёте, какой кадр не удался и сколько попыток было.

## 4. Четыре обложки круга 75 — пересмотреть

`vy-art-update`, `vy-art-connect`, `vy-art-app`, `vy-art-media` делались по той же ошибочной
модели кузова. Владелец их отдельно не разбирал, но дефект тот же.

- виден нос и он неверный → **перегенерировать** под тем же базовым именем
  (`voyah-art-update` и т. д.) в `docs/photos-source/r77/`;
- кадр про корму, салон или крупный план детали, ошибки не видно → **оставить как есть** и
  написать об этом одну строку в отчёте.

Не перегенерированные кадры не удалять: скрипт нарезки берёт только те имена, которые
найдёт в `docs/photos-source/r77/`, остальные ассеты останутся прежними.

## 5. Нарезка

```bash
cd site
node scripts/build-voyah-art-r77.mjs
```

Скрипт уже в ветке: делает 480/960/1600 в AVIF и WebP без апскейла, держит лимиты веса
(1600 WebP ≤ 165 КБ), предупреждает про пропорции и про мастер меньше 1600 px, пишет
`site/public/img/vy-art-r77-manifest.json`. Тяжёлый вариант 1600 WebP должен быть ≤ 165 КБ —
если скрипт не смог, он скажет это в выводе.

## 6. Границы

- Работайте в **своей** ветке Arena; PR не открывать, в `preview/github-pages` не пушить.
- Ничего не менять в статьях, `seed-data.ts`, `gen-news-seed.mjs`, `markdown.ts`,
  `content.ts` — это работа A9. Ваш результат: мастера, нарезанные ассеты, манифест.
- `docs/refs/r77-voyah-free/` — только образец, не для сайта.
- PDF, скриншоты чужих сайтов, скачанные фото автомобилей в `site/public/` не класть.

## 7. Отчёт

`docs/reports/r77-images/report.md`:

- таблица «мастер → что в кадре → признаки годности»: знак есть/нет, ламели вертикальные,
  передней полосы нет, лапы подъёмника видны, цвет кузова, ракурс;
- сколько вариантов сгенерировано и какие забракованы, с причиной — это важнее списка
  удачных;
- вес файлов из манифеста и самый тяжёлый кадр;
- какие обложки круга 75 перегенерированы, какие оставлены и почему;
- что осталось спорным (например, знак вышел нечитаемым, но кадр в остальном годен).

Плюс короткое сообщение в ответ: `HEAD`, список файлов в `docs/photos-source/r77/`,
самый тяжёлый ассет и одна строка «сколько кадров принято из скольких попыток».
