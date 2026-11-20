"""Second series: five compositions built around place, promise and service."""
from math import cos, radians, sin
import re

from render import (ADDRESS, B, C, CITY, D, HOURS, I, LEGAL, M, MAIN, N, NAME, R,
                    SITE, STOP, TG, TOKENS, Card, line, logo, path, qr_svg,
                    rect, render)

COPPER = re.search(r'--copper:(#[0-9a-fA-F]{6})', TOKENS)[1]


def ring(x, y, r, ink, sw=.15, opacity=1):
    return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="none" stroke="{ink}" '
            f'stroke-width="{sw}" opacity="{opacity}"/>')


def point(x, y, r, ink):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{ink}"/>'


def landmark():
    f, b = Card(N), Card(D)
    f.add(logo(8, 7.5, 12), line(25, 11.2, 29, 11.2, B, .15),
          line(7.8, 16.5, 88.2, 16.5, B, .14, .5))
    f.display(NAME, 33, 12.65, 3.05, I)
    f.label('РОСТОВ-НА-ДОНУ', 8, 23.5, M)
    f.display('Портовая', 8, 30.55, 3.9, I)
    f.display('439', 87.6, 38.1, 22, B, align='right', tracking=-.65)
    f.add(rect(0, 40.8, 96, 15.2, R), line(0, 40.8, 96, 40.8, B, .18, .7))
    f.txt('Автосервис и шиномонтаж', 8, 47.5, 2.55, M, bg=R)
    f.display(MAIN, 88, 47.55, 3.9, I, align='right', phone=True, bg=R)
    # The brass rule is an index between text blocks, not a map or route.
    b.add(line(9, 12, 9, 39, B, .18, .65), ring(9, 12, 1.35, B, .22),
          point(9, 12, .46, B), point(9, 39, .6, B),
          rect(64.5, 0, 31.5, 56, N), line(64.5, 0, 64.5, 56, B, .2, .55),
          qr_svg(70.25, 15.5, 18), line(14.5, 25.5, 59.5, 25.5, B, .13, .45))
    b.display(ADDRESS, 14.5, 13.8, 3.65, I)
    b.txt(STOP, 14.5, 18.5, 2.55, M)
    b.txt(HOURS, 14.5, 22.6, 2.55, M)
    b.txt(CITY, 14.5, 32.9, 4, I, weight=700, phone=True)
    b.txt(TG, 14.5, 39, 2.9, M, phone=True)
    b.txt(LEGAL, 8, 47.55, 2.25, M)
    b.label('САЙТ', 79.25, 12, B, bg=N, align='center')
    b.txt(SITE, 79.25, 38, 2.65, I, weight=700, align='center', bg=N)
    return f, b


def promise():
    f, b = Card(N), Card(N)
    f.add(logo(8, 7.7, 12.6), line(22.8, 8.1, 22.8, 15.2, B, .14, .8),
          rect(0, 40, 96, 16, R), line(0, 40, 96, 40, B, .22))
    f.display(NAME, 25, 12.65, 2.8, I)
    f.txt('Автосервис и шиномонтаж', 88, 12.65, 2.4, M, align='right')
    f.display('Сначала смета.', 8, 26.05, 6.1, B)
    f.display('Потом ремонт.', 8, 35, 6.1, I)
    f.label('ЗАПИСЬ', 8, 47.05, B, bg=R)
    f.display(MAIN, 88, 47.05, 4.45, I, align='right', phone=True, bg=R)
    b.add(rect(0, 0, 96, 20, R), line(8, 20, 88, 20, B, .2),
          line(63.2, 24.2, 63.2, 48.2, B, .14, .55), qr_svg(69.3, 24.2, 18.2))
    b.label('ПОЗВОНИТЬ', 8, 10.8, B, bg=R)
    b.txt(CITY, 8, 16.6, 4.25, I, weight=700, phone=True, bg=R)
    b.txt(TG, 88, 11.2, 2.9, M, align='right', phone=True, bg=R)
    b.display(ADDRESS, 8, 27.8, 3.6, I)
    b.txt('Ростов-на-Дону', 8, 32.3, 2.55, M)
    b.txt(STOP, 8, 36.4, 2.6, M)
    b.txt(HOURS, 8, 40.9, 2.7, I, weight=500)
    b.txt(LEGAL, 8, 48, 2.25, M)
    b.txt(SITE, 78.4, 47.3, 2.65, B, weight=700, align='center')
    return f, b


def dial(x, y, radius):
    parts = [ring(x, y, radius - 4.2, B, .14, .57), ring(x, y, radius, B, .14, .74)]
    for i in range(48):
        a = radians(7.5 * i)
        ri = radius - (3 if i % 6 == 0 else 1.3)
        parts.append(line(x + ri*cos(a), y + ri*sin(a), x + radius*cos(a), y + radius*sin(a),
                          B, .22 if i % 6 == 0 else .14, .9 if i % 6 == 0 else .5))
    return ''.join(parts)


