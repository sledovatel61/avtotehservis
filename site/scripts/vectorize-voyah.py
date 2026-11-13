#!/usr/bin/env python3
"""Векторизация знака, лейбла и локапа Voyah из файла владельца.

Вход : docs/brand/voyah/source/logo-black-on-white.png  (1536×864, RGBA)
Выход: site/public/img/vy-{mark,label,lockup}[-light|-dark|-ghost].svg
       site/public/img/vy-mark-paths.json

Почему именно этот файл
-----------------------
`logo-black-on-white.png` и прежний `logo/vy-mark.png` — один и тот же файл
(sha256 c6ee048f…), проверено побайтово. Растр `site/public/img/vy-mark.png`
(512×733) собран из `logo-white-on-dark.jpg` с ручным кропом и искажён по
пропорции: 512/733 = 0.699 против 0.710 у эталона. Вектор ведётся от эталона,
под PNG не подгоняется.

Как работает
------------
1. Из альфа-канала берётся изолиния 50 % покрытия (marching squares) — настоящая
   граница с субпиксельной точностью; «лестница» пиксельной сетки в контур не идёт.
2. Точки контура передискретизируются с шагом 0.5 px; сглаживание вдоль длины
   (гаусс 0.8 px) применяется только внутри участков — рядом с углами берутся
   «сырые» точки, иначе сглаживание скругляет острые концы лопастей и иглы.
3. Углы: скачок направления в трёх масштабах (1.5 / 4 / 8 px), затем уточнение
   пересечением прямых по участкам слева и справа.
4. Участок между углами приближается по очереди отрезком, дугой окружности
   (через три точки — концы и середину, дуга проходит точно через оба угла) или
   кубической Безье. Между примитивами нет разрывов.
5. Готовая цепочка проверяется целиком; если отклонение больше допуска, участок
   делится и подгоняется заново — поэтому максимум ограничен измерением.

Запуск: python3 site/scripts/vectorize-voyah.py
"""
import hashlib
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image
from skimage import measure

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "brand" / "voyah" / "source" / "logo-black-on-white.png"
OUT = ROOT / "site" / "public" / "img"
OUT_JSON = OUT / "vy-mark-paths.json"

TOL_PX = float(os.environ.get("VY_TOL", "0.8"))     # допуск приближения участка, px
SIGMA = float(os.environ.get("VY_SIGMA", "0.8"))    # сглаживание вдоль контура, px
CORNER_RAD = float(os.environ.get("VY_CORNER", "0.60"))
CORNER_W = float(os.environ.get("VY_CORNER_W", "5.0"))
DEC = int(os.environ.get("VY_DEC", "1"))
STEP = 0.5
PAD = 0.5                       # отступ плотного viewBox, px

INK = "#1B1F3C"                 # краска владельца: rgb(27, 31, 60)
WHITE = "#FFFFFF"
GHOST_OPACITY = 0.13
LABEL_GAP_MIN = 20.0            # мин. вертикальный зазор между знаком и лейблом, px

# ------------------------------------------------------------------ утилиты


def resample(pts, step=STEP):
    src = np.vstack([pts, pts[:1]])
    d = np.linalg.norm(np.diff(src, axis=0), axis=1)
    s = np.concatenate(([0.0], np.cumsum(d)))
    n = max(12, int(round(s[-1] / step)))
    u = np.linspace(0.0, s[-1], n, endpoint=False)
    return np.column_stack([np.interp(u, s, src[:, 0]), np.interp(u, s, src[:, 1])])


def smooth_closed(pts, sigma):
    if sigma <= 0:
        return pts
    n = len(pts)
    half = max(1, int(np.ceil(3 * sigma / STEP)))
    k = np.exp(-0.5 * (np.arange(-half, half + 1) * STEP / sigma) ** 2)
    k /= k.sum()
    out = np.empty_like(pts)
    for c in range(2):
        padded = np.concatenate([pts[-half:, c], pts[:, c], pts[:half, c]])
        out[:, c] = np.convolve(padded, k, mode="same")[half : half + n]
    return out


