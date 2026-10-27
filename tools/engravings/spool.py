import math, os, numpy as np
from engrave import Canvas, LIGHT, bezier_path, norm

C = Canvas(600, 600)
cx = 300
RY = 0.27  # ellipse ratio (view slightly from above)


def ell(cy, rx):
    return C.ellipse_mask(cx, cy, rx, rx * RY)


def cyl_tone(r, spec=0.25, amb=0.16):
    n = C.cyl_normals(cx, r)
    return C.tone_from_normals(n, ambient=amb, spec=spec, spec_pow=14)


# ---- cast shadow on the ground (light from the top-left → shadow to the right)
m_shadow = C.ellipse_mask(cx + 150, 466, 205, 40)
C.add(m_shadow, np.clip(0.55 - 0.004 * np.abs(C.X - cx - 40), 0, 1), [dict(kind='parallel', angle=0, spacing=4.6, wmax=1.8, t0=0.05)], outline=0, name='shadow')

# ---- bottom flange (rim + lower edge)
Rf = 138
yb0, yb1 = 432, 452
m_bottom = C.rect_mask(cx - Rf, yb0, cx + Rf, yb1) | ell(yb1, Rf) | ell(yb0, Rf)
t = cyl_tone(Rf, spec=0.15)
C.add(m_bottom, t, [dict(kind='parallel', angle=90, spacing=4.2, wmax=2.3, t0=0.08, floor=0.45)], outline=1.5, name='bottom')
# top face of the bottom flange (visible ring around the core)
m_bface = ell(yb0, Rf)
tface = np.clip(0.18 + 0 * C.X, 0, 1)
C.add(m_bface, tface + 0.12 * ((C.X - cx) / Rf).clip(0, 1), [dict(kind='field', field=((C.X - cx) ** 2 + ((C.Y - yb0) / RY) ** 2) ** 0.5, spacing=9, wmax=1.4, t0=0.05, floor=0.4)], outline=1.2)

# ---- thread core
Rc = 104
yt = 168
m_core = C.rect_mask(cx - Rc, yt, cx + Rc, yb0) | ell(yb0, Rc)
u = np.clip((C.X - cx) / Rc, -0.999, 0.999)
F_wind = C.Y - Rc * RY * np.sqrt(1 - u ** 2)  # front half-ellipses
t_core = cyl_tone(Rc, spec=0.55, amb=0.12)
C.add(m_core, t_core, [
    dict(kind='field', field=F_wind, spacing=3.5, wmax=2.6, t0=0.02, gamma=0.85, cut=0.2, floor=0.55),
    dict(kind='parallel', angle=90, spacing=4.4, wmax=1.3, t0=0.62, where=(C.X > cx + 30)),
], outline=1.3, name='core')

# ---- top flange rim
ytf0, ytf1 = 148, 168
m_trim = C.rect_mask(cx - Rf, ytf0, cx + Rf, ytf1) | ell(ytf1, Rf)
C.add(m_trim, cyl_tone(Rf, spec=0.2), [dict(kind='parallel', angle=90, spacing=4.2, wmax=2.3, t0=0.08, floor=0.45)], outline=1.5, name='toprim')

# ---- top face with wood grain rings and the centre hole
m_top = ell(ytf0, Rf)
r_ell = ((C.X - cx) ** 2 + ((C.Y - ytf0) / RY) ** 2) ** 0.5
t_top = np.clip(0.1 + 0.22 * np.clip((C.X - cx) / Rf, -1, 1) + 0.12 * np.clip((C.Y - ytf0) / (Rf * RY), -1, 1), 0, 1)
grain = r_ell + 3.0 * np.sin(np.arctan2((C.Y - ytf0) / RY, C.X - cx) * 3) * (r_ell / Rf)
C.add(m_top, t_top + 0.15, [dict(kind='field', field=grain, spacing=9.5, wmax=1.6, t0=0.04, floor=0.45)], outline=1.5, name='top')
m_hole = C.ellipse_mask(cx, ytf0, 24, 24 * RY)
C.add(m_hole, np.full_like(C.X, 0.95), [dict(kind='parallel', angle=0, spacing=2.6, wmax=2.2, t0=0.0)], outline=1.2, name='hole')

# ---- loose thread end + needle
thread = bezier_path([(cx + Rc - 4, 360), (cx + Rc + 60, 372), (cx + 150, 470), (cx + 92, 512),
                      (cx + 40, 548), (cx - 70, 520), (cx - 120, 540)], n=80)
C.stroke(thread, 2, taper=False, width_fn=lambda s: 1.6 + 0.8 * np.sin(s * math.pi))

# needle lying diagonally, eye on the left
p0, p1 = np.array([120, 548]), np.array([352, 478])
d = norm(p1 - p0); nrm = np.array([-d[1], d[0]])
L = np.linalg.norm(p1 - p0)
ts = np.linspace(0, 1, 60)
half = 4.6 * np.where(ts > 0.84, (1 - ts) / 0.16, 1.0) ** 0.8 * np.where(ts < 0.04, 0.6 + 10 * ts, 1.0)
half = np.maximum(half, 0.15)
top = p0 + np.outer(ts * L, d) + np.outer(half, nrm)
bot = p0 + np.outer(ts * L, d) - np.outer(half, nrm)
needle_poly = np.vstack([top, bot[::-1]])
m_needle = C.poly_mask([tuple(p) for p in needle_poly])
n_needle, _ = C.inflate_normals(m_needle, 3.0)
C.add(m_needle, C.tone_from_normals(n_needle, ambient=0.1, spec=0.6), [dict(kind='parallel', angle=math.degrees(math.atan2(d[1], d[0])), spacing=2.4, wmax=1.4, t0=0.25)], outline=1.4, name='needle')
# eye of the needle (punched out by drawing it as an outlined slot)
eye_c = p0 + d * 16
eye = [eye_c - d * 8, eye_c + d * 8]
C.stroke([tuple(eye[0]), tuple(eye[1])], 2.2, taper=False)
# thread through the eye
C.stroke(bezier_path([(cx - 120, 540), (cx - 150, 548), (eye_c[0] + 4, eye_c[1] - 10), tuple(eye_c)], n=30), 1.8, taper=False)
C.stroke(bezier_path([tuple(eye_c), (eye_c[0] - 10, eye_c[1] + 14), (eye_c[0] - 26, eye_c[1] + 6), (eye_c[0] - 40, eye_c[1] + 22)], n=30), 1.7)

C.render()
os.makedirs('out', exist_ok=True)
svg = C.svg('Spool of thread')
open('out/spool.svg', 'w').write(svg)
print('ribbons', len(C.ribbons), 'bytes', len(svg))
