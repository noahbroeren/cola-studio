"""Thimble with dimples, standing, plus two buttons and a pin beside it."""
import math, os, numpy as np
from engrave import Canvas, bezier_path

W, H = 520, 520
C = Canvas(W, H)
X, Y = C.X, C.Y
cx = 230
RY = 0.3
top_y, bot_y = 150, 380
r_top, r_bot = 72, 92


def radius_at(y):
    t = np.clip((y - top_y) / (bot_y - top_y), 0, 1)
    return r_top + (r_bot - r_top) * t


# ---- ground shadow
m_sh = C.ellipse_mask(cx + 70, bot_y + 14, 150, 30)
C.add(m_sh, np.full_like(X, 0.4), [dict(kind='parallel', angle=0, spacing=4.4, wmax=1.5, t0=0.08)], outline=0)

# ---- body: tapered cylinder + dome
R = radius_at(Y)
m_body = (np.abs(X - cx) <= R) & (Y >= top_y) & (Y <= bot_y)
m_body |= C.ellipse_mask(cx, bot_y, r_bot, r_bot * RY)
dome = C.ellipse_mask(cx, top_y, r_top, r_top * 0.62) & (Y <= top_y + 1)
m_body |= dome
u = np.clip((X - cx) / np.maximum(R, 1), -0.999, 0.999)
nz = np.sqrt(1 - u ** 2)
n = np.dstack([u * 0.97, np.full_like(u, -0.08), nz])
# dome normals
du = np.clip((X - cx) / r_top, -0.999, 0.999)
dv = np.clip((Y - top_y) / (r_top * 0.62), -0.999, 0)
dz = np.sqrt(np.clip(1 - du ** 2 - dv ** 2, 0, 1))
dome_n = np.dstack([du, dv, dz])
n = np.where(dome[..., None], dome_n, n)
n /= np.linalg.norm(n, axis=2, keepdims=True)
tone = C.tone_from_normals(n, ambient=0.12, spec=0.6, spec_pow=20)
band = (Y > bot_y - 34)
F = Y - (R * RY) * np.sqrt(1 - u ** 2)
C.add(m_body, tone, [
    dict(kind='field', field=F, spacing=3.6, wmax=2.2, t0=0.05, floor=0.3, where=band),
    dict(kind='parallel', angle=90, spacing=3.4, wmax=2.0, t0=0.12, floor=0.3, where=~band),
], outline=1.7, name='body')

# ---- dimples: rows of small dots following the surface
rows = 11
for i in range(rows):
    y = top_y - 34 + i * 19
    if y > bot_y - 44:
        break
    if y < top_y:  # on the dome: fewer dimples
        rr = r_top * math.sqrt(max(0.0, 1 - ((top_y - y) / (r_top * 0.62)) ** 2))
    else:
        rr = float(radius_at(y))
    k = max(4, int(rr / 7))
    for j in range(-k, k + 1):
        a = j / (k + 0.5) * (math.pi / 2) * 0.96 + (0.5 / (k + 0.5) * (math.pi / 2) if i % 2 else 0)
        if abs(a) > math.pi / 2 * 0.97:
            continue
        x = cx + rr * math.sin(a)
        yy = y + rr * RY * math.cos(a) * (1 if y >= top_y else 0.6)
        light = max(0.0, -math.sin(a) * 0.55 + 0.5)
        size = 3.1 * math.cos(a) ** 0.6
        C.dot(x, yy, size * (0.55 + 0.45 * (1 - light)) * 0.75)

# ---- buttons
for (bx, by, br) in [(395, 412, 34), (318, 440, 24)]:
    m_b = C.ellipse_mask(bx, by, br, br * 0.55)
    n_b, _ = C.inflate_normals(m_b, br * 0.35)
    C.add(m_b, C.tone_from_normals(n_b, ambient=0.25, spec=0.4) * 0.9, [dict(kind='contour', spacing=3.0, wmax=1.5, t0=0.08, floor=0.35)], outline=1.6)
    for dx, dy in [(-0.22, -0.2), (0.22, -0.2), (-0.22, 0.2), (0.22, 0.2)]:
        C.dot(bx + dx * br, by + dy * br * 0.55, br * 0.075)

# ---- a pin
C.stroke([(120, 470), (300, 400)], 1.5, width_fn=lambda s: 1.6 - 1.2 * s ** 6)
m_head = C.ellipse_mask(116, 472, 9, 9)
n_h, _ = C.inflate_normals(m_head, 7)
C.add(m_head, C.tone_from_normals(n_h, ambient=0.2, spec=0.8), [dict(kind='contour', spacing=2.0, wmax=1.2, t0=0.1, floor=0.3)], outline=1.3)

C.render()
os.makedirs('out', exist_ok=True)
svg = C.svg('Thimble and buttons')
open('out/thimble.svg', 'w').write(svg)
print('ribbons', len(C.ribbons), 'bytes', len(svg))