def bez(p, t):
    p0, p1, p2, p3 = p
    mt = 1.0 - t
    return (mt ** 3) * p0 + (3 * mt * mt * t) * p1 + (3 * mt * t * t) * p2 + (t ** 3) * p3


def bez_d(p, t):
    p0, p1, p2, p3 = p
    mt = 1.0 - t
    return (3 * mt * mt) * (p1 - p0) + (6 * mt * t) * (p2 - p1) + (3 * t * t) * (p3 - p2)


def bez_dd(p, t):
    p0, p1, p2, p3 = p
    mt = 1.0 - t
    return (6 * mt) * (p2 - 2 * p1 + p0) + (6 * t) * (p3 - 2 * p2 + p1)


def chord_params(pts):
    d = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    t = np.concatenate(([0.0], np.cumsum(d)))
    return t / t[-1] if t[-1] > 0 else np.linspace(0, 1, len(pts))


def polyline_dev(pts, a, b):
    v = b - a
    L = np.linalg.norm(v)
    if L < 1e-9:
        return np.inf, np.inf
    nv = np.array([-v[1], v[0]]) / L
    perp = np.abs((pts - a) @ nv)
    proj = (pts - a) @ (v / L)
    return float(perp.max()), float(max(0.0, -proj.min(), proj.max() - L))


# ------------------------------------------------------- приближение Безье


def fit_cubic_lsq(pts, t, t1, t2):
    p0, p3 = pts[0], pts[-1]
    b1 = 3 * t * (1 - t) ** 2
    b2 = 3 * t ** 2 * (1 - t)
    A1 = b1[:, None] * t1[None, :]
    A2 = b2[:, None] * t2[None, :]
    rest = pts - (p0[None, :] * ((1 - t) ** 3 + b1)[:, None] + p3[None, :] * (b2 + t ** 3)[:, None])
    c00 = float((A1 * A1).sum())
    c01 = float((A1 * A2).sum())
    c11 = float((A2 * A2).sum())
    x0 = float((A1 * rest).sum())
    x1 = float((A2 * rest).sum())
    det = c00 * c11 - c01 * c01
    if abs(det) > 1e-12:
        al = (x0 * c11 - x1 * c01) / det
        ar = (c00 * x1 - c01 * x0) / det
    else:
        al = ar = 0.0
    seg = float(np.linalg.norm(p3 - p0)) or 1.0
    if not np.isfinite(al) or not np.isfinite(ar) or al < 1e-6 or ar < 1e-6:
        al = ar = seg / 3.0
    cap = seg * 1.25
    return p0, p0 + t1 * min(al, cap), p3 + t2 * min(ar, cap), p3


def reparametrize(pts, t, c, iters=4):
    t = t.copy()
    for _ in range(iters):
        d = bez(c, t[:, None])
        q1 = bez_d(c, t[:, None])
        q2 = bez_dd(c, t[:, None])
        num = ((d - pts) * q1).sum(1)
        den = (q1 * q1 + (d - pts) * q2).sum(1)
        with np.errstate(divide="ignore", invalid="ignore"):
            step = np.where(np.abs(den) > 1e-12, num / den, 0.0)
        t = np.clip(t - np.nan_to_num(step, nan=0.0), 0.0, 1.0)
        t[0], t[-1] = 0.0, 1.0
        if not np.all(np.diff(t) >= -1e-9):
            t = np.sort(t)
    return t


def curve_dev(pts, c, n=64):
    s = bez(c, np.linspace(0, 1, n)[:, None])
    return float(np.max(np.min(np.linalg.norm(s[None, :, :] - pts[:, None, :], axis=2), axis=1)))


# ------------------------------------------------------------- дуги окружностей


