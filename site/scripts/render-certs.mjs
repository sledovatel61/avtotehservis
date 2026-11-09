/* Круг 27 (задание №31, §1): рендер ИЛЛЮСТРАЦИЙ сертификатов блока «Сертификаты» (/about).
   Владелец забраковал вариант круга 26 (четыре одинаковых чёрных карточки с текстом) и
   попросил «сгенерировать такие же, как на фото». Поэтому здесь — четыре РАЗНЫХ светлых
   бумажных бланка: у каждого свой багет, своя бумага, свой фирменный знак, свои печати и
   своя композиция, максимально близкая к эталону docs/content-source/r26/cert-<brand>.jpg.
   Рендер только в Chromium (puppeteer-core 23 + @sparticuz/chromium 131, standing R20):
   кириллица мелким кеглем должна быть идеально резкой, диффузионные генераторы её ломают.
   Мастера: docs/photos-source/r26-certs/cert-{lynxauto,sufix,korson,ngn}.jpg, 1200×1600, JPEG q95.
   Производные 720×960 / 1200×1600 (webp+avif) собирает build-images.mjs (блок 10c).
   Сырые фото бланков docs/content-source/r26/cert-*.jpg не копируются; живые рукописные
   автографы и ФИО подписантов не воспроизводятся — вместо росчерка чистая линия подписи
   и должность/компания.
   Запуск: node scripts/render-certs.mjs   (детерминированный: байт-в-байт при повторе) */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, renameSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const OUT = join(ROOT, 'docs', 'photos-source', 'r26-certs');
if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });

/* ---------- общие куски ---------- */
const FONTS = `
@font-face{font-family:'Unbounded';src:url('/fonts/unbounded-latin-600.woff2') format('woff2');font-weight:600}
@font-face{font-family:'Golos';src:url('/fonts/golos-latin-700.woff2') format('woff2');font-weight:700}
@font-face{font-family:'Golos';src:url('/fonts/golos-cyrillic-700.woff2') format('woff2');font-weight:700;unicode-range:U+0400-04FF}
@font-face{font-family:'Golos';src:url('/fonts/golos-latin-500.woff2') format('woff2');font-weight:500}
@font-face{font-family:'Golos';src:url('/fonts/golos-cyrillic-500.woff2') format('woff2');font-weight:500;unicode-range:U+0400-04FF}
@font-face{font-family:'Golos';src:url('/fonts/golos-latin-400.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Golos';src:url('/fonts/golos-cyrillic-400.woff2') format('woff2');font-weight:400;unicode-range:U+0400-04FF}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:1600px;overflow:hidden}
body{font-family:'Golos',sans-serif;-webkit-font-smoothing:antialiased}
.paper{position:absolute;inset:0;pointer-events:none;mix-blend-mode:multiply}
.sheet{position:absolute;overflow:hidden}
`;

/* бумажная фактура: feTurbulence + мелкое зерно, одинаково для всех бланков */
const PAPER_SVG = (op) => `<svg class="paper" viewBox="0 0 1200 1600" preserveAspectRatio="none" aria-hidden="true">
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" seed="7" result="n"/>
  <feColorMatrix type="saturate" values="0"/>
</filter>
<rect width="1200" height="1600" filter="url(#grain)" opacity="${op}"/>
</svg>`;

/* гильошированная розетка (тонкие наложенные эллипсы) */
const rosette = (cx, cy, rx, ry, n, color, op) => `<svg class="rosette" viewBox="0 0 1200 1600" aria-hidden="true">
${Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI;
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${(i * 180) / n} ${cx} ${cy})" stroke="${color}" stroke-width="1.1" fill="none" opacity="${op}" style="transform-box:fill-box"/>`;
  }).join('')}
