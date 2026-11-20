"""Five fascia and pier mockups on the real Portovaya 439 photo (day + dusk)."""
from pathlib import Path
import re
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent
sys.path.insert(0, str(OUT.parent))
from render import B, C, D, I, M, N, R, ROOT, TOKENS, logo, path, line, raster, rect, text

CU = re.search(r'--copper:(#[0-9a-fA-F]{6})', TOKENS)[1]
NAME = 'АвтоТехСервис'
MAIN = '+7 (951) 826-98-39'  # live site's main phone, also on current signage
PROPORTIONS = (1600, 900)
CROP = (158, 39, 1368, 854)
# Points are in a 1600×900 copy of the matched Drive source, TL → TR → BR → BL.
FASCIA = [(202, 62), (1311, 183), (1318, 386), (187, 378)]
PIER = [(689, 395), (846, 395), (854, 843), (684, 843)]
# Existing projecting objects preserved above the artwork, not painted over.
OBJECTS = [
    [(190,292),(196,280),(210,280),(220,285),(222,295),(215,303),(201,299),(191,299)],
    [(736,389),(746,384),(783,384),(788,391),(786,405),(782,409),(750,412),(744,405),(736,403)],
    [(731,843),(733,810),(744,805),(746,779),(775,772),(780,783),(780,831),(779,839),
     (790,843),(790,844)],
    [(788,846),(801,811),(802,804),(806,805),(804,819),(801,837),(813,842),(819,846)],
]
W, H = 1140, 320
PW, PH = 168, 450


def tt(s,x,y,size,c=I,bold=False,head=False,align='left',track=0):
    return text(s,x,y,size,c,'u' if head else 'g',700 if bold else 400,
                align=align,tracking=track,safe=False)


def label(s,x,y,size,c=B,align='left',track=2):
    return tt(s,x,y,size,c,bold=True,align=align,track=track)


def poly(points, fill):
    return f'<polygon points="{" ".join(f"{x},{y}" for x,y in points)}" fill="{fill}"/>'


class Design:
    def __init__(self, ink, pierink):
        self.face = [rect(0,0,W,H,ink)]
        self.pier = [rect(0,0,PW,PH,pierink)]
        self.face_light = []
        self.pier_light = []

    def add(self, *parts, pier=False, lit=False):
        (self.pier if pier else self.face).extend(parts)
        if lit:
            (self.pier_light if pier else self.face_light).extend(parts)

    def logo(self, x, y, w, pier=False):
        self.add(logo(x,y,w), pier=pier, lit=True)

    def svg(self, pier=False, light=False):
        w,h = (PW,PH) if pier else (W,H)
        data = self.pier_light if light and pier else self.face_light if light else self.pier if pier else self.face
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">' + ''.join(data) + '</svg>'


def pillar_info(q, accent=B, text_color=I, treatment='center'):
    if treatment=='center':
        q.add(label('ПОРТОВАЯ',84,123,17,accent,'center',1.4),
              tt('439',84,204,60,text_color,head=True,align='center'),
              line(28,231,140,231,accent,1,.66),
              label('ЕЖЕДНЕВНО',84,277,14,text_color,'center',1.2),
              tt('9:00–19:00',84,318,23,text_color,bold=True,align='center'),pier=True)
    if treatment=='stripe':
        q.add(poly([(0,0),(168,0),(168,102),(0,154)],CU),
              line(0,162,168,110,accent,2,.72),
              label('ПОРТОВАЯ',84,197,17,accent,'center',1.4),
              tt('439',84,282,59,I,head=True,align='center'),
              tt('9:00–19:00',84,339,24,I,bold=True,align='center'),pier=True)


def apex():
    q=Design(N,N)
    q.add(poly([(0,0),(903,0),(722,320),(0,320)],CU),
          line(920,0,739,320,B,2.5,.83),
          line(46,264,676,264,N,1.3,.56))
    q.add(label('АВТОСЕРВИС И ШИНОМОНТАЖ',45,163,22,N,track=2.4),
          tt(NAME,44,233,67,N,head=True))
    q.logo(875,161,166)
    q.add(tt('ats-rostov.ru',958,297,23,I,bold=True,align='center'),lit=True)
    pillar_info(q,treatment='stripe')
    return q


