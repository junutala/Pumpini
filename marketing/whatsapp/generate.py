#!/usr/bin/env python3
"""Pumpini WhatsApp creative generator (1080x1350).

To add a language: copy the 'en' dict in LANGS, translate every value,
then run:  python3 generate.py
Requires:  npx playwright (chromium installed), Noto Indic fonts,
           ../../frontend/public/pumpini-logo.png
"""
import os, shutil, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))

LANGS = {
'en': dict(
  tg1='Your other businesses get your time.', tg2='Your petrol bunk gets Pumpini.',
  k1='PUMPINI AI', h1a='Presents the TODAY.', h1b='Predicts the TOMORROW.',
  s1='Ask anything. Get warned before money is lost.',
  k2='END-TO-END, TIED TIGHT',
  n=['Opening dip','Tanker in','Sales','Cash','Bank','Closing dip'],
  pain='Fuel loss. Cash shortages. Credit leakage\u2026', h2='Nothing misses Pumpini\u2019s eyes.',
  s3='Your team works in the language they think in.',
  foot='15-day free trial \u00b7 No credit card',
  tl1='Control every drop.', tl2='Track every rupee.',
  scan='Scan to see your bunk\u2019s tomorrow'),
'te': dict(
  tg1='\u0c2e\u0c3f\u0c17\u0c24\u0c3e \u0c35\u0c4d\u0c2f\u0c3e\u0c2a\u0c3e\u0c30\u0c3e\u0c32\u0c15\u0c41 \u0c2e\u0c40 \u0c38\u0c2e\u0c2f\u0c02.', tg2='\u0c2e\u0c40 \u0c2a\u0c46\u0c1f\u0c4d\u0c30\u0c4b\u0c32\u0c4d \u0c2c\u0c02\u0c15\u0c4d\u200c\u0c15\u0c41 Pumpini.',
  k1='PUMPINI AI', h1a='\u0c08\u0c30\u0c4b\u0c1c\u0c41\u0c28\u0c41 \u0c1a\u0c42\u0c2a\u0c3f\u0c38\u0c4d\u0c24\u0c41\u0c02\u0c26\u0c3f.', h1b='\u0c30\u0c47\u0c2a\u0c41\u0c28\u0c41 \u0c05\u0c02\u0c1a\u0c28\u0c3e \u0c35\u0c47\u0c38\u0c4d\u0c24\u0c41\u0c02\u0c26\u0c3f.',
  s1='\u0c0f\u0c26\u0c48\u0c28\u0c3e \u0c05\u0c21\u0c17\u0c02\u0c21\u0c3f. \u0c21\u0c2c\u0c4d\u0c2c\u0c41 \u0c2a\u0c4b\u0c15\u0c2e\u0c41\u0c02\u0c26\u0c47 \u0c39\u0c46\u0c1a\u0c4d\u0c1a\u0c30\u0c3f\u0c15.',
  k2='\u0c2e\u0c4a\u0c26\u0c1f\u0c3f \u0c28\u0c41\u0c02\u0c1a\u0c3f \u0c1a\u0c3f\u0c35\u0c30\u0c3f \u0c35\u0c30\u0c15\u0c41 \u2014 \u0c17\u0c1f\u0c4d\u0c1f\u0c3f \u0c32\u0c46\u0c15\u0c4d\u0c15',
  n=['\u0c13\u0c2a\u0c46\u0c28\u0c3f\u0c02\u0c17\u0c4d \u0c21\u0c3f\u0c2a\u0c4d','\u0c1f\u0c4d\u0c2f\u0c3e\u0c02\u0c15\u0c30\u0c4d','\u0c05\u0c2e\u0c4d\u0c2e\u0c15\u0c3e\u0c32\u0c41','\u0c15\u0c4d\u0c2f\u0c3e\u0c37\u0c4d','\u0c2c\u0c4d\u0c2f\u0c3e\u0c02\u0c15\u0c4d','\u0c15\u0c4d\u0c32\u0c4b\u0c1c\u0c3f\u0c02\u0c17\u0c4d \u0c21\u0c3f\u0c2a\u0c4d'],
  pain='\u0c2b\u0c4d\u0c2f\u0c42\u0c2f\u0c32\u0c4d \u0c28\u0c37\u0c4d\u0c1f\u0c02. \u0c15\u0c4d\u0c2f\u0c3e\u0c37\u0c4d \u0c15\u0c4a\u0c30\u0c24. \u0c15\u0c4d\u0c30\u0c46\u0c21\u0c3f\u0c1f\u0c4d \u0c32\u0c40\u0c15\u0c47\u0c1c\u0c4d\u2026',
  h2='Pumpini \u0c15\u0c02\u0c1f\u0c3f\u0c15\u0c3f \u0c0f\u0c26\u0c40 \u0c24\u0c2a\u0c4d\u0c2a\u0c26\u0c41.',
  s3='\u0c2e\u0c40 \u0c1f\u0c40\u0c2e\u0c4d \u0c06\u0c32\u0c4b\u0c1a\u0c3f\u0c02\u0c1a\u0c47 \u0c2d\u0c3e\u0c37\u0c32\u0c4b\u0c28\u0c47 \u0c2a\u0c28\u0c3f \u0c1a\u0c47\u0c38\u0c4d\u0c24\u0c41\u0c02\u0c26\u0c3f.',
  foot='15 \u0c30\u0c4b\u0c1c\u0c41\u0c32 \u0c09\u0c1a\u0c3f\u0c24 \u0c1f\u0c4d\u0c30\u0c2f\u0c32\u0c4d \u00b7 \u0c15\u0c3e\u0c30\u0c4d\u0c21\u0c4d \u0c05\u0c35\u0c38\u0c30\u0c02 \u0c32\u0c47\u0c26\u0c41',
  tl1='\u0c2a\u0c4d\u0c30\u0c24\u0c3f \u0c1a\u0c41\u0c15\u0c4d\u0c15\u0c2a\u0c48 \u0c28\u0c3f\u0c2f\u0c02\u0c24\u0c4d\u0c30\u0c23.', tl2='\u0c2a\u0c4d\u0c30\u0c24\u0c3f \u0c30\u0c42\u0c2a\u0c3e\u0c2f\u0c3f\u0c2a\u0c48 \u0c28\u0c3f\u0c18\u0c3e.',
  scan='\u0c38\u0c4d\u0c15\u0c3e\u0c28\u0c4d \u0c1a\u0c47\u0c2f\u0c02\u0c21\u0c3f \u2014 \u0c2e\u0c40 \u0c2c\u0c02\u0c15\u0c4d \u0c30\u0c47\u0c2a\u0c1f\u0c3f\u0c28\u0c3f \u0c1a\u0c42\u0c21\u0c02\u0c21\u0c3f'),
'ta': dict(
  tg1='\u0bae\u0bb1\u0bcd\u0bb1 \u0baa\u0bbf\u0b9a\u0bbf\u0ba9\u0bb8\u0bcd\u0b95\u0bb3\u0bc1\u0b95\u0bcd\u0b95\u0bc1 \u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0ba8\u0bc7\u0bb0\u0bae\u0bcd.', tg2='\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0baa\u0bc6\u0b9f\u0bcd\u0bb0\u0bcb\u0bb2\u0bcd \u0baa\u0b99\u0bcd\u0b95\u0bbf\u0bb1\u0bcd\u0b95\u0bc1 Pumpini.',
  k1='PUMPINI AI', h1a='\u0b87\u0ba9\u0bcd\u0bb1\u0bc8\u0b95\u0bcd \u0b95\u0bbe\u0b9f\u0bcd\u0b9f\u0bc1\u0bae\u0bcd.', h1b='\u0ba8\u0bbe\u0bb3\u0bc8\u0baf\u0bc8\u0b95\u0bcd \u0b95\u0ba3\u0bbf\u0b95\u0bcd\u0b95\u0bc1\u0bae\u0bcd.',
  s1='\u0b8e\u0ba4\u0bc8\u0baf\u0bc1\u0bae\u0bcd \u0b95\u0bc7\u0bb3\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd. \u0baa\u0ba3\u0bae\u0bcd \u0baa\u0bcb\u0b95\u0bc1\u0bae\u0bc1\u0ba9\u0bcd \u0b8e\u0b9a\u0bcd\u0b9a\u0bb0\u0bbf\u0b95\u0bcd\u0b95\u0bc8.',
  k2='\u0bae\u0bc1\u0ba4\u0bb2\u0bbf\u0bb2\u0bbf\u0bb0\u0bc1\u0ba8\u0bcd\u0ba4\u0bc1 \u0b87\u0bb1\u0bc1\u0ba4\u0bbf \u0bb5\u0bb0\u0bc8 \u2014 \u0b87\u0bb1\u0bc1\u0b95\u0bcd\u0b95\u0bae\u0bbe\u0ba9 \u0b95\u0ba3\u0b95\u0bcd\u0b95\u0bc1',
  n=['\u0b93\u0baa\u0bcd\u0baa\u0ba9\u0bbf\u0b99\u0bcd \u0b9f\u0bbf\u0baa\u0bcd','\u0b9f\u0bc7\u0b99\u0bcd\u0b95\u0bb0\u0bcd','\u0bb5\u0bbf\u0bb1\u0bcd\u0baa\u0ba9\u0bc8','\u0baa\u0ba3\u0bae\u0bcd','\u0bb5\u0b99\u0bcd\u0b95\u0bbf','\u0b95\u0bc1\u0bb3\u0bcb\u0b9a\u0bbf\u0b99\u0bcd \u0b9f\u0bbf\u0baa\u0bcd'],
  pain='\u0b8e\u0bb0\u0bbf\u0baa\u0bca\u0bb0\u0bc1\u0bb3\u0bcd \u0b87\u0bb4\u0baa\u0bcd\u0baa\u0bc1. \u0baa\u0ba3\u0baa\u0bcd \u0baa\u0bb1\u0bcd\u0bb1\u0bbe\u0b95\u0bcd\u0b95\u0bc1\u0bb1\u0bc8. \u0b95\u0b9f\u0ba9\u0bcd \u0b95\u0b9a\u0bbf\u0bb5\u0bc1\u2026',
  h2='Pumpini \u0b95\u0ba3\u0bcd\u0ba3\u0bbf\u0bb2\u0bcd \u0b8e\u0ba4\u0bc1\u0bb5\u0bc1\u0bae\u0bcd \u0ba4\u0baa\u0bcd\u0baa\u0bbe\u0ba4\u0bc1.',
  s3='\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b95\u0bc1\u0bb4\u0bc1 \u0ba8\u0bbf\u0ba9\u0bc8\u0b95\u0bcd\u0b95\u0bc1\u0bae\u0bcd \u0bae\u0bca\u0bb4\u0bbf\u0baf\u0bbf\u0bb2\u0bc7\u0baf\u0bc7 \u0bb5\u0bc7\u0bb2\u0bc8.',
  foot='15 \u0ba8\u0bbe\u0bb3\u0bcd \u0b87\u0bb2\u0bb5\u0b9a \u0b9a\u0bcb\u0ba4\u0ba9\u0bc8 \u00b7 \u0b95\u0bbe\u0bb0\u0bcd\u0b9f\u0bc1 \u0ba4\u0bc7\u0bb5\u0bc8\u0baf\u0bbf\u0bb2\u0bcd\u0bb2\u0bc8',
  tl1='\u0b92\u0bb5\u0bcd\u0bb5\u0bca\u0bb0\u0bc1 \u0ba4\u0bc1\u0bb3\u0bbf\u0baf\u0bc1\u0bae\u0bcd \u0b95\u0b9f\u0bcd\u0b9f\u0bc1\u0baa\u0bcd\u0baa\u0bbe\u0b9f\u0bcd\u0b9f\u0bbf\u0bb2\u0bcd.', tl2='\u0b92\u0bb5\u0bcd\u0bb5\u0bca\u0bb0\u0bc1 \u0bb0\u0bc2\u0baa\u0bbe\u0baf\u0bc1\u0bae\u0bcd \u0b95\u0ba3\u0bcd\u0b95\u0bbe\u0ba3\u0bbf\u0baa\u0bcd\u0baa\u0bbf\u0bb2\u0bcd.',
  scan='\u0bb8\u0bcd\u0b95\u0bc7\u0ba9\u0bcd \u0b9a\u0bc6\u0baf\u0bcd\u0baf\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u2014 \u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0baa\u0b99\u0bcd\u0b95\u0bbf\u0ba9\u0bcd \u0ba8\u0bbe\u0bb3\u0bc8\u0baf\u0bc8\u0baa\u0bcd \u0baa\u0bbe\u0bb0\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd'),
}
ICONS = ['\U0001F6E2\uFE0F','\U0001F69B','\u26FD','\U0001F4B5','\U0001F3E6','\U0001F6E2\uFE0F']

