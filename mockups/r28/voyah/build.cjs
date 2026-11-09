/* Сборка самодостаточных HTML из src/*.html + assets/voyah.css.
   Каждый итоговый файл содержит CSS и JS внутри себя: внешних запросов, кроме
   собственных картинок (img/) и шрифтов (fonts/), нет. Запуск: node build.cjs */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const css = fs.readFileSync(path.join(dir, 'assets', 'voyah.css'), 'utf8');
const pages = [['page.html', 'index.html'], ['home.html', 'home-section.html'],
  ['intro-a.html', 'intro-a.html'], ['intro-b.html', 'intro-b.html']];

for (const [srcName, outName] of pages) {
  const src = fs.readFileSync(path.join(dir, 'src', srcName), 'utf8');
  if (!src.includes('/*==VOYAH_CSS==*/')) throw new Error(`${srcName}: нет метки /*==VOYAH_CSS==*/`);
  const out = src.replace('/*==VOYAH_CSS==*/', css.trimEnd());
  fs.writeFileSync(path.join(dir, outName), out);
  console.log(`${outName}: ${(Buffer.byteLength(out) / 1024).toFixed(1)} КБ`);
}