def halo():
    q=Design(N,D)
    q.add(rect(0,0,W,H,R),rect(0,158,W,162,N),
          line(0,158,W,158,B,1,.43),
          line(36,294,1103,294,B,2,.82))
    q.add(label('СНАЧАЛА СМЕТА',47,115,18,B,track=3))
    q.logo(49,175,170)
    q.add(tt(NAME,262,240,76,I,head=True),
          tt('АВТОСЕРВИС  ·  ШИНОМОНТАЖ',266,279,24,I,bold=True,track=2.3),lit=True)
    q.add(line(21,33,21,409,B,2,.7),line(147,33,147,409,B,2,.7),pier=True)
    pillar_info(q)
    return q


def landmark():
    q=Design(D,CU)
    q.add(rect(0,0,399,H,N),line(398,0,398,H,B,1.6,.82),
          line(30,278,360,278,B,1.2,.72),line(430,279,1108,279,B,1,.62))
    q.add(label('УЛИЦА ПОРТОВАЯ',38,135,20,B,track=2.6),
          tt('439',30,247,136,B,head=True,track=-1.5),lit=True)
    q.add(tt(NAME,433,214,62,I,head=True),
          tt('Автосервис и шиномонтаж',437,253,29,M,bold=True),lit=True)
    q.logo(986,232,105)
    q.add(line(24,57,144,57,N,1.4,.7),
          tt('ОТКРЫТО',84,188,21,N,bold=True,align='center',track=1.4),
          tt('9:00',84,240,38,N,head=True,align='center'),
          line(44,260,124,260,N,1.3,.7),
          tt('19:00',84,314,33,N,head=True,align='center'),
          tt('ЕЖЕДНЕВНО',84,355,13,N,bold=True,align='center',track=1),pier=True)
    return q


def bays():
    q=Design(N,N)
    q.add(rect(0,236,505,84,CU),rect(505,236,635,84,R),
          line(505,240,505,320,N,3),line(0,236,W,236,B,1.2,.72))
    q.logo(52,120,135)
    q.add(tt(NAME,224,203,76,I,head=True),lit=True)
    q.add(label('АВТОСЕРВИС',250,289,33,N,'center',2.4),
          label('ШИНОМОНТАЖ',810,289,33,I,'center',2.4))
    q.add(rect(15,42,138,336,D),line(15,112,153,112,CU,2),
          label('ПОРТОВАЯ',84,163,16,B,'center',1.2),
          tt('439',84,240,58,I,head=True,align='center'),
          tt('9:00–19:00',84,328,24,I,bold=True,align='center'),pier=True)
    return q


def bright():
    q=Design(I,N)
    q.add(rect(0,0,W,11,CU),rect(0,248,W,72,N),
          line(0,247,W,247,CU,4),line(36,124,566,124,C,1.4,.64))
    q.add(tt(NAME,39,212,82,N,head=True))
    q.logo(952,152,140)
    q.add(label('АВТОСЕРВИС И ШИНОМОНТАЖ',41,294,25,I,track=2),
          tt(MAIN,1090,294,31,B,bold=True,align='right'),lit=True)
    q.add(rect(16,52,136,276,I),rect(16,52,136,8,CU),
          label('ПОРТОВАЯ',84,113,17,N,'center',1.1),
          tt('439',84,201,57,N,head=True,align='center'),
          line(37,224,131,224,C,1.4,.6),
          tt('9:00–19:00',84,270,23,N,bold=True,align='center'),pier=True)
    return q


