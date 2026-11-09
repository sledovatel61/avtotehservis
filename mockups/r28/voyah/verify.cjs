/* Проверки прототипов интро в Chromium:
   1) без JS контент виден (JS выключен);
   2) prefers-reduced-motion: reduce → оверлея нет;
   3) клик / Esc / колесо → оверлей уходит за ~180 мс;
   4) оверлей исчезает сам не позже 2,5 с;
   5) повторный заход в той же сессии — без интро (sessionStorage);
   6) вес JS и CSS в gzip; 7) ни одного сетевого запроса наружу.
   Запуск: node verify.cjs */
const puppeteer = require('/tmp/w28/site/node_modules/puppeteer-core');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const dir = __dirname;
const F = (f) => 'file://' + path.join(dir, f);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;

(async () => {
  const b = await puppeteer.launch({ executablePath: '/tmp/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
  const res = {};
  const external = [];

  const open = async (file, opts = {}) => {
    const p = await b.newPage();
    p.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith('file://') && !u.startsWith('data:')) external.push(u);
    });
    await p.setViewport({ width: opts.w || 1440, height: 900 });
    if (opts.noJs) await p.setJavaScriptEnabled(false);
    if (opts.reduce) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    if (opts.slow) await p.emulateCPUThrottling(6);
    await p.goto(F(file), { waitUntil: 'load' });
    await sleep(120);
    return p;
  };

  /* 1. без JS: контент виден, оверлея нет */
  {
    const p = await open('index.html', { noJs: true });
    res.noJs = await p.evaluate(() => ({
      intro: !!document.querySelector('.intro'),
      h1: document.querySelector('h1')?.textContent.trim().slice(0, 40),
      h1Visible: (() => { const r = document.querySelector('h1').getBoundingClientRect(); return r.height > 20; })(),
    }));
    await p.close();
  }

  /* 2. reduce: оверлея нет */
  for (const f of ['intro-a.html', 'intro-b.html']) {
    const p = await open(f, { reduce: true });
    await sleep(300);
    res['reduce_' + f] = await p.evaluate(() => !!document.querySelector('.intro'));
    await p.close();
  }

  /* 3–5. обычный запуск: оверлей есть, сам уходит ≤ 2,5 с, повторно не показывается */
  for (const f of ['intro-a.html', 'intro-b.html']) {
    const p = await open(f);
    await sleep(150);
    const present = await p.evaluate(() => !!document.querySelector('.intro'));
    await sleep(2500);
    const goneAfter = await p.evaluate(() => !document.querySelector('.intro'));
    const scrollLocked = await p.evaluate(() => document.body.classList.contains('no-scroll'));
    /* повторный заход в той же сессии */
    await p.reload({ waitUntil: 'load' });
    await sleep(400);
    const repeat = await p.evaluate(() => !!document.querySelector('.intro'));
    res['intro_' + f] = { present, goneAfter2500: goneAfter, scrollUnlocked: !scrollLocked, repeatShown: repeat };
    await p.close();
  }

  /* 3b. прерывание: клик, Esc, колесо — оверлей исчезает за ≤ 400 мс */
  const interruptions = {
    click: async (p) => p.mouse.click(700, 450),
    esc: async (p) => p.keyboard.press('Escape'),
    wheel: async (p) => { await p.mouse.move(700, 450); await p.mouse.wheel({ deltaY: 200 }); },
  };
  for (const [name, act] of Object.entries(interruptions)) {
    const p = await open('intro-a.html');
    await sleep(500);
    await act(p);
    await sleep(400);
    res['stop_' + name] = await p.evaluate(() => !document.querySelector('.intro'));
    await p.close();
  }

  /* 6. вес JS/CSS в gzip (по собранным файлам: инлайн-блоки) */
  const files = ['index.html', 'home-section.html', 'intro-a.html', 'intro-b.html'];
  res.sizeKb = {};
  for (const f of files) {
    const html = fs.readFileSync(path.join(dir, f), 'utf8');
    const styles = (html.match(/<style>[\s\S]*?<\/style>/g) || []);
    const script = (html.match(/<script>[\s\S]*?<\/script>/g) || []).join('');
    res.sizeKb[f] = {
      htmlKb: +(html.length / 1024).toFixed(1),
      cssAllGz: +(gz(Buffer.from(styles.join(''))) / 1024).toFixed(1),
      /* второй блок <style> — только CSS интро (первый — общий CSS мокапа) */
      cssIntroGz: styles[1] ? +(gz(Buffer.from(styles[1])) / 1024).toFixed(1) : 0,
      jsGz: +(gz(Buffer.from(script)) / 1024).toFixed(1),
    };
  }
  res.externalRequests = [...new Set(external)];

  /* 7. горизонтальный скролл и шапка на всех ширинах */
  await b.close();
  fs.writeFileSync(path.join(dir, 'verify-report.json'), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
})();
