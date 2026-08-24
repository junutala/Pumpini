#!/usr/bin/env python3
"""Pumpini launch film generator — 1080x1920 (9:16), 41s, silent, H.264 MP4.

Third creative in the recall chain (WhatsApp image -> A5 front -> this film ->
the two-fold brochure). Every caption is copy already set in type on the
brochure. The film reinforces the print piece; it does not invent new claims.

How it works: the scene is one HTML page whose motion is pure CSS animation.
Every animation is PAUSED, and each frame is rendered by setting
`Animation.currentTime` to that frame's timestamp (Web Animations API) before
screenshotting. A frame is therefore a pure function of its time — no real-time
recording, no dropped frames, byte-identical on a re-run.

Live-action footage is composited the same way: each clip is exploded to a JPEG
sequence at build time and the right frame is swapped into an <img> for each
film frame. It is done that way because the bundled Chromium cannot decode
H.264 in-page — seeking a <video> element hangs forever waiting for a `seeked`
event that never fires. Frames always work.

    python3 generate.py            # English master

Requires: pip install playwright pillow  (+ `playwright install chromium`, or
          set CHROMIUM_PATH to an existing chromium binary)
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
# EVERY timing in the film lives here, in seconds.
END = 41.0
SCENES = {                       # scene: (start, end), 0.5s cross-fade each side
    's1': (0.0,  3.2),           # TAKE PICTURE
    'sA': (3.0,  5.4),           # FOOTAGE — attendant photographs the nozzle slip
    's2': (5.2, 11.4),           # USP 1 — capture
    's3': (11.2, 19.4),          # USP 2 — reconcile
    's4': (19.2, 25.4),          # USP 3 — dashboard
    's5': (25.2, 30.0),          # USP 4 — ask
    'sB': (29.8, 32.2),          # FOOTAGE — the owner checks the bunk on his phone
    's7': (32.0, 36.2),          # the dashboard, full screen
    's6': (36.0, END),           # close — HELD, never faded out (see scene_css)
}
CUE = {
    'h1': 0.30, 'h1sub': 1.05,
    'capA': 3.75,
    'k2': 5.55, 'h2': 6.15, 'chip0': 7.05, 'chipstep': 0.50, 'slot2': 9.20, 'h2sub': 10.20,
    'k3': 11.55, 'h3': 12.15, 'item0': 13.30, 'itemstep': 0.45, 'slot3': 15.90,
    'k4': 19.55, 'h4': 20.15, 'h4sub': 21.40, 'slot4': 22.10,
    'k5': 25.55, 'h5': 26.10, 'h5sub': 27.05, 'slot5': 27.60,
    'capB': 30.50,
    'dashfull': 32.35, 'capDash': 33.40,
    'logo6': 36.30, 'tl1': 36.65, 'tl2': 36.95, 'qr': 37.30, 'wa': 37.65,
    'price': 38.00, 'price2': 38.30,
}
POSTER_AT = 34.50                # the dashboard, full screen

# Live-action clips: (file, when its first frame lands in the film, duration).
# What is NOT here matters as much as what is. The supplied 10s reel has two
# sections that must never be cut in:
#   2.1s-4.5s  the attendant photographing the console — an incorrect ATG
#              capture, rejected by the owner.
#   6.8s-10s   an AI-FABRICATED dashboard. Its labels read "Morguiar months",
#              "Volume & moirts", "53.666 cars", "₹3,25.71224 • 2 autins", and
#              the middle donut says ULLAGE where the real product says BLENDED
#              MARGIN. Only the three headline figures survived intact. The
#              real screenshot is used for the dashboard beat instead.
FOOTAGE = {
    'a': ('attendant-slip.mp4', 3.20, 2.00),
    'b': ('owner-phone.mp4',   30.00, 1.80),
}

# ------------------------------------------------------------------- copy ---
# APPROVED — lifted verbatim from the printed two-fold brochure. Do not reword
# here; reword the brochure first, then copy it across.
T = dict(
    h1='TAKE PICTURE.', h1sub='Data saved. Evidence captured.',

    capA='Photograph it.',

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

    k5='AI ASSISTANT',
    h5a='DON’T TYPE.', h5b='ASK.',
    h5sub='In your language. Answers in your language.',

    capB='Anywhere. Anytime.',
    capDash='One outlet or ten.',

    tl1='control every drop.', tl2='track every rupee.',
    # Kept as THREE separate claims on purpose. Run together as one line,
    # "15-day free trial · Less than ₹45 a day" reads as though the trial costs
    # ₹45 a day. The brochure sets them as two separate badges; so does this.
    price='15-DAY FREE TRIAL',
    price2='No setup cost. No long-term lock-in.',
    price3='Less than ₹45 a day',
    wa='+91 78421 78350',
)

# Product screens, cropped from the supplied PDFs — see README for the source
# file and crop box of each. Every crop deliberately excludes the sidebar (it
# carries the outlet name and the logged-in user), the browser chrome, the
# Windows taskbar, and any operator's name. Value is display width in film px.
SLOTS = {
    'slot2': ('capture-gauge.png', 896),
    'slot3': ('credit-invoice.png', 896),
    'slot4': ('dashboard.png', 820),
    'slot5': ('ai-assistant.png', 860),
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
.scene.full{padding:0;justify-content:flex-end;align-items:stretch}

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

/* a real product screen, seated on the dark ground */
.shotwrap{margin-top:44px;width:100%;display:flex;justify-content:center}
.shot{display:block;border-radius:22px;border:3px solid rgba(255,255,255,.22);
  box-shadow:0 30px 90px rgba(0,0,0,.6);background:#fff}

/* live-action footage, full bleed, with a scrim so white type stays legible */
.foot{position:absolute;inset:0;width:1080px;height:1920px;object-fit:cover}
.scrim{position:absolute;inset:0;
  background:linear-gradient(to top,rgba(7,21,14,.88) 0%,rgba(7,21,14,.35) 32%,
             rgba(7,21,14,0) 58%)}
.lower{position:relative;padding:0 92px 250px}
.lower .txt{font-size:76px;font-weight:900;line-height:1.08;letter-spacing:-.02em;
  text-shadow:0 8px 40px rgba(0,0,0,.8)}

/* the dashboard, full screen, with a slow push in */
.dashfull{position:absolute;left:0;top:50%;width:1080px;
  box-shadow:0 40px 120px rgba(0,0,0,.65)}
@keyframes push{from{transform:translateY(-50%) scale(1)}
                to{transform:translateY(-50%) scale(1.10)}}

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
.card .pdiv{width:150px;height:3px;border-radius:3px;background:#E2E6E4;margin:34px auto 0}
.card .price3{font-size:46px;font-weight:900;color:#0C2418;margin-top:26px;letter-spacing:-.01em}

/* Persistent wordmark, frame one to the close. A clip gets forwarded out of
   every context it was posted in; the mark has to travel with it. It sits on a
   white chip because the logo is dark-on-white artwork with no alpha, so it
   cannot simply be laid over a dark ground or over footage. It fades before the
   closing card, where the logo appears full size. */
.bug{position:absolute;top:52px;left:92px;background:#fff;border-radius:99px;
  padding:13px 28px;box-shadow:0 8px 26px rgba(0,0,0,.35);z-index:5}
.bug img{height:46px;display:block}
"""


