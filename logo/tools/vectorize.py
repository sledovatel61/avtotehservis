#!/usr/bin/env python3
"""Векторизация знака и лейбла Voyah из файла владельца.

Вход : logo/vy-mark.png  (Voyah_Logo-1536x864.png из папки владельца в Google Drive)
Выход: logo/vy-logo.svg, logo/vy-mark.svg, logo/vy-mark-paths.json

Как работает
------------
1. Из альфа-канала берётся изолиния 50 % покрытия (marching squares) — «настоящий»
   контур знака с субпиксельной точностью.
2. Контур передискретизируется с шагом 0.5 px и слегка сглаживается вдоль
   длины (гаусс, SIGMA px) — это убирает «лестницу» пиксельной сетки.
3. По скачку направления находятся углы; угол уточняется пересечением прямых,
   подогнанных к участкам слева и справа (иначе острые концы лопастей и иглы
   срезаются на пиксель).
4. Каждый участок между углами приближается по очереди отрезком, дугой
   окружности (через три точки — концы и середину, поэтому дуга проходит точно
   через оба угла) или кубической Безье. Между примитивами нет разрывов.
5. Пишется компактный path M/L/A/C/Z без <text>: лейбл — контурами.

Запуск: python3 logo/tools/vectorize.py
"""
import hashlib
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image
from skimage import measure

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "logo" / "vy-mark.png"
OUT_LOGO = ROOT / "logo" / "vy-logo.svg"
OUT_MARK = ROOT / "logo" / "vy-mark.svg"
OUT_JSON = ROOT / "logo" / "vy-mark-paths.json"

TOL_PX = float(os.environ.get("VY_TOL", "1.0"))      # допуск приближения участка, px
SIGMA = float(os.environ.get("VY_SIGMA", "0.8"))     # сглаживание вдоль контура, px
CORNER_RAD = float(os.environ.get("VY_CORNER", "0.60"))
CORNER_W = float(os.environ.get("VY_CORNER_W", "5.0"))
DEC = int(os.environ.get("VY_DEC", "1"))
STEP = 0.5
FILL = "#1B1F3C"          # цвет знака в файле владельца: rgb(27, 31, 60)
ORIGIN = (366.0, 50.0)    # SVG = pастр - ORIGIN, рамка 804 x 765
MARK_BOX = (441.0, 622.0)  # рамка только знака
LABEL_TOP = 700.0

# ------------------------------------------------------------------ утилиты


def resample(pts, step=STEP, closed=True):
    src = np.vstack([pts, pts[:1]]) if closed else pts
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
        col = pts[:, c]
        # циклическая свёртка: контур замкнут
        padded = np.concatenate([col[-half:], col, col[:half]])
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
    """Отклонение точек от отрезка a-b (вдоль и поперёк)."""
    v = b - a
    L = np.linalg.norm(v)
    if L < 1e-9:
        return np.inf, np.inf
    nv = np.array([-v[1], v[0]]) / L
    perp = np.abs((pts - a) @ nv)
    proj = (pts - a) @ (v / L)
    outside = max(0.0, -proj.min(), proj.max() - L)
    return float(perp.max()), float(outside)


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


def fit_piece(pts, t1, t2, out, depth=0):
    """Участок -> отрезок | дуга | кубическая Безье; если не выходит — делим."""
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


# ------------------------------------------------------------- дуги окружностей


def circle3(a, m, b):
    """Окружность через три точки."""
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
    r = float(np.hypot(ax - ux, ay - uy))
    return np.array([ux, uy]), r


def try_arc(pts, tol):
    """Дуга через концы участка и самую удалённую от хорды точку."""
    a, b = pts[0], pts[-1]
    v = b - a
    L = np.linalg.norm(v)
    if L < 1e-6:
        return None
    nv = np.array([-v[1], v[0]]) / L
    dist = (pts - a) @ nv
    k = int(np.argmax(np.abs(dist)))
    if abs(dist[k]) < 2 * tol:      # почти прямая — дуга не нужна
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
    # направление обхода определяем по средней точке
    if ((am - a0) % (2 * np.pi)) > sweep:
        sweep -= 2 * np.pi
    arc = ("arc", c, float(R), float(a0), float(sweep), a, b)
    # обратная проверка: точки самой дуги должны лежать на исходном контуре,
    # иначе дуга уходит «не туда» (например, длинной стороной окружности)
    ts = np.linspace(0.02, 0.98, 24)
    samples = np.array([c + R * np.array([np.cos(a0 + sweep * t), np.sin(a0 + sweep * t)]) for t in ts])
    d = np.min(np.linalg.norm(samples[:, None, :] - pts[None, :, :], axis=2), axis=1)
    if float(d.max()) > tol:
        return None
    return arc


