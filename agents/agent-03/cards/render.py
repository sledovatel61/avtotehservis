"""Build standalone outline SVGs, 2× PNGs, and the trimmed presentation sheet."""
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
import re

from resvg_py import svg_to_bytes
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from PIL import Image
import qrcode
import uharfbuzz as hb
import zxingcpp

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[2]
TOKENS = (ROOT / 'site/src/styles/tokens.css').read_text()
N, D, R, I, M, B, C = (re.search(rf'--{name}:(#[0-9a-fA-F]{{6}})', TOKENS)[1]
                     for name in ('night', 'deep', 'deep2', 'ivory', 'mist', 'brass', 'copper-dark'))
LOGO = (ROOT / 'site/public/img/logo.svg').read_text().strip()
NAME = 'АвтоТехСервис'
SUB = 'Автосервис и шиномонтаж · Ростов-на-Дону'
MAIN = '+7 (928) 906-57-00'
CITY = '+7 (863) 229-19-50'
TG = 'Telegram: +7 (951) 826-98-39'
ADDRESS = 'ул. Портовая, 439'
STOP = 'ост. «3-й Поселковый»'
HOURS = 'ежедневно 9:00–19:00'
SITE = 'ats-rostov.ru'
URL = 'https://' + SITE
LEGAL = 'ИП Яковенко П. И. · ИНН 341010400388'
FONTS = ROOT / 'site/public/fonts'


def num(n):
    return f'{n:.5f}'.rstrip('0').rstrip('.') or '0'


@lru_cache(None)
def font(family, weight, subset):
    stem = 'unbounded' if family == 'u' else 'golos'
    tt = TTFont(FONTS / f'{stem}-{subset}-{weight}.woff2')
    tt.flavor = None
    raw = BytesIO()
    tt.save(raw)
    face = hb.Face(raw.getvalue())
    shaper = hb.Font(face)
    shaper.scale = face.upem, face.upem
    return tt, tt.getGlyphSet(), shaper, face.upem


@lru_cache(None)
def glyph(family, weight, subset, gid):
    tt, gs, _, _ = font(family, weight, subset)
    g = gs[tt.getGlyphName(gid)]
    svg, bounds = SVGPathPen(gs, ntos=num), BoundsPen(gs)
    g.draw(svg)
    g.draw(bounds)
    return svg.getCommands(), bounds.bounds


def text(s, x, y, size, color, family='g', weight=400, align='left', tracking=0,
         bg=None, safe=True, phone=False, ledger=None):
    weight = 600 if family == 'u' else weight
    pos, paths, boxes = 0, [], []
    for run in re.findall(r'[\u0400-\u045f]+|[^\u0400-\u045f]+', s):
        subset = 'cyrillic' if '\u0400' <= run[0] <= '\u045f' else 'latin'
        tt, _, shaper, upem = font(family, weight, subset)
        assert set(map(ord, run)) <= tt.getBestCmap().keys(), run
        buf = hb.Buffer()
        buf.add_str(run)
        buf.guess_segment_properties()
        hb.shape(shaper, buf, {'tnum': 1})
        sc = size / upem
        for info, p in zip(buf.glyph_infos, buf.glyph_positions):
            d, box = glyph(family, weight, subset, info.codepoint)
            a, b = pos + p.x_offset * sc, -p.y_offset * sc
            if box:
                u, v, r, t = box
                boxes.append((a + u * sc, b - t * sc, a + r * sc, b - v * sc))
                paths.append(f'<path transform="translate({num(a)} {num(b)}) scale({num(sc)} {num(-sc)})" d="{d}"/>')
            pos += p.x_advance * sc + tracking
    pos -= tracking
    x -= {'left': 0, 'right': pos, 'center': pos / 2}[align]
    if safe:
        assert size * 72 / 25.4 >= (8 if phone else 6), s
        assert all(x + a >= 7 and y + b >= 7 and x + c <= 89 and y + d <= 49
                   for a, b, c, d in boxes), (s, x, y, pos)
        assert bg is not None and contrast(color, bg) >= 4.5, (s, color, bg)
        if ledger is not None:
            left = x + min(a for a, _, _, _ in boxes)
            top = y + min(b for _, b, _, _ in boxes)
            right = x + max(c for _, _, c, _ in boxes)
            bottom = y + max(d for _, _, _, d in boxes)
            for other, a, b, c, d in ledger:
                assert left >= c or right <= a or top >= d or bottom <= b, (s, other)
            ledger.append((s, left, top, right, bottom))
    return (f'<g aria-label="{escape(s)}" fill="{color}" transform="translate({num(x)} {num(y)})">'
            + ''.join(paths) + '</g>')


