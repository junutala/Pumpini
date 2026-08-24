# Pumpini launch film — WORK IN PROGRESS, DO NOT RENDER YET

Third creative in the recall chain (WhatsApp image → A5 front → **this film** → the
two-fold brochure). 1080×1920 (9:16), 36s, silent with burned-in captions.

## Status (24-Aug-2026)

**The machinery is built and verified. The content is NOT approved.**

- ✅ Deterministic frame stepping — every CSS animation is paused and each frame is
  rendered by setting `Animation.currentTime`, so a frame is a pure function of its
  time. No real-time recording, no dropped frames, identical on a re-run.
- ✅ Brand CSS, timeline, and cue table.
- ⛔ **The copy in `LANGS` below is SUPERSEDED.** It is the abstract chain copy from
  the WhatsApp/A5 creatives. The agreed direction is now the owner's four USPs,
  written in the words already printed on the two-fold brochure ("TAKE PICTURE. Data
  saved. Evidence captured." / "RECONCILE FOR EVERY SHIFT. NOT DAY END." / "DATA AT
  FINGERTIPS — ANYWHERE. ANYTIME." / "DON'T TYPE. ASK."). Awaiting sign-off.
  The film reinforces the two-fold brochure and must complement it, so where the
  brochure already sets a line in type, the film uses that line verbatim.
- ⛔ **No product screens captured yet.** Blocked on a login for a dummy outlet
  (Dilsukhnagar / Nagole). See below.

## Why the screens must be recaptured, not reused

The screen pack dated 10-Aug-2026 cannot be used as-is:

1. It is **real outlets** — Adhoc Highway, Kamala, Highway — showing real money
   (YTD ₹6.23 Cr, credit receivables ₹32,44,535). The Cash Integrity screen **names
   six operators and flags them "Suspect"**. Named individuals must never appear in a
   marketing film.
2. They are **desktop captures**, but three of the four USPs promise "on your mobile
   phone". Desktop screens are illegible at 9:16 and undercut the claim.
3. They carry browser and OS chrome that must not ship: a ChatGPT tab, an "Ask Gemini"
   button, the Windows taskbar, and personal notification toasts.

The fix is one Playwright pass against a dummy outlet at a mobile viewport, which also
yields a clean AI-assistant exchange for USP 4.

## The AI Assistant panel — owner-set 24-Aug-2026, do not re-open

The two-fold brochure's AI Assistant panel shows the assistant answering "Diesel has
the most stock at 8,302 L" and then correcting itself: "Wait, I need to correct that —
Petrol actually has the most at 9,789 L."

A previous session flagged this as a defect and advised holding the print run. **The
owner overruled it, and the ruling stands:** it is the real answer the assistant gave,
everyone knows an AI can be wrong, and showing it is an honest reproduction. Printing
and distribution had already begun in any case.

**The consequence for this film:** the assistant exchange is captured LIVE and shown as
it comes. Do not fish for a clean answer, do not re-run until the assistant looks good,
do not edit the reply. Whatever it says is what goes in. Honesty is the brand position
here, not polish.

The outlet anonymisation in that same brochure screenshot is only half applied — the
tabs read "Outlet A/B/C Filling Station" while the BY OUTLET rows and the margin panel
still read "Kamala Filling Station" and "Highway Filling Station". Not a defect to fix
retrospectively; noted because the film's screens are being recaptured on dummy outlets
and must not repeat it.

## Brand colours

Verified from source, not from eye:

| Token | Hex | Where |
|---|---|---|
| Brand orange | `#FF6B00` | 165 uses across `frontend/src` |
| Dark | `#0C2418` | |
| Deepest | `#07150E` | |
| Green | `#4ADE80` | |
| Cyan | `#4DC3E8` / `#7DD7F0` | |

All chrome, type, overlays and transitions in the film are brand-only. **Note that
`frontend/tailwind.config.js` defines the fuel product colours deliberately off-brand**
(petrol `#3b82f6`, diesel `#f59e0b`, CNG `#10b981`, premium `#8b5cf6`), and those are
baked into every chart in every screenshot. They cannot be repainted in the film — only
by changing the palette and recapturing.

## Closing frame

Carries the **WhatsApp QR** (+91 78421 78350), matching the brochure's funnel — not the
`pumpini.in` QR used on the A5 handout.

## Running it (once content is approved)

    pip install playwright && playwright install chromium
    apt-get install -y ffmpeg fonts-noto-core
    python3 generate.py            # English master
    python3 generate.py en te ta   # all three

Set `CHROMIUM_PATH` to reuse an existing chromium binary instead of downloading one.
