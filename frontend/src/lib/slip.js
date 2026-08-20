// frontend/src/lib/slip.js
//
// Why a scanned slip line was refused, in words a manager can act on.
//
// The DECISION is the backend's — slipParser marks a line `legible:false` and says
// why in `reject_reason`. This only turns that into a sentence, and it lives here
// rather than in a page because Shift Open and Shift Close both need the same one:
// two copies would drift, and the manager would be told different things about the
// same nozzle depending on which screen he was standing on.
export function rejectNote(line, tc) {
  if (!line || line.legible !== false) return null;
  if (line.reject_reason === 'implied_price_out_of_band') {
    return tc('slip.rejPrice', 'implies ₹{p}/L')
      .replace('{p}', line.implied_price == null ? '?' : line.implied_price);
  }
  if (line.reject_reason === 'no_amount_to_cross_check') {
    return tc('slip.rejNoAmount', 'amount not read, nothing to check it against');
  }
  if (line.swapped_amount_for_volume) {
    return tc('slip.rejSwap', 'rupee/litre swap');
  }
  return tc('slip.rejUnclear', 'digits unclear');
}