def contrast(a, b):
    def lum(c):
        components = [int(c[p:p + 2], 16) / 255 for p in (1, 3, 5)]
        return sum(w * (v / 12.92 if v <= .04045 else ((v + .055) / 1.055)**2.4)
                   for w, v in zip((.2126, .7152, .0722), components))
    lo, hi = sorted((lum(a), lum(b)))
    return (hi + .05) / (lo + .05)


def rect(x, y, w, h, c, stroke=None, sw=.13):
    outline = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{c}"{outline}/>'


def path(d, color, sw=.14, opacity=1):
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" opacity="{opacity}"/>'


def line(x, y, a, b, color, sw=.14, opacity=1):
    return path(f'M{x} {y}L{a} {b}', color, sw, opacity)


def logo(x, y, w, suffix='', opacity=1):
    svg = LOGO
    if suffix:
        svg = re.sub(r'(id="|url\(#)(shield|brass|body|rim)', rf'\1{suffix}-\2', svg)
    return (f'<g transform="translate({x} {y}) scale({num(w/72)})" opacity="{opacity}">'
            + svg[svg.index('>') + 1:svg.rindex('</svg>')] + '</g>')


qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, border=4)
qr.add_data(URL)
qr.make(fit=True)
MATRIX = qr.get_matrix()


def qr_svg(x, y, size=16.5):
    assert 7 <= x <= x + size <= 89 and 7 <= y <= y + size <= 49 and size >= 12
    d = ''.join(f'M{j} {i}h1v1h-1z' for i, row in enumerate(MATRIX) for j, v in enumerate(row) if v)
    return (f'<g aria-label="QR: {URL}" transform="translate({x} {y}) scale({num(size/len(MATRIX))})"'
            f' shape-rendering="crispEdges">{rect(0, 0, len(MATRIX), len(MATRIX), I)}'
            f'<path d="{d}" fill="{N}"/></g>')


class Card:
    def __init__(self, bg):
        self.bg = bg
        self.ink = []
        self.layers = [rect(0, 0, 96, 56, bg)]

    def add(self, *svg_elements):
        self.layers.extend(svg_elements)

    def txt(self, *args, bg=None, **kwargs):
        self.add(text(*args, bg=bg or self.bg, ledger=self.ink, **kwargs))

    def display(self, *args, **kwargs):
        self.txt(*args, family='u', **kwargs)

    def label(self, s, x, y, c, **kwargs):
        self.txt(s, x, y, 2.25, c, weight=500, tracking=.24, **kwargs)

    def svg(self, title):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="96mm" height="56mm" '
                f'viewBox="0 0 96 56" role="img"><title>{escape(title)}</title>\n'
                + '\n'.join(self.layers) + '\n</svg>\n')


def night():
    f, b = Card(N), Card(D)
    f.add(line(7.5, 36, 88.5, 36, B, .16), logo(36.5, 7, 23))
    f.display(NAME, 48, 28.5, 4.8, I, align='center')
    f.txt(SUB, 48, 33.2, 2.7, M, align='center')
    f.display(MAIN, 48, 45.4, 4.9, B, align='center', phone=True)
    b.label('КАК НАС НАЙТИ', 8, 10, B)
    b.display(ADDRESS, 8, 16.2, 3.5, I)
    b.txt(STOP, 8, 20.6, 2.5, M)
    b.txt(HOURS, 8, 24.9, 2.65, I, weight=500)
    b.add(line(8, 28.3, 88, 28.3, B, .14, .47), qr_svg(70.5, 9, 17.5))
    b.txt(SITE, 79.25, 34, 2.7, B, weight=700, align='center')
    b.txt(CITY, 8, 34.4, 3.55, I, weight=700, phone=True)
    b.txt(TG, 8, 39.2, 2.95, M, phone=True)
    b.txt(LEGAL, 8, 47.1, 2.25, M)
    return f, b


