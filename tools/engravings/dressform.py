"""Tailor's dress form on a tripod stand, with a tape measure draped round the neck."""
import math, os, numpy as np
from scipy import ndimage
from engrave import Canvas, bezier_path

W, H = 520, 760
C = Canvas(W, H)
X, Y = C.X, C.Y
cx = 260

# ---- shadow on the floor
m_sh = C.ellipse_mask(cx + 60, 706, 170, 26)
C.add(m_sh, np.full_like(X, 0.4), [dict(kind='parallel', angle=0, spacing=4.6, wmax=1.6, t0=0.08)], outline=0)

# ---- tripod legs + pole
legs = [[(cx, 600), (cx - 40, 640), (cx - 110, 690), (cx - 150, 702)],
        [(cx, 600), (cx + 40, 640), (cx + 120, 688), (cx + 160, 700)],
        [(cx, 600), (cx + 6, 640), (cx + 14, 690), (cx + 18, 716)]]
for i, ctrl in enumerate(legs):
    pts = bezier_path(ctrl, n=40)
    m = C.stroke_mask([tuple(p) for p in pts], 11 if i < 2 else 12)
    n_l, _ = C.inflate_normals(m, 5)
    C.add(m, C.tone_from_normals(n_l, ambient=0.15, spec=0.5) + 0.1, [dict(kind='contour', spacing=2.4, wmax=1.4, t0=0.06, floor=0.3)], outline=1.5)
for (fx, fy) in [(cx - 152, 704), (cx + 162, 702), (cx + 18, 718)]:
    m = C.ellipse_mask(fx, fy, 10, 6)
    C.add(m, np.full_like(X, 0.7), [dict(kind='parallel', angle=0, spacing=2.2, wmax=1.3, t0=0.1)], outline=1.3)
m_pole = C.rect_mask(cx - 7, 470, cx + 7, 606)
C.add(m_pole, C.tone_from_normals(C.cyl_normals(cx, 7), ambient=0.15, spec=0.6), [dict(kind='parallel', angle=90, spacing=2.6, wmax=1.6, t0=0.1, floor=0.3)], outline=1.5)
m_collar = C.rect_mask(cx - 16, 560, cx + 16, 578) | C.ellipse_mask(cx, 578, 16, 5)
C.add(m_collar, C.tone_from_normals(C.cyl_normals(cx, 16), ambient=0.15, spec=0.5), [dict(kind='parallel', angle=90, spacing=2.6, wmax=1.6, t0=0.1, floor=0.3)], outline=1.4)

# ---- torso silhouette (bust, waist, hips)
right = [(cx, 96), (cx + 34, 96), (cx + 44, 104), (cx + 48, 118),          # neck
         (cx + 60, 130), (cx + 108, 132), (cx + 128, 152),                  # shoulder
         (cx + 138, 172), (cx + 130, 206), (cx + 132, 236),                  # armhole down to bust
         (cx + 136, 266), (cx + 128, 300), (cx + 104, 330),                  # under bust to waist
         (cx + 92, 346), (cx + 92, 372), (cx + 108, 404),                    # waist to hip
         (cx + 124, 432), (cx + 128, 462), (cx + 118, 484),                  # hip
         (cx + 108, 494), (cx + 60, 500), (cx, 500)]                         # bottom edge
pts_r = bezier_path(right, n=30)
pts_l = pts_r[::-1].copy()
pts_l[:, 0] = 2 * cx - pts_l[:, 0]
torso = np.vstack([pts_r, pts_l])
m_torso = C.poly_mask([tuple(p) for p in torso])
n_t, d_t = C.inflate_normals(m_torso, 70)
t_torso = C.tone_from_normals(n_t, ambient=0.14, spec=0.35, spec_pow=10)
C.add(m_torso, t_torso, [
    dict(kind='field', field=ndimage.gaussian_filter(d_t, 9), spacing=4.2, wmax=2.4, t0=0.06, floor=0.3, offset=1.5),
    dict(kind='parallel', angle=-50, spacing=4.6, wmax=1.2, t0=0.6),
], outline=1.9, name='torso')

