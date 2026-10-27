"""Vintage sewing machine, three-quarter side view (needle head left, hand wheel right)."""
import math, os, numpy as np
from scipy import ndimage
from engrave import Canvas, bezier_path, norm, LIGHT

W, H = 900, 640
C = Canvas(W, H)
X, Y = C.X, C.Y


def T(n, amb=0.16, spec=0.0, sp=16):
    return C.tone_from_normals(n, ambient=amb, spec=spec, spec_pow=sp)


# ------------------------------------------------------------------ ground shadow
m_sh = C.ellipse_mask(540, 508, 360, 30)
C.add(m_sh, np.clip(0.5 - 0.0016 * np.abs(X - 600), 0, 1), [dict(kind='parallel', angle=0, spacing=4.8, wmax=1.6, t0=0.12)], outline=0)

# ------------------------------------------------------------------ bed (cast base): top face + front face
bed_top = [(96, 452), (812, 452), (860, 418), (150, 418)]
bed_front = [(96, 452), (812, 452), (812, 494), (96, 494)]
bed_side = [(812, 452), (860, 418), (860, 458), (812, 494)]
m_front = C.poly_mask(bed_front)
yy = np.clip((Y - 452) / 42, 0, 1)
t_front = np.clip(0.42 + 0.35 * yy + 0.1 * np.clip((X - 600) / 300, 0, 1), 0, 1)
C.add(m_front, t_front, [dict(kind='parallel', angle=0, spacing=4.2, wmax=2.2, t0=0.1, floor=0.4)], outline=1.6, name='bedfront')
m_side = C.poly_mask(bed_side)
C.add(m_side, np.full_like(X, 0.8), [dict(kind='parallel', angle=-55, spacing=4.0, wmax=2.2, t0=0.1)], outline=1.6, name='bedside')
m_top = C.poly_mask(bed_top)
t_top = np.clip(0.12 + 0.18 * np.clip((X - 300) / 560, 0, 1), 0, 1)
C.add(m_top, t_top, [dict(kind='parallel', angle=-35, spacing=7.0, wmax=1.2, t0=0.05, floor=0.35)], outline=1.6, name='bedtop')

# needle plate + slide plate (flat inlays on the bed)
m_plate = C.poly_mask([(190, 446), (330, 446), (350, 428), (214, 428)])
C.add(m_plate, np.full_like(X, 0.3), [dict(kind='parallel', angle=0, spacing=3.2, wmax=1.0, t0=0.05, floor=0.35)], outline=1.3, name='plate')

# ------------------------------------------------------------------ fabric piece on the bed with a seam
cloth = bezier_path([(120, 448), (150, 436), (190, 431), (240, 433), (300, 435), (350, 436), (400, 440),
                     (420, 445), (430, 452), (434, 458), (300, 460), (200, 458), (160, 456), (130, 454), (120, 448)], n=40)
m_cloth = C.poly_mask([tuple(p) for p in cloth])
n_cloth, _ = C.inflate_normals(m_cloth, 5)
C.add(m_cloth, T(n_cloth, amb=0.25) * 0.8 + 0.1, [dict(kind='parallel', angle=8, spacing=3.2, wmax=1.3, t0=0.05, floor=0.35)], outline=1.4, name='cloth')