def smeta():
    f, b = Card(N), Card(D)
    f.add(rect(6, 6, 84, 44, 'none', B, .13), rect(6.1, 36, 83.8, 13.9, D),
          logo(11, 11, 20), path('M6 29H90 M6 36H90 M35.5 6V29 M33 36V50', B, .14, .64),
          line(11, 43, 29, 43, B, .14, .68))
    f.display(NAME, 86, 21.5, 4.55, I, align='right')
    f.txt(SUB, 86, 33.6, 2.65, M, align='right')
    f.display(MAIN, 86, 44.7, 4.45, I, align='right', bg=D, phone=True)
    b.add(rect(6, 6, 84, 44, 'none', B, .13), rect(6.08, 6.08, 17.42, 36.92, R),
          path('M23.5 6V43 M67 6V43 M6 14.5H67 M6 26.5H67 M6 34.8H67 M6 43H90', B, .14, .55),
          qr_svg(70, 12.5, 16.5))
    b.txt(SITE, 78.25, 34.6, 2.55, B, weight=700, align='center')
    for y, label in [(11.7, 'ТЕЛЕФОН'), (19.8, 'АДРЕС'), (31.8, 'ЧАСЫ'), (40, 'СВЯЗЬ')]:
        b.label(label, 8.7, y, B, bg=R)
    b.txt(CITY, 65, 11.8, 3.25, I, align='right', weight=700, phone=True)
    b.txt(ADDRESS, 65, 19.7, 2.95, I, align='right', weight=500)
    b.txt(STOP, 65, 23.8, 2.35, M, align='right')
    b.txt(HOURS, 65, 31.8, 2.65, I, align='right')
    b.txt(TG, 65, 40, 2.85, I, align='right', tracking=-.03, phone=True)
    b.txt(LEGAL, 8.7, 47.5, 2.25, M)
    return f, b


def mishen():
    f, b = Card(N), Card(D)
    f.add(rect(64, 0, 32, 56, D), line(64, 0, 64, 56, B, .14, .42), logo(66.5, 13, 56))
    f.display(NAME, 8, 24, 4.85, I)
    f.txt(SUB, 8, 29.2, 2.5, M)
    f.add(line(8, 35, 20, 35, B, .16))
    f.display(MAIN, 8, 43.7, 4.65, I, phone=True)
    b.add(rect(0, 0, 34, 56, N), logo(-42, -25, 75),
          line(34, 0, 34, 56, B, .14, .42), qr_svg(8.5, 23, 17))
    b.txt(SITE, 17, 45, 2.5, B, weight=700, align='center', bg=N)
    b.txt(CITY, 39, 12.2, 4.1, I, weight=700, phone=True)
    b.txt(TG, 39, 17.2, 2.9, M, phone=True)
    b.add(line(39, 21.4, 88, 21.4, B, .14, .52))
    b.display(ADDRESS, 39, 28.7, 3.3, I)
    b.txt(STOP, 39, 33.4, 2.55, M)
    b.txt(HOURS, 39, 38.2, 2.65, I, weight=500)
    b.txt(LEGAL, 39, 47.1, 2.25, M)
    return f, b


