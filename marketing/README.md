# Pumpini marketing creatives

Reproducible generators for the campaign creatives, iterated and approved
June 2026. Final approved assets are committed under each `output/` folder.

## Creatives

| Creative | Spec | Languages |
|---|---|---|
| `whatsapp/` | 1080×1350 PNG (WhatsApp share image) | en, te, ta |
| `a5-handout/` | 2-page PDF, 154×216 mm = A5 + 3 mm bleed, 300 dpi | front: en/te/ta · back: en |

Shared structure (the recall chain: WhatsApp image → A5 front → website hero):
ego line ("Your other businesses get your time. Your petrol bunk gets Pumpini.")
→ Pumpini AI ("Presents the TODAY. Predicts the TOMORROW.")
→ tight-rope chain + pain line ("Nothing misses Pumpini's eyes.")
→ six languages strip → brand tagline.

The A5 back is the "Petrol Bunk Ready Reckoner" (4 daily checklists).
It is **English-only by design**: the manual, English checklist creates the
quiet pull toward "automatic, in your language" — Pumpini. Keep it English.

## Regenerating / adding a language

1. Open `generate.py` in the creative's folder, copy the `en` entry in
   `LANGS`, translate every value (keep `PUMPINI AI` and brand words as-is).
2. Run `python3 generate.py` from that folder.

Dependencies: `npx playwright` with chromium (`npx playwright install chromium`),
Noto Indic fonts (`apt-get install fonts-noto-core`), and for the A5 PDF:
`pip install img2pdf` and `npx -y qrcode`.
The logo is taken from `frontend/public/pumpini-logo.png`; the QR points to
https://pumpini.in.

Print notes (A5): tell the printer "A5 final size, bleed included, trim to
148×210 mm". 300 gsm art card + matte lamination holds up at an outlet.
