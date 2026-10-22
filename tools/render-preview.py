#!/usr/bin/env python3
"""Render a labelled preview sheet of the button families (normal and lit states).

Text is drawn on the real 72x72 backgrounds from src/styles.js the way Companion does it (Arimo,
fixed size 14, centred, word-wrapped, white or the preset's text color), then scaled up 2x.

    python3 tools/render-preview.py OUT.png [--keys-dir DIR]
"""
import base64, io, os, re, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'src')
FONT = '/usr/share/fonts/truetype/sand-box/google/Arimo/Arimo-VariableFont_wght.ttf'
SIZE = 14
WHITE, BLACK, YELLOW, GREEN, RED = (255, 255, 255), (0, 0, 0), (255, 200, 0), (40, 220, 110), (255, 70, 70)

def load_styles():
    js = open(os.path.join(SRC, 'styles.js')).read()
    return {k: Image.open(io.BytesIO(base64.b64decode(v))).convert('RGBA') for k, v in re.findall(r'^\s+(\w+): "([^"]+)"', js, re.M)}

def load_logo():
    js = open(os.path.join(SRC, 'logo.js')).read()
    return Image.open(io.BytesIO(base64.b64decode(re.search(r"LOGO_PNG64: '([^']+)'", js).group(1)))).convert('RGBA')

def wrap(draw, font, text, width):
    lines = []
    for para in text.split('\n'):
        cur = ''
        for word in para.split(' '):
            t = (cur + ' ' + word).strip()
            if draw.textlength(t, font=font) <= width or not cur: cur = t
            else: lines.append(cur); cur = word
        lines.append(cur)
    return lines

