"""Render an SVG (mask-style, black paths) in brand colours to a PNG for review.
python3 preview.py file.svg out.png [fg] [bg] [width]"""
import sys
from playwright.sync_api import sync_playwright
svg, out = sys.argv[1], sys.argv[2]
fg = sys.argv[3] if len(sys.argv) > 3 else '#C07A42'
bg = sys.argv[4] if len(sys.argv) > 4 else '#130D0A'
w = int(sys.argv[5]) if len(sys.argv) > 5 else 700
src = open(svg).read().replace('<svg ', f'<svg style="width:{w}px;height:auto;display:block;fill:{fg}" ', 1)
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': w + 40, 'height': w + 40})
    pg.set_content(f'<body style="margin:0;padding:20px;background:{bg}">{src}</body>')
    pg.locator('svg').screenshot(path=out)
    b.close()
print('ok', out)