def instrument():
    f, b = Card(D), Card(N)
    f.add(rect(55, 0, 41, 56, N), dial(73, 23.9, 19.8), logo(63.5, 18.1, 19),
          point(73, 11.1, .44, B), rect(0, 38.5, 96, 17.5, R),
          line(0, 38.5, 96, 38.5, B, .16, .7), line(59, 42, 59, 49, B, .15, .7))
    f.display(NAME, 8, 12.2, 3.55, I)
    f.display('Автосервис', 8, 25, 4.7, I)
    f.display('и шиномонтаж', 8, 32, 4.5, I)
    f.display(MAIN, 8, 46.55, 4.05, B, bg=R, phone=True)
    f.txt('Ростов-на-Дону', 88, 46.35, 2.72, M, bg=R, align='right')
    b.add(rect(61, 0, 35, 56, D), dial(78, 24, 16.6), qr_svg(70, 16, 16),
          line(8, 21, 55, 21, B, .15, .62), line(8, 41.4, 55, 41.4, B, .15, .62))
    b.txt(CITY, 8, 12.2, 4.2, I, weight=700, phone=True)
    b.txt(TG, 8, 17.15, 2.95, M, phone=True)
    b.display(ADDRESS, 8, 28.9, 3.7, I)
    b.txt(STOP, 8, 33.7, 2.6, M)
    b.txt(HOURS, 8, 38.3, 2.7, I, weight=500)
    b.txt(LEGAL, 8, 47.35, 2.25, M)
    b.txt(SITE, 78, 46.65, 2.7, I, weight=700, align='center', bg=D)
    return f, b


def lintel(x, y, w, h, ink):
    return path(f'M{x} {y+h}V{y+2.4}L{x+2.4} {y}H{x+w-2.4}'
                f'L{x+w} {y+2.4}V{y+h}', ink, .24, .76)


def workshop():
    f, b = Card(N), Card(I)
    f.add(logo(73.5, 7.25, 14.5),
          rect(8, 25, 38.25, 14, D), rect(49.75, 25, 38.25, 14, D),
          lintel(8, 23.5, 38.25, 15.5, B), lintel(49.75, 23.5, 38.25, 15.5, B),
          line(8, 39, 88, 39, B, .17, .75))
    f.display(NAME, 8, 12.8, 5.35, I)
    f.txt('Автосервис · Ростов-на-Дону', 8, 18.1, 2.7, M)
    for x in (8, 49.75):
        for y in (27, 28.15):
            f.add(line(x+2.5, y, x+35.75, y, B, .12, .48))
    f.txt('Шиномонтаж', 27.1, 35.7, 3.4, I, weight=500, align='center', bg=D)
    f.txt('Ремонт и ТО', 68.9, 35.7, 3.4, I, weight=500, align='center', bg=D)
    f.display(MAIN, 48, 47.4, 4.75, B, align='center', phone=True)
    b.add(lintel(8, 8, 47.5, 34, C), lintel(59, 8, 29, 34, C),
          line(8, 42, 88, 42, C, .16, .7), qr_svg(64.25, 15.6, 18.5))
    b.display(ADDRESS, 12, 15.7, 3.38, N)
    b.txt(STOP, 12, 20.25, 2.45, N)
    b.txt(HOURS, 12, 24.6, 2.55, N)
    b.txt(CITY, 12, 33.2, 3.55, N, weight=700, phone=True)
    b.txt(TG, 12, 38.1, 2.88, N, phone=True)
    b.txt(SITE, 73.5, 38.1, 2.65, C, weight=700, align='center')
    b.txt(LEGAL, 8, 47.3, 2.25, N)
    return f, b


def copper():
    f, b = Card(COPPER), Card(N)
    f.add(rect(0, 34.5, 96, 21.5, N), logo(73, 8, 15),
          path('M8 10H67 M8 20.25H88', N, .14, .65), line(8, 40.7, 88, 40.7, B, .14, .55))
    f.label('АВТОСЕРВИС И ШИНОМОНТАЖ', 8, 15.65, N)
    f.display(NAME, 8, 29.35, 7.35, N)
    f.txt('Ростов-на-Дону', 8, 47.55, 2.65, M, bg=N)
    f.display(MAIN, 88, 47.8, 4.8, I, align='right', phone=True, bg=N)
    b.add(rect(68.3, 0, 27.7, 56, COPPER), qr_svg(70.75, 17.6, 17),
          line(8, 23.4, 62.5, 23.4, B, .14, .68), line(8, 43, 62.5, 43, B, .14, .5),
          line(71.3, 8.3, 87.6, 8.3, N, .15, .8), line(71.3, 47.8, 87.6, 47.8, N, .15, .8))
    b.display(ADDRESS, 8, 13.35, 4.05, I)
    b.txt(STOP, 8, 17.45, 2.5, M)
    b.txt(HOURS, 8, 21.25, 2.55, M)
    b.txt(CITY, 8, 32.4, 4.25, B, weight=700, phone=True)
    b.txt(TG, 8, 37.5, 2.95, I, phone=True)
    b.txt(LEGAL, 8, 48, 2.25, M)
    b.txt(SITE, 79.25, 40.25, 2.65, N, weight=700, align='center', bg=COPPER)
    return f, b


SERIES = [
    ('06-portovaya-439', 'Портовая, 439', 'Адрес работает как номер на фасаде: запоминается раньше, чем карточка уходит в карман.', landmark),
    ('07-snachala-smeta', 'Сначала смета', 'Обещание с главной страницы вместо рекламного слогана.', promise),
    ('08-pribor', 'Прибор', 'Точная шкала вокруг знака — отсылка к диагностике.', instrument),
    ('09-dva-boksa', 'Два бокса', 'Проёмы мастерской на лицевой и светлый, открытый оборот.', workshop),
    ('10-mednaya-podpis', 'Медная подпись', 'Цвет кнопки записи становится главным, а номер остаётся на ночном фоне.', copper),
]

if __name__ == '__main__':
    render(SERIES, stem='collage-03-encore', heading='АвтоТехСервис · серия II', first=6)