def key(bg, text, color=WHITE):
    im = bg.copy() if bg is not None else Image.new('RGBA', (72, 72), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(FONT, SIZE)
    lines = wrap(d, f, text, 68)
    lh = round(SIZE * 1.12)
    y = (72 - lh * len(lines)) / 2
    for ln in lines:
        w = d.textlength(ln, font=f)
        d.text(((72 - w) / 2, y), ln, font=f, fill=color)
        y += lh
    return im

def main():
    out = sys.argv[1]
    kdir = sys.argv[sys.argv.index('--keys-dir') + 1] if '--keys-dir' in sys.argv else None
    st = load_styles(); logo = load_logo()
    logo_key = Image.new('RGBA', (72, 72), (0, 0, 0, 255)); logo_key.alpha_composite(logo.resize((72, 72)))
    rows = [
        ('Preset tile recall', 'steel blue, blue accent', [('Normal', key(st['preset'], 'Wide Panel Master')), ('On Preview', key(st['preset_pvw'], 'Wide Panel Master')), ('On Program', key(st['preset_pgm'], 'Wide Panel Master')), ('Empty tile', key(st['preset'], '17 (empty)'))]),
        ('Master memory', 'violet, violet accent', [('Normal', key(st['master'], 'Keynote Full')), ('On Preview', key(st['master_pvw'], 'Keynote Full')), ('On Program', key(st['master_pgm'], 'Keynote Full'))]),
        ('Destination select', 'teal, teal accent', [('Normal', key(st['dest'], 'S1\nMain LED')), ('Selected', key(st['dest_sel'], 'S1\nMain LED', BLACK)), ('Aux', key(st['dest'], 'A1\nConfidence'))]),
        ('TAKE / CUT', 'bold red / dark red', [('TAKE', key(st['take'], 'TAKE\nS1,S2')), ('CUT', key(st['cut'], 'CUT\nS1,S2'))]),
        ('Auto take', 'dark, amber accent', [('Off', key(st['auto'], 'AUTO\nTAKE\nOFF')), ('On', key(st['auto_sel'], 'AUTO\nTAKE\nON', BLACK))]),
        ('Input tally', 'neutral grey, grey accent', [('Normal', key(st['tally'], 'IN 3\nCam 1')), ('On Preview', key(st['tally_pvw'], 'IN 3\nCam 1')), ('On Program', key(st['tally_pgm'], 'IN 3\nCam 1')), ('No signal', key(st['tally'], 'IN 3\nCam 1', YELLOW))]),
        ('Input freeze', 'navy, ice-blue accent', [('Normal', key(st['freeze'], 'FRZ 3\nCam 1')), ('Frozen', key(st['freeze_frozen'], 'FRZ 3\nCam 1'))]),
        ('Backups', 'brown, orange accent', [('Normal', key(st['backup'], 'IN 5\nBKP 1')), ('Active', key(st['backup_sel'], 'IN 5\nBKP 1', BLACK)), ('Primary', key(st['backup'], 'IN 5\nPRIMARY'))]),
        ('Audio mute', 'plum, magenta accent', [('Normal', key(st['audio'], 'IN 2\nCH 1\nMUTE')), ('Muted', key(st['audio_muted'], 'IN 2\nCH 1\nMUTE'))]),
        ('E2 (Barco)', 'olive, lime accent', [('Preset', key(st['e2'], 'Walk-in')), ('On Preview', key(st['e2_pvw'], 'Walk-in')), ('On Program', key(st['e2_pgm'], 'Walk-in')), ('Dest selected', key(st['e2_sel'], 'S1\nMain LED', BLACK)), ('TAKE', key(st['take'], 'E2\nTAKE'))]),
        ('PixelHue', 'wine, rose accent', [('Preset', key(st['pixelhue'], 'Opener')), ('On Preview', key(st['pixelhue_pvw'], 'Opener')), ('On Program', key(st['pixelhue_pgm'], 'Opener')), ('Dest selected', key(st['pixelhue_sel'], 'S1\nLED Wall', BLACK)), ('CUT', key(st['cut'], 'PIXELHUE\nCUT'))]),
        ('ATEM', 'bronze, gold accent', [('Program bus', key(st['atem'], 'PGM\nCAM1')), ('On Program', key(st['atem_pgm'], 'PGM\nCAM1')), ('On Preview', key(st['atem_pvw'], 'PVW\nCAM2')), ('Key tied', key(st['atem_sel'], 'KEY 1\nTIE', BLACK)), ('Macro', key(st['atem'], 'MACRO\nOpener roll'))]),
        ('Panasonic PTZ', 'navy, indigo accent', [('Camera', key(st['ptz'], 'Cam 1 Wide')), ('Selected', key(st['ptz_sel'], 'Cam 1 Wide', BLACK)), ('Tally red', key(st['ptz_pgm'], 'Cam 1 Wide')), ('Preset recalled', key(st['ptz_pvw'], 'Pulpit')), ('Hold to pan', key(st['ptz'], '\u25b2\nPAN TILT'))]),
        ('Status / utility', 'black / grey', [('Last recalled', key(st['status'], 'PVW\n12\nWide Panel', GREEN)), ('Master PGM', key(st['status'], 'MASTER\n3\nKeynote', RED)), ('Refresh', key(st['utility'], 'REFRESH\nMEMORY')), ('Logo', logo_key)]),
    ]
    Z = 2; K = 72 * Z; GAP = 22; LW = 230; TOP = 70; RH = K + 46
    W = LW + max(len(r[2]) for r in rows) * (K + GAP) + 20; H = TOP + RH * len(rows) + 20
    sheet = Image.new('RGB', (W, H), (24, 24, 27)); d = ImageDraw.Draw(sheet)
    fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
    fr = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
    d.text((20, 18), 'PV Control Center: Companion button styles (72x72 keys shown at 2x, text size 14)', font=fb, fill=(240, 240, 240))
    for r, (name, desc, keys) in enumerate(rows):
        y = TOP + r * RH
        d.text((20, y + K / 2 - 18), name, font=fb, fill=(235, 235, 235))
        d.text((20, y + K / 2 + 6), desc, font=fr, fill=(150, 150, 155))
        for c, (cap, im) in enumerate(keys):
            x = LW + c * (K + GAP)
            sheet.paste(im.convert('RGB').resize((K, K), Image.LANCZOS), (x, y))
            tw = d.textlength(cap, font=fr); d.text((x + (K - tw) / 2, y + K + 6), cap, font=fr, fill=(190, 190, 195))
            if kdir:
                os.makedirs(kdir, exist_ok=True)
                im.convert('RGB').save(os.path.join(kdir, re.sub(r'\W+', '-', f'{name}-{cap}').lower().strip('-') + '.png'))
    sheet.save(out)
    print('wrote', out, sheet.size)

if __name__ == '__main__':
    main()