<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${color}" stroke-width="1.6" fill="none" opacity="${op + 0.1}"/>
<ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.72}" ry="${ry * 0.72}" stroke="${color}" stroke-width="1.2" fill="none" opacity="${op + 0.06}"/>
<ellipse cx="${cx}" cy="${cy}" rx="${rx * 0.44}" ry="${ry * 0.44}" stroke="${color}" stroke-width="1" fill="none" opacity="${op}"/>
</svg>`;

const page = (css, body) => `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<style>${FONTS}${css}</style></head><body>${body}</body></html>`;

/* ============================ 1. LYNXauto ============================ */
const lynxauto = page(`
body{background:#B9A98F}
/* багет под светлое дерево */
.frame-wood{position:absolute;inset:0;background:
  repeating-linear-gradient(92deg,#C9AE86 0 3px,#DCC6A4 3px 7px,#BFA47C 7px 10px,#D6BE9A 10px 16px),
  linear-gradient(180deg,#D9C3A0,#C2A881)}
.frame-wood::after{content:'';position:absolute;inset:14px;box-shadow:inset 0 0 0 2px rgba(90,70,45,.45),inset 0 6px 22px rgba(60,45,25,.35)}
.glass{position:absolute;inset:24px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.5),inset 0 0 44px rgba(80,60,35,.28),inset 0 0 8px rgba(255,255,255,.55)}
.sheet{inset:24px;background:linear-gradient(165deg,#FBF8F2 0%,#F7F3EA 46%,#F1ECE2 100%)}
.rosette{position:absolute;inset:0;opacity:.5}
.fr1{position:absolute;inset:44px;border:3px solid #595E64}
.fr2{position:absolute;inset:54px;border:1px solid #7C838A}
.content{position:absolute;inset:54px;padding:96px 118px 120px;display:flex;flex-direction:column;align-items:center;text-align:center}
.logo{display:flex;align-items:flex-end;gap:0;position:relative;padding-bottom:34px}
.logo .word{font-family:'Golos';font-weight:700;font-size:104px;line-height:.92;color:#C0202B;letter-spacing:.01em}
.logo .r{position:relative;width:196px;height:96px;margin-left:6px}
.logo .slashes{position:absolute;left:0;top:0;width:150px;height:96px}
.logo .auto{position:absolute;left:96px;top:44px;font-style:italic;font-weight:400;font-size:44px;color:#595E64;letter-spacing:.02em}
.logo .sp{position:absolute;left:0;bottom:-40px;font-weight:500;font-size:23px;letter-spacing:.40em;color:#595E64}
.h1{margin-top:132px;font-weight:700;font-size:64px;letter-spacing:.14em;text-indent:.14em;color:#C0202B}
.rule{width:790px;height:3px;background:#C0202B;margin-top:22px}
.rule2{width:790px;height:1px;background:#C0202B;margin-top:5px;opacity:.55}
.lines{margin-top:64px;font-size:32px;line-height:1.62;color:#2F3438;font-weight:400}
.lines .b{font-weight:700;font-size:37px;color:#1F2428}
.lines .brand{font-weight:700;font-size:46px;color:#1F2428;margin-top:6px}
.lines .gap{margin-top:20px}
.foot-l{position:absolute;left:80px;bottom:184px;text-align:left;font-size:23px;line-height:1.5;color:#4A4F55}
.foot-l b{font-weight:700;color:#2F3438}
.seal{position:absolute;right:74px;bottom:142px;width:238px;height:238px}
.valid{position:absolute;left:130px;right:130px;bottom:94px;padding-bottom:14px;border-bottom:1.5px solid rgba(192,32,43,.65);text-align:center;font-size:25px;color:#2F3438}
.valid b{font-weight:700;color:#C0202B}
`, `
<div class="frame-wood"></div><div class="glass"></div>
<div class="sheet">
  ${PAPER_SVG(0.085)}
  ${rosette(600, 850, 470, 430, 22, '#C6B69C', 0.52)}
  <div class="fr1"></div><div class="fr2"></div>
  <div class="content">
    <div class="logo">
      <span class="word">LYNX</span>
      <span class="r">
        <svg class="slashes" viewBox="0 0 150 96" aria-hidden="true">
          <line x1="18" y1="96" x2="74" y2="0" stroke="#8C9298" stroke-width="7"/>
          <line x1="48" y1="96" x2="104" y2="0" stroke="#8C9298" stroke-width="7"/>
          <line x1="78" y1="96" x2="134" y2="0" stroke="#8C9298" stroke-width="7"/>
        </svg>
        <span class="auto">auto</span>
      </span>
      <span class="sp">SPARE PARTS</span>
    </div>
    <div class="h1">СЕРТИФИКАТ</div>
    <div class="rule"></div><div class="rule2"></div>
    <div class="lines">
      <div>настоящим удостоверяется, что</div>
      <div>СТАНЦИЯ ТЕХНИЧЕСКОГО ОБСЛУЖИВАНИЯ</div>
      <div class="b">АвтоТехСервис</div>
      <div class="gap">Ростовская область</div>
      <div>г. Ростов-на-Дону, ул. Портовая, д. 439</div>
      <div class="gap">является официальной точкой продаж</div>
      <div>продукции торговой марки</div>
      <div class="brand">LYNXauto</div>
      <div class="gap">и гарантирует качество продукции</div>
    </div>
  </div>
  <div class="foot-l"><b>Akita Kaihatsu G.K.</b><br>Tokyo, Japan</div>
  <svg class="seal" viewBox="0 0 250 250" aria-hidden="true">
    <defs><path id="lyx-seal" d="M33,125 A92,92 0 0 1 217,125"/>
      <clipPath id="lyx-clip"><circle cx="125" cy="125" r="104"/></clipPath></defs>
    <circle cx="125" cy="125" r="108" fill="#C0202B" opacity=".10"/>
    <circle cx="125" cy="125" r="104" fill="none" stroke="#C0202B" stroke-width="4"/>
    <circle cx="125" cy="125" r="96" fill="none" stroke="#C0202B" stroke-width="1.6"/>
    <g clip-path="url(#lyx-clip)" stroke="#C0202B" stroke-width="1.4" opacity=".55">
      ${Array.from({ length: 30 }, (_, i) => `<line x1="${20 + i * 9}" y1="8" x2="${-120 + i * 9}" y2="250"/>`).join('')}
    </g>
    <text font-family="Golos" font-size="15.5" font-weight="700" fill="#C0202B" letter-spacing="2.6">
      <textPath href="#lyx-seal" startOffset="2%">AKITA KAIHATSU · JAPAN · LYNXauto ·</textPath>
    </text>
    <text x="125" y="132" text-anchor="middle" font-family="Golos" font-size="40" font-weight="700" fill="#C0202B">LYNX</text>
    <text x="125" y="158" text-anchor="middle" font-family="Golos" font-size="17" font-weight="500" fill="#C0202B" letter-spacing="2">auto</text>
  </svg>
  <div class="valid">Сертификат действителен по <b>23.06.2027 г.</b></div>
</div>`);

/* ============================ 2. SUFIX ============================ */
const sufix = page(`
body{background:#3A3D41}
.frame-dark{position:absolute;inset:0;background:
  repeating-linear-gradient(90deg,#2E3134 0 2px,#3C4044 2px 5px,#26292C 5px 8px,#43474B 8px 13px)}
.frame-dark::after{content:'';position:absolute;inset:15px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.10),inset 0 4px 18px rgba(0,0,0,.55)}
.glass{position:absolute;inset:26px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),inset 0 0 34px rgba(0,0,0,.35)}
.sheet{inset:26px;background:linear-gradient(172deg,#FBFAF6 0%,#F7F6F1 60%,#FAF9F5 100%)}
.content{position:absolute;inset:0;padding:0 104px}
/* верхние срезанные плашки */
.corner-up{position:absolute;left:0;right:0;top:0;height:330px}
.corner-dn{position:absolute;left:0;right:0;bottom:0;height:236px}
.cap{position:absolute;left:100px;top:118px;font-weight:700;font-size:84px;line-height:1.1;letter-spacing:.055em;color:#3E4147}
.mark{margin:0 auto;width:560px;position:relative;height:230px;display:flex;align-items:center;justify-content:center}
.mark .box{position:absolute;left:0;right:0;top:52px;height:126px;border:7px solid #3E4147;border-radius:16px;background:#FBFAF6}
.mark .tri{position:absolute;left:50%;top:0;width:126px;height:126px;margin-left:-63px;background:#FBFAF6;border:7px solid #3E4147;transform:rotate(45deg);border-radius:14px}
.mark .tri2{position:absolute;left:50%;top:104px;width:126px;height:126px;margin-left:-63px;background:#FBFAF6;border:7px solid #3E4147;transform:rotate(45deg);border-radius:14px}
.mark .su,.mark .fix{position:absolute;top:78px;font-weight:700;font-size:64px;letter-spacing:.06em;color:#3E4147;z-index:2}
.mark .su{left:64px}.mark .fix{right:64px}
.mark .dia{position:absolute;left:50%;top:50%;width:96px;height:96px;margin:-48px 0 0 -48px;z-index:3}
.mark .dia i{position:absolute;inset:0;border:6px solid #DFC05B;transform:rotate(45deg)}
.mark .dia i+ i{inset:20px;border-width:5px}
.lines{margin-top:64px;text-align:center;font-size:31px;line-height:1.66;color:#3B3F44}
.lines .b{font-weight:700;font-size:40px;color:#23272B}
.foot{position:absolute;left:104px;bottom:322px}
.sigbox{text-align:left}
.sigline{width:360px;height:2px;background:#4A4E53}
.sigbox .p1{font-size:22px;font-weight:500;margin-top:16px;color:#3B3F44}
.sigbox .p2{font-size:23px;font-weight:700;color:#23272B}
.seal-s{position:absolute;right:96px;bottom:246px;width:206px;height:206px}
.valid{position:absolute;left:0;right:0;bottom:252px;text-align:center;font-size:23px;color:#3B3F44}
.valid b{font-weight:700;color:#23272B}
`, `
<div class="frame-dark"></div><div class="glass"></div>
<div class="sheet">
  ${PAPER_SVG(0.06)}
  <svg class="corner-up" viewBox="0 0 1148 330" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,0 1148,0 1148,64 0,64" fill="#3E4147"/>
    <polygon points="0,74 1148,74 1148,96 0,96" fill="#3E4147" opacity=".85"/>
    <polygon points="0,104 1010,104 940,292 0,292" fill="#DFC05B"/>
    <polygon points="0,300 902,300 840,322 0,322" fill="#DFC05B" opacity=".9"/>
    <polygon points="0,330 872,330 872,354 0,354" fill="#3E4147" opacity=".9"/>
    <polygon points="1050,96 1148,96 1148,292 984,292" fill="#3E4147" opacity=".18"/>
  </svg>
  <div class="cap">СЕРТИФИКАТ</div>
  <div class="content">
    <div class="mark" style="margin-top:470px">
      <div class="box"></div><div class="tri"></div><div class="tri2"></div>
      <span class="su">SU</span><span class="fix">FIX</span>
      <div class="dia"><i></i><i></i></div>
    </div>
    <div class="lines">
      <div>настоящим удостоверяется, что компания</div>
      <div class="b">АвтоТехСервис</div>
      <div>Ростовская область</div>
      <div>г. Ростов-на-Дону, ул. Портовая, д. 439</div>
      <div>является официальной точкой продаж</div>
      <div>автокомпонентов и расходных материалов "SUFIX"</div>
    </div>
  </div>
  <div class="foot">
    <div class="sigbox">
      <div class="sigline"></div>
      <div class="p1">Генеральный директор</div>
      <div class="p2">ООО «ЛН Дистрибьюция»</div>
    </div>
  </div>
  <svg class="seal-s" viewBox="0 0 210 210" aria-hidden="true">
      <defs><path id="sfx-seal" d="M27,105 A78,78 0 0 1 183,105"/>
        <clipPath id="sfx-clip"><circle cx="105" cy="105" r="88"/></clipPath></defs>
      <circle cx="105" cy="105" r="90" fill="none" stroke="#6C7C8C" stroke-width="3.4"/>
      <circle cx="105" cy="105" r="82" fill="none" stroke="#6C7C8C" stroke-width="1.3"/>
      <g clip-path="url(#sfx-clip)" stroke="#6C7C8C" stroke-width="1" opacity=".30">
        ${Array.from({ length: 22 }, (_, i) => `<line x1="${10 + i * 10}" y1="4" x2="${-110 + i * 10}" y2="206"/>`).join('')}
      </g>
      <text font-family="Golos" font-size="13.5" font-weight="700" fill="#4F5F6F" letter-spacing="2.2">
        <textPath href="#sfx-seal" startOffset="1%">ЗАПАСНЫЕ ЧАСТИ · SUFIX · РАСХОДНЫЕ МАТЕРИАЛЫ ·</textPath>
      </text>
      <g transform="translate(105 105)">
        <rect x="-52" y="-19" width="104" height="38" rx="6" fill="#F7F6F1" stroke="#4F5F6F" stroke-width="2.6"/>
        <text x="0" y="7" text-anchor="middle" font-family="Golos" font-size="19" font-weight="700" fill="#4F5F6F" letter-spacing="0">SU◇FIX</text>
      </g>
  </svg>
  <div class="valid">действителен по <b>23.06.2027 г.</b></div>
  <svg class="corner-dn" viewBox="0 0 1148 300" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="0,236 1148,236 1148,172 0,172" fill="#3E4147"/>
    <polygon points="0,226 1148,226 1148,202 0,202" fill="#3E4147" opacity=".85"/>
    <polygon points="160,136 1148,136 1148,26 218,26" fill="#DFC05B"/>
    <polygon points="300,136 1148,136 1148,80 322,80" fill="#DFC05B" opacity=".55"/>
  </svg>
</div>`);

/* ============================ 3. KORSON ============================ */
const korson = page(`
body{background:#C9C3B7}
.frame-lite{position:absolute;inset:0;background:
  repeating-linear-gradient(90deg,#CFC9BD 0 3px,#DED8CC 3px 6px,#C2BBAD 6px 9px,#D8D2C6 9px 15px)}
.frame-lite::after{content:'';position:absolute;inset:14px;box-shadow:inset 0 0 0 2px rgba(90,84,72,.30),inset 0 4px 16px rgba(70,64,52,.28)}
.glass{position:absolute;inset:24px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.5),inset 0 0 30px rgba(90,84,72,.22)}
.sheet{inset:24px;background:
  linear-gradient(118deg,rgba(255,255,255,.55) 0 22%,rgba(255,255,255,0) 22.2% 47%,rgba(226,228,224,.75) 47.2% 62%,rgba(255,255,255,0) 62.2%),
  linear-gradient(155deg,#EDEDE9 0%,#E4E5E1 34%,#DCDDD8 58%,#E7E7E3 82%,#DEDFDA 100%)}
.oct{position:absolute;inset:56px}
.oct svg{position:absolute;inset:0}
.content{position:absolute;inset:56px;padding:268px 168px 0;text-align:center}
.kind{font-weight:400;font-size:56px;letter-spacing:.34em;text-indent:.34em;color:#71767C}
.brand{font-family:'Golos';font-weight:700;font-size:152px;letter-spacing:.055em;line-height:1.02;margin-top:16px;
  background:linear-gradient(96deg,#9A7B45 0%,#D9BE84 26%,#B08C4F 48%,#E3CB96 68%,#A7853F 88%,#C9A865 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent}
.lines{margin-top:56px;font-size:30px;line-height:1.66;color:#3A3F44;text-align:center}
.lines .b{font-weight:700;font-size:38px;color:#252A2F}
.stamp{position:absolute;left:150px;bottom:196px;text-align:left;font-size:22px;line-height:1.52;color:#3A4A56}
.stamp .up{font-weight:700;letter-spacing:.045em}
.stamp .small{font-size:20px;color:#4A5560}
.valid{position:absolute;left:150px;bottom:140px;font-size:22px;color:#3A3F44}
`, `
<div class="frame-lite"></div><div class="glass"></div>
<div class="sheet">
  ${PAPER_SVG(0.07)}
  <div class="oct">
    <svg viewBox="0 0 1088 1488" preserveAspectRatio="none" aria-hidden="true">
      <path d="M40,74 L44,74 L74,44 L74,40 L1014,40 L1014,44 L1044,74 L1048,74 L1048,1444 L1044,1444 L1014,1474 L1014,1478 L74,1478 L74,1474 L44,1444 L40,1444 Z"
        fill="none" stroke="#C3A472" stroke-width="2.6"/>
      <path d="M52,84 L52,1434 L84,1466 L1004,1466 L1036,1434 L1036,84 L1004,52 L84,52 Z" fill="none" stroke="#D6BE96" stroke-width="1"/>
    </svg>
  </div>
  <!-- верхний левый угол: многослойные шевроны + дорожка золотых точек -->
  <svg style="position:absolute;left:24px;top:24px;width:360px;height:370px" viewBox="0 0 420 430" aria-hidden="true">
    <polygon points="0,0 300,0 118,182 0,182" fill="#222A31" opacity=".92"/>
    <polygon points="0,0 214,0 92,122 0,122" fill="#3A4A56" opacity=".95"/>
    <polygon points="0,150 250,150 132,268 0,268" fill="#C8A870" opacity=".92"/>
    <polygon points="0,206 300,206 214,292 0,292" fill="#3A4A56" opacity=".85"/>
    <polygon points="0,300 200,300 128,372 0,372" fill="#222A31" opacity=".8"/>
    <g fill="#C8A870">
      ${Array.from({ length: 11 }, (_, i) => `<circle cx="${44 + i * 22}" cy="${44 + i * 22}" r="5.4"/>`).join('')}
    </g>
  </svg>
  <!-- нижний правый угол: зеркальные шевроны -->
  <svg style="position:absolute;right:24px;bottom:24px;width:420px;height:430px" viewBox="0 0 420 430" aria-hidden="true">
    <polygon points="420,430 120,430 302,248 420,248" fill="#222A31" opacity=".92"/>
    <polygon points="420,430 206,430 328,308 420,308" fill="#3A4A56" opacity=".95"/>
    <polygon points="420,280 170,280 288,162 420,162" fill="#C8A870" opacity=".92"/>
    <polygon points="420,224 120,224 206,138 420,138" fill="#3A4A56" opacity=".85"/>
    <polygon points="420,130 220,130 292,58 420,58" fill="#222A31" opacity=".8"/>
    <g stroke="#C8A870" stroke-width="6" stroke-linecap="round">
      ${Array.from({ length: 4 }, (_, i) => `<line x1="${356 + i * 15}" y1="${404 - i * 15}" x2="${288 + i * 15}" y2="${404 - i * 15}"/>`).join('')}
    </g>
  </svg>
  <div class="content">
    <div class="kind">СЕРТИФИКАТ</div>
    <div class="brand">KORSON</div>
    <div class="lines">
      <div>настоящий сертификат подтверждает, что</div>
      <div class="b">АвтоТехСервис</div>
      <div>Ростовская область</div>
      <div>г. Ростов-на-Дону, ул. Портовая, д. 439</div>
      <div>является официальной точкой продаж</div>
      <div>продукции торговой марки "KORSON"</div>
    </div>
  </div>
  <div class="stamp">
    <div class="up">TREUS OTOMOTIV İTHALAT İHRACAT</div>
    <div class="up">SANAYİ VE TİCARET LTD. ŞTİ.</div>
    <div class="small">Altınkum Mah. 423 Sok. Kaya Plaza No:35/4</div>
    <div class="small">Konyaaltı/ANTALYA</div>
  </div>
  <div class="valid">сертификат действителен по <b>23.06.2027 г.</b></div>
</div>`);

/* ============================ 4. NGN (портрет 3:4) ============================ */
const ngn = page(`
body{background:#3B3F42}
.frame-graph{position:absolute;inset:0;background:
  repeating-linear-gradient(90deg,#33373A 0 2px,#42464A 2px 5px,#2B2F32 5px 8px,#4A4E51 8px 14px)}
.frame-graph::after{content:'';position:absolute;inset:15px;box-shadow:inset 0 0 0 2px rgba(255,255,255,.10),inset 0 4px 18px rgba(0,0,0,.5)}
.glass{position:absolute;inset:26px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.20),inset 0 0 34px rgba(0,0,0,.30)}
.sheet{inset:26px;background:linear-gradient(168deg,#FBF8F1 0%,#FAF7EE 52%,#F6F2E7 100%)}
.honey{position:absolute;inset:0;opacity:.5}
.fr-o{position:absolute;inset:56px;border:5px solid #BA6D46}
.fr-i{position:absolute;inset:70px;border:1.6px solid #D19A76}
.content{position:absolute;inset:70px;padding:92px 96px 0}
.head{display:flex;align-items:center;gap:56px}
.badge{position:relative;width:206px;height:206px;flex:0 0 auto}
.badge .hex{position:absolute;inset:0}
.h1{font-weight:700;font-size:62px;letter-spacing:.13em;color:#1F4396;line-height:1.06}
.h1 small{display:block;font-size:23px;font-weight:500;letter-spacing:.24em;color:#5B6B86;margin-top:14px}
.lines{margin-top:74px;text-align:center;font-size:31px;line-height:1.68;color:#33383D}
.lines .b{font-weight:700;font-size:40px;color:#21262B}
.lines .brand{font-weight:700;font-size:44px;color:#1F4396;margin-top:4px}
.foot{position:absolute;left:96px;right:96px;bottom:150px;display:flex;align-items:flex-end;justify-content:space-between}
.seal-n{width:186px;height:186px}
.valid{font-size:23px;color:#33383D;text-align:right;line-height:1.5}
.valid b{font-weight:700;color:#21262B}
`, `
<div class="frame-graph"></div><div class="glass"></div>
<div class="sheet">
  ${PAPER_SVG(0.07)}
  <svg class="honey" viewBox="0 0 1148 1548" aria-hidden="true">
    <defs>
      <pattern id="hx" width="60" height="104" patternUnits="userSpaceOnUse" patternTransform="translate(0 0)">
        <path d="M30,0 L60,17 L60,52 L30,69 L0,52 L0,17 Z" fill="none" stroke="#C9AE86" stroke-width="1" opacity=".55"/>
        <path d="M30,52 L60,69 L60,104 M30,52 L0,69 L0,104" fill="none" stroke="#C9AE86" stroke-width="1" opacity=".35"/>
      </pattern>
    </defs>
    <rect width="1148" height="1548" fill="url(#hx)"/>
  </svg>
  <!-- золотисто-янтарная динамичная дуга в левом верхнем углу -->
  <svg style="position:absolute;left:26px;top:26px;width:560px;height:600px" viewBox="0 0 560 600" aria-hidden="true">
    <defs><linearGradient id="amber" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#B36A16"/><stop offset=".42" stop-color="#D9932E"/>
      <stop offset=".72" stop-color="#EFC27A"/><stop offset="1" stop-color="#8C5A1B"/></linearGradient></defs>
    <path d="M0,600 C 40,300 240,120 560,74 L560,0 L0,0 Z" fill="url(#amber)" opacity=".96"/>
    <path d="M0,600 C 90,360 280,205 560,170" fill="none" stroke="#5B3C12" stroke-width="10" opacity=".55"/>
    <path d="M0,600 C 130,410 320,270 560,246" fill="none" stroke="#F3D9A8" stroke-width="6" opacity=".55"/>
  </svg>
  <div class="fr-o"></div><div class="fr-i"></div>
  <div class="content">
    <div class="head">
      <div class="badge">
        <svg class="hex" viewBox="0 0 206 206" aria-hidden="true">
          <path d="M103,4 L189,53 L189,153 L103,202 L17,153 L17,53 Z" fill="#1F4396"/>
          <path d="M103,12 L182,58 L182,148 L103,194 L24,148 L24,58 Z" fill="none" stroke="#FFFFFF" stroke-width="2.4" opacity=".85"/>
          <path d="M54,116 C 62,74 148,58 168,96 C 178,116 150,138 118,138 C 96,138 78,126 78,112"
            fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" opacity=".95"/>
          <text x="103" y="122" text-anchor="middle" font-family="Golos" font-size="46" font-weight="700" fill="#FFFFFF" letter-spacing="1">NGN</text>
        </svg>
      </div>
      <div class="h1">СЕРТИФИКАТ<small>ОФИЦИАЛЬНАЯ ТОЧКА ПРОДАЖ</small></div>
    </div>
    <div class="lines">
      <div>настоящим удостоверяется, что</div>
      <div>СТАНЦИЯ ТЕХНИЧЕСКОГО ОБСЛУЖИВАНИЯ</div>
      <div class="b">АвтоТехСервис</div>
      <div>Ростовская область</div>
      <div>г. Ростов-на-Дону, ул. Портовая, д. 439</div>
      <div>является официальной точкой продаж продукции</div>
      <div>торговой марки</div>
      <div class="brand">NGN</div>
      <div>и гарантирует качество продукции</div>
    </div>
  </div>
  <div class="foot">
    <svg class="seal-n" viewBox="0 0 186 186" aria-hidden="true">
      <defs><path id="ngn-seal" d="M25,93 A68,68 0 0 1 161,93"/>
        <clipPath id="ngn-clip"><circle cx="93" cy="93" r="78"/></clipPath></defs>
      <circle cx="93" cy="93" r="80" fill="none" stroke="#1F4396" stroke-width="3.2"/>
      <circle cx="93" cy="93" r="71" fill="none" stroke="#1F4396" stroke-width="1.2"/>
      <g clip-path="url(#ngn-clip)" stroke="#1F4396" stroke-width="1" opacity=".28">
        ${Array.from({ length: 20 }, (_, i) => `<line x1="${6 + i * 10}" y1="2" x2="${-100 + i * 10}" y2="184"/>`).join('')}
      </g>
      <text font-family="Golos" font-size="13" font-weight="700" fill="#1F4396" letter-spacing="2.4">
        <textPath href="#ngn-seal" startOffset="4%">ОФИЦИАЛЬНАЯ ТОЧКА ПРОДАЖ · NGN ·</textPath>
      </text>
      <path d="M93,50 L128,70 L128,110 L93,130 L58,110 L58,70 Z" fill="none" stroke="#1F4396" stroke-width="2.6"/>
      <text x="93" y="101" text-anchor="middle" font-family="Golos" font-size="26" font-weight="700" fill="#1F4396">NGN</text>
    </svg>
    <div class="valid">Сертификат действителен по<br><b>23.06.2027 г.</b></div>
  </div>
</div>`);

const CERTS = [
  { key: 'lynxauto', html: lynxauto, seed: 27001 },
  { key: 'sufix', html: sufix, seed: 27002 },
  { key: 'korson', html: korson, seed: 27003 },
  { key: 'ngn', html: ngn, seed: 27004 },
];

/* детерминированный ГПСЧ (тот же mulberry32, что в build-images) */
const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (p.startsWith('/fonts/')) {
    try {
      const b = await readFile(join(SITE, 'public', 'fonts', p.slice('/fonts/'.length)));
      res.setHeader('content-type', 'font/woff2'); res.end(b); return;
    } catch { res.statusCode = 404; res.end('nf'); return; }
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(server.__html ?? '');
});
await new Promise((r) => server.listen(4331, '127.0.0.1', r));

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--no-sandbox', '--font-render-hinting=none'], headless: 'shell',
  env: { ...process.env, LD_LIBRARY_PATH: `/tmp/nss-libs:/tmp/al2023-libs/lib:/tmp/al2-libs/lib:${process.env.LD_LIBRARY_PATH || ''}` },
  protocolTimeout: 300000 });

for (const c of CERTS) {
  server.__html = c.html;
  const p = await browser.newPage();
  await p.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 1 });
  await p.goto('http://127.0.0.1:4331/', { waitUntil: 'networkidle0' });
  await p.evaluate(async () => {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 8000))]);
  });
  await new Promise((r) => setTimeout(r, 250));
  const shot = await p.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 1600 } });
  await p.close();

  /* зерно σ=6: бумажная фактура бланка + запас по lapvar для гейта check-certs (≥200) */
  const im = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = im.info;
  const d = Buffer.from(im.data);
  const rnd = mulberry32(c.seed);
  for (let i = 0; i < d.length; i += ch) {
    const n = Math.round(((rnd() + rnd() + rnd() + rnd() + rnd() + rnd()) / 6 - 0.5) * 2 * 6);
    for (let q = 0; q < 3; q++) d[i + q] = Math.max(0, Math.min(255, d[i + q] + n));
  }
  const out = join(OUT, `cert-${c.key}.jpg`);
  await sharp(d, { raw: { width: w, height: h, channels: ch } }).jpeg({ quality: 95 }).toFile(out + '.tmp');
  renameSync(out + '.tmp', out);
  console.log(`render-certs: ${out} (${w}×${h})`);
}
await browser.close();
server.close();
console.log('render-certs: готово, 4 светлых бланка');