DESIGNS = [
    ('01-apeks', 'Апекс', 'Медная диагональ с утверждённой визитки. Щит — на тёмной стороне.', apex),
    ('02-tikhiy-svet', 'Тихий свет', 'Тёмный фасад и крупные светящиеся буквы, как на ночной главной.', halo),
    ('03-portovaya', 'Портовая, 439', 'Крупный номер дома читается ещё до названия. Самый заметный ориентир.', landmark),
    ('04-dva-boksa', 'Два бокса', 'Единая вывеска на два проёма, услуги читаются отдельной полосой.', bays),
    ('05-shildik', 'Светлый шильдик', 'Слоновая кость, тёмные буквы и медная кромка. Максимум контраста днём.', bright),
]


def photo():
    img = Image.open(ROOT/'docs/photos-source/original-front-wide-3840x2160.jpg').convert('RGB').resize(PROPORTIONS, Image.Resampling.LANCZOS)
    # Mask the two visible workshop plates before publishing the review sheet.
    for b in ((593,635,648,653),(932,495,994,518)):
        img.paste(img.crop(b).filter(ImageFilter.GaussianBlur(7)),b)
    return img


def project(img, corners, src):
    x = np.array([(u,v) for u,v in corners])
    matrix, target = [], []
    for (a,b),(c,d) in zip(x,src):
        matrix.extend(((a,b,1,0,0,0,-c*a,-c*b),(0,0,0,a,b,1,-d*a,-d*b)))
        target.extend((c,d))
    return img.transform(PROPORTIONS, Image.Transform.PERSPECTIVE,
                         np.linalg.solve(matrix, target), Image.Resampling.BICUBIC)


def board(d, pier=False, light=False):
    w,h = (PW,PH) if pier else (W,H)
    svg = d.svg(pier,light).replace(f'width="{w}" height="{h}"', f'width="{2*w}" height="{2*h}"')
    material = raster(svg, 2*w, 2*h).convert('RGBA')
    if pier:
        return project(material, PIER, ((1,1),(2*w-2,1),(2*w-2,2*h-2),(1,2*h-2)))
    # Fit the sign plane along the bottom of the roofline. The plane is clipped
    # to the existing taper so the lettering stays on a level baseline.
    result = project(material, [(202,58),(1311,66),(1318,387),(187,379)],
                     ((1,1),(2*w-2,1),(2*w-2,2*h-2),(1,2*h-2)))
    stencil = Image.new('L',PROPORTIONS)
    ImageDraw.Draw(stencil).polygon(FASCIA,fill=255)
    result.putalpha(Image.fromarray(np.minimum(np.asarray(result.getchannel('A')),np.asarray(stencil))))
    return result


def ambient(img, dusk):
    a=np.asarray(img).astype(np.float32)/255
    y,x=np.mgrid[:a.shape[0],:a.shape[1]]
    if not dusk:
        out=(a*.95+np.array([.019,.020,.018]))
    else:
        tint=np.array([.39,.47,.52]); out=a*tint + np.array([.010,.022,.026])
        for cx,cy in [(488,524),(1041,508)]:
            weight=(np.exp(-((x-cx)/175)**2-((y-cy)/160)**2)*.57)[...,None]
            out=out*(1-weight)+a*np.array([1,.70,.45])*weight
        out=np.clip(out,0,1)
    return Image.fromarray(np.uint8(np.clip(out*255,0,255))).convert('RGBA')


def adapt(layer, dusk, pier=False, style=0):
    a=np.array(layer)
    rgb=a[...,:3].astype(np.float32)
    y,x=np.mgrid[:a.shape[0],:a.shape[1]]
    if dusk:
        if pier:
            light=.54+.20*np.exp(-((y-479)/150)**2)
        else:
            light=np.full_like(x,.67,dtype=float)
            for cx in [355,540,763,987,1185]:
                light += .13*np.exp(-((x-cx)/89)**2-((y-335)/123)**2)
            if style in (0,4):
                light *= 1.07  # brighter face-lit proposals
        reflect=rgb*light[...,None]*np.array([1,.91,.80])+np.array([1.,2.,2.])
    else:
        grain=np.random.default_rng(439).normal(0,.42,size=x.shape)
        grad=(.943+.043*(1-y/900))[...,None]
        reflect=rgb*grad+grain[...,None]+np.array([1.8,1.5,1.4])
    a[...,:3]=np.uint8(np.clip(reflect,0,255))
    return Image.fromarray(a)


