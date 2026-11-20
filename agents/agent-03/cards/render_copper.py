"""Third series: five ways to use the site's copper as the main color."""
from render import (ADDRESS, B, CITY, D, HOURS, I, LEGAL, M, MAIN, N, NAME,
                    SITE, STOP, TG, Card, line, logo, path, qr_svg, rect, render)
from render_encore import COPPER, point, ring


def polygon(points, fill):
    coords = ' '.join(f'{x},{y}' for x, y in points)
    return f'<polygon points="{coords}" fill="{fill}"/>'


def arrow(x, y, length, ink, sw=.34):
    end = x + length
    return path(f'M{x} {y}H{end} m-2.1 -2.1 l2.1 2.1 -2.1 2.1', ink, sw)


def apex():
    f, b = Card(COPPER), Card(N)
    f.add(polygon([(77, 0), (96, 0), (96, 56), (55, 56)], N),
          line(81, 0, 59, 56, B, .18, .75), logo(72.5, 34, 15.5),
          line(8, 33.3, 60, 33.3, N, .19, .61))
    f.label('АВТОСЕРВИС И ШИНОМОНТАЖ', 8, 12.4, N)
    f.display(NAME, 8, 25.2, 5.9, N)
    f.display(MAIN, 8, 42.3, 3.76, N, phone=True)
    f.txt('Ростов-на-Дону', 8, 47.8, 2.6, N)
    b.add(polygon([(78, 0), (96, 0), (96, 56), (56, 56)], COPPER),
          line(74, 0, 52, 56, B, .18, .72), qr_svg(70.2, 23, 17.8),
          line(8, 21.6, 56, 21.6, B, .15, .68))
    b.txt(CITY, 8, 12.5, 4.15, I, weight=700, phone=True)
    b.txt(TG, 8, 17.65, 2.9, M, phone=True)
    b.display(ADDRESS, 8, 29.5, 3.55, B)
    b.txt(STOP, 8, 34.15, 2.6, M)
    b.txt(HOURS, 8, 39.2, 2.65, I, weight=500)
    b.txt(LEGAL, 8, 47.45, 2.25, M)
    b.txt(SITE, 79.1, 45.25, 2.65, N, align='center', weight=700, bg=COPPER)
    return f, b


def plate(x, y, w, h, ink, edge, holes=True):
    d = 2.6
    points = [(x+d,y),(x+w-d,y),(x+w,y+d),(x+w,y+h-d),
              (x+w-d,y+h),(x+d,y+h),(x,y+h-d),(x,y+d)]
    elements = [polygon(points, ink), path('M' + 'L'.join(f'{u} {v}' for u,v in points) + 'Z', edge, .19)]
    if holes:
        for u, v in ((x+3.2,y+3.2),(x+w-3.2,y+3.2),(x+3.2,y+h-3.2),(x+w-3.2,y+h-3.2)):
            elements += [ring(u,v,.65,edge,.14), line(u-.3,v+.3,u+.3,v-.3,edge,.12)]
    return ''.join(elements)


def nameplate():
    f, b = Card(D), Card(COPPER)
    f.add(line(0, 26.75, 96, 26.75, B, .19, .58), plate(7, 6.2, 82, 41, COPPER, N),
          logo(40, 9, 16), line(16, 34.7, 80, 34.7, N, .13, .72))
    f.display(NAME, 48, 26.85, 5.4, N, align='center', bg=COPPER)
    f.txt('Автосервис и шиномонтаж', 48, 31.4, 2.65, N, align='center', bg=COPPER)
    f.display(MAIN, 48, 42.3, 4.5, N, align='center', bg=COPPER, phone=True)
    b.add(plate(5.5, 5.5, 85, 45, N, B), qr_svg(68.8, 13.75, 16.8),
          line(11.5, 27, 62, 27, B, .13, .59))
    b.label('РОСТОВ-НА-ДОНУ', 11.5, 11.2, B, bg=N)
    b.display(ADDRESS, 11.5, 17.15, 3.55, I, bg=N)
    b.txt(STOP, 11.5, 21.4, 2.45, M, bg=N)
    b.txt(HOURS, 11.5, 25.1, 2.5, M, bg=N)
    b.txt(CITY, 11.5, 33.45, 3.85, I, bg=N, weight=700, phone=True)
    b.txt(TG, 11.5, 38.6, 2.9, M, bg=N, phone=True)
    b.txt(LEGAL, 11.5, 46.55, 2.25, M, bg=N)
    b.txt(SITE, 77.2, 36, 2.65, B, align='center', weight=700, bg=N)
    return f, b