def sample_chain(prims, step=0.4):
    """Плотная выборка точек по цепочке примитивов (как её увидит рендерер)."""
    out = []
    for pr in prims:
        if pr[0] == "line":
            a, b = pr[1], pr[2]
            n = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
            out.extend(a + (b - a) * (k / n) for k in range(n + 1))
        elif pr[0] == "arc":
            _, c, R, a0, sweep, _p0, _p1 = pr
            n = max(4, int(np.ceil(abs(sweep) * R / step)))
            out.extend(c + R * np.array([np.cos(a0 + sweep * k / n), np.sin(a0 + sweep * k / n)])
                       for k in range(n + 1))
        else:
            c = pr[1]
            n = max(6, int(np.ceil(np.linalg.norm(c[3] - c[0]) / step)) + 4)
            out.extend(bez(c, np.linspace(0, 1, n + 1)[:, None]))
    return np.array(out)


def chain_dev(pts, prims):
    """Максимальное расстояние от точек исходного контура до готовой цепочки примитивов."""
    if not prims:
        return np.inf
    ch = sample_chain(prims)
    d = np.min(np.linalg.norm(ch[None, :, :] - pts[:, None, :], axis=2), axis=1)
    return float(d.max())


def fit_span(seg, t1, t2, depth=0):
    """Подгонка участка с проверкой цепочки целиком и локальным ремонтом."""
    prims = []
    ar = try_arc(seg, TOL_PX)
    if ar is not None:
        prims = [ar]
    else:
        fit_piece(seg, t1, t2, prims)
    if chain_dev(seg, prims) <= TOL_PX or depth >= 5 or len(seg) < 12:
        return prims
    # делим участок в точке наибольшего отклонения и подгоняем половины
    ch = sample_chain(prims)
    d = np.min(np.linalg.norm(ch[None, :, :] - seg[:, None, :], axis=2), axis=1)
    at = int(np.argmax(d))
    at = max(3, min(len(seg) - 4, at))
    return fit_span(seg[: at + 1], t1, t1, depth + 1) + fit_span(seg[at:], t2, t2, depth + 1)


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
    """Углы в нескольких масштабах: и острые пики, и скруглённые переходы."""
    n = len(pts)
    hot = np.zeros(n, dtype=bool)
    for win_px, thresh in ((1.5, CORNER_RAD), (4.0, CORNER_RAD * 0.8), (8.0, CORNER_RAD * 0.6)):
        k = max(2, int(round(win_px / STEP)))
        hot |= turn_angles(pts, k) > thresh
    if not hot.any():
        return []
    k = max(2, int(round(CORNER_W / STEP)))
    idx = np.where(hot)[0]
    groups = [[int(idx[0])]
    ]
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
    """Уточняем угол пересечением прямых по участкам слева и справа."""
    n = len(pts)
    m = max(3, int(round(span_px / STEP)))
    gap = max(2, int(round(1.5 / STEP)))
    left = np.array([pts[(i - gap - t) % n] for t in range(m)])
    right = np.array([pts[(i + gap + t) % n] for t in range(m)])

    def fit_dir(p):
        c = p.mean(0)
        u, s, vt = np.linalg.svd(p - c)
        if s[0] <= 0 or s[1] / s[0] > 0.08:   # участок не прямой
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
    if np.hypot(*(p - pts[i])) > 1.0:   # угол уточняем, но не «вытягиваем»
        return pts[i]
    return p