# ------------------------------------------------------------------ pillar (right) + arm + head, as one cast body
body = bezier_path([
    (612, 422), (618, 360), (626, 300), (640, 268),      # pillar left edge up
    (630, 262), (560, 268), (330, 270),                   # arm underside going left
    (300, 270), (296, 276), (296, 300),                   # into head
    (296, 300), (296, 320), (296, 336), (290, 342),       # head right edge down
    (270, 346), (210, 346), (192, 340),                   # head bottom
    (186, 330), (184, 260), (186, 196),                   # head left edge up
    (188, 168), (206, 150), (240, 148),                   # head top-left round
    (330, 146), (520, 156), (640, 168),                   # arm top
    (700, 172), (732, 196), (736, 236),                   # shoulder round into pillar right
    (738, 300), (740, 380), (746, 422),                   # pillar right edge down
    (700, 428), (650, 428), (612, 422),                   # foot of the pillar
], n=50)
m_body = C.poly_mask([tuple(p) for p in body])
n_body, d_body = C.inflate_normals(m_body, 34)
t_body = T(n_body, amb=0.12, spec=0.55, sp=22)
FONT_B = '/home/claude/cola-studio/public/assets/fonts/Poppins-Bold.ttf'
m_decal = C.text_mask('COLA', 392, 232, 38, FONT_B, tracking=0.28, angle=-1.6)
keep = ~ndimage.binary_dilation(m_decal, iterations=int(3 * 2))
# medallion badge on the pillar front
mx, my, mr = 680, 318, 26
m_med = C.ellipse_mask(mx, my, mr, mr * 1.08)
keep &= ~ndimage.binary_dilation(m_med, iterations=4)
C.add(m_body, t_body, [
    dict(kind='field', field=ndimage.gaussian_filter(d_body, 5), spacing=4.1, wmax=2.5, t0=0.05, floor=0.32, offset=2.0, where=keep),
    dict(kind='parallel', angle=-48, spacing=4.8, wmax=1.3, t0=0.62, where=keep),  # cross-hatch in deep shadow
], outline=1.9, name='body')

# face plate on the head (slightly raised oval)
m_face = C.ellipse_mask(240, 250, 34, 74)
n_face, _ = C.inflate_normals(m_face, 14)
C.add(m_face, T(n_face, amb=0.2, spec=0.4) * 0.85, [dict(kind='contour', spacing=4.2, wmax=1.5, t0=0.08, floor=0.3)], outline=1.4, name='face')

# ------------------------------------------------------------------ needle bar, presser bar, foot, needle
m_nbar = C.rect_mask(226, 340, 236, 398)
C.add(m_nbar, C.tone_from_normals(C.cyl_normals(231, 5), ambient=0.2, spec=0.5), [dict(kind='parallel', angle=90, spacing=2.4, wmax=1.2, t0=0.3)], outline=1.2)
m_pbar = C.rect_mask(252, 340, 260, 404)
C.add(m_pbar, C.tone_from_normals(C.cyl_normals(256, 4), ambient=0.2, spec=0.5), [dict(kind='parallel', angle=90, spacing=2.4, wmax=1.2, t0=0.3)], outline=1.2)
m_clamp = C.rect_mask(222, 392, 240, 402)
C.add(m_clamp, np.full_like(X, 0.6), [dict(kind='parallel', angle=0, spacing=2.4, wmax=1.2, t0=0.1)], outline=1.2)
foot = [(240, 404), (270, 404), (276, 414), (282, 426), (236, 426), (240, 414)]
m_foot = C.poly_mask(foot)
C.add(m_foot, np.clip(0.3 + 0.4 * ((X - 236) / 46), 0, 1), [dict(kind='parallel', angle=0, spacing=2.6, wmax=1.3, t0=0.1, floor=0.3)], outline=1.3)
C.stroke([(231, 402), (231, 428)], 1.6, taper=False)  # needle
C.stroke([(231, 428), (231, 432)], 1.0)

# ------------------------------------------------------------------ thread tension discs on the head front
m_disc = C.ellipse_mask(212, 205, 9, 15)
C.add(m_disc, np.full_like(X, 0.5), [dict(kind='contour', spacing=2.4, wmax=1.1, t0=0.1)], outline=1.2)
C.dot(212, 205, 2.2)

# ------------------------------------------------------------------ hand wheel (three-quarter view)
wcx, wcy, wrx, wry = 780, 236, 34, 84
m_wheel_back = C.ellipse_mask(wcx + 9, wcy, wrx, wry)
C.add(m_wheel_back, np.full_like(X, 0.85), [dict(kind='parallel', angle=90, spacing=3.4, wmax=2.0, t0=0.1)], outline=1.6, name='wheelrim')
m_wheel = C.ellipse_mask(wcx, wcy, wrx, wry)
m_hub_hole = C.ellipse_mask(wcx, wcy, wrx - 9, wry - 14)
m_rim = m_wheel & ~m_hub_hole
ang = np.arctan2((Y - wcy) / wry, (X - wcx) / wrx)
t_rim = np.clip(0.25 + 0.35 * np.sin(ang + 0.7), 0, 1)
r_e = np.sqrt(((X - wcx) / wrx) ** 2 + ((Y - wcy) / wry) ** 2)
C.add(m_rim, t_rim, [dict(kind='field', field=r_e * 100, spacing=2.6, wmax=1.6, t0=0.05, floor=0.35)], outline=1.6, name='rim')
# spokes + hub
spokes = np.zeros_like(m_wheel)
for k in range(6):
    a0 = k * math.pi / 3 + 0.25
    p_in = (wcx + wrx * 0.14 * math.cos(a0), wcy + wry * 0.14 * math.sin(a0))
    p_out = (wcx + wrx * 0.8 * math.cos(a0), wcy + wry * 0.8 * math.sin(a0))
    spokes |= C.stroke_mask([p_in, p_out], 6)