def circle3(a, m, b):
    ax, ay = a
    bx, by = m
    cx, cy = b
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if abs(d) < 1e-9:
        return None
    a2 = ax * ax + ay * ay
    b2 = bx * bx + by * by
    c2 = cx * cx + cy * cy
    ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
    uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
    return np.array([ux, uy]), float(np.hypot(ax - ux, ay - uy))


def try_arc(pts, tol):
    """Дуга через концы участка и самую удалённую от хорды точку + обратная проверка."""
    a, b = pts[0], pts[-1]
    v = b - a
    L = np.linalg.norm(v)
    if L < 1e-6:
        return None
    nv = np.array([-v[1], v[0]]) / L
    dist = (pts - a) @ nv
    k = int(np.argmax(np.abs(dist)))
    if abs(dist[k]) < 2 * tol:
        return None
    res = circle3(a, pts[k], b)
    if res is None:
        return None
    c, R = res
    if R < 2.0 or R > 1e4:
        return None
    rr = np.linalg.norm(pts - c, axis=1)
    if float(np.abs(rr - R).max()) > tol:
        return None
    a0 = np.arctan2(a[1] - c[1], a[0] - c[0])
    a1 = np.arctan2(b[1] - c[1], b[0] - c[0])
    am = np.arctan2(pts[k][1] - c[1], pts[k][0] - c[0])
    sweep = (a1 - a0) % (2 * np.pi)
    if ((am - a0) % (2 * np.pi)) > sweep:
        sweep -= 2 * np.pi
    ts = np.linspace(0.02, 0.98, 24)
    samples = np.array([c + R * np.array([np.cos(a0 + sweep * t), np.sin(a0 + sweep * t)]) for t in ts])
    if float(np.min(np.linalg.norm(samples[:, None, :] - pts[None, :, :], axis=2), axis=1).max()) > tol:
        return None
    return ("arc", c, float(R), float(a0), float(sweep), a, b)


# ------------------------------------------------------------------ конвейер


def turn_angles(pts, k):
    n = len(pts)
    fwd = np.roll(pts, -k, axis=0) - pts
    bwd = pts - np.roll(pts, k, axis=0)
    a1 = np.arctan2(fwd[:, 1], fwd[:, 0])
    a2 = np.arctan2(bwd[:, 1], bwd[:, 0])
    d = np.abs((a1 - a2 + np.pi) % (2 * np.pi) - np.pi)
    return np.minimum(d, 2 * np.pi - d)


def detect_corners(pts):
    n = len(pts)
    hot = np.zeros(n, dtype=bool)
    for win_px, thresh in ((1.5, CORNER_RAD), (4.0, CORNER_RAD * 0.8), (8.0, CORNER_RAD * 0.6)):
        hot |= turn_angles(pts, max(2, int(round(win_px / STEP)))) > thresh
    if not hot.any():
        return []
    k = max(2, int(round(CORNER_W / STEP)))
    idx = np.where(hot)[0]
    groups = [[int(idx[0])]]
    for j in idx[1:]:
        if j - groups[-1][-1] <= k:
            groups[-1].append(int(j))
        else:
            groups.append([int(j)])
    if len(groups) > 1 and (groups[0][0] + n - groups[-1][-1]) <= k:
        groups[0] = [g - n for g in groups[-1]] + groups[0]
        groups.pop()
    turn = np.maximum.reduce([turn_angles(pts, max(2, int(round(w / STEP)))) for w in (1.5, 4.0, 8.0)])
    return sorted({max(g, key=lambda i: turn[i % n]) % n for g in groups})


def refine_corner(pts, i, span_px=7.0):
    n = len(pts)
    m = max(3, int(round(span_px / STEP)))
    gap = max(2, int(round(1.5 / STEP)))
    left = np.array([pts[(i - gap - t) % n] for t in range(m)])
    right = np.array([pts[(i + gap + t) % n] for t in range(m)])

    def fit_dir(p):
        c = p.mean(0)
        _, s, vt = np.linalg.svd(p - c)
        if s[0] <= 0 or s[1] / s[0] > 0.08:
            return None
        return c, vt[0]

    fl, fr = fit_dir(left), fit_dir(right)
    if fl is None or fr is None:
        return pts[i]
    (c1, d1), (c2, d2) = fl, fr
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 0.08:
        return pts[i]
    t = ((c2[0] - c1[0]) * d2[1] - (c2[1] - c1[1]) * d2[0]) / den
    p = c1 + d1 * t
    if np.hypot(*(p - pts[i])) > 1.0:      # угол уточняем, но не «вытягиваем»
        return pts[i]
    return p


