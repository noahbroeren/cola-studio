"""
Tiny engraving engine: turns shaded shapes into swelling-line hatching (like
19th-century engravings) and writes compact single-colour SVG.

Coordinates are in viewBox units; internally everything is rasterised at S×.
"""
import math
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import measure

S = 2  # supersampling factor


def norm(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


LIGHT = norm([-0.55, -0.62, 0.56])  # from the top-left, slightly in front (y points down)


class Canvas:
    def __init__(self, w, h):
        self.vw, self.vh = w, h
        self.W, self.H = int(w * S), int(h * S)
        yy, xx = np.mgrid[0:self.H, 0:self.W]
        self.X = (xx + 0.5) / S  # viewBox coords of pixel centres
        self.Y = (yy + 0.5) / S
        self.parts = []
        self.ribbons = []  # list of polygons (Nx2 arrays, viewBox units)
        self.solids = []   # filled shapes that keep their own winding (letters, logos)
        self.occluders = np.zeros((self.H, self.W), bool)

    # ------------------------------------------------------------ masks
    def blank(self):
        return Image.new('L', (self.W, self.H), 0)

    def poly_mask(self, pts):
        im = self.blank()
        ImageDraw.Draw(im).polygon([(x * S, y * S) for x, y in pts], fill=255)
        return np.array(im) > 127

    def ellipse_mask(self, cx, cy, rx, ry):
        im = self.blank()
        ImageDraw.Draw(im).ellipse([(cx - rx) * S, (cy - ry) * S, (cx + rx) * S, (cy + ry) * S], fill=255)
        return np.array(im) > 127

    def rect_mask(self, x0, y0, x1, y1):
        return (self.X >= x0) & (self.X <= x1) & (self.Y >= y0) & (self.Y <= y1)

    def stroke_mask(self, pts, width):
        im = self.blank()
        d = ImageDraw.Draw(im)
        d.line([(x * S, y * S) for x, y in pts], fill=255, width=max(1, int(round(width * S))), joint='curve')
        r = width * S / 2
        for x, y in (pts[0], pts[-1]):
            d.ellipse([x * S - r, y * S - r, x * S + r, y * S + r], fill=255)
        return np.array(im) > 127

    # ------------------------------------------------------------ shading
    def inflate_normals(self, mask, radius):
        """Pillow-like normals from the distance to the silhouette (rounded edges of `radius`)."""
        d = ndimage.distance_transform_edt(mask) / S
        t = np.clip(d / radius, 0, 1)
        h = radius * np.sqrt(np.clip(1 - (1 - t) ** 2, 0, 1))
        h = ndimage.gaussian_filter(h, 1.2)
        gy, gx = np.gradient(h, 1 / S)
        n = np.dstack([-gx, -gy, np.ones_like(h)])
        n /= np.linalg.norm(n, axis=2, keepdims=True)
        return n, d

    def cyl_normals(self, cx, r, axis='v', cy=None):
        """Normals of a cylinder with a vertical (or horizontal) axis."""
        if axis == 'v':
            u = np.clip((self.X - cx) / r, -0.999, 0.999)
            n = np.dstack([u, np.zeros_like(u), np.sqrt(1 - u ** 2)])
        else:
            u = np.clip((self.Y - cy) / r, -0.999, 0.999)
            n = np.dstack([np.zeros_like(u), u, np.sqrt(1 - u ** 2)])
        return n

    def flat_normals(self, nx=0.0, ny=0.0):
        n = norm([nx, ny, 1])
        return np.broadcast_to(n, (self.H, self.W, 3)).copy()

    @staticmethod
    def tone_from_normals(n, ambient=0.18, spec=0.0, spec_pow=18, light=LIGHT, gamma=1.0):
        diff = np.clip(n @ light, 0, 1)
        lit = ambient + (1 - ambient) * diff
        if spec:
            h = norm(light + np.array([0, 0, 1]))
            lit = lit + spec * np.clip(n @ h, 0, 1) ** spec_pow
        t = np.clip(1 - lit, 0, 1)
        return t ** gamma

    # ------------------------------------------------------------ parts
    def add(self, mask, tone, hatches, outline=1.0, name=''):
        """Register a part (drawn in order; later parts cover earlier ones)."""
        self.parts.append(dict(mask=mask, tone=tone, hatches=hatches, outline=outline, name=name))

    def render(self):
        n = len(self.parts)
        above = [np.zeros((self.H, self.W), bool) for _ in range(n)]
        acc = np.zeros((self.H, self.W), bool)
        for i in range(n - 1, -1, -1):
            above[i] = acc.copy()
            acc |= self.parts[i]['mask']
        for i, p in enumerate(self.parts):
            vis = p['mask'] & ~above[i]
            # a little ambient occlusion where higher parts sit on this one
            occ = ndimage.gaussian_filter(above[i].astype(float), 6 * S) * p['mask']
            tone = np.clip(p['tone'] + 0.55 * occ, 0, 1)
            for h in p['hatches']:
                self._hatch(vis, tone, **h)
            if p['outline']:
                self._outline(p['mask'], above[i], tone, p['outline'])

    # ------------------------------------------------------------ hatching
    def _hatch(self, vis, tone, kind='parallel', angle=0.0, spacing=3.0, wmax=1.6, t0=0.12, gamma=1.0,
               field=None, cut=0.22, step=2.6, offset=0.0, where=None, floor=0.0):
        if where is not None:
            vis = vis & where
        if not vis.any():
            return
        if kind == 'parallel':
            a = math.radians(angle)
            F = self.X * math.sin(a) - self.Y * math.cos(a)  # constant along direction `angle`
        elif kind == 'contour':
            F = ndimage.distance_transform_edt(vis) / S
        elif kind == 'field':
            F = field
        else:
            raise ValueError(kind)
        Fm = np.where(vis, F, np.nan)
        lo, hi = np.nanmin(Fm), np.nanmax(Fm)
        start = math.floor((lo - offset) / spacing) * spacing + offset + (spacing / 2 if kind == 'contour' else 0)
        levels = np.arange(start, hi, spacing)
        Fpad = np.where(vis, F, np.nanmax(Fm) + 10 * spacing)  # keep contours inside
        for lev in levels:
            if lev <= lo:
                continue
            for c in measure.find_contours(Fpad, lev, mask=vis):
                pts = np.column_stack([(c[:, 1] + 0.5) / S, (c[:, 0] + 0.5) / S])
                self._ribbon_from_line(pts, tone, wmax, t0, gamma, cut, step, floor=floor)

    def _sample_tone(self, tone, pts):
        xs = np.clip(pts[:, 0] * S - 0.5, 0, self.W - 1)
        ys = np.clip(pts[:, 1] * S - 0.5, 0, self.H - 1)
        return ndimage.map_coordinates(tone, [ys, xs], order=1)

    def _ribbon_from_line(self, pts, tone, wmax, t0, gamma, cut, step, widths=None, floor=0.0):
        pts = resample(pts, step)
        if len(pts) < 2:
            return
        if widths is None:
            t = self._sample_tone(tone, pts)
            w = np.clip((t - t0) / max(1e-6, 1 - t0), 0, 1) ** gamma * wmax
            if floor:
                w = np.maximum(w, floor)
        else:
            w = widths(pts)
        on = w >= cut
        # split into runs
        idx = np.flatnonzero(np.diff(np.concatenate([[0], on.astype(int), [0]])))
        for a, b in zip(idx[::2], idx[1::2]):
            if b - a < 2:
                continue
            seg, ws = pts[a:b], w[a:b].copy()
            k = min(3, (b - a) // 2)
            ramp = np.linspace(0.35, 1, k + 1)[1:] if k else []
            if k:
                ws[:k] *= ramp
                ws[-k:] *= ramp[::-1]
            self.ribbons.append(ribbon(seg, ws))

    def _outline(self, mask, above, tone, weight):
        m = ndimage.binary_closing(mask, iterations=1)
        for c in measure.find_contours(m.astype(float), 0.5):
            pts = np.column_stack([(c[:, 1] + 0.5) / S, (c[:, 0] + 0.5) / S])
            pts = resample(pts, 1.8)
            if len(pts) < 3:
                continue
            xs = np.clip((pts[:, 0] * S).astype(int), 0, self.W - 1)
            ys = np.clip((pts[:, 1] * S).astype(int), 0, self.H - 1)
            hidden = ndimage.binary_dilation(above, iterations=2)[ys, xs]
            t = self._sample_tone(ndimage.gaussian_filter(tone, 3), pts)
            w = (0.55 + 0.9 * t) * weight
            w[hidden] = 0
            on = w > 0.05
            idx = np.flatnonzero(np.diff(np.concatenate([[0], on.astype(int), [0]])))
            for a, b in zip(idx[::2], idx[1::2]):
                if b - a >= 2:
                    self.ribbons.append(ribbon(pts[a:b], w[a:b]))

    # ------------------------------------------------------------ explicit strokes
    def stroke(self, pts, width, taper=True, width_fn=None):
        pts = resample(np.asarray(pts, float), 1.6)
        if len(pts) < 2:
            return
        if width_fn is not None:
            w = width_fn(np.linspace(0, 1, len(pts)))
        else:
            w = np.full(len(pts), float(width))
            if taper:
                k = min(4, len(pts) // 3)
                if k:
                    r = np.linspace(0.3, 1, k)
                    w[:k] *= r
                    w[-k:] *= r[::-1]
        self.ribbons.append(ribbon(pts, w))

    def image_mask(self, path, x, y, w, h, threshold=128, invert=True):
        """Mask from a raster image (dark pixels = inside), placed at x,y with size w×h."""
        im = Image.open(path).convert('L').resize((int(w * S), int(h * S)), Image.LANCZOS)
        a = np.array(im)
        a = a < threshold if invert else a >= threshold
        m = np.zeros((self.H, self.W), bool)
        x0, y0 = int(x * S), int(y * S)
        hh, ww = a.shape
        ys, xs = slice(max(0, y0), min(self.H, y0 + hh)), slice(max(0, x0), min(self.W, x0 + ww))
        m[ys, xs] = a[ys.start - y0:ys.stop - y0, xs.start - x0:xs.stop - x0]
        return m

    def text_mask(self, text, x, y, size, font, tracking=0.0, angle=0.0):
        """Rasterised text mask (font file path) with the baseline-left at x,y."""
        from PIL import ImageFont
        f = ImageFont.truetype(font, int(size * S))
        im = self.blank()
        d = ImageDraw.Draw(im)
        cur = x * S
        for ch in text:
            d.text((cur, y * S), ch, font=f, fill=255, anchor='ls')
            cur += d.textlength(ch, font=f) + tracking * size * S
        if angle:
            im = im.rotate(-angle, center=(x * S, y * S), resample=Image.BICUBIC)
        return np.array(im) > 127

    def solid(self, mask, smooth=0.6):
        """Fill a mask exactly (contours become filled polygons; holes stay open)."""
        m = ndimage.gaussian_filter(mask.astype(float), smooth)
        for c in measure.find_contours(m, 0.5):
            pts = np.column_stack([(c[:, 1] + 0.5) / S, (c[:, 0] + 0.5) / S])
            pts = rdp(pts, 0.06)
            if len(pts) >= 3:
                self.solids.append(pts)

    def dot(self, x, y, r):
        a = np.linspace(0, 2 * math.pi, 10, endpoint=False)
        self.ribbons.append(np.column_stack([x + r * np.cos(a), y + r * np.sin(a)]))

    # ------------------------------------------------------------ output
    def svg(self, title=''):
        parts = []
        for poly in self.ribbons:
            if len(poly) < 3:
                continue
            # same winding for every stroke, so crossing hatches never cancel out (nonzero fill)
            area = np.sum(poly[:-1, 0] * poly[1:, 1] - poly[1:, 0] * poly[:-1, 1])
            parts.append(path_d(poly if area >= 0 else poly[::-1]))
        # solids: outer contours one way, holes the other (skimage orientation) — with
        # nonzero that leaves the holes open
        for poly in self.solids:
            area = np.sum(poly[:-1, 0] * poly[1:, 1] - poly[1:, 0] * poly[:-1, 1])
            parts.append(path_d(poly))
        d = ''.join(parts)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.vw} {self.vh}">'
                + (f'<title>{title}</title>' if title else '')
                + f'<path d="{d}"/></svg>')


# ---------------------------------------------------------------- geometry helpers
def resample(pts, step):
    pts = np.asarray(pts, float)
    if len(pts) < 2:
        return pts
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    L = np.concatenate([[0], np.cumsum(seg)])
    if L[-1] < step:
        return pts[[0, -1]]
    n = max(2, int(round(L[-1] / step)) + 1)
    s = np.linspace(0, L[-1], n)
    return np.column_stack([np.interp(s, L, pts[:, 0]), np.interp(s, L, pts[:, 1])])


def rdp(pts, eps):
    """Ramer–Douglas–Peucker simplification (iterative)."""
    n = len(pts)
    if n < 3:
        return pts
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, q = pts[a], pts[b]
        seg = pts[a + 1:b]
        d = q - p
        L = np.hypot(*d)
        if L == 0:
            dist = np.hypot(*(seg - p).T)
        else:
            dist = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / L
        i = int(np.argmax(dist))
        if dist[i] > eps:
            m = a + 1 + i
            keep[m] = True
            stack.append((a, m))
            stack.append((m, b))
    return pts[keep]


SIMPLIFY = 0.09


def ribbon(pts, w):
    pts = np.asarray(pts, float)
    t = np.gradient(pts, axis=0)
    ln = np.linalg.norm(t, axis=1, keepdims=True)
    ln[ln == 0] = 1
    t /= ln
    nrm = np.column_stack([-t[:, 1], t[:, 0]])
    half = (np.asarray(w)[:, None]) / 2
    left = rdp(pts + nrm * half, SIMPLIFY)
    right = rdp(pts - nrm * half, SIMPLIFY)
    return np.vstack([left, right[::-1]])


def fmt(v):
    s = f'{v:.1f}'
    if s.endswith('.0'):
        s = s[:-2]
    if s.startswith('0.'):
        s = s[1:]
    elif s.startswith('-0.'):
        s = '-' + s[2:]
    return s


def path_d(poly):
    # relative coordinates keep the file small
    q = np.round(poly * 10).astype(int)
    out = [f'M{fmt(q[0,0]/10)} {fmt(q[0,1]/10)}']
    prev = q[0]
    rel = []
    for p in q[1:]:
        dx, dy = p - prev
        if dx == 0 and dy == 0:
            continue
        rel.append(f'{fmt(dx/10)} {fmt(dy/10)}'.replace(' -', '-'))
        prev = p
    if not rel:
        return ''
    s = 'l' + ' '.join(rel)
    s = s.replace(' -', '-')
    return out[0] + s + 'z'


def bezier(p0, p1, p2, p3, n=60):
    t = np.linspace(0, 1, n)[:, None]
    p0, p1, p2, p3 = map(np.array, (p0, p1, p2, p3))
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3


def bezier_path(points, n=40):
    """Chain of cubic segments: [p0, c1, c2, p1, c3, c4, p2, ...]."""
    out = []
    for i in range(0, len(points) - 3, 3):
        seg = bezier(points[i], points[i + 1], points[i + 2], points[i + 3], n)
        out.append(seg if not out else seg[1:])
    return np.vstack(out)
