# Pumpini launch film

Third creative in the recall chain (WhatsApp image → A5 front → **this film** → the
two-fold brochure). 1080×1920 (9:16), 36s, silent with burned-in captions.

## Status (24-Aug-2026)

**The film renders end to end, with product screens in place.**

`output/pumpini-film-en.mp4` — 1080×1920, 36.0s, H.264 + silent AAC, ~4.4 MB. Six beats:
TAKE PICTURE → capture → reconcile-every-shift-not-day-end → data at fingertips →
don't type, ask → the close.

- ✅ Deterministic frame stepping — every CSS animation is paused and each frame is
  rendered by setting `Animation.currentTime`, so a frame is a pure function of its
  time. No real-time recording, no dropped frames, identical on a re-run.
- ✅ Copy is the approved brochure wording, verbatim.
- ✅ Closing QR verified by decoding it out of the *encoded video frame*, not just the
  source PNG: it resolves to `https://wa.me/917842178350`. It survives H.264.
- ✅ The wordmark is cropped from the brand logo at build time, because the logo bakes
  the tagline in and the close card sets that same tagline in 70px type.
- ✅ A persistent wordmark bug rides every frame from the first, so a forwarded clip
  carries the brand with it — and so the opening frame is never blank in a thumbnail.
- ✅ The trial and the price are **separate** claims. Run together as one line,
  "15-day free trial · Less than ₹45 a day" reads as though the trial costs ₹45 a day.
  Price verified with the owner: ₹1,299/month ÷ 30 = ₹43.30/day.
- ✅ Product screens cropped from the supplied PDFs — see the table below for the
  source and crop box of each, and the two outlet-name leaks that cropping removed.

## The product screens — where each one came from

The owner directed (24-Aug) that the screens come from the supplied PDFs rather than
waiting on a recapture. `screens/` holds the crops; they are committed so the film
rebuilds from repository contents alone.

| File | Source | Crop box (native px) | Shown at |
|---|---|---|---|
| `capture-gauge.png` | screens PDF, img 004 | `(195,345)-(730,545)` | 896 px |
| `credit-invoice.png` | screens PDF, img 010 | `(195,200)-(880,430)` | 896 px |
| `dashboard.png` | brochure PDF, img 026 | `(430,400)-(830,660)` | 820 px |
| `ai-assistant.png` | brochure PDF, img 027 | `(8,55)-(442,350)` | 860 px |

Each is upscaled with Lanczos and given a light unsharp mask. **Crop tight, not wide.**
A whole desktop screen shrunk into a 1080-wide vertical frame is unreadable on a phone —
the first cut made exactly that mistake. Show the one element the beat is about.

Two name leaks were caught by *looking at the crops*, not by trusting the framing:

- the shift selector on the Start Shift screen read **"Shift 1 — Adhoc"**;
- the grey note inside every dashboard card read **"costed on Highway Filling Station's
  rate"**.

Both are outside the final crop boxes. Every crop also excludes the sidebar (it carries
the outlet name and the logged-in user), the browser chrome, the Windows taskbar, and
every operator name. **The Cash Integrity screen is never used** — it names six operators
and flags them "Suspect".

The dashboard crop comes from the brochure because the owner had already anonymised the
outlets there to "Outlet A / B / C". Its money figures are real but already in print.

### Two product defects visible in these screens

Recorded because they are on camera, not to re-argue them:

- **The assistant's reply renders raw markdown.** It shows `**Diesel**` and `**8,302 L**`
  literally, asterisks and all, instead of bold. That is a rendering bug in the chat
  panel, and it is legible in the film.
- The 10-Aug End Shift screen labels nozzles `N1.1`, `N1.2` — the naming the owner
  banned on 20-Aug in favour of `<pump serial>.<nozzle number>`. That screen is not used
  in the film, partly for this reason.

## Blocked: capture from a live app is not possible here

Credentials are not the problem. The session's egress policy denies the hosts outright:

    pumpini.in          CONNECT tunnel failed, 403
    staging.pumpini.in  unreachable
    api.pumpini.in      unreachable

The screens above are therefore cropped from PDFs. A mobile-viewport recapture — where
the type is natively large instead of upscaled — remains the way to make them properly
crisp, and needs a machine that can reach the app.

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