def illuminate(canvas, led, style):
    opacity = led.getchannel('A')
    # Near-black logo areas are opaque housings, not light sources.
    light=np.max(np.asarray(led)[...,:3],axis=2).astype(float)/255
    glowbase=Image.fromarray(np.uint8(np.asarray(opacity)*light**2))
    for blur,strength in ((7,.16),(2,.27)):
        glow=Image.new('RGBA',canvas.size,(232,169,101,0))
        glow.putalpha(glowbase.filter(ImageFilter.GaussianBlur(blur)).point(lambda n:n*strength))
        canvas.alpha_composite(glow)
    led.putalpha(opacity.point(lambda n:n*(.86 if style==1 else .69)))
    canvas.alpha_composite(led)


def scene(base, fascia, pier, led, dusk, style):
    canvas=ambient(base,dusk)
    originals=canvas.copy()
    for part, is_pier in ((fascia,False),(pier,True)):
        mask=part.getchannel('A')
        shadow=Image.new('RGBA',canvas.size,(0,0,0,0))
        offset=Image.new('L',canvas.size);offset.paste(mask,(1,5))
        shadow.putalpha(offset.filter(ImageFilter.GaussianBlur(4)).point(lambda n:n*.45))
        canvas.alpha_composite(shadow)
        canvas.alpha_composite(adapt(part,dusk,is_pier,style))
    if dusk:
        illuminate(canvas,led.copy(),style)
    occlusion=Image.new('L',canvas.size)
    for pts in OBJECTS:
        ImageDraw.Draw(occlusion).polygon(pts,fill=255)
    canvas.paste(originals,(0,0),occlusion.filter(ImageFilter.GaussianBlur(.55)))
    return canvas.crop(CROP).convert('RGB')


def render():
    base=photo()
    a,b = 1210,815
    m,g,top,row = 52,28,190,b+117
    sw,sh=2*a+2*m+g,top+row*len(DESIGNS)+22
    sheet=Image.new('RGB',(sw,sh),N)
    captions=[tt(NAME+' · вывеска',m,95,61,I,head=True),
              label('ПОРТОВАЯ, 439',sw-m,92,23,B,'right',3),
              line(m,117,sw-m,117,B,1.5,.63),
              tt('5 концепций на фото здания',m,151,27,M),
              label('ДЕНЬ',m+7,179,19,B,track=2.2),
              label('ВЕЧЕР · ЭСКИЗ ПОДСВЕТКИ',m+a+g+7,179,19,B,track=2.2)]
    for i,(slug,title,desc,design) in enumerate(DESIGNS):
        q=design()
        fascia,pier,led=board(q),board(q,pier=True),board(q,light=True)
        y=top+row*i
        for dusk in (False,True):
            shot=scene(base,fascia,pier,led,dusk,i)
            x=m+(a+g)*int(dusk)
            sheet.paste(shot,(x,y))
            captions.append(rect(x+.5,y+.5,a-1,b-1,'none',B,.85))
        captions += [tt(f'{i+1:02d} · {title}',m,y+b+44,32,I,head=True),
                     tt(desc,m,y+b+78,24,M)]
        print(f'Composited {slug}, day and dusk')
    overlay=raster(f'<svg xmlns="http://www.w3.org/2000/svg" width="{sw}" height="{sh}">'
                   +''.join(captions)+'</svg>',sw,sh).convert('RGBA')
    sheet.paste(overlay,(0,0),overlay)
    jpg=OUT/'ATS-signage-5-concepts.jpg'
    for quality in (91,88,85,82,79):
        sheet.save(jpg,quality=quality, optimize=True,subsampling=2)
        if jpg.stat().st_size < 2_000_000: break
    print(jpg.name, sheet.size, jpg.stat().st_size)


if __name__=='__main__':
    render()
