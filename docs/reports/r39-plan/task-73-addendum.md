## Дополнение к заданию №73: обложки и картинки внутри страницы

Собрал полный набор новых кадров и положил в репозиторий (ветка `arena/ec60317b-avtotehservis`,
коммиты `dd50cfc` и `982bc59`). Мастера — `docs/photos-source/r70/*.png` (1672×941),
сборка — `site/scripts/build-voyah-art.mjs`, результат — `site/public/img/vy-art-*`.

На каждый кадр по три ширины **в AVIF и WebP**: 480, 960, 1600. Ширины 2560 нет —
мастер 1672 px, апскейл не делаем (это же правило, что в `build-voyah-images.mjs`).

| кадр | AVIF 480/960/1600 | WebP 480/960/1600 |
|---|---|---|
| `vy-art-to` — **белый** Free сзади-три-четверти на двухстоечном подъёмнике | 10 / 29 / 59 КБ | 14 / 40 / 81 КБ |
| `vy-art-maslo` — **тёмно-синий**, капот открыт, канистра и воронка | 13 / 38 / 78 КБ | 23 / 69 / 144 КБ |
| `vy-art-bolezni` — **графитовый**, крупно передний диск и суппорт | 11 / 34 / 74 КБ | 14 / 44 / 95 КБ |

Забрать в свою ветку:

```bash
git fetch origin arena/ec60317b-avtotehservis
git checkout FETCH_HEAD -- site/public/img/vy-art-to-1600.avif site/public/img/vy-art-to-1600.webp \
  site/public/img/vy-art-to-960.avif site/public/img/vy-art-to-960.webp \
  site/public/img/vy-art-to-480.avif site/public/img/vy-art-to-480.webp \
  site/public/img/vy-art-maslo-1600.avif site/public/img/vy-art-maslo-1600.webp \
  site/public/img/vy-art-maslo-960.avif site/public/img/vy-art-maslo-960.webp \
  site/public/img/vy-art-maslo-480.avif site/public/img/vy-art-maslo-480.webp \
  site/public/img/vy-art-bolezni-1600.avif site/public/img/vy-art-bolezni-1600.webp \
  site/public/img/vy-art-bolezni-960.avif site/public/img/vy-art-bolezni-960.webp \
  site/public/img/vy-art-bolezni-480.avif site/public/img/vy-art-bolezni-480.webp \
  docs/photos-source/r70 site/scripts/build-voyah-art.mjs
```

(`docs/photos-source/r70` — три PNG-мастера, если понадобится пересборка.)

### Что менять на `/voyah-free`

Сейчас на странице одна и та же зелёная машина в трёх местах: герой (`vy-hero`), крупный
план узла (`vy-node`), вечерний кадр (`vy-evening`). Владелец: «везде всё одинаково, цвет
авто тоже должен быть разным». Меняем все три:

| место в `voyah-free.astro` | было | стало |
|---|---|---|
| герой, ~стр. 250–254 | `vy-hero-m-640/960`, `vy-hero-960/1600/2560` | `vy-art-to-480/960/1600` (белый на подъёмнике) |
| крупный план узла, ~стр. 319–321 | `vy-node-640/960` | `vy-art-maslo-480/960/1600` (синий, капот, масло) |
| кадр у секции жалоб, ~стр. 429–431 | `vy-evening-960/1600` | `vy-art-bolezni-480/960/1600` (графит, диск) |

Разметку бери по образцу текущей: `<picture>` с `<source type="image/avif" srcset=…>` и
`<source type="image/webp" srcset=…>`, мобильный `<source media="(max-width:767px)">` — на
480. `width`/`height` в `<img>` — реальные пропорции кадра 1672×941 (например
`width="1672" height="941"` для 1600 или `1600 × 900` — главное, чтобы соотношение было
1,777 и не было сдвига вёрстки).

Alt-тексты — по факту кадра, без утверждений о модели, как в задании.

Старые `vy-hero*`, `vy-node*`, `vy-evening*` из страницы убираем, но файлы не удаляем: они
ещё используются в `measure-contrast.mjs` и в старых отчётах. Просто проверь, что в
`pages-dist` после сборки по ним нет ссылок из `voyah-free`.

### Гейты — дополнительно к прежним

```bash
node -e "const s=require('fs').readFileSync('site/pages-dist/voyah-free/index.html','utf8'); \
  console.log('hero:', /vy-hero[^\"']*/.exec(s)?.[0] ?? 'нет', '| node:', /vy-node[^\"']*/.exec(s)?.[0] ?? 'нет', '| evening:', /vy-evening[^\"']*/.exec(s)?.[0] ?? 'нет')"
node -e "const s=require('fs').readFileSync('site/pages-dist/voyah-free/index.html','utf8'); \
  console.log('art:', [...new Set(s.match(/vy-art-[a-z]+-\d+/g)||[])].join(', '))"
```

Ожидаемо: три старых префикса — `нет`, новых — три кадра по трём ширинам. И кадр страницы
на 1440 + 390 в `evaluation/assets/r70/`, чтобы было видно, что кадры встали и не растянуты.
