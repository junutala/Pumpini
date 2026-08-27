// Front-of-house feature switches that are NOT per-outlet settings.
//
// A per-outlet behaviour belongs on `station_settings` (products_enabled,
// self_settlement_enabled, …). This file is for the other kind: something turned
// off for EVERYONE while a decision is pending. One constant, read by every screen
// that shows the thing, so turning it back on is one line rather than a hunt.

// THE COMPOSITE "SCAN ALL SLIPS (ONE PHOTO)" BUTTON.
//
// Off for everyone, owner-set 27-Aug-2026. Srinivas asked for it to be taken away
// from managers; the owner's instruction was then simply "just hide this composite
// scan button for ALL for now" rather than build a permission for it yet.
//
// WHAT IS AND IS NOT AFFECTED:
//   - hidden: the capture button and its "Retake / clear" on Shift Start and Shift End
//   - untouched: the PER-NOZZLE camera, which is a different route (/pos-meter) and
//     the attendant's own path
//   - untouched: the "Slips scanned" strip, which is read-only evidence behind
//     readings already taken — hiding the camera must not hide the audit trail
//   - untouched: POST /api/reconcile/parse-slips, which stays live. Nothing calls it
//     while this is false, and it is how the button comes back
//
// WHEN IT COMES BACK it is expected to return as an OWNER-ONLY capability, via a
// `reconcile.composite` permission rather than a second route — see the notes in
// backend/src/middleware/permissions.js on how owner = the whole catalog. Flipping
// this constant to true without that guard restores it for managers too.
export const COMPOSITE_SLIP_SCAN = false;