def bug_css():
    """Visible from frame one, gone before the closing card takes over."""
    up, out = 0.45 / END * 100, SCENES['s6'][0] / END * 100
    return ('@keyframes bugfade{0%%{opacity:0}%.3f%%{opacity:1}%.3f%%{opacity:1}'
            '%.3f%%{opacity:0}100%%{opacity:0}}\n'
            '.bug{animation:bugfade %.3fs linear 0s both}' % (up, out, out + 1.4, END))


def scene_css():
    """One opacity animation per scene — fade up, hold, cross-fade out.

    The LAST scene is the exception: it fades up and then holds at full opacity
    to the final frame. A player decides whether to loop a clip and no flag in
    the file changes that, so the only thing under our control is what the last
    frame shows. It has to be the QR and the phone number, still on screen —
    not a scene halfway through fading out. Do not "tidy" this back into the
    uniform loop.
    """
    out, fade = [], 0.5
    last = list(SCENES)[-1]
    for name, (s, e) in SCENES.items():
        d = e - s
        p1 = fade / d * 100
        if name == last:
            out.append('@keyframes fade_%s{0%%{opacity:0}%.3f%%{opacity:1}'
                       '100%%{opacity:1}}' % (name, p1))
        else:
            p2 = (d - fade) / d * 100
            out.append('@keyframes fade_%s{0%%{opacity:0}%.3f%%{opacity:1}'
                       '%.3f%%{opacity:1}100%%{opacity:0}}' % (name, p1, p2))
        out.append('.%s{animation:fade_%s %.3fs linear %.3fs both}' % (name, name, d, s))
    return '\n'.join(out)


def dly(key, extra=0.0):
    return 'style="animation-delay:%.2fs"' % (CUE[key] + extra)


def slot(key):
    src, w = SLOTS[key]
    return ('<div class="shotwrap"><img class="shot rise" src="screens/%s" '
            'style="width:%dpx;animation-delay:%.2fs" alt=""></div>'
            % (src, w, CUE[key]))


def footage(key):
    _, t0, dur = FOOTAGE[key]
    n = int(round(dur * FPS))
    return ('<img class="foot" data-seq="%s" data-t0="%.3f" data-n="%d" '
            'src="footage/%s_0001.jpg" alt="">' % (key, t0, n, key))