def light():
    f, b = Card(I), Card(I)
    f.add(logo(70.4, 7.5, 17.5), line(8, 8.5, 66, 8.5, C), line(8, 18, 66, 18, C, .14, .65))
    f.txt(SUB, 8, 14.1, 2.65, N, weight=500)
    f.display(NAME, 8, 33.1, 7.1, N)
    f.display(MAIN, 88, 45.9, 4.35, C, align='right', phone=True)
    f.add(line(8, 44.5, 35.5, 44.5, C))
    b.add(line(8, 8.5, 88, 8.5, C), line(34, 12.5, 34, 41.5, C, .13, .7),
          line(8, 42.2, 88, 42.2, C, .13, .7), qr_svg(10.5, 18.5, 17.5))
    b.txt(SITE, 19.25, 15, 2.8, C, weight=700, align='center')
    b.display(ADDRESS, 39, 16, 3.55, N)
    b.txt(STOP, 39, 20.75, 2.6, N)
    b.txt(HOURS, 39, 25.3, 2.65, N, weight=500)
    b.txt(CITY, 39, 33.5, 3.8, N, weight=700, phone=True)
    b.txt(TG, 39, 38.3, 2.95, N, phone=True)
    b.txt(LEGAL, 8, 47.8, 2.25, N)
    return f, b


def tread(x, w, track, groove):
    # Tread seen flat: longitudinal grooves and offset rectangular shoulder blocks.
    rows = [rect(x, 0, w, 56, track), line(x + 3, 0, x + 3, 56, groove, .16, .55),
            line(x + w - 3, 0, x + w - 3, 56, groove, .16, .55)]
    for y in range(-4, 59, 7):
        for a, b, jog in [(x + 3, x + w*.46, 1.5), (x + w - 3, x + w*.59, -1.5)]:
            rows.append(path(f'M{a} {y}H{a + (b-a)*.63}v{jog}H{b}', groove, .22, .61))
    return ''.join(rows)


def protector():
    f, b = Card(N), Card(D)
    f.add(tread(72, 24, R, B), line(72, 0, 72, 56, B, .14, .55), logo(8, 8.5, 18.5))
    f.display(NAME, 8, 30.2, 5.65, I)
    f.txt(SUB, 8, 35.2, 2.6, M)
    f.add(line(0, 39, 66, 39, B, .14, .75))
    f.display(MAIN, 8, 46.7, 4.6, I, phone=True)
    b.add(tread(86, 10, R, B), rect(0, 6.5, 80.5, 18, R), rect(0, 36, 80.5, 7.2, N),
          qr_svg(62, 10.8, 16.5))
    b.label('ТЕЛЕФОН', 8, 11.6, B, bg=R)
    b.txt(CITY, 8, 17.1, 4.05, I, weight=700, bg=R, phone=True)
    b.txt(TG, 8, 21.5, 2.9, I, bg=R, phone=True)
    b.display(ADDRESS, 8, 30.6, 3.35, I)
    b.txt(STOP, 8, 34.65, 2.45, M)
    b.txt(HOURS, 8, 40.75, 2.7, I, weight=500, bg=N)
    b.txt(LEGAL, 8, 48, 2.25, M)
    b.txt(SITE, 70.25, 32.5, 2.7, B, weight=700, align='center')
    return f, b


CONCEPTS = [
    ('01-nochnoy-ceh', 'Ночной цех', 'Щит над названием, латунная линия и номер — ничего лишнего.', night),
    ('02-smeta', 'Смета', 'Контакты на сетке заказ-наряда: подписи слева, значения справа.', smeta),
    ('03-mishen', 'Мишень', 'Щит с сайта уходит за обрез и становится крупной графикой.', mishen),
    ('04-svetlaya', 'Светлая', 'Слоновая кость и тёмная медь, крупное название и ясная навигация.', light),
    ('05-protektor', 'Протектор', 'Ритм канавок шины отсылает к шиномонтажу на Портовой.', protector),
]


def raster(svg, width, height):
    png = svg_to_bytes(svg_string=svg.replace('width="96mm" height="56mm"', f'width="{width}" height="{height}"'), skip_system_fonts=True)
    return Image.open(BytesIO(png))