# princess seams + centre front seam (stitched)
for side in (-1, 1):
    seam = bezier_path([(cx + side * 70, 132), (cx + side * 66, 220), (cx + side * 46, 300),
                        (cx + side * 44, 350), (cx + side * 50, 420), (cx + side * 58, 470), (cx + side * 60, 498)], n=60)
    C.stroke(seam, 1.3, taper=False)
cf = np.column_stack([np.full(80, cx), np.linspace(118, 498, 80)])
for i in range(0, 76, 4):
    C.stroke(cf[i:i + 2], 1.4, taper=False)

# ---- neck cap with knob
m_cap = C.ellipse_mask(cx, 96, 36, 9)
C.add(m_cap, np.full_like(X, 0.35), [dict(kind='field', field=np.hypot(X - cx, (Y - 96) / 0.25), spacing=5, wmax=1.2, t0=0.05, floor=0.35)], outline=1.5)
m_knob = C.ellipse_mask(cx, 82, 11, 11)
n_k, _ = C.inflate_normals(m_knob, 8)
C.add(m_knob, C.tone_from_normals(n_k, ambient=0.2, spec=0.7), [dict(kind='contour', spacing=2.2, wmax=1.2, t0=0.08, floor=0.3)], outline=1.4)

# ---- tape measure draped around the neck, hanging down both sides
tape_w = 15


def tape(ctrl, flip_at=None):
    c = bezier_path(ctrl, n=60)
    t = np.gradient(c, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    nrm = np.column_stack([-t[:, 1], t[:, 0]])
    s = np.linspace(0, 1, len(c))
    twist = np.ones_like(s) if flip_at is None else np.cos(np.clip((s - flip_at) * 6, -math.pi / 2, math.pi / 2) * 1.0) * 0.75 + 0.25
    half = tape_w / 2 * np.abs(twist)
    left, rightp = c + nrm * half[:, None], c - nrm * half[:, None]
    poly = np.vstack([left, rightp[::-1]])
    m = C.poly_mask([tuple(p) for p in poly])
    # flat ribbon: light, with a little shading where it turns
    tone = np.full_like(X, 0.12)
    C.add(m, tone, [dict(kind='parallel', angle=0, spacing=6, wmax=0.6, t0=0.0, floor=0.0)], outline=1.4)
    # tick marks across the tape
    L = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(c, axis=0), axis=1))])
    k = 0
    for d in np.arange(4, L[-1] - 2, 4.2):
        i = int(np.searchsorted(L, d))
        i = min(i, len(c) - 1)
        long = (k % 5 == 0)
        ln = (0.85 if long else 0.45) * half[i]
        p0 = c[i] + nrm[i] * half[i]
        p1 = p0 - nrm[i] * ln * 2 * (0.9 if long else 0.6)
        C.stroke([tuple(p0), tuple(p1)], 0.9 if long else 0.65, taper=False)
        k += 1


tape([(cx - 40, 112), (cx - 70, 130), (cx - 96, 210), (cx - 92, 300), (cx - 88, 360), (cx - 104, 400), (cx - 100, 452)], flip_at=0.62)
tape([(cx + 40, 112), (cx + 70, 128), (cx + 90, 200), (cx + 84, 270), (cx + 80, 318), (cx + 94, 352), (cx + 90, 392)], flip_at=0.55)
tape([(cx - 42, 113), (cx - 20, 124), (cx + 20, 124), (cx + 42, 113)])

C.render()
os.makedirs('out', exist_ok=True)
svg = C.svg('Dress form with tape measure')
open('out/dressform.svg', 'w').write(svg)
print('ribbons', len(C.ribbons), 'bytes', len(svg))
