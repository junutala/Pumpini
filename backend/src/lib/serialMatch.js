// A NEAR-MISS SERIAL PROPOSES; IT NEVER ASSUMES.
//
// The engines misread serials in a small, boringly consistent way. From the 25/26-Aug
// Sri Balaji scans, every one of these came back on a machine the outlet really has:
//
//     17CH2900V   for  17EH2900V     one letter
//     H28253V     for  17CH2653V     a chewed prefix
//     17CH2659V   for  17CH2653V     one digit
//
// Today each of those matches nothing and the line is dropped in silence — the
// Nagole 20-Aug failure, where 0 of 28 lines matched and no screen said a word.
//
// THE RULE THIS IMPLEMENTS (§10, rule 2): a near miss PROPOSES the nearest known
// machine — one tap to confirm — and no close match gets a loud card. It never
// auto-accepts, because a serial we guessed silently is how one pump's meter lands on
// another pump, and the attribution instability measured on 26-Aug shows the reader is
// not reliable enough to be trusted on its own.

// Levenshtein, iterative and small — serials are a dozen characters at most.
function distance(a, b) {
  const s = String(a || '').toUpperCase(), t = String(b || '').toUpperCase();
  if (s === t) return 0;
  if (!s.length || !t.length) return Math.max(s.length, t.length);
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,                                   // delete
        cur[j - 1] + 1,                                // insert
        prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1)  // substitute
      );
    }
    prev = cur;
  }
  return prev[t.length];
}

// HOW CLOSE IS CLOSE ENOUGH — ONE EDIT, and the reason is measured rather than chosen.
//
// Two of Sri Balaji's OWN machines are two edits apart: 17CH2645V and 17CH2653V. At a
// threshold of two, a CORRECTLY READ serial would be offered as a different real pump —
// one machine's meter proposed onto another's, which is the exact harm this file exists
// to prevent. The first draft did that, and the test below caught it.
//
// One edit still reaches the real misreads that matter (17CH2900V → 17EH2900V,
// 17CH2659V → 17CH2653V). A badly chewed read like H28253V is FOUR edits away and gets
// the loud card instead — correctly, because a four-edit leap is a guess wearing a
// suggestion's clothes.
const MAX_EDITS = 1;
// A near miss must still be recognisably the same length of thing. 2444 is not a near
// miss of 17FH3756V, it is a failed read, and offering it as one insults the manager.
const MAX_LENGTH_GAP = 3;

// read     — the serial the engine returned
// known    — the serials configured at this outlet
// Returns { serial, distance } for the single nearest candidate, or null.
//
// AMBIGUITY IS NOT A PROPOSAL. If two known machines are equally close there is
// nothing to propose — offering either would be a coin toss dressed as a suggestion —
// so it returns null and the line goes to the loud card instead.
function proposeSerial(read, known) {
  const r = String(read || '').trim().toUpperCase();
  if (!r) return null;
  const all = (known || []).map(k => String(k || '').trim().toUpperCase()).filter(Boolean);

  // AN EXACT MATCH IS NOT A NEAR MISS. Skipping only that one candidate and carrying on
  // was the bug: a correctly-read serial then collected its NEIGHBOURS as proposals and
  // offered to change itself into a different real machine. If we already know it, say
  // nothing.
  if (all.includes(r)) return null;

  const candidates = [];
  for (const s of all) {
    if (Math.abs(s.length - r.length) > MAX_LENGTH_GAP) continue;
    const d = distance(r, s);
    if (d > 0 && d <= MAX_EDITS) candidates.push({ serial: s, distance: d });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  if (candidates.length > 1 && candidates[0].distance === candidates[1].distance) return null;
  return candidates[0];
}

module.exports = { proposeSerial, distance, MAX_EDITS, MAX_LENGTH_GAP };
