"""Apex revision: the original seven brands in a subordinate monochrome row."""
from PIL import Image

from build import B, I, M, N, OUT, apex, board, label, line, photo, raster, rect, scene, tt

BRANDS = ('NGN', 'BARDAHL', 'KORSON', 'PROMATIX', 'LYNXauto', 'SUFIX', 'ICHIRO')
BRAND_LINE = '  ·  '.join(BRANDS)


def design():
    d = apex()
    names = tt(BRAND_LINE, 46, 298, 16.7, N, bold=True, track=.34)
    sample = raster(f'<svg xmlns="http://www.w3.org/2000/svg" width="1140" height="320">'
                    f'{names}</svg>', 1140, 320).convert('RGBA')
    bounds = sample.getchannel('A').getbbox()
    assert bounds and bounds[2] <= 690, bounds  # breathing room before the copper diagonal
    d.add(names)
    return d


def render_revision():
    base = photo()
    d = design()
    fascia, pier, light = board(d), board(d, pier=True), board(d, light=True)
    day, dusk = (scene(base, fascia, pier, light, dark, 0) for dark in (False, True))
    w, h = day.size
    m, gap, top = 52, 28, 198
    sw, sh = w*2 + m*2 + gap, 1590
    sheet = Image.new('RGB', (sw, sh), N)
    left, right, bottom = m, m + w + gap, top + h
    sheet.paste(day, (left, top))
    sheet.paste(dusk, (right, top))
    # Detail of the installed sign; use a crop of the same perspective, not a different layout.
    detail = day.crop((46, 157, 1147, 342))
    detail_w = sw - 2*m
    detail_h = round(detail.height * detail_w / detail.width)
    dy = bottom + 106
    sheet.paste(detail.resize((detail_w, detail_h), Image.Resampling.LANCZOS), (m, dy))
    captions = [tt('Апекс · с брендами', m, 95, 67, I, head=True),
                label('ПОРТОВАЯ, 439', sw-m, 90, 24, B, 'right', 3),
                line(m, 117, sw-m, 117, B, 1.4, .63),
                tt('АвтоТехСервис · обновлённый эскиз на реальном фасаде', m, 154, 28, M),
                label('ДЕНЬ', left, 184, 20, B),
                label('ВЕЧЕР · ЭСКИЗ ПОДСВЕТКИ', right, 184, 20, B),
                rect(left+.5, top+.5, w-1, h-1, 'none', B, 1),
                rect(right+.5, top+.5, w-1, h-1, 'none', B, 1),
                label('КРУПНЫЙ ПЛАН · ПОЛОСА БРЕНДОВ', m, dy-25, 24, B),
                rect(m+.5, dy+.5, detail_w-1, detail_h-1, 'none', B, 1),
                tt('Семь брендов со старой вывески — в одну строку, без цветных логотипов.',
                   m, dy+detail_h+35, 24, M)]
    assert dy + detail_h + 35 < sh
    overlay = raster(f'<svg xmlns="http://www.w3.org/2000/svg" width="{sw}" height="{sh}">'
                     + ''.join(captions) + '</svg>', sw, sh).convert('RGBA')
    sheet.paste(overlay, (0, 0), overlay)
    jpg = OUT / 'ATS-Apeks-brands.jpg'
    sheet.save(jpg, quality=93, optimize=True, subsampling=0)
    assert jpg.stat().st_size < 2_000_000
    with Image.open(jpg) as check:
        check.load()
        assert check.size == (sw, sh)
    print(f'{jpg.name}: {sw} × {sh}, {jpg.stat().st_size:,} bytes')


if __name__ == '__main__':
    render_revision()
