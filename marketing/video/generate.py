#!/usr/bin/env python3
"""Pumpini launch film generator — 1080x1920 (9:16), 36s, silent, H.264 MP4.

Third creative in the recall chain (WhatsApp image -> A5 front -> this film).
It reuses the SAME approved copy dict as marketing/whatsapp/generate.py, so a
line changed there is changed here by copy-paste, not by rewriting.

How it works: the scene is one HTML page whose motion is pure CSS animation.
Every animation is PAUSED, and each frame is rendered by setting
`Animation.currentTime` to that frame's timestamp (Web Animations API) before
screenshotting. So a frame is a pure function of its time — no real-time
recording, no dropped frames, byte-identical on a re-run.

    python3 generate.py            # English master
    python3 generate.py en te ta   # all three

Requires: pip install playwright  (+ `playwright install chromium`, or set
          CHROMIUM_PATH to an existing chromium binary)
          ffmpeg with libx264 + aac
          Noto Indic fonts (apt-get install fonts-noto-core) for te/ta
          npx -y qrcode  for the closing QR
          ../../frontend/public/pumpini-logo.png
"""
import base64, os, shutil, string, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1080, 1920, 30

# ---------------------------------------------------------------- timeline --
# EVERY timing in the film lives here, in seconds. To shorten the film (e.g. a
# 28s cut for WhatsApp Status), pull these in — nothing else needs touching.
END = 36.0
SCENES = {                      # scene: (start, end) — 0.5s cross-fade each side
    's1': (0.0,  5.2),          # the ego line
    's2': (5.0, 12.2),          # Pumpini AI — today / tomorrow
    's3': (12.0, 23.0),         # the tied-tight chain, and the eye
    's4': (22.8, 28.2),         # six languages
    's5': (28.0, END),          # tagline, trial, QR
}
CUE = {                         # entrance time of each element
    'logo1': 0.35, 'tg1': 0.95, 'tg2': 1.75,
    'k1': 5.35, 'h1a': 5.95, 'h1b': 6.65, 'tile': 7.45,
    'count': 7.9, 'predict': 10.0, 's1line': 10.9,
    'k2': 12.35, 'node0': 12.9, 'nodestep': 0.42, 'line': 12.95,
    'pain': 17.3, 'eye': 18.7,
    'globe': 23.15, 'langstep': 0.22, 's3line': 25.5,
    'card5': 28.35, 'tl1': 28.95, 'tl2': 29.5, 'qr': 30.2, 'foot': 30.9, 'scan': 31.5,
}
POSTER_AT = 19.6                # the "nothing misses Pumpini's eyes" beat

# ------------------------------------------------------------------- copy ---
# Keys mirror marketing/whatsapp/generate.py exactly. To add a language, copy
# the 'en' entry there, translate, and paste it here under the same code.
LANGS = {
'en': dict(
  tg1='Your other businesses get your time.', tg2='Your petrol bunk gets Pumpini.',
  k1='PUMPINI AI', h1a='Presents the TODAY.', h1b='Predicts the TOMORROW.',
  s1='Ask anything. Get warned before money is lost.',
  k2='END-TO-END, TIED TIGHT',
  n=['Opening dip','Tanker in','Sales','Cash','Bank','Closing dip'],
  pain='Fuel loss. Cash shortages. Credit leakage…', h2='Nothing misses Pumpini’s eyes.',
  s3='Your team works in the language they think in.',
  foot='15-day free trial · No credit card',
  tl1='Control every drop.', tl2='Track every rupee.',
  scan='pumpini.in',
  # scene 2 labels
  today='TODAY, LIVE', l_sales='Sales today', l_litres='Litres sold',
  l_var='Cash variance', var='₹ 0', ok='matched',
  tomorrow='TOMORROW', predict='HSD runs dry in 2 days — indent 12,000 L now.'),
}

ICONS = ['\U0001F6E2️', '\U0001F69B', '⛽', '\U0001F4B5', '\U0001F3E6', '\U0001F6E2️']
LANG_PILLS = ['हिन्दी', 'தமிழ்',
              'తెలుగు', 'ಕನ್ನಡ',
              'मराठी', 'English']