def wayfinding():
    f, b = Card(COPPER), Card(COPPER)
    f.add(logo(74.5, 7.7, 13.5), line(8, 19.6, 88, 19.6, N, .19, .73),
          rect(8, 23.3, 80, 12.1, N), arrow(12.2, 29.35, 8, B),
          line(24.8, 25.6, 24.8, 33, B, .14, .72))
    f.label('АВТОСЕРВИС И ШИНОМОНТАЖ', 8, 12.5, N)
    f.display(NAME, 29, 31.1, 4.55, I, bg=N)
    f.txt('Ростов-на-Дону', 8, 45.5, 2.65, N)
    f.display(MAIN, 88, 46, 4.8, N, align='right', phone=True)
    b.add(rect(0, 0, 62, 56, N), qr_svg(68, 19, 17.5),
          path('M76.75 9.4V15.9 M75 14.15L76.75 15.9 78.5 14.15', N, .34), line(8, 24.2, 56, 24.2, B, .18, .65))
    b.display(ADDRESS, 8, 13.1, 3.85, I, bg=N)
    b.txt(STOP, 8, 17.5, 2.55, M, bg=N)
    b.txt(HOURS, 8, 21.5, 2.6, M, bg=N)
    b.txt(CITY, 8, 31.95, 4.2, B, weight=700, phone=True, bg=N)
    b.txt(TG, 8, 37.3, 2.9, I, phone=True, bg=N)
    b.txt(LEGAL, 8, 47.4, 2.25, M, bg=N)
    b.txt(SITE, 76.75, 42.25, 2.75, N, weight=700, align='center')
    return f, b


def perforation(x):
    marks = [line(x, y, x, y + 1.6, N, .2, .65) for y in range(6, 51, 4)]
    return ''.join(marks) + point(x, 3, 1.9, N) + point(x, 53, 1.9, N)


def ticket():
    f, b = Card(COPPER), Card(COPPER)
    f.add(rect(64, 0, 32, 56, B), perforation(64),
          logo(71, 9, 17.5), line(8, 19.5, 58, 19.5, N, .16, .7),
          line(8, 36, 58, 36, N, .16, .7), line(70, 27, 88.5, 27, N, .13, .8))
    f.label('АВТОСЕРВИС И ШИНОМОНТАЖ', 8, 13.4, N)
    f.display(NAME, 8, 30.65, 4.8, N)
    f.display(MAIN, 8, 45, 4.05, N, phone=True)
    f.txt('Портовая', 79.2, 32.5, 2.6, N, weight=500, align='center', bg=B)
    f.display('439', 79.2, 42.3, 6.45, N, align='center', bg=B)
    b.add(rect(64, 0, 32, 56, B), perforation(64), qr_svg(70.25, 17.1, 17.9),
          line(8, 22, 58, 22, N, .14, .74), line(8, 42.6, 58, 42.6, N, .14, .74))
    b.label('СВЯЗАТЬСЯ', 8, 10, N)
    b.txt(CITY, 8, 15.6, 4.1, N, weight=700, phone=True)
    b.txt(TG, 8, 19.8, 2.85, N, phone=True)
    b.display(ADDRESS, 8, 29.5, 3.75, N)
    b.txt(STOP, 8, 34.3, 2.55, N)
    b.txt(HOURS, 8, 39.2, 2.6, N)
    b.txt(LEGAL, 8, 47.7, 2.25, N)
    b.txt(SITE, 79.2, 40.15, 2.7, N, weight=700, align='center', bg=B)
    return f, b


def stripes():
    f, b = Card(N), Card(N)
    f.add(rect(0, 0, 23.5, 56, COPPER), rect(23.5, 0, 3.2, 56, N),
          rect(26.7, 0, 1.6, 56, COPPER), logo(7.4, 10.3, 14.7),
          rect(7.5, 29, 13.6, 13.6, N), line(34, 36.15, 88, 36.15, B, .16, .61))
    f.display('439', 14.3, 37.4, 3.62, B, align='center')
    f.display(NAME, 34, 23.7, 4.8, I)
    f.txt('Автосервис и шиномонтаж', 34, 29.8, 2.65, M)
    f.display(MAIN, 34, 45.25, 4.4, B, phone=True)
    b.add(rect(0, 0, 96, 16.3, COPPER), rect(0, 18.6, 96, 1.45, COPPER),
          qr_svg(70.4, 24.4, 16.8), line(8, 36.15, 62, 36.15, B, .17, .68))
    b.display(ADDRESS, 8, 12.7, 3.95, N, bg=COPPER)
    b.txt('Ростов-на-Дону', 88, 12.55, 2.65, N, align='right', bg=COPPER)
    b.txt(CITY, 8, 28.2, 4, I, weight=700, phone=True)
    b.txt(TG, 8, 33.2, 2.9, M, phone=True)
    b.txt(STOP, 8, 40.7, 2.5, M)
    b.txt(HOURS, 8, 44.45, 2.5, I, weight=500)
    b.txt(LEGAL, 8, 48.45, 2.25, M)
    b.txt(SITE, 78.8, 46.2, 2.65, B, weight=700, align='center')
    return f, b


SERIES = [
    ('11-apeks', 'Апекс', 'Резкий срез двух цветов, как на гоночной ливрее.', apex),
    ('12-shildik', 'Шильдик', 'Медная заводская табличка со срезанными углами и крепежом.', nameplate),
    ('13-ukazatel', 'Указатель', 'Чёрная вывеска на меди: ясные стрелки и крупный номер.', wayfinding),
    ('14-talon', 'Талон', 'Визитка как сервисный талон с выделенным корешком.', ticket),
    ('15-bortovaya-polosa', 'Бортовая полоса', 'Две медные полосы меняют направление на обороте.', stripes),
]

if __name__ == '__main__':
    render(SERIES, stem='collage-03-copper', heading='АвтоТехСервис · медная серия', first=11)
