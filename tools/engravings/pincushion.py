"""Tomato pincushion with pins."""
import math, os, numpy as np
from engrave import Canvas, bezier_path

W, H = 520, 460
C = Canvas(W, H)
X, Y = C.X, C.Y
cx, cy, rx, ry = 250, 270, 150, 112

# shadow
m_sh = C.ellipse_mask(cx + 60, cy + ry - 6, 170, 30)
C.add(m_sh, np.full_like(X, 0.4), [dict(kind='parallel', angle=0, spacing=4.4, wmax=1.5, t0=0.08)], outline=0)

# body: squashed sphere
m_b = C.ellipse_mask(cx, cy, rx, ry)
u = np.clip((X - cx) / rx, -1, 1)
v = np.clip((Y - cy) / ry, -1, 1)
nz = np.sqrt(np.clip(1 - u ** 2 - v ** 2, 0, 1))
n = np.dstack([u, v, nz])
n /= np.linalg.norm(n, axis=2, keepdims=True)
tone = C.tone_from_normals(n, ambient=0.12, spec=0.35, spec_pow=12)
# meridian-like hatching: lines of constant "longitude" seen from slightly above
lon = np.arctan2(u, np.maximum(nz, 0.02))
lat = np.arcsin(np.clip(v, -1, 1))
# segment grooves darken the surface between lobes
seg = np.cos(lon * 3.2) ** 2
tone2 = np.clip(tone + 0.18 * (1 - seg), 0, 1)
C.add(m_b, tone2, [
    dict(kind='field', field=lon * 100, spacing=5.2, wmax=2.3, t0=0.05, floor=0.3),
    dict(kind='field', field=lat * 100, spacing=6.0, wmax=1.2, t0=0.55),
], outline=1.9, name='body')
# grooves
for k in range(-3, 4):
    a = k * math.pi / 6.4
    pts = []
    for t in np.linspace(-1.35, 1.2, 60):
        x = cx + rx * math.sin(a) * math.cos(t)
        y = cy - ry * 0.92 * math.sin(t) * 0.98 + 18 * math.cos(t) * (1 - abs(math.sin(a)))
        pts.append((x, y))
    if abs(a) < math.pi / 2:
        C.stroke(pts, 1.6)

# leaf cap on top
cap = []
for i in range(10):
    a = i * 2 * math.pi / 10
    r = 46 if i % 2 == 0 else 16
    cap.append((cx + r * math.cos(a), cy - ry + 26 + r * 0.36 * math.sin(a)))
m_cap = C.poly_mask(cap)
C.add(m_cap, np.full_like(X, 0.55), [dict(kind='parallel', angle=60, spacing=2.6, wmax=1.3, t0=0.1)], outline=1.5)
m_stem = C.rect_mask(cx - 4, cy - ry + 4, cx + 4, cy - ry + 26)
C.add(m_stem, np.full_like(X, 0.6), [dict(kind='parallel', angle=90, spacing=2.2, wmax=1.2, t0=0.1)], outline=1.3)

# pins with round heads
pins = [((cx - 60, cy - 60), (-38, -128)), ((cx + 30, cy - 70), (14, -140)), ((cx + 90, cy - 30), (70, -110)),
        ((cx - 110, cy - 10), (-96, -70)), ((cx + 60, cy + 10), (110, -60)), ((cx - 20, cy - 20), (-10, -110))]
for (bx, by), (dx, dy) in pins:
    hx, hy = bx + dx * 0.9, by + dy * 0.9
    C.stroke([(bx, by), (hx, hy)], 1.4, taper=False)
    m_h = C.ellipse_mask(hx, hy, 8.5, 8.5)
    n_h = np.dstack([np.clip((X - hx) / 8.5, -1, 1), np.clip((Y - hy) / 8.5, -1, 1), np.sqrt(np.clip(1 - ((X - hx) / 8.5) ** 2 - ((Y - hy) / 8.5) ** 2, 0, 1))])
    C.add(m_h, C.tone_from_normals(n_h, ambient=0.15, spec=0.8), [dict(kind='contour', spacing=2.0, wmax=1.3, t0=0.06, floor=0.3)], outline=1.3)

C.render()
os.makedirs('out', exist_ok=True)
svg = C.svg('Pincushion')
open('out/pincushion.svg', 'w').write(svg)
print('ribbons', len(C.ribbons), 'bytes', len(svg))
