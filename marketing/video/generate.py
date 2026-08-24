#!/usr/bin/env python3
"""Pumpini launch film generator — 1080x1920 (9:16), 36s, silent, H.264 MP4.

Third creative in the recall chain (WhatsApp image -> A5 front -> this film ->
the two-fold brochure). Every caption below is copy already set in type on the
brochure. The film reinforces the print piece; it does not invent new claims.

How it works: the scene is one HTML page whose motion is pure CSS animation.
Every animation is PAUSED, and each frame is rendered by setting
`Animation.currentTime` to that frame's timestamp (Web Animations API) before
screenshotting. A frame is therefore a pure function of its time — no real-time
recording, no dropped frames, byte-identical on a re-run.

    python3 generate.py            # English master

Requires: pip install playwright  (+ `playwright install chromium`, or set
          CHROMIUM_PATH to an existing chromium binary)
          ffmpeg with libx264 + aac
          npx -y qrcode  for the closing WhatsApp QR
          ../../frontend/public/pumpini-logo.png
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'output')
W, H, FPS = 1080, 1920, 30

# The brochure's QR is a WhatsApp chat link, not the website. The film matches
# it, because that is where the leads actually land.
WHATSAPP = 'https://wa.me/917842178350'

# ---------------------------------------------------------------- timeline --
# EVERY timing in the film lives here, in seconds. To cut a shorter version
# (e.g. 28s for WhatsApp Status) pull these in — nothing else needs touching.
END = 36.0
SCENES = {                       # scene: (start, end), 0.5s cross-fade each side
    's1': (0.0,  3.6),           # TAKE PICTURE
    's2': (3.4, 11.6),           # USP 1 — capture
    's3': (11.4, 19.6),          # USP 2 — reconcile
    's4': (19.4, 27.6),          # USP 3 — dashboard
    's5': (27.4, 32.6),          # USP 4 — ask
    's6': (32.4, END),           # close
}
CUE = {
    'h1': 0.30, 'h1sub': 1.10,
    'k2': 3.75, 'h2': 4.35, 'chip0': 5.30, 'chipstep': 0.55, 'slot2': 7.70, 'h2sub': 9.90,
    'k3': 11.75, 'h3': 12.35, 'item0': 13.60, 'itemstep': 0.50, 'slot3': 14.10,
    'k4': 19.75, 'h4': 20.35, 'h4sub': 21.60, 'slot4': 22.30, 'h4sub2': 25.40,
    'k5': 27.75, 'h5': 28.30, 'h5sub': 29.30, 'slot5': 29.90,
    'logo6': 32.70, 'tl1': 33.05, 'tl2': 33.35, 'qr': 33.70, 'wa': 34.05,
    'price': 34.40, 'price2': 34.70,
}
POSTER_AT = 13.0                 # the "not day end" beat

# ------------------------------------------------------------------- copy ---
# APPROVED — lifted verbatim from the printed two-fold brochure. Do not reword
# here; reword the brochure first, then copy it across.
T = dict(
    h1='TAKE PICTURE.', h1sub='Data saved. Evidence captured.',

    k2='CAPTURE → VERIFY → RECONCILE',
    h2a='Photograph it.', h2b='Pumpini types it.',
    chips=['Nozzle slip', 'Tank gauge', 'Credit coupon', 'Invoice'],
    h2sub='And the image is stored for audit.',

    k3='EVERY SHIFT',
    h3a='RECONCILE FOR EVERY SHIFT.', h3b='NOT DAY END.',
    items=['Attendant reco', 'Underground tank reco', 'Credit invoices',
           'P&L and Balance Sheet', 'Tally interface'],

    k4='OWNER DASHBOARD',
    h4a='DATA AT FINGERTIPS —', h4b='ANYWHERE. ANYTIME.',
    h4sub='Today… for the month… year to date.',
    h4sub2='One outlet or ten.',

    k5='AI ASSISTANT',
    h5a='DON’T TYPE.', h5b='ASK.',
    h5sub='In your language. Answers in your language.',

    tl1='control every drop.', tl2='track every rupee.',
    price='15-day free trial · Less than ₹45 a day',
    price2='No setup cost. No long-term lock-in.',
    wa='+91 78421 78350',
)

# Slots where a captured product screen goes. Rendered as an unmistakable
# placeholder until the screens exist — never as a design element, so nobody
# can mistake a draft for a finished film.
SLOTS = {
    'slot2': 'Shift Start — gauge photo,\npump-slip scan, attendant photo',
    'slot3': 'End Shift — settlement,\nvariance to zero',
    'slot4': 'Group View — outlets live,\ndrill into one bunk',
    'slot5': 'AI Assistant — live answer,\ncaptured unrehearsed',
}

FONTS = ("'DM Sans','Noto Sans','Noto Sans Telugu','Noto Sans Tamil',"
         "'Noto Sans Devanagari','Noto Sans Kannada',system-ui,sans-serif")

# Brand tokens, verified against frontend/src (#FF6B00 has 165 uses).
CSS = """
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1920px;overflow:hidden;color:#fff;background:#07150E;
  font-family:__FONTS__;-webkit-font-smoothing:antialiased}
