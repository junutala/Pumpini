# Voice-Triggered Forms — Design Note

**Status:** Plan / not yet implemented
**Branch:** `claude/voice-triggered-forms-1aa121`
**Last updated:** 2026-06-22

## 1. Goal

We already have voice **input** (a clerk speaks, the transcript fills POS form
fields). The new idea is voice **navigation**: attach a spoken "voice tag" to a
frequently-used form, and when the user calls out that tag, the app **opens the
form**. This should work anywhere after login — including straight from the
dashboard the user lands on.

We are deliberately **not** doing this for every form. Start with a small,
high-frequency set (e.g. **Dipstick Reading**, **Shift Start**, **Shift End**).

## 2. What already exists (codebase findings)

- **Global mic, app-wide.** `frontend/src/components/shared/FloatingChat.js`
  records mic audio (`MediaRecorder`) on every authenticated page and POSTs it to
  `POST /api/voice/transcribe`. It is mounted inside `AppShell`, so it is present
  the moment the user lands on `/dashboard` after login.
- **Speech-to-text backend.** `backend/src/routes/voice.js` calls **Sarvam AI**
  (`saaras:v3`, codemix mode) and returns `{ transcript, parsed }`. Supports
  en/hi/ta/te/kn/mr. This pipeline is **speaker-independent** — it converts
  speech to text; it does not compare one person's voice against another's.
- **POS field-fill** uses `parsePOSCommand()` in `voice.js` (quantity / entry
  type / payment mode / fuel type via hardcoded keyword dictionaries).
- **Navigation is a clean registry.** `NAV_GROUPS` in
  `frontend/src/components/shared/Sidebar.js` lists every form with `key`,
  `href` (route), `perm`, and optional `roles`. Opening a form is just
  `router.push(href)`. Visibility is gated by `isVisible()` (role + `can(perm)`).
- **Post-login landing** is `/dashboard` (`frontend/src/app/page.js`).
- **No voice-tag concept today** — no DB table, alias, or keyword attached to a
  form; `parsePOSCommand` only extracts POS fields, not "open form X" intents.

## 3. Phase 1 — Static voice-tag registry (recommended first build)

Frontend-only. Reuses the existing global mic. No backend changes.

**Flow:** mic → `/api/voice/transcribe` → transcript → **new matcher** → if a
known tag matches, `router.push(href)`; otherwise fall back to the existing AI
chat behavior (no regression).

### File-by-file

1. **`frontend/src/lib/nav.js` (new)** — Move `NAV_GROUPS` out of `Sidebar.js`
   into a shared, exported module (single source of truth for `href`/`perm`/
   `roles`). Add a `tags: [...]` array of spoken aliases per item, e.g.
   - `pos` → `['pos','sale','billing','pump entry']`
   - `startshift` → `['start shift','open shift','begin shift']`
   - `endshift` → `['end shift','close shift']`
   - `dipstick` → `['dipstick','dip reading','stick reading']`
   `Sidebar.js` imports `NAV_GROUPS` from here — no behavior change.

2. **`frontend/src/lib/voiceForms.js` (new)** — Export
   `matchFormCommand(transcript, { can, role })` that:
   1. Normalizes the transcript (lowercase / trim).
   2. Optionally strips an "open intent" prefix (`open`, `go to`, `show`,
      `start`, `take me to`) so "open POS" and "POS" both work.
   3. Scores each nav item by tag match (exact phrase > word overlap),
      **applying the same `isVisible` gate Sidebar uses** (role + `can(perm)`),
      so a clerk can never voice-jump to an owner-only form.
   4. Returns `{ href, key, label }` above a confidence threshold, else `null`.

3. **`frontend/src/components/shared/FloatingChat.js` (edit)** — Add `useRouter`
   (already have `can` and `user`). In the `rec.onstop` handler, after getting
   `data.transcript`, call `matchFormCommand`. On match → show a brief
   "Opening <label>…" line and `router.push(href)` (do **not** call the AI).
   On no match → existing `send(transcript)` AI fallback.
   *Optional:* run typed input through the matcher too, so typing "open POS" works.

### Caveats / decisions

- **AI-feature gating.** The mic only renders when `can('ai_chat.use')` is true
  (`FloatingChat.js`). Voice navigation inherits that gate. Default: leave gated
  for v1; relax if voice nav should work without the AI chat plan feature.
- **Ambiguity.** On weak/multiple matches, fall back to AI chat rather than
  guessing wrong. A "Did you mean…?" chip list is a later refinement.
- **Backend untouched.** Matching needs the user's permission context (client
  side), so Phase 1 is purely frontend.

**Effort:** small/medium, frontend-only.

## 4. Phase 2 — Manager-enrolled voice samples (optional enhancement)

Idea: in **station settings**, let the manager record themselves saying each of
the 3 daily-use form names, and personalize the tags to how *they* actually
speak. This improves match rate for accents, dialects, and code-mixed phrasing.

**Important architecture note:** because the stack is STT (speaker-independent),
the practical win is **transcript-based personalization**, not audio-to-audio
voiceprint matching.

- **Option A (recommended).** Capture the sample in settings, run it through the
  **existing** `/api/voice/transcribe`, and store the resulting **transcript**
  as that station's personalized tag(s) for the form. No new ML. Ask the manager
  to repeat each name 2–3 times for robustness.
- **Option B (future, heavy).** Store raw audio and do acoustic keyword-spotting
  / speaker embeddings. The one place this genuinely beats STT is the **noisy
  forecourt** (pumps/traffic), and it could run offline on-device — but it's a
  real ML build (collection, training, inference). Not for now.

### Phase 2 trade-offs

- Changes the storage model from purely static to **per-station/per-manager** —
  needs a small persistence layer (station/manager → form → captured tag[s]).
- **Privacy/consent.** Storing audio is voice data → needs explicit consent and
  a retention policy. Storing **only the transcript** largely sidesteps this and
  is another reason to prefer Option A.
- **Keep the static tags as a fallback** so a manager who hasn't enrolled yet
  still gets voice navigation on day one; their samples just refine it.

## 5. Open decisions for when we pick this up

- Confirm the initial 3 forms (proposed: Dipstick Reading, Shift Start, Shift End).
- Phase 1 only, or Phase 1 + Phase 2 enrollment together?
- Should voice navigation be available even when the AI chat plan feature is off?
- Seed tags for all forms, or only the high-frequency set?
