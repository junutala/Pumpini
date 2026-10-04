// services/mrpGuard.js
//
// WHO MAY CHANGE A PRODUCT'S MRP. Owner, 04-Oct-2026: "restrict MRP edits to managers."
//
// Since #447 the MRP in the catalogue IS the price every product sale is charged at —
// the till has no price box, only a discount. So the MRP is the one lever on product
// prices, and it had no guard: the Catalogue and Stock screens were hidden from
// non-managers in the MENU, but the three writes behind them checked only that the
// caller belonged to the outlet. Any logged-in user, an attendant included, could
// change a price by calling the API directly.
//
// The guard is on the PRICE CHANGE, not on the screens. Tying a barcode, renaming a
// product or receiving stock at the same MRP is unaffected — the Stock screen is also
// reached with gift.manage, and gift stock has to keep being received.
//
// Checked 04-Oct-2026: all 11 managers and owners at the five real outlets hold
// lubes.manage (template or role default), so nobody who edits prices today loses it.
const { getUserPermissions } = require('../middleware/permissions');

const PERM = 'lubes.manage';

// Is this request setting a different MRP? `incoming` absent, null or '' means "not
// touching the price". POST /products/stock also treats 0 as absent (its UPDATE is
// COALESCE(NULLIF…)), so it passes zeroIsUnset to match what it would actually write.
function mrpChanging(current, incoming, { zeroIsUnset = false } = {}) {
  if (incoming === undefined || incoming === null || incoming === '') return false;
  const next = Number(incoming);
  if (zeroIsUnset && !next) return false;
  if (current === undefined || current === null) return true;      // a new product
  return Math.round(Number(current) * 100) !== Math.round(next * 100);
}

// Returns null when allowed, or the 403 body to send.
async function mrpRefusal(req, stationId) {
  const perms = await getUserPermissions(req.user.id, stationId);
  if (perms.includes('ALL') || perms.includes(PERM)) return null;
  return { error: "Only a manager or the owner can set or change a product's MRP." };
}

module.exports = { mrpChanging, mrpRefusal, PERM };