spokes &= m_hub_hole
C.add(spokes, np.clip(0.35 + 0.4 * ((X - wcx) / wrx), 0, 1), [dict(kind='parallel', angle=90, spacing=2.2, wmax=1.2, t0=0.05, floor=0.3)], outline=1.2, name='spokes')
m_hub = C.ellipse_mask(wcx, wcy, 9, 18)
C.add(m_hub, np.clip(0.3 + 0.5 * ((X - wcx + 9) / 18), 0, 1), [dict(kind='contour', spacing=2.4, wmax=1.2, t0=0.1, floor=0.3)], outline=1.4, name='hub')

# ------------------------------------------------------------------ bobbin winder on top of the pillar
m_bw = C.ellipse_mask(676, 168, 13, 8)
C.add(m_bw, np.full_like(X, 0.55), [dict(kind='contour', spacing=2.4, wmax=1.2, t0=0.1)], outline=1.3)
C.stroke([(676, 168), (676, 152)], 2.4, taper=False)

# ------------------------------------------------------------------ spool on the spool pin
sx, sy = 520, 118
C.stroke([(sx, 152), (sx, 96)], 2.2, taper=False)
m_sp = C.rect_mask(sx - 20, sy - 14, sx + 20, sy + 22) | C.ellipse_mask(sx, sy + 22, 20, 5)
u = np.clip((X - sx) / 20, -0.999, 0.999)
C.add(m_sp, C.tone_from_normals(C.cyl_normals(sx, 20), ambient=0.12, spec=0.5), [dict(kind='field', field=Y - 5 * np.sqrt(1 - u ** 2), spacing=2.4, wmax=1.6, t0=0.02, floor=0.4)], outline=1.3, name='spool')
for yv in (sy - 14, sy + 22):
    m_fl = C.ellipse_mask(sx, yv, 25, 6.5)
    C.add(m_fl, np.full_like(X, 0.35), [dict(kind='field', field=np.sqrt((X - sx) ** 2 + ((Y - yv) / 0.26) ** 2), spacing=5, wmax=1.0, t0=0.05, floor=0.35)], outline=1.3)

# ------------------------------------------------------------------ thread path: spool → guides → tension → needle
thread = bezier_path([(sx + 20, sy + 4), (430, 128), (300, 150), (226, 160),
                      (205, 168), (200, 190), (212, 205),
                      (220, 222), (226, 300), (230, 360),
                      (231, 380), (231, 398), (231, 402)], n=40)
C.stroke(thread, 1.25, taper=False)

# ------------------------------------------------------------------ gilt decal + pinstripes + medallion
C.solid(m_decal)
C.stroke(bezier_path([(318, 252), (400, 258), (520, 258), (622, 246)], n=50), 1.3, taper=False)
C.stroke(bezier_path([(318, 170), (420, 164), (530, 168), (626, 182)], n=50), 1.1, taper=False)
m_med_ring = m_med & ~C.ellipse_mask(mx, my, mr - 4, (mr - 4) * 1.08)
C.solid(m_med_ring)
m_mono = C.image_mask('mono.png', mx - 17, my - 18, 34, 36)
C.solid(m_mono)

# stitched seam on the cloth (dashes)
seam = bezier_path([(128, 451), (200, 444), (300, 446), (420, 452)], n=120)
for i in range(0, len(seam) - 6, 9):
    C.stroke(seam[i:i + 5], 1.5, taper=False)

C.render()
os.makedirs('out', exist_ok=True)
svg = C.svg('Vintage sewing machine')
open('out/machine.svg', 'w').write(svg)
print('ribbons', len(C.ribbons), 'bytes', len(svg))