# Illustrative figures for the scene-2 tile. NOT from any outlet — a shop
# window, not a claim. Edit freely; they are labelled illustrative in README.
DEMO = dict(sales=486250, litres=12480)

# ------------------------------------------------------------------ styles --
FONTS = ("'DM Sans','Noto Sans','Noto Sans Telugu','Noto Sans Telugu UI',"
         "'Noto Sans Tamil','Noto Sans Tamil UI','Noto Sans Devanagari',"
         "'Noto Sans Kannada',system-ui,sans-serif")

CSS = """
*{margin:0;padding:0;box-sizing:border-box}
body{width:1080px;height:1920px;overflow:hidden;color:#fff;background:#07150E;
  font-family:__FONTS__;-webkit-font-smoothing:antialiased}
.bg{position:absolute;inset:0;
  background:linear-gradient(160deg,#07150E 0%,#0C2418 55%,#07150E 100%)}
.blob{position:absolute;border-radius:50%;filter:blur(120px)}
.b1{width:900px;height:900px;left:-220px;top:-180px;background:rgba(77,195,232,.20);
  animation:drift1 24s ease-in-out infinite alternate}
.b2{width:820px;height:820px;right:-240px;bottom:-160px;background:rgba(255,107,0,.20);
  animation:drift2 20s ease-in-out infinite alternate}
@keyframes drift1{to{transform:translate(140px,120px) scale(1.15)}}
@keyframes drift2{to{transform:translate(-120px,-140px) scale(1.12)}}

.scene{position:absolute;inset:0;display:flex;flex-direction:column;
  justify-content:center;align-items:flex-start;padding:0 90px;opacity:0}

/* entrance primitives — delay is set inline, from CUE */
.rise{animation:rise .85s cubic-bezier(.2,.85,.25,1) both}
@keyframes rise{from{opacity:0;transform:translateY(46px)}to{opacity:1;transform:none}}
.pop{animation:pop .6s cubic-bezier(.2,1.4,.35,1) both}
@keyframes pop{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:scale(1)}}
.wipe{animation:wipe .9s cubic-bezier(.3,.9,.2,1) both}
@keyframes wipe{from{opacity:0;transform:translateX(-40px)}to{opacity:1;transform:none}}

.logo{height:104px}
.kicker{font-size:31px;font-weight:800;letter-spacing:.12em}
.kicker.cy{color:#7DD7F0}.kicker.gr{color:#4ADE80}.kicker.or{color:#FFA666}

/* 1 — the ego line */
.s1 .l1{font-size:64px;font-weight:700;color:rgba(255,255,255,.80);
  line-height:1.28;margin-top:78px}
.s1 .l2{font-size:82px;font-weight:900;color:#FF6B00;line-height:1.2;margin-top:26px}
.s1 .rule{width:190px;height:9px;border-radius:9px;margin-top:52px;
  background:linear-gradient(90deg,#FFB347,#FF6B00)}

/* 2 — presents the today, predicts the tomorrow */
.s2 h1{font-size:88px;font-weight:900;line-height:1.12;letter-spacing:-.02em;margin-top:22px}
.s2 h1 .tm{background:linear-gradient(90deg,#FFB347,#FF6B00);-webkit-background-clip:text;
  background-clip:text;color:transparent}
.tile{width:100%;margin-top:56px;border-radius:38px;padding:44px 48px;
  background:linear-gradient(135deg,rgba(77,195,232,.15),rgba(255,107,0,.12));
  border:3px solid rgba(77,195,232,.5);box-shadow:0 26px 80px rgba(0,0,0,.45)}
.tile .hd{font-size:27px;font-weight:800;letter-spacing:.14em;color:#7DD7F0;
  display:flex;align-items:center;gap:16px}
.dotlive{width:16px;height:16px;border-radius:50%;background:#4ADE80;
  box-shadow:0 0 0 0 rgba(74,222,128,.6);animation:blip 1.6s ease-out infinite}
@keyframes blip{70%{box-shadow:0 0 0 22px rgba(74,222,128,0)}100%{box-shadow:0 0 0 0 rgba(74,222,128,0)}}
.row{display:flex;align-items:baseline;justify-content:space-between;margin-top:30px}
.row .lb{font-size:34px;font-weight:600;color:rgba(255,255,255,.66)}
.row .vl{font-size:58px;font-weight:900;letter-spacing:-.01em}
.row .vl.ok{color:#4ADE80;font-size:50px}
.row .vl .u{font-size:34px;font-weight:700;color:rgba(255,255,255,.6);margin-left:10px}
.predict{margin-top:38px;border-radius:26px;padding:28px 32px;display:flex;gap:20px;
  align-items:flex-start;background:rgba(255,107,0,.16);border:2.5px solid rgba(255,107,0,.55)}
.predict .ic{font-size:40px;line-height:1}
.predict .tx{font-size:34px;font-weight:700;line-height:1.35;color:#FFD3AE}
.predict .tx b{display:block;font-size:25px;letter-spacing:.14em;color:#FF9A4D;margin-bottom:8px}
.s2 .sub{font-size:38px;font-weight:600;color:rgba(255,255,255,.76);margin-top:44px;line-height:1.35}

/* 3 — the chain, and the eye */
.chain{position:relative;margin-top:44px;width:100%}
.chain .track{position:absolute;left:51px;top:52px;bottom:52px;width:6px;border-radius:6px;
  transform-origin:top;background:repeating-linear-gradient(180deg,#FF6B00 0 20px,rgba(255,107,0,.22) 20px 34px)}
.node{display:flex;align-items:center;gap:34px;margin-bottom:26px;position:relative}
.node .ic{flex:none;width:104px;height:104px;border-radius:50%;background:#0C2418;
  border:5px solid #FF6B00;display:flex;align-items:center;justify-content:center;
  font-size:48px;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.node .lb{font-size:42px;font-weight:700;color:rgba(255,255,255,.86)}
.s3 .pain{font-size:42px;font-weight:700;color:rgba(255,166,120,.95);margin-top:34px;line-height:1.3}
.s3 .eyeline{display:flex;align-items:center;gap:24px;margin-top:26px}
.s3 .eyeline .ey{font-size:62px;color:#4ADE80}
.s3 .eyeline h2{font-size:62px;font-weight:900;line-height:1.16}

/* 4 — six languages */
.pills{display:flex;flex-wrap:wrap;gap:22px;margin-top:46px;max-width:920px}
.pill{font-size:48px;font-weight:900;padding:20px 38px;border-radius:99px;
  background:rgba(255,255,255,.07);border:2.5px solid rgba(255,255,255,.2)}
.pill.hi{background:rgba(255,107,0,.18);border-color:rgba(255,107,0,.6);color:#FFC08A}
.s4 .globe{font-size:92px}
.s4 .sub{font-size:40px;font-weight:600;color:rgba(255,255,255,.76);margin-top:52px;line-height:1.35}

/* 5 — the close */
.s5{justify-content:center;align-items:center}
.card5{width:100%;background:#fff;border-radius:52px;padding:70px 64px;text-align:center;
  box-shadow:0 40px 120px rgba(0,0,0,.55)}
.card5 img.logo{height:96px;margin-bottom:44px}
.card5 .tl1{font-size:68px;font-weight:900;color:#0C2418;line-height:1.2}
.card5 .tl2{font-size:68px;font-weight:900;color:#FF6B00;line-height:1.2;margin-top:8px}
.card5 .qr{width:300px;height:300px;margin:46px auto 0;border:6px solid #0C2418;
  border-radius:26px;padding:12px;background:#fff;display:block}
.card5 .scan{font-size:40px;font-weight:900;color:#FF6B00;margin-top:22px;letter-spacing:.01em}
.card5 .foot{display:inline-block;margin-top:30px;font-size:31px;font-weight:800;color:#0C2418;
  background:#F2F4F3;border-radius:99px;padding:16px 36px}
"""

def scene_css():
    """One opacity animation per scene — held, then cross-faded out."""
    out, fade = [], 0.5
    for name, (s, e) in SCENES.items():
        d = e - s
        p1, p2 = fade / d * 100, (d - fade) / d * 100
        out.append('@keyframes fade_%s{0%%{opacity:0}%.3f%%{opacity:1}'
                   '%.3f%%{opacity:1}100%%{opacity:0}}' % (name, p1, p2))
        out.append('.%s{animation:fade_%s %.3fs linear %.3fs both}' % (name, name, d, s))
    return '\n'.join(out)
