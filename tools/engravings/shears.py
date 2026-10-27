"""Tailor's shears, slightly open, lying diagonally."""
import math, os, numpy as np
from scipy import ndimage
from engrave import Canvas, bezier_path

W, H = 760, 460
C = Canvas(W, H)
X, Y = C.X, C.Y
ROT = math.radians(-16)
OX, OY = 330, 250  # pivot position on the canvas


def tr(pts, rot=ROT, ox=OX, oy=OY):
    pts = np.asarray(pts, float)
    c, s = math.cos(rot), math.sin(rot)
    return np.column_stack([ox + pts[:, 0] * c - pts[:, 1] * s, oy + pts[:, 0] * s + pts[:, 1] * c])


def ellipse_pts(cx, cy, rx, ry, rot=0.0, n=120):
    a = np.linspace(0, 2 * math.pi, n, endpoint=False)
    x, y = rx * np.cos(a), ry * np.sin(a)
    c, s = math.cos(rot), math.sin(rot)
    return np.column_stack([cx + x * c - y * s, cy + x * s + y * c])


def blade(length, w0, w1, open_deg, dy):
    xs = np.linspace(-6, length, 80)
    half = np.interp(xs, [-6, 26, 70, length * 0.55, length * 0.92, length], [w0 * 0.85, w1, w1 * 0.97, w1 * 0.62, 5.0, 1.0])
    top = np.column_stack([xs, dy - half * 0.55])
    bot = np.column_stack([xs, dy + half * 0.45])
    pts = np.vstack([top, bot[::-1]])
    a = math.radians(open_deg)
    c, s = math.cos(a), math.sin(a)
    return np.column_stack([pts[:, 0] * c - pts[:, 1] * s, pts[:, 0] * s + pts[:, 1] * c])


def blade_tone(poly_local, open_deg, dy):
    """Steel: bright streak along the blade, darker bevel at the cutting edge."""
    a = ROT + math.radians(open_deg)
    c, s = math.cos(a), math.sin(a)
    lx = (X - OX) * c + (Y - OY) * s
    ly = -(X - OX) * s + (Y - OY) * c - dy
    v = np.clip(ly / 20, -1, 1)
    t = 0.48 + 0.42 * np.clip(v, 0, 1) ** 0.8 - 0.42 * np.exp(-((v + 0.3) / 0.22) ** 2)
    t += 0.1 * np.clip((lx - 220) / 180, 0, 1)
    return np.clip(t, 0, 1), math.degrees(a)


def handle(shank_ctrl, loop, thick):
    """Shank (bezier) + oval finger loop, as a mask."""
    sh = tr(bezier_path(shank_ctrl, n=40))
    m = C.stroke_mask([tuple(p) for p in sh], thick)
    cx, cy, rx, ry, rr = loop
    outer = tr(ellipse_pts(cx, cy, rx, ry, rr))
    inner = tr(ellipse_pts(cx, cy, rx - thick * 0.95, ry - thick * 0.95, rr))
    ring = C.poly_mask([tuple(p) for p in outer]) & ~C.poly_mask([tuple(p) for p in inner])
    hole = C.poly_mask([tuple(p) for p in inner])
    return (m | ring) & ~hole


# ------------------------------------------------------------------ cast shadow
sh_poly = tr(np.vstack([blade(400, 30, 34, 3, 16), ellipse_pts(-120, 40, 70, 46)]), ox=OX + 16, oy=OY + 22)
m_sh = ndimage.binary_dilation(C.poly_mask([tuple(p) for p in tr(blade(400, 30, 34, 3, 14), ox=OX + 18, oy=OY + 24)]), iterations=8)
m_sh |= ndimage.binary_dilation(C.poly_mask([tuple(p) for p in tr(ellipse_pts(-118, 52, 64, 40), ox=OX + 14, oy=OY + 20)]), iterations=6)
C.add(m_sh, np.full_like(X, 0.3), [dict(kind='parallel', angle=0, spacing=5.0, wmax=1.2, t0=0.1)], outline=0, name='shadow')

# ------------------------------------------------------------------ lower blade + lower (thumb) handle
lb = blade(380, 34, 40, 2.6, 9)
m_lb = C.poly_mask([tuple(p) for p in tr(lb)])
t_lb, a_lb = blade_tone(lb, 2.6, 9)
C.add(m_lb, t_lb + 0.08, [dict(kind='parallel', angle=a_lb, spacing=3.2, wmax=2.3, t0=0.05, floor=0.4)], outline=1.8, name='lowerblade')

m_lh = handle([(-4, 12), (-40, 20), (-62, 38), (-88, 46)], (-118, 54, 46, 30, math.radians(8)), 15)
n_lh, _ = C.inflate_normals(m_lh, 7.5)
C.add(m_lh, C.tone_from_normals(n_lh, ambient=0.14, spec=0.5) + 0.12, [dict(kind='contour', spacing=3.0, wmax=1.8, t0=0.06, floor=0.35)], outline=1.8, name='lowerhandle')

# ------------------------------------------------------------------ upper blade + upper (bow) handle with the tailor's bend
ub = blade(392, 36, 42, -1.0, -7)
m_ub = C.poly_mask([tuple(p) for p in tr(ub)])
t_ub, a_ub = blade_tone(ub, -1.0, -7)
C.add(m_ub, t_ub, [dict(kind='parallel', angle=a_ub, spacing=3.2, wmax=2.3, t0=0.05, floor=0.4)], outline=1.9, name='upperblade')

m_uh = handle([(-4, -10), (-46, -22), (-72, -46), (-110, -52)], (-158, -48, 64, 36, math.radians(-6)), 16)
n_uh, _ = C.inflate_normals(m_uh, 8)
C.add(m_uh, C.tone_from_normals(n_uh, ambient=0.14, spec=0.55) + 0.06, [dict(kind='contour', spacing=3.0, wmax=1.8, t0=0.06, floor=0.35)], outline=1.9, name='upperhandle')

# ------------------------------------------------------------------ pivot screw
px, py = tr([[6, 0]])[0]
m_pv = C.ellipse_mask(px, py, 12, 12)
n_pv, _ = C.inflate_normals(m_pv, 6)
C.add(m_pv, C.tone_from_normals(n_pv, ambient=0.2, spec=0.6), [dict(kind='contour', spacing=2.2, wmax=1.2, t0=0.08, floor=0.3)], outline=1.6, name='pivot')
a = ROT + 0.9
C.stroke([(px - 7 * math.cos(a), py - 7 * math.sin(a)), (px + 7 * math.cos(a), py + 7 * math.sin(a))], 2.0, taper=False)

C.render()
os.makedirs('out', exist_ok=True)
svg = C.svg("Tailor's shears")
open('out/shears.svg', 'w').write(svg)
print('ribbons', len(C.ribbons), 'bytes', len(svg))