def nodes_html(labels):
    return ''.join('<div class="node"><div class="ic">%s</div><div class="lb">%s</div></div>' % (ic, lb)
                   for ic, lb in zip(ICONS, labels))

TEMPLATE = '<!doctype html><html><head><meta charset="utf-8"><style>\n*{{margin:0;padding:0;box-sizing:border-box}}\nbody{{width:1080px;height:1350px;font-family:\'DM Sans\',\'Noto Sans\',\'Noto Sans Telugu\',\'Noto Sans Telugu UI\',\'Noto Sans Tamil\',\'Noto Sans Tamil UI\',system-ui,sans-serif;\n  color:#fff;overflow:hidden;display:flex;flex-direction:column;background:#fff}}\n.strip-top{{background:#fff;height:118px;display:flex;align-items:center;justify-content:space-between;padding:0 60px;flex:none}}\n.strip-top img{{height:78px}}\n.strip-top .tag{{font-size:22px;color:#475259;font-weight:700;text-align:right;line-height:1.5}}\n.strip-top .tagx{{color:#FF6B00;font-weight:900;font-size:24px}}\n.mid{{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;padding:30px 60px;\n  background:radial-gradient(800px 500px at 12% -5%, rgba(77,195,232,.20), transparent 55%),\n             radial-gradient(700px 500px at 95% 105%, rgba(255,107,0,.18), transparent 55%),\n             linear-gradient(160deg,#07150E 0%,#0C2418 55%,#07150E 100%)}}\n.card{{position:relative;border-radius:26px;padding:32px 38px}}\n.rank{{position:absolute;top:16px;right:26px;font-size:84px;font-weight:900;color:rgba(255,255,255,.07);line-height:1}}\n.k{{font-size:21px;font-weight:800;letter-spacing:.1em;margin-bottom:12px}}\n.c1{{background:linear-gradient(135deg,rgba(77,195,232,.16),rgba(255,107,0,.13));border:2px solid rgba(77,195,232,.55);\n  box-shadow:0 14px 50px rgba(77,195,232,.18)}}\n.c1 .k{{color:#7DD7F0}}\n.c1 h1{{font-size:53px;font-weight:900;line-height:1.16;letter-spacing:-.015em}}\n.c1 h1 .tm{{background:linear-gradient(90deg,#FFB347,#FF6B00);-webkit-background-clip:text;background-clip:text;color:transparent}}\n.c1 .s{{font-size:26px;color:rgba(255,255,255,.78);margin-top:13px;font-weight:600}}\n.c2{{background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.16)}}\n.c2 .k{{color:#4ADE80}}\n.chain{{display:flex;align-items:flex-start;justify-content:space-between;margin:18px 0 4px;position:relative}}\n.chain::before{{content:\'\';position:absolute;top:37px;left:40px;right:40px;height:4px;\n  background:repeating-linear-gradient(90deg,#FF6B00 0 14px,rgba(255,107,0,.25) 14px 24px);border-radius:4px}}\n.node{{position:relative;z-index:1;text-align:center;width:142px}}\n.node .ic{{width:76px;height:76px;border-radius:50%;background:#0C2418;border:3px solid #FF6B00;\n  display:flex;align-items:center;justify-content:center;font-size:36px;margin:0 auto 10px;\n  box-shadow:0 6px 18px rgba(0,0,0,.45)}}\n.node .lb{{font-size:18.5px;font-weight:700;color:rgba(255,255,255,.75);line-height:1.25}}\n.pain{{font-size:25px;font-weight:700;text-align:center;margin-top:18px;color:rgba(255,166,120,.92);letter-spacing:.01em}}\n.c2 h2{{font-size:39px;font-weight:900;text-align:center;margin-top:6px;color:#fff}}\n.c2 h2 .eye{{color:#4ADE80}}\n.c3{{background:rgba(255,255,255,.05);border:1.5px solid rgba(255,255,255,.16);display:flex;align-items:center;gap:28px;padding:26px 38px}}\n.c3 .globe{{font-size:52px}}\n.c3 .langs{{font-size:30px;font-weight:900;line-height:1.5}}\n.c3 .s{{font-size:22px;color:rgba(255,255,255,.66);font-weight:600;margin-top:6px}}\n.strip-bot{{background:#fff;flex:none;text-align:center;padding:34px 60px}}\n.strip-bot .tagline{{font-size:42px;font-weight:900;margin-bottom:10px}}\n.strip-bot .tagline .g{{color:#0C2418}}\n.strip-bot .tagline .o{{color:#FF6B00}}\n.pill{{display:inline-block;background:linear-gradient(135deg,#FF8C3B,#FF6B00);color:#fff;font-size:30px;font-weight:900;\n  border-radius:99px;padding:14px 42px;box-shadow:0 10px 28px rgba(255,107,0,.35)}}\n.strip-bot .note{{font-size:22px;color:#5b6570;font-weight:600}}\n</style></head><body>\n  <div class="strip-top"><img src="pumpini-logo.png"><div class="tag">{tg1}<br><span class="tagx">{tg2}</span></div></div>\n  <div class="mid">\n    <div class="card c1"><div class="rank">1</div>\n      <div class="k">✨ {k1}</div>\n      <h1>{h1a}<br><span class="tm">{h1b}</span></h1>\n      <div class="s">{s1}</div>\n    </div>\n    <div class="card c2"><div class="rank">2</div>\n      <div class="k">🔗 {k2}</div>\n      <div class="chain">{nodes}</div>\n      <div class="pain">{pain}</div>\n      <h2><span class="eye">👁</span> {h2}</h2>\n    </div>\n    <div class="card c3"><div class="rank">3</div>\n      <div class="globe">🌐</div>\n      <div>\n        <div class="langs">हिन्दी · தமிழ் · తెలుగు · ಕನ್ನಡ · मराठी · English</div>\n        <div class="s">{s3}</div>\n      </div>\n    </div>\n  </div>\n  <div class="strip-bot">\n    <div class="tagline"><span class="g">{tl1}</span> <span class="o">{tl2}</span></div>\n    <div class="note">{foot}</div>\n  </div>\n</body></html>'

def main():
    out = os.path.join(HERE, 'output')
    os.makedirs(out, exist_ok=True)
    shutil.copy(os.path.join(HERE, '../../frontend/public/pumpini-logo.png'),
                os.path.join(out, 'pumpini-logo.png'))
    for code, t in LANGS.items():
        html = TEMPLATE.format(nodes=nodes_html(t['n']),
                               **{k: v for k, v in t.items() if k not in ('n', 'scan')})
        page = os.path.join(out, 'wa-%s.html' % code)
        open(page, 'w', encoding='utf-8').write(html)
        png = os.path.join(out, 'pumpini-whatsapp-%s.png' % code)
        subprocess.run(['npx', 'playwright', 'screenshot', '--viewport-size=1080,1350',
                        '--wait-for-timeout=1500', 'file://' + page, png], check=True)
        print('rendered', png)

if __name__ == '__main__':
    main()