def build_html():
    chips = ''.join('<div class="chip pop" style="animation-delay:%.2fs">%s</div>'
                    % (CUE['chip0'] + i * CUE['chipstep'], c)
                    for i, c in enumerate(T['chips']))
    items = ''.join('<div class="item wipe" style="animation-delay:%.2fs">'
                    '<div class="tick">&#10003;</div>%s</div>'
                    % (CUE['item0'] + i * CUE['itemstep'], it)
                    for i, it in enumerate(T['items']))
    dash_s, dash_e = SCENES['s7']
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
{CSS.replace('__FONTS__', FONTS)}
{scene_css()}
{bug_css()}
.dashfull{{animation:push {dash_e - dash_s:.2f}s linear {dash_s:.2f}s both}}
</style></head><body>
<div class="bg"><div class="blob b1"></div><div class="blob b2"></div></div>
<div class="bug"><img src="pumpini-wordmark.png" alt="Pumpini"></div>

<div class="scene s1">
  <h1 class="rise" {dly('h1')}>{T['h1']}</h1>
  <div class="sub big rise" {dly('h1sub')}>{T['h1sub']}</div>
  <div class="rule rise" {dly('h1sub', 0.25)}></div>
</div>

<div class="scene sA full">
  {footage('a')}
  <div class="scrim"></div>
  <div class="lower"><div class="txt rise" {dly('capA')}>{T['capA']}</div></div>
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
  {slot('slot3')}
</div>

<div class="scene s4">
  <div class="kicker rise" {dly('k4')}>{T['k4']}</div>
  <h2 class="rise" {dly('h4')}>{T['h4a']}<br><span class="o">{T['h4b']}</span></h2>
  <div class="sub big rise" {dly('h4sub')}>{T['h4sub']}</div>
  {slot('slot4')}
</div>

<div class="scene s5">
  <div class="kicker rise" {dly('k5')}>{T['k5']}</div>
  <h2 class="rise" {dly('h5')}>{T['h5a']} <span class="o">{T['h5b']}</span></h2>
  <div class="sub big rise" {dly('h5sub')}>{T['h5sub']}</div>
  {slot('slot5')}
</div>

<div class="scene sB full">
  {footage('b')}
  <div class="scrim"></div>
  <div class="lower"><div class="txt rise" {dly('capB')}>{T['capB']}</div></div>
</div>

<div class="scene s7 full">
  <img class="dashfull" src="screens/dashboard-full.png" alt="">
  <div class="scrim"></div>
  <div class="lower"><div class="txt rise" {dly('capDash')}>{T['capDash']}</div></div>
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
    <div class="pdiv rise" {dly('price2', 0.2)}></div>
    <div class="price3 rise" {dly('price2', 0.3)}>{T['price3']}</div>
  </div>
</div>

<script>
const FPS = {FPS};
window.renderFrame = async (ms) => {{
  for (const a of document.getAnimations()) {{ a.pause(); a.currentTime = ms; }}
  for (const el of document.querySelectorAll('img[data-seq]')) {{
    const t0 = +el.dataset.t0, n = +el.dataset.n, key = el.dataset.seq;
    let i = Math.round((ms / 1000 - t0) * FPS);
    i = Math.max(0, Math.min(n - 1, i));
    const src = 'footage/' + key + '_' + String(i + 1).padStart(4, '0') + '.jpg';
    if (!el.getAttribute('src').endsWith(src)) {{
      el.setAttribute('src', src);
      try {{ await el.decode(); }} catch (e) {{}}
    }}
  }}
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

    # screens and footage are referenced relatively from the rendered page
    scr_dst = os.path.join(OUT, 'screens')
    if os.path.isdir(scr_dst):
        shutil.rmtree(scr_dst)
    shutil.copytree(os.path.join(HERE, 'screens'), scr_dst)

    # Explode each clip to a JPEG sequence. Chromium cannot decode H.264
    # in-page, so a <video> element would hang on seek; frames always work.
    foot_dst = os.path.join(OUT, 'footage')
    if os.path.isdir(foot_dst):
        shutil.rmtree(foot_dst)
    os.makedirs(foot_dst)
    for key, (clip, _t0, dur) in FOOTAGE.items():
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', '-i', os.path.join(HERE, 'footage', clip),
             '-vf', 'scale=%d:%d:flags=lanczos,fps=%d' % (W, H, FPS), '-q:v', '3',
             os.path.join(foot_dst, '%s_%%04d.jpg' % key)], check=True)
        got = len([f for f in os.listdir(foot_dst) if f.startswith(key + '_')])
        print('footage %s: %d frames (need %d)' % (key, got, round(dur * FPS)))

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
        pg.wait_for_timeout(1500)
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