def fit_contour(raw):
    """Контур -> примитивы: сначала углы на «сырых» точках, потом сглаживание внутри участков."""
    base = resample(raw, STEP)                 # без сглаживания: углы не съедаются
    soft = smooth_closed(base, 0.6)            # лёгкое сглаживание только для поиска углов
    corners = detect_corners(soft)
    if not corners:
        far = int(np.argmax(np.linalg.norm(soft - soft[0], axis=1)))
        corners = sorted({0, far // 2})

    # рабочий массив: сглаженный, но рядом с углами возвращаем «сырые» точки —
    # иначе сглаживание скругляет острые концы лопастей и иглы
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
    return prims, work


# ------------------------------------------------------------------ вывод


def fmt(v):
    s = f"{v:.{DEC}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def arc_end(pr):
    _, c, R, a0, sweep, _a, _b = pr
    return c + R * np.array([np.cos(a0 + sweep), np.sin(a0 + sweep)])


def prims_to_d(prims, origin):
    out = []
    start = prims[0][1] if prims[0][0] != "cubic" else prims[0][1][0]
    if prims[0][0] == "arc":
        start = prims[0][5]
    out.append(f"M{fmt(start[0]-origin[0])} {fmt(start[1]-origin[1])}")
    for pr in prims:
        if pr[0] == "line":
            q = pr[2]
            out.append(f"L{fmt(q[0]-origin[0])} {fmt(q[1]-origin[1])}")
        elif pr[0] == "arc":
            _, c, R, a0, sweep, p0, p1 = pr
            large = 1 if abs(sweep) > np.pi else 0
            sw = 1 if sweep > 0 else 0
            out.append(
                f"A{fmt(R)} {fmt(R)} 0 {large} {sw} {fmt(p1[0]-origin[0])} {fmt(p1[1]-origin[1])}"
            )
        else:
            _, (c0, c1, c2, c3) = pr
            out.append(
                "C{0} {1} {2} {3} {4} {5}".format(
                    fmt(c1[0] - origin[0]), fmt(c1[1] - origin[1]),
                    fmt(c2[0] - origin[0]), fmt(c2[1] - origin[1]),
                    fmt(c3[0] - origin[0]), fmt(c3[1] - origin[1]),
                )
            )
    out.append("Z")
    return "".join(out)


def write_svg(path, d, viewbox, fill=FILL):
    path.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" role="img" '
        f'aria-label="Voyah"><path fill="{fill}" d="{d}"/></svg>\n'
    )


def main():
    alpha = np.asarray(Image.open(SRC).convert("RGBA"))[:, :, 3].astype(float) / 255.0
    items = []
    for c in measure.find_contours(alpha, 0.5):
        x, y = c[:, 1], c[:, 0]
        items.append({
            "pts": np.column_stack([x, y]),
            "bb": (float(x.min()), float(y.min()), float(x.max()), float(y.max())),
        })
    for it in items:
        x0, y0, x1, y1 = it["bb"]
        if y0 > LABEL_TOP:
            it["kind"] = "label"
        elif (x1 - x0) < 70:
            it["kind"] = "needle"
        else:
            it["kind"] = "blade"

    blades = sorted([i for i in items if i["kind"] == "blade"], key=lambda i: i["bb"][0])
    needles = [i for i in items if i["kind"] == "needle"]
    labels = [i for i in items if i["kind"] == "label"]
    assert len(blades) == 2 and len(needles) == 1, "структура знака не распознана"

    hole = None
    for p in labels:
        x0, y0, x1, y1 = p["bb"]
        for q in labels:
            if q is p:
                continue
            qx0, qy0, qx1, qy1 = q["bb"]
            if x0 > qx0 and x1 < qx1 and y0 > qy0 and y1 < qy1:
                p["kind"], p["parent"], hole = "hole", q, p
                break
    glyphs = sorted([p for p in labels if p["kind"] == "label"], key=lambda p: p["bb"][0])
    assert len(glyphs) == 5 and hole is not None, "лейбл не распознан"

    blades[0]["name"] = "blade-left"
    blades[1]["name"] = "blade-right"
    needles[0]["name"] = "needle"
    for p, nm in zip(glyphs, ["V", "O", "Y", "A", "H"]):
        p["name"] = nm
    hole["name"] = "O-counter"

    order = [needles[0], blades[0], blades[1]] + glyphs + [hole]
    for it in order:
        it["prims"], _ = fit_contour(it["pts"])
    # marching squares уже даёт у отверстия противоположный обход: для nonzero
    # этого достаточно, разворачивать не нужно (проверено растеризацией)
    if winding_sign(hole["prims"]) == winding_sign(hole["parent"]["prims"]):
        hole["prims"] = [reverse_prim(p) for p in reversed(hole["prims"])]

    mark_items = [it for it in order if it["kind"] in ("blade", "needle")]
    label_items = [it for it in order if it["kind"] in ("label", "hole")]

    d_of = lambda lst: "".join(prims_to_d(it["prims"], ORIGIN) for it in lst)
    d_all = d_of(mark_items + label_items)
    d_mark = d_of(mark_items)

    write_svg(OUT_LOGO, d_all, "0 0 804 765")
    write_svg(OUT_MARK, d_mark, f"0 0 {fmt(MARK_BOX[0])} {fmt(MARK_BOX[1])}")

    # ---- JSON для 3D-экструзии
    jp = []
    for it in order:
        segs = []
        for pr in it["prims"]:
            if pr[0] == "line":
                segs.append({
                    "type": "line",
                    "from": [rs(pr[1][0] - ORIGIN[0]), rs(pr[1][1] - ORIGIN[1])],
                    "to": [rs(pr[2][0] - ORIGIN[0]), rs(pr[2][1] - ORIGIN[1])],
                })
            elif pr[0] == "arc":
                _, c, R, a0, sweep, p0, p1 = pr
                segs.append({
                    "type": "arc",
                    "from": [rs(p0[0] - ORIGIN[0]), rs(p0[1] - ORIGIN[1])],
                    "to": [rs(p1[0] - ORIGIN[0]), rs(p1[1] - ORIGIN[1])],
                    "center": [rs(c[0] - ORIGIN[0]), rs(c[1] - ORIGIN[1])],
                    "radius": round(float(R), 3),
                    "sweep_deg": round(float(np.degrees(sweep)), 3),
                    "large_arc": bool(abs(sweep) > np.pi),
                    "clockwise": bool(sweep > 0),
                })
            else:
                c = pr[1]
                segs.append({
                    "type": "cubic",
                    "p0": [rs(c[0][0] - ORIGIN[0]), rs(c[0][1] - ORIGIN[1])],
                    "p1": [rs(c[1][0] - ORIGIN[0]), rs(c[1][1] - ORIGIN[1])],
                    "p2": [rs(c[2][0] - ORIGIN[0]), rs(c[2][1] - ORIGIN[1])],
                    "p3": [rs(c[3][0] - ORIGIN[0]), rs(c[3][1] - ORIGIN[1])],
                })
        is_mark = it["kind"] in ("blade", "needle")
        jp.append({
            "name": it["name"],
            "group": "mark" if is_mark else "label",
            "kind": it["kind"],
            "role": "hole" if it["name"] == "O-counter" else "outer",
            "closed": True,
            "segments": segs,
        })

    doc = {
        "component": "Voyah — знак (2 лопасти + игла) и лейбл контурами",
        "consumer": "агент 3D-экструзии: контуры выдавливаются по z, отверстие O — role=hole",
        "source": {
            "file": "logo/vy-mark.png",
            "origin": "Google Drive владельца: Voyah_Logo-1536x864.png",
            "sha256": hashlib.sha256(SRC.read_bytes()).hexdigest(),
            "contour": "изолиния 50 % альфа-канала (marching squares), сглаживание 1.2 px",
        },
        "coordinate_system": {
            "y_axis": "вниз (как в SVG)",
            "unit": "пиксель растра vy-mark.png 1536x864",
            "to_svg": "p_svg = p_rastr - (366, 50)",
            "viewBox": "0 0 804 765",
            "mark_viewBox": "0 0 441 622",
            "fill_rule": "nonzero; у O-counter обратный обход",
        },
        "extrusion": {
            "group_mark": "2 лопасти + игла — отдельная деталь",
            "group_label": "5 глифов контурами, без шрифта",
            "depth_mm_default": 8,
            "depth_mm_unit": "при ширине знака 200 мм",
            "note": "контуры замкнуты и стыкуются конец-в-начало; arc: sweep_deg>0 — по часовой в координатах с y вниз",
        },
        "paths": jp,
    }
    OUT_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")

    print(json.dumps(
        {it["name"]: "".join("l" if p[0] == "line" else "a" if p[0] == "arc" else "c" for p in it["prims"])
         for it in order},
        ensure_ascii=False,
    ))


def winding_sign(prims):
    """Знак площади (направление обхода) замкнутого контура."""
    area = 0.0
    for pr in prims:
        if pr[0] == "line":
            x0, y0 = pr[1]
            x1, y1 = pr[2]
            area += x0 * y1 - x1 * y0
        elif pr[0] == "arc":
            _, c, R, a0, sweep, p0, p1 = pr
            area += p0[0] * p1[1] - p1[0] * p0[1] + R * R * sweep
            area += (c[1] - p1[1]) * (p0[0] - c[0]) - (c[0] - p1[0]) * (p0[1] - c[1])
        else:
            _, (c0, c1, c2, c3) = pr
            area += c0[0] * c1[1] - c1[0] * c0[1]
            area += c1[0] * c2[1] - c2[0] * c1[1]
            area += c2[0] * c3[1] - c3[0] * c2[1]
    return 1 if area > 0 else -1


def reverse_prim(pr):
    if pr[0] == "line":
        return ("line", pr[2], pr[1])
    if pr[0] == "arc":
        _, c, R, a0, sweep, p0, p1 = pr
        return ("arc", c, R, a0 + sweep, -sweep, p1, p0)
    _, (c0, c1, c2, c3) = pr
    return ("cubic", (c3, c2, c1, c0))


def rs(v):
    """Координата в системе SVG (JSON всегда в системе SVG, y вниз)."""
    return round(float(v), 3)


if __name__ == "__main__":
    main()
