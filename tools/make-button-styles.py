#!/usr/bin/env python3
"""Generate the 72x72 button background PNGs for the Companion presets and write src/styles.js.

Control-surface look: a chamfered glass panel per key (dark gradient tinted in the family hue, faint
scanlines, inner shadow, glossy top highlight), a thin bezel and HUD corner brackets in the family
color, and a slim glowing accent line at the top centre. Lit feedback states (Preview green, Program
red, selected amber, frozen blue) fill the panel with the state color and add a neon edge glow; the
family accent line stays so the button is still recognisable when lit. Rendered at 4x, downsampled.

    python3 tools/make-button-styles.py [--png-dir DIR]

Needs Pillow (pip install pillow). Re-run after changing a color; the output is deterministic.
"""
import base64, io, json, os, sys
from PIL import Image, ImageDraw, ImageFilter

S = 72          # Stream Deck key size, Companion's base button size
SS = 4          # supersampling for smooth edges

def hx(s): s = s.lstrip('#'); return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))
def mix(a, b, t): return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

# family: (gradient top, gradient bottom, accent)
FAMILIES = {
    'preset':   ('#2c3e5a', '#10161f', '#3d8bff'),   # preset tile recall: steel blue
    'master':   ('#3d2a5c', '#140e1f', '#a46bff'),   # Master memories: violet
    'dest':     ('#1d4a4c', '#0a1718', '#1fd1c1'),   # screen / aux destination select: teal
    'take':     ('#f01c1c', '#8c0000', '#ffd0d0'),   # TAKE: bold red
    'cut':      ('#5c0d0d', '#1f0303', '#ff3b30'),   # CUT: dark red, red strip
    'auto':     ('#3b3420', '#141108', '#ffb000'),   # AUTO TAKE: dark, amber strip
    'tally':    ('#3a3d42', '#16181b', '#b8bec6'),   # input tally: neutral grey
    'freeze':   ('#1a3350', '#08111c', '#7fd6ff'),   # input freeze: ice blue
    'backup':   ('#4d3112', '#1a0f04', '#ff8a1f'),   # backups: orange
    'audio':    ('#47183f', '#170714', '#ff4fd0'),   # audio mute: magenta
    'status':   ('#1c1c1c', '#050505', '#6b6b6b'),   # status / display buttons: black
    'utility':  ('#34383d', '#15171a', '#ffffff'),   # refresh and other utilities: grey, white strip
}
# active states: (gradient top, gradient bottom, border/glow)
STATES = {
    'pvw':    ('#19c25a', '#06642a', '#8dffb8'),     # Preview: green
    'pgm':    ('#ee2222', '#7a0000', '#ff9a9a'),     # Program: red
    'sel':    ('#ffbf2e', '#c27400', '#fff1b8'),     # selected / armed: amber (black text)
    'frozen': ('#2f7cf0', '#0d3591', '#bfe6ff'),     # frozen: blue
    'muted':  ('#ee2222', '#7a0000', '#ffb0e8'),     # audio muted: red with a magenta-ish glow
}

W = S * SS
CH = 7          # chamfer (cut corner) size, px at 72
IN = 1          # panel inset from the key edge, px at 72

def u(v): return round(v * SS)  # 72-scale -> render scale

def chamfer_poly(inset, ch):
    a, b, c = u(inset), W - 1 - u(inset), u(ch)
    return [(a + c, a), (b - c, a), (b, a + c), (b, b - c), (b - c, b), (a + c, b), (a, b - c), (a, a + c)]

def mask_of(poly, blur=0):
    m = Image.new('L', (W, W), 0); ImageDraw.Draw(m).polygon(poly, fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur)) if blur else m

def layer(im, color, m, alpha=1.0):
    if alpha != 1.0: m = m.point(lambda v: round(v * alpha))
    over = Image.new('RGBA', (W, W), color + (0,)); over.putalpha(m)
    return Image.alpha_composite(im, over)

def gradient(top, bottom):
    g = Image.new('RGBA', (W, W)); d = ImageDraw.Draw(g)
    for y in range(W): d.line([(0, y), (W, y)], fill=mix(top, bottom, y / (W - 1)) + (255,))
    return g

def outline_mask(poly, width):
    m = Image.new('L', (W, W), 0); ImageDraw.Draw(m).line(poly + [poly[0]], fill=255, width=max(1, u(width)), joint='curve')
    return m