.bg{position:absolute;inset:0;background:linear-gradient(160deg,#07150E 0%,#0C2418 55%,#07150E 100%)}
.blob{position:absolute;border-radius:50%;filter:blur(120px)}
.b1{width:900px;height:900px;left:-220px;top:-180px;background:rgba(77,195,232,.18);
  animation:drift1 24s ease-in-out infinite alternate}
.b2{width:820px;height:820px;right:-240px;bottom:-160px;background:rgba(255,107,0,.20);
  animation:drift2 20s ease-in-out infinite alternate}
@keyframes drift1{to{transform:translate(140px,120px) scale(1.15)}}
@keyframes drift2{to{transform:translate(-120px,-140px) scale(1.12)}}

.scene{position:absolute;inset:0;display:flex;flex-direction:column;
  justify-content:center;align-items:flex-start;padding:0 92px;opacity:0}

.rise{animation:rise .85s cubic-bezier(.2,.85,.25,1) both}
@keyframes rise{from{opacity:0;transform:translateY(48px)}to{opacity:1;transform:none}}
.pop{animation:pop .55s cubic-bezier(.2,1.4,.35,1) both}
@keyframes pop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}
.wipe{animation:wipe .8s cubic-bezier(.3,.9,.2,1) both}
@keyframes wipe{from{opacity:0;transform:translateX(-46px)}to{opacity:1;transform:none}}

.kicker{font-size:32px;font-weight:800;letter-spacing:.14em;color:#FF9A4D;margin-bottom:26px}
h1{font-size:112px;font-weight:900;line-height:1.02;letter-spacing:-.03em}
h2{font-size:82px;font-weight:900;line-height:1.1;letter-spacing:-.022em}
h2 .o{color:#FF6B00}
.sub{font-size:40px;font-weight:600;color:rgba(255,255,255,.78);line-height:1.34;margin-top:30px}
.sub.big{font-size:46px;color:#fff}
.rule{width:200px;height:10px;border-radius:10px;margin-top:44px;
  background:linear-gradient(90deg,#FFB347,#FF6B00)}

.chips{display:flex;flex-wrap:wrap;gap:20px;margin-top:44px;max-width:900px}
.chip{font-size:38px;font-weight:800;padding:20px 34px;border-radius:99px;
  background:rgba(255,107,0,.15);border:3px solid rgba(255,107,0,.55);color:#FFC08A}

.items{margin-top:40px;display:flex;flex-direction:column;gap:22px}
.item{display:flex;align-items:center;gap:26px;font-size:42px;font-weight:700;
  color:rgba(255,255,255,.9)}
.item .tick{flex:none;width:56px;height:56px;border-radius:50%;background:rgba(74,222,128,.16);
  border:4px solid #4ADE80;color:#4ADE80;font-size:30px;font-weight:900;
  display:flex;align-items:center;justify-content:center}

/* placeholder for a product screen that has not been captured yet */
.slot{margin-top:46px;width:100%;height:430px;border-radius:34px;
  border:5px dashed rgba(255,107,0,.55);background:rgba(255,107,0,.06);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px}
.slot .lb{font-size:26px;font-weight:800;letter-spacing:.16em;color:#FF9A4D}
.slot .tx{font-size:32px;font-weight:600;color:rgba(255,255,255,.6);text-align:center;
  line-height:1.35;white-space:pre-line}

.s6{justify-content:center;align-items:center;padding:0 84px}
.card{width:100%;background:#fff;border-radius:56px;padding:76px 60px;text-align:center;
  box-shadow:0 40px 130px rgba(0,0,0,.6)}
.card img.logo{height:92px;margin-bottom:46px}
.card .tl1{font-size:70px;font-weight:900;color:#0C2418;line-height:1.18}
.card .tl2{font-size:70px;font-weight:900;color:#FF6B00;line-height:1.18;margin-top:6px}
.card .qr{width:310px;height:310px;margin:52px auto 0;border:7px solid #0C2418;
  border-radius:28px;padding:14px;background:#fff;display:block}
.card .wa{font-size:44px;font-weight:900;color:#0C2418;margin-top:26px;letter-spacing:.01em}
.card .price{display:inline-block;margin-top:30px;font-size:33px;font-weight:800;color:#fff;
  background:linear-gradient(135deg,#FF8C3B,#FF6B00);border-radius:99px;padding:20px 44px}
.card .price2{font-size:29px;font-weight:600;color:#5b6570;margin-top:20px}
"""


def scene_css():
    """One opacity animation per scene — fade up, hold, cross-fade out."""
    out, fade = [], 0.5
    for name, (s, e) in SCENES.items():
        d = e - s
        p1, p2 = fade / d * 100, (d - fade) / d * 100
        out.append('@keyframes fade_%s{0%%{opacity:0}%.3f%%{opacity:1}'
                   '%.3f%%{opacity:1}100%%{opacity:0}}' % (name, p1, p2))
        out.append('.%s{animation:fade_%s %.3fs linear %.3fs both}' % (name, name, d, s))
    return '\n'.join(out)


def dly(key, extra=0.0):
    return 'style="animation-delay:%.2fs"' % (CUE[key] + extra)


def slot(key):
    return ('<div class="slot rise" %s><div class="lb">SCREEN SLOT</div>'
            '<div class="tx">%s</div></div>' % (dly(key), SLOTS[key]))


def build_html():
    chips = ''.join('<div class="chip pop" style="animation-delay:%.2fs">%s</div>'
                    % (CUE['chip0'] + i * CUE['chipstep'], c)
                    for i, c in enumerate(T['chips']))
    items = ''.join('<div class="item wipe" style="animation-delay:%.2fs">'
                    '<div class="tick">✓</div>%s</div>'
                    % (CUE['item0'] + i * CUE['itemstep'], it)
                    for i, it in enumerate(T['items']))
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
{CSS.replace('__FONTS__', FONTS)}
{scene_css()}
</style></head><body>
<div class="bg"><div class="blob b1"></div><div class="blob b2"></div></div>

<div class="scene s1">
  <h1 class="rise" {dly('h1')}>{T['h1']}</h1>
  <div class="sub big rise" {dly('h1sub')}>{T['h1sub']}</div>
  <div class="rule rise" {dly('h1sub', 0.25)}></div>
</div>

<div class="scene s2">
  <div class="kicker rise" {dly('k2')}>{T['k2']}</div>
  <h2 class="rise" {dly('h2')}>{T['h2a']}<br><span class="o">{T['h2b']}</span></h2>
  <div class="chips">{chips}</div>
  {slot('slot2')}
  <div class="sub rise" {dly('h2sub')}>{T['h2sub']}</div>
</div>

<div class="scene s3">
  <div class="kicker rise" {dly('k3')}>{T['k3']}</div>
  <h2 class="rise" {dly('h3')}>{T['h3a']}<br><span class="o">{T['h3b']}</span></h2>
  <div class="items">{items}</div>
</div>

<div class="scene s4">
  <div class="kicker rise" {dly('k4')}>{T['k4']}</div>
  <h2 class="rise" {dly('h4')}>{T['h4a']}<br><span class="o">{T['h4b']}</span></h2>
  <div class="sub big rise" {dly('h4sub')}>{T['h4sub']}</div>
  {slot('slot4')}
  <div class="sub rise" {dly('h4sub2')}>{T['h4sub2']}</div>
</div>

<div class="scene s5">
  <div class="kicker rise" {dly('k5')}>{T['k5']}</div>
  <h2 class="rise" {dly('h5')}>{T['h5a']} <span class="o">{T['h5b']}</span></h2>
  <div class="sub big rise" {dly('h5sub')}>{T['h5sub']}</div>
  {slot('slot5')}
</div>

<div class="scene s6">
  <div class="card">
    <img class="logo pop" src="pumpini-wordmark.png" {dly('logo6')}>
    <div class="tl1 rise" {dly('tl1')}>{T['tl1']}</div>
    <div class="tl2 rise" {dly('tl2')}>{T['tl2']}</div>
    <img class="qr pop" src="qr.png" {dly('qr')}>
    <div class="wa rise" {dly('wa')}>{T['wa']}</div>
    <div><span class="price pop" {dly('price')}>{T['price']}</span></div>
    <div class="price2 rise" {dly('price2')}>{T['price2']}</div>
  </div>
</div>

<script>
window.renderFrame = (ms) => {{
  for (const a of document.getAnimations()) {{ a.pause(); a.currentTime = ms; }}
}};
</script>
</body></html>"""


def main():
    os.makedirs(OUT, exist_ok=True)
    from PIL import Image
    src = os.path.join(HERE, '../../frontend/public/pumpini-logo.png')
    shutil.copy(src, os.path.join(OUT, 'pumpini-logo.png'))
    # The brand logo bakes the tagline in beneath the wordmark (rows 218-287 of
    # 295). The close card sets that same tagline in 70px type, so the lockup
    # would say it twice. Crop to the wordmark — derived at build time, so no
    # second brand asset is created and nothing can drift from the original.
    lg = Image.open(src)
    lg.crop((0, 0, lg.width, 218)).save(os.path.join(OUT, 'pumpini-wordmark.png'))
    subprocess.run(['npx', '-y', 'qrcode', '-o', os.path.join(OUT, 'qr.png'),
                    '-w', '620', '-m', '2', WHATSAPP], check=True)

    page_path = os.path.join(OUT, 'film-en.html')
    open(page_path, 'w', encoding='utf-8').write(build_html())

    from playwright.sync_api import sync_playwright
    mp4 = os.path.join(OUT, 'pumpini-film-en.mp4')
    poster = os.path.join(OUT, 'pumpini-video-poster-en.jpg')
    frames = int(round(END * FPS))

    ff = subprocess.Popen(
        ['ffmpeg', '-y', '-loglevel', 'error',
         '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', str(FPS), '-i', '-',
         '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
         '-shortest', '-c:v', 'libx264', '-preset', 'slow', '-crf', '21',
         '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
         '-c:a', 'aac', '-b:a', '96k', mp4],
        stdin=subprocess.PIPE)

    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'))
        pg = b.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
        pg.goto('file://' + page_path, wait_until='load')
        pg.evaluate('document.fonts.ready')
        pg.wait_for_timeout(1200)
        for i in range(frames):
            ms = i * 1000.0 / FPS
            pg.evaluate('(ms) => window.renderFrame(ms)', ms)
            ff.stdin.write(pg.screenshot(type='jpeg', quality=92))
            if abs(ms / 1000.0 - POSTER_AT) < 0.5 / FPS:
                pg.screenshot(path=poster, type='jpeg', quality=92)
            if i % 120 == 0:
                print('  frame %d/%d' % (i, frames), flush=True)
        b.close()

    ff.stdin.close()
    if ff.wait() != 0:
        sys.exit('ffmpeg failed')
    print('built', mp4, '(%.1f MB)' % (os.path.getsize(mp4) / 1e6))
    print('built', poster)


if __name__ == '__main__':
    main()