def sample_chain(prims, step=0.4):
    out = []
    for pr in prims:
        if pr[0] == "line":
            a, b = pr[1], pr[2]
            n = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
            out.extend(a + (b - a) * (k / n) for k in range(n + 1))
        elif pr[0] == "arc":
            _, c, R, a0, sweep, _p0, _p1 = pr
            n = max(4, int(np.ceil(abs(sweep) * R / step)))
            out.extend(c + R * np.array([np.cos(a0 + sweep * k / n), np.sin(a0 + sweep * k / n)]) for k in range(n + 1))
        else:
            c = pr[1]
            n = max(6, int(np.ceil(np.linalg.norm(c[3] - c[0]) / step)) + 4)
            out.extend(bez(c, np.linspace(0, 1, n + 1)[:, None]))
    return np.array(out)


def chain_dev(pts, prims):
    if not prims:
        return np.inf
    ch = sample_chain(prims)
    return float(np.min(np.linalg.norm(ch[None, :, :] - pts[:, None, :], axis=2), axis=1).max())


def fit_piece(pts, t1, t2, out, depth=0):
    if len(pts) < 4:
        out.append(("line", pts[0], pts[-1]))
        return
    perp, outside = polyline_dev(pts, pts[0], pts[-1])
    if perp <= TOL_PX * 0.7 and outside <= TOL_PX * 0.7:
        out.append(("line", pts[0], pts[-1]))
        return
    ar = try_arc(pts, TOL_PX)
    if ar is not None:
        out.append(ar)
        return
    t = chord_params(pts)
    c = fit_cubic_lsq(pts, t, t1, t2)
    dev = curve_dev(pts, c)
    if dev > TOL_PX and len(pts) >= 10:
        c_alt = fit_cubic_lsq(pts, reparametrize(pts, t, c), t1, t2)
        if curve_dev(pts, c_alt) < dev:
            c, dev = c_alt, curve_dev(pts, c_alt)
    if dev <= TOL_PX or depth >= 10 or len(pts) < 10:
        out.append(("cubic", c))
        return
    s = bez(c, np.linspace(0, 1, 40)[:, None])
    at = int(np.argmax(np.min(np.linalg.norm(s[None, :, :] - pts[:, None, :], axis=2), axis=1)))
    at = max(1, min(len(pts) - 2, at))
    fit_piece(pts[: at + 1], t1, t1, out, depth + 1)
    fit_piece(pts[at:], t2, t2, out, depth + 1)


def fit_span(seg, t1, t2, depth=0):
    prims = []
    ar = try_arc(seg, TOL_PX)
    if ar is not None:
        prims = [ar]
    else:
        fit_piece(seg, t1, t2, prims)
    if chain_dev(seg, prims) <= TOL_PX or depth >= 5 or len(seg) < 12:
        return prims
    ch = sample_chain(prims)
    d = np.min(np.linalg.norm(ch[None, :, :] - seg[:, None, :], axis=2), axis=1)
    at = max(3, min(len(seg) - 4, int(np.argmax(d))))
    return fit_span(seg[: at + 1], t1, t1, depth + 1) + fit_span(seg[at:], t2, t2, depth + 1)