def render(concepts=CONCEPTS, stem='collage-03',
           heading='АвтоТехСервис · визитка · агент 03', first=1):
    width, height = 2268, 1322
    sheet_w, margin, gap = 3200, 60, 40
    cw = (sheet_w - 2 * margin - gap) // 2
    ch = round(cw * 50 / 90)
    top, row = 180, ch + 140
    sheet_h = top + row * len(concepts) + 15
    sheet = Image.new('RGB', (sheet_w, sheet_h), N)
    # Artifact date intentionally fixed for stable rerenders of the same concept round.
    labels = [text(heading, margin, 111, 65, I, family='u', safe=False),
              text('20.11.2026', sheet_w - margin, 111, 27, M, align='right', safe=False),
              line(margin, 133, sheet_w - margin, 133, B, 1, .7),
              text('ЛИЦЕВАЯ', margin, 164, 20, B, tracking=2.5, safe=False),
              text('ОБОРОТНАЯ', margin + cw + gap, 164, 20, B, tracking=2.5, safe=False)]
    for i, (slug, title, description, build) in enumerate(concepts):
        pair = OUT / 'concepts' / slug
        pair.mkdir(parents=True, exist_ok=True)
        y = top + row * i
        for j, (side, card) in enumerate(zip(('front', 'back'), build())):
            svg = card.svg(f'{title} — {"лицевая" if j == 0 else "оборотная"}')
            svg_file = pair / f'{side}.svg'
            svg_file.write_text(svg)
            assert re.search('aria-label="' + re.escape(MAIN if j == 0 else CITY) + '"', svg)
            if j:
                for fact in (ADDRESS, STOP, HOURS, TG, SITE, LEGAL):
                    assert f'aria-label="{fact}"' in svg
                assert svg.count('+7 (951)') == 1
            im = raster(svg, width, height).convert('RGB')
            im.save(pair / f'{side}.png', dpi=(300, 300), optimize=True)
            # Crop to the 90×50 mm trim box before laying out the comparison.
            bleed_x, bleed_y = width * 3 / 96, height * 3 / 56
            arr = im.resize((cw, ch), Image.Resampling.LANCZOS,
                            (bleed_x, bleed_y, width - bleed_x, height - bleed_y))
            if j:
                for sample in (im, im.resize((1134, 661), Image.Resampling.LANCZOS), arr):
                    decoded = zxingcpp.read_barcode(sample, formats=zxingcpp.BarcodeFormat.QRCode)
                    assert decoded and decoded.text == URL, (slug, sample.size)
            x = margin + j * (cw + gap)
            sheet.paste(arr, (x, y))
            labels.append(rect(x + .5, y + .5, cw - 1, ch - 1, 'none', B, .7))
        labels += [text(f'{i + first:02d} · {title}', margin, y + ch + 49, 32, I, family='u', safe=False),
                   text(description, margin, y + ch + 85, 22, M, safe=False)]
        print(f'{slug}: geometry, contacts, contrast and 3 QR renders OK')
    layer = raster(f'<svg xmlns="http://www.w3.org/2000/svg" width="{sheet_w}" height="{sheet_h}">'
                   + ''.join(labels) + '</svg>', sheet_w, sheet_h)
    sheet.paste(layer, (0, 0), layer)
    collage = OUT / 'collage'
    collage.mkdir(exist_ok=True)
    sheet.save(collage / f'{stem}.png', optimize=True)
    jpg = collage / f'{stem}.jpg'
    for quality in (94, 90, 86, 82):
        sheet.save(jpg, quality=quality, optimize=True, subsampling=0)
        if jpg.stat().st_size <= 2_000_000:
            break
    assert jpg.stat().st_size <= 2_000_000
    print(f'Collage: {sheet_w}×{sheet_h}, JPG {jpg.stat().st_size:,} bytes')
    print(f'Contrast: ivory/night {contrast(I,N):.2f}, mist/deep {contrast(M,D):.2f}, '
          f'brass/raised {contrast(B,R):.2f}, dark copper/ivory {contrast(C,I):.2f}')


if __name__ == '__main__':
    render()