def key(top, bottom, accent, *, lit=None, take=False):
    """lit = (top, bottom, glow) for a lit feedback state; accent = family color."""
    acc = hx(accent)
    im = Image.new('RGBA', (W, W), (6, 7, 9, 255))               # the key's dark surround
    panel = chamfer_poly(IN, CH); pm = mask_of(panel)
    t, b = (hx(lit[0]), hx(lit[1])) if lit else (hx(top), hx(bottom))
    body = gradient(t, b); im.paste(body, (0, 0), pm)
    # fine scanlines (every 2px) for a display-glass texture, very faint
    sc = Image.new('L', (W, W), 0); sd = ImageDraw.Draw(sc)
    for y in range(0, W, u(2)): sd.rectangle([0, y, W, y + SS - 1], fill=255)
    im = layer(im, (0, 0, 0), Image.composite(sc, Image.new('L', (W, W), 0), pm), 0.10 if not lit else 0.07)
    # inner shadow: dark falloff from the panel edge inwards
    inner = Image.eval(mask_of(chamfer_poly(IN + 3, CH + 1), blur=u(3.5)), lambda v: 255 - v)
    im = layer(im, (0, 0, 0), Image.composite(inner, Image.new('L', (W, W), 0), pm), 0.55 if not lit else 0.35)
    # glossy top highlight (backlit glass): a soft band in the top third
    gl = Image.new('L', (W, W), 0); gd = ImageDraw.Draw(gl)
    for y in range(u(2), u(30)): gd.line([(0, y), (W, y)], fill=round(255 * (1 - (y - u(2)) / u(28)) ** 1.6))
    im = layer(im, (255, 255, 255), Image.composite(gl, Image.new('L', (W, W), 0), mask_of(chamfer_poly(IN + 2, CH))), 0.13 if not lit else 0.20)
    if lit:
        glow = hx(lit[2])
        # neon edge: a soft inward glow plus a crisp bright bezel
        edge = outline_mask(panel, 3)
        im = layer(im, glow, Image.composite(edge.filter(ImageFilter.GaussianBlur(u(2.5))), Image.new('L', (W, W), 0), pm), 1.0)
        im = layer(im, glow, outline_mask(panel, 1.4), 1.0)
        bez = (255, 255, 255)
    else:
        # thin bezel in the family color, plus a hairline inner bevel
        im = layer(im, acc, outline_mask(panel, 1), 0.55 if not take else 0.75)
        im = layer(im, (255, 255, 255), outline_mask(chamfer_poly(IN + 2, CH), 0.6), 0.06)
        bez = acc
    # corner brackets along the chamfers (HUD ticks), clear of the centred text area
    cm = Image.new('L', (W, W), 0); cd = ImageDraw.Draw(cm)
    for (x, y, dx, dy) in [(1, 1, 1, 1), (71, 1, -1, 1), (1, 71, 1, -1), (71, 71, -1, -1)]:
        # a short diagonal parallel to the cut corner, just inside the bezel, with tiny end ticks
        p1, p2 = (x + dx * 10.5, y + dy * 3.2), (x + dx * 3.2, y + dy * 10.5)
        cd.line([(u(p1[0]), u(p1[1])), (u(p2[0]), u(p2[1]))], fill=255, width=u(1))
        cd.line([(u(p1[0]), u(p1[1])), (u(p1[0] + dx * 2.2), u(p1[1]))], fill=255, width=u(1))
        cd.line([(u(p2[0]), u(p2[1])), (u(p2[0]), u(p2[1] + dy * 2.2))], fill=255, width=u(1))
    im = layer(im, bez if not lit else (255, 255, 255), cm, 0.7 if not lit else 0.5)
    # slim accent line at the top centre with a soft neon glow, family color (kept when lit)
    am = Image.new('L', (W, W), 0); ImageDraw.Draw(am).rounded_rectangle([u(24), u(2.6), u(48), u(4.4)], radius=u(0.9), fill=255)
    if lit:  # dark backing so the family color reads on a bright fill
        bk = Image.new('L', (W, W), 0); ImageDraw.Draw(bk).rounded_rectangle([u(22.5), u(1.6), u(49.5), u(5.4)], radius=u(1.6), fill=255)
        im = layer(im, (0, 0, 0), bk, 0.55)
    im = layer(im, acc, am.filter(ImageFilter.GaussianBlur(u(1.6))), 0.9)
    im = layer(im, acc if not take else (255, 255, 255), am, 1.0)
    return im

def finish(im):
    out = im.resize((S, S), Image.LANCZOS).convert('RGB')
    buf = io.BytesIO(); out.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(buf, 'PNG', optimize=True)  # palette PNG: ~half the size
    return out, buf.getvalue()

def normal(fam):
    top, bottom, accent = FAMILIES[fam]
    return finish(key(top, bottom, accent, take=(fam == 'take')))

def active(fam, state):
    return finish(key(None, None, FAMILIES[fam][2], lit=STATES[state]))

# Which images the presets use (normal: one per family; active: family x state where used)
ACTIVE = [('preset', 'pvw'), ('preset', 'pgm'), ('master', 'pvw'), ('master', 'pgm'), ('dest', 'sel'),
          ('auto', 'sel'), ('tally', 'pvw'), ('tally', 'pgm'), ('freeze', 'frozen'), ('backup', 'sel'),
          ('audio', 'muted')]

def main():
    png_dir = None
    if '--png-dir' in sys.argv: png_dir = sys.argv[sys.argv.index('--png-dir') + 1]; os.makedirs(png_dir, exist_ok=True)
    out = {}
    jobs = [(f, None) for f in FAMILIES] + ACTIVE
    for fam, st in jobs:
        img, data = normal(fam) if st is None else active(fam, st)
        key = fam if st is None else f'{fam}_{st}'
        out[key] = base64.b64encode(data).decode()
        if png_dir: img.save(os.path.join(png_dir, f'{key}.png'))
    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.join(here, '..', 'src', 'styles.js')
    lines = ["'use strict';", '// GENERATED by tools/make-button-styles.py: 72x72 button backgrounds (base64 PNG) for the presets.',
             '// <family> is the normal look, <family>_<state> the lit look used by feedbacks. Do not edit by hand.',
             'module.exports = {']
    for k, v in out.items(): lines.append(f'  {k}: {json.dumps(v)},')
    lines.append('};'); lines.append('')
    open(target, 'w').write('\n'.join(lines))
    print(f'wrote {len(out)} images to src/styles.js ({os.path.getsize(target)} bytes)')

if __name__ == '__main__':
    main()