def fit_contour(raw):
    base = resample(raw)
    soft = smooth_closed(base, 0.6)
    corners = detect_corners(soft)
    if not corners:
        far = int(np.argmax(np.linalg.norm(soft - soft[0], axis=1)))
        corners = sorted({0, far // 2})
    work = smooth_closed(base, SIGMA)
    near = max(1, int(round(2.5 / STEP)))
    for i in corners:
        for o in range(-near, near + 1):
            j = (i + o) % len(base)
            work[j] = base[j]
    cpts = []
    for i in corners:
        p = base[i]
        q = refine_corner(smooth_closed(base, 0.8), i)
        cpts.append(q if np.hypot(*(q - p)) < 1.2 else p)
    for i, p in zip(corners, cpts):
        work[i] = p
    n = len(work)
    m = len(corners)
    prims = []
    for ci in range(m):
        i0 = corners[ci]
        i1 = corners[(ci + 1) % m] + (n if (ci + 1) % m == 0 else 0)
        seg = np.vstack([work[i0 : i1 + 1]])
        seg[0] = cpts[ci]
        seg[-1] = cpts[(ci + 1) % m]
        if len(seg) < 4:
            prims.append(("line", seg[0], seg[-1]))
            continue
        t1 = seg[1] - seg[0]
        t1 = t1 / (np.linalg.norm(t1) or 1.0)
        t2 = seg[-1] - seg[-2]
        t2 = t2 / (np.linalg.norm(t2) or 1.0)
        prims.extend(fit_span(seg, t1, t2))
    return prims


# ------------------------------------------------------------------ вывод


def fmt(v):
    s = f"{v:.{DEC}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def prims_to_d(prims, origin, scale=1.0):
    """Абсолютные M/L/A/C/Z; координаты = (p - origin) * scale."""
    def q(p):
        return ((p[0] - origin[0]) * scale, (p[1] - origin[1]) * scale)

    out = []
    start = prims[0][5] if prims[0][0] == "arc" else (prims[0][1] if prims[0][0] == "line" else prims[0][1][0])
    sx, sy = q(start)
    out.append(f"M{fmt(sx)} {fmt(sy)}")
    for pr in prims:
        if pr[0] == "line":
            x, y = q(pr[2])
            out.append(f"L{fmt(x)} {fmt(y)}")
        elif pr[0] == "arc":
            _, c, R, a0, sweep, p0, p1 = pr
            large = 1 if abs(sweep) > np.pi else 0
            sw = 1 if sweep > 0 else 0
            x, y = q(p1)
            out.append(f"A{fmt(R * scale)} {fmt(R * scale)} 0 {large} {sw} {fmt(x)} {fmt(y)}")
        else:
            _, (c0, c1, c2, c3) = pr
            x1, y1 = q(c1)
            x2, y2 = q(c2)
            x3, y3 = q(c3)
            out.append(f"C{fmt(x1)} {fmt(y1)} {fmt(x2)} {fmt(y2)} {fmt(x3)} {fmt(y3)}")
    out.append("Z")
    return "".join(out)


def bbox_of(prims):
    pts = sample_chain(prims, 0.25)
    return (float(pts[:, 0].min()), float(pts[:, 1].min()), float(pts[:, 0].max()), float(pts[:, 1].max()))


def svg_doc(vb, d, fill, opacity=None, title="Voyah"):
    op = f' fill-opacity="{opacity}"' if opacity is not None else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="{title}">'
        f'<path fill="{fill}"{op} d="{d}"/></svg>\n'
    )


def main():
    alpha = np.asarray(Image.open(SRC).convert("RGBA"))[:, :, 3].astype(float) / 255.0
    H, W = alpha.shape
    contours = measure.find_contours(alpha, 0.5)

    # --- разделение знак / лейбл по горизонтальному зазору
    rows = (alpha > 0.5).any(axis=1)
    runs = []
    st = None
    for y in range(H):
        if rows[y] and st is None:
            st = y
        if not rows[y] and st is not None:
            runs.append((st, y - 1))
            st = None
    if st is not None:
        runs.append((st, H - 1))
    # ищем самый широкий пустой зазор между группами строк
    gaps = [(runs[i + 1][0] - runs[i][1] - 1, runs[i][1], runs[i + 1][0]) for i in range(len(runs) - 1)]
    gaps.sort(reverse=True)
    gap_h, below_mark, above_label = gaps[0]
    assert gap_h >= LABEL_GAP_MIN, f"зазор между знаком и лейблом {gap_h} px < {LABEL_GAP_MIN}"
    split_y = below_mark + 1

    items = []
    for c in contours:
        x, y = c[:, 1], c[:, 0]
        items.append({
            "pts": np.column_stack([x, y]),
            "bb": (float(x.min()), float(y.min()), float(x.max()), float(y.max())),
        })
    for it in items:
        it["group"] = "mark" if it["bb"][3] < split_y else "label"

    marks = sorted([i for i in items if i["group"] == "mark"], key=lambda i: i["bb"][0])
    labels = sorted([i for i in items if i["group"] == "label"], key=lambda i: i["bb"][0])
    assert len(marks) == 3, f"контуров знака {len(marks)}, ожидается 3 (2 лопасти + игла)"
    assert len(labels) == 6, f"контуров лейбла {len(labels)}, ожидается 6 (5 глифов + отверстие O)"

    # --- имена
    wide = [m for m in marks if m["bb"][2] - m["bb"][0] >= 70]
    narrow = [m for m in marks if m["bb"][2] - m["bb"][0] < 70]
    assert len(wide) == 2 and len(narrow) == 1, "не 2 лопасти + 1 игла"
    wide[0]["name"], wide[1]["name"] = "blade-left", "blade-right"
    narrow[0]["name"] = "needle"
    hole = None
    for p in labels:
        p["kind"] = "glyph"
    for p in labels:
        for q in labels:
            if q is p:
                continue
            qx0, qy0, qx1, qy1 = q["bb"]
            if p["bb"][0] > qx0 and p["bb"][2] < qx1 and p["bb"][1] > qy0 and p["bb"][3] < qy1:
                p["kind"], p["parent"], hole = "hole", q, p
                break
    glyphs = [p for p in labels if p["kind"] == "glyph"]
    assert len(glyphs) == 5 and hole is not None, "лейбл: не 5 глифов + отверстие"
    for p, nm in zip(glyphs, ["V", "O", "Y", "A", "H"]):
        p["name"] = nm
    hole["name"] = "O-counter"

    mark_order = [narrow[0], wide[0], wide[1]]
    label_order = glyphs + [hole]
    for it in mark_order + label_order:
        it["prims"] = fit_contour(it["pts"])

    # --- плотные рамки (bbox всех контуров + отступ PAD)
    def frame(lst):
        bbs = [bbox_of(it["prims"]) for it in lst]
        x0 = min(b[0] for b in bbs) - PAD
        y0 = min(b[1] for b in bbs) - PAD
        x1 = max(b[2] for b in bbs) + PAD
        y1 = max(b[3] for b in bbs) + PAD
        return x0, y0, x1 - x0, y1 - y0

    mx, my, mw, mh = frame(mark_order)
    lx, ly, lw, lh = frame(label_order)
    ux0, uy0 = min(mx, lx), min(my, ly)
    ux1, uy1 = max(mx + mw, lx + lw), max(my + mh, ly + lh)

    def d_of(lst, ox, oy):
        return "".join(prims_to_d(it["prims"], (ox, oy)) for it in lst)

    def vb(x, y, w, h):
        # Кадр начинается в нуле: координаты контуров отсчитываются от origin
        # группы (prims_to_d вычитает его), поэтому абсолютный viewBox нарисовал
        # бы пустоту. Смещение группы живёт в JSON (frames.*.origin_px).
        return f"0 0 {fmt(w)} {fmt(h)}"

    variants = [
        ("vy-mark", mark_order, (mx, my, mw, mh), "знак Voyah"),
        ("vy-label", label_order, (lx, ly, lw, lh), "лейбл Voyah"),
        ("vy-lockup", mark_order + label_order, (ux0, uy0, ux1 - ux0, uy1 - uy0), "Voyah — знак и лейбл"),
    ]
    written = []
    for base, lst, fr, title in variants:
        ox, oy = fr[0], fr[1]
        d = d_of(lst, ox, oy)
        vbs = vb(*fr)
        written.append((f"{base}.svg", svg_doc(vbs, d, "currentColor", title=title)))
        written.append((f"{base}-light.svg", svg_doc(vbs, d, WHITE, title=title)))
        written.append((f"{base}-dark.svg", svg_doc(vbs, d, INK, title=title)))
        written.append((
            f"{base}-ghost.svg",
            svg_doc(vbs, d, WHITE, opacity=GHOST_OPACITY, title=title),
        ))

    for name, text in written:
        (OUT / name).write_text(text)

    # --- JSON для 3D-экструзии: пиксели эталона + нормализованные 0…1
    def seg_json(pr, ox, oy, w, h):
        def n(v, o, dim):
            return round((v - o) / dim, 6)
        def px(v, o):
            return round(v - o, 3)

        if pr[0] == "line":
            return {
                "type": "line",
                "from": [px(pr[1][0], ox), px(pr[1][1], oy)],
                "to": [px(pr[2][0], ox), px(pr[2][1], oy)],
                "from_n": [n(pr[1][0], ox, w), n(pr[1][1], oy, h)],
                "to_n": [n(pr[2][0], ox, w), n(pr[2][1], oy, h)],
            }
        if pr[0] == "arc":
            _, c, R, a0, sweep, p0, p1 = pr
            return {
                "type": "arc",
                "from": [px(p0[0], ox), px(p0[1], oy)],
                "to": [px(p1[0], ox), px(p1[1], oy)],
                "center": [px(c[0], ox), px(c[1], oy)],
                "radius": round(float(R), 3),
                "radius_n": round(float(R) / max(w, h), 6),
                "sweep_deg": round(float(np.degrees(sweep)), 3),
                "large_arc": bool(abs(sweep) > np.pi),
                "clockwise": bool(sweep > 0),
                "from_n": [n(p0[0], ox, w), n(p0[1], oy, h)],
                "to_n": [n(p1[0], ox, w), n(p1[1], oy, h)],
                "center_n": [n(c[0], ox, w), n(c[1], oy, h)],
            }
        c = pr[1]
        return {
            "type": "cubic",
            "p0": [px(c[0][0], ox), px(c[0][1], oy)],
            "p1": [px(c[1][0], ox), px(c[1][1], oy)],
            "p2": [px(c[2][0], ox), px(c[2][1], oy)],
            "p3": [px(c[3][0], ox), px(c[3][1], oy)],
            "p0_n": [n(c[0][0], ox, w), n(c[0][1], oy, h)],
            "p1_n": [n(c[1][0], ox, w), n(c[1][1], oy, h)],
            "p2_n": [n(c[2][0], ox, w), n(c[2][1], oy, h)],
            "p3_n": [n(c[3][0], ox, w), n(c[3][1], oy, h)],
        }

    paths = []
    for it in mark_order + label_order:
        is_mark = it["group"] == "mark"
        ox, oy = (mx, my) if is_mark else (lx, ly)
        w, h = (mw, mh) if is_mark else (lw, lh)
        paths.append({
            "name": it["name"],
            "group": it["group"],
            "kind": it["kind"] if it["group"] == "label" else ("blade" if "blade" in it["name"] else "needle"),
            "role": "hole" if it["name"] == "O-counter" else "outer",
            "closed": True,
            "frame": {"origin_px": [round(ox, 3), round(oy, 3)], "size_px": [round(w, 3), round(h, 3)]},
            "segments": [seg_json(pr, ox, oy, w, h) for pr in it["prims"]],
        })

    doc = {
        "component": "Voyah — знак (2 лопасти + игла), лейбл 5 глифов и локап",
        "consumer": "агент 3D-экструзии: контуры выдавливаются по z; отверстие O — role=hole",
        "source": {
            "file": "docs/brand/voyah/source/logo-black-on-white.png",
            "sha256": hashlib.sha256(SRC.read_bytes()).hexdigest(),
            "size_px": [W, H],
            "note": "тот же файл, что прежний logo/vy-mark.png (побайтово); site/public/img/vy-mark.png искажён по пропорции и НЕ является источником",
            "contour": "изолиния 50 % альфа-канала (marching squares), сглаживание 0.8 px внутри участков",
        },
        "coordinate_system": {
            "px": "пиксели эталона 1536×864, y вниз; каждый контур дан в своей плотной рамке (frame)",
            "normalized": "те же точки в 0…1 внутри frame: x/W, y/H; y вниз; для экструзии удобнее normalized",
            "svg": "viewBox каждого файла — плотная рамка группы с отступом 0.5 px",
        },
        "frames": {
            "mark": {"origin_px": [round(mx, 3), round(my, 3)], "size_px": [round(mw, 3), round(mh, 3)],
                     "viewBox": vb(mx, my, mw, mh), "aspect": round(mw / mh, 6)},
            "label": {"origin_px": [round(lx, 3), round(ly, 3)], "size_px": [round(lw, 3), round(lh, 3)],
                      "viewBox": vb(lx, ly, lw, lh), "aspect": round(lw / lh, 6)},
            "lockup": {"origin_px": [round(ux0, 3), round(uy0, 3)], "size_px": [round(ux1 - ux0, 3), round(uy1 - uy0, 3)],
                       "viewBox": vb(ux0, uy0, ux1 - ux0, uy1 - uy0), "aspect": round((ux1 - ux0) / (uy1 - uy0), 6)},
        },
        "extrusion": {
            "group_mark": "2 лопасти + игла — отдельная деталь",
            "group_label": "5 глифов контурами, без шрифта",
            "depth_mm_default": 8,
            "depth_mm_unit": "при ширине знака 200 мм",
            "note": "контуры замкнуты и стыкуются конец-в-начало; arc: sweep_deg>0 — по часовой в координатах с y вниз",
        },
        "colors": {
            "currentColor": "vy-mark.svg — инлайн в разметке (в <img> и background-image не работает)",
            "light": "vy-mark-light.svg — #FFFFFF, для <img> и CSS-фонов на тёмном",
            "dark": "vy-mark-dark.svg — #1B1F3C (краска владельца), светлые подложки и печать",
            "ghost": f"vy-mark-ghost.svg — #FFFFFF с fill-opacity {GHOST_OPACITY}, водяные знаки",
        },
        "paths": paths,
    }
    OUT_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")

    # --- сводка
    print(json.dumps({
        "split_y": split_y,
        "gap_px": gap_h,
        "frames": {
            "mark": [round(v, 2) for v in (mx, my, mw, mh)],
            "label": [round(v, 2) for v in (lx, ly, lw, lh)],
            "lockup": [round(v, 2) for v in (ux0, uy0, ux1 - ux0, uy1 - uy0)],
        },
        "aspect": {
            "mark": round(mw / mh, 4),
            "label": round(lw / lh, 4),
            "lockup": round((ux1 - ux0) / (uy1 - uy0), 4),
        },
        "files": len(written),
    }, ensure_ascii=False, indent=1))


def winding_sign(prims):
    area = 0.0
    for pr in prims:
        if pr[0] == "line":
            x0, y0 = pr[1]
            x1, y1 = pr[2]
            area += x0 * y1 - x1 * y0
        elif pr[0] == "arc":
            _, c, R, a0, sweep, p0, p1 = pr
            area += p0[0] * p1[1] - p1[0] * p0[1] + R * R * sweep
        else:
            _, (c0, c1, c2, c3) = pr
            area += c0[0] * c1[1] - c1[0] * c0[1]
            area += c1[0] * c2[1] - c2[0] * c1[1]
            area += c2[0] * c3[1] - c3[0] * c2[1]
    return 1 if area > 0 else -1


if __name__ == "__main__":
    main()
