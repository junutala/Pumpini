// src/routes/creditSlipBooks.js
// Thin guarded entry points over services/creditSlipBookService — the one writer.
// Design + reasoning: docs/credit-slip-invoicing.md.
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requirePerm } = require('../middleware/permissions');
const { requireStationAccess } = require('../middleware/stationAccess');
const svc = require('../services/creditSlipBookService');

// Every handler below is column-tolerant in one specific way: the table may not
// exist yet (the DDL is owner-run and deploys AFTER this code). A missing relation
// is 42P01 — we answer with an empty register / a clear message rather than 500ing,
// so shipping this before the migration cannot break a screen.
const NOT_MIGRATED = 'Coupon books are not set up on this database yet.';
const isMissingTable = e => e.code === '42P01';

// GET /api/credit-slip-books?station_id=&corporate_id=&status=
router.get('/', authenticate, requireStationAccess({ required: true }), requirePerm('corporate.view'), async (req, res, next) => {
  try {
    const { station_id, corporate_id, status } = req.query;
    res.json(await svc.listBooks({ station_id, corporate_id, status }));
  } catch (err) {
    if (isMissingTable(err)) return res.json([]);
    next(err);
  }
});

// GET /api/credit-slip-books/resolve?station_id=&leaf=
// Which book (and therefore which customer) does a coupon number belong to?
// Coupon capture will use this; exposed now so the register screen can answer
// "who does number 17702 belong to?" without a lookup by eye.
router.get('/resolve', authenticate, requireStationAccess({ required: true }), requirePerm('corporate.view'), async (req, res, next) => {
  try {
    const { station_id, leaf } = req.query;
    if (!leaf) return res.status(400).json({ error: 'leaf is required' });
    const book = await svc.findBookForLeaf({ station_id, leaf });
    if (!book) return res.status(404).json({ error: `Coupon ${leaf} is not in any book issued at this outlet.` });
    res.json(book);
  } catch (err) {
    if (isMissingTable(err)) return res.status(503).json({ error: NOT_MIGRATED });
    next(err);
  }
});

// POST /api/credit-slip-books — issue a book to a credit customer
router.post('/', authenticate, requireStationAccess({ required: true }), requirePerm('corporate.manage'), async (req, res, next) => {
  try {
    const book = await svc.issueBook({ ...req.body, station_id: req.body.station_id, issued_by: req.user.id });
    res.status(201).json(book);
  } catch (err) {
    if (isMissingTable(err)) return res.status(503).json({ error: NOT_MIGRATED });
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// PATCH /api/credit-slip-books/:id — status / label / notes / opening leaf.
// The coupon RANGE is intentionally not editable — see the service.
router.patch('/:id', authenticate, requireStationAccess({ required: true }), requirePerm('corporate.manage'), async (req, res, next) => {
  try {
    const book = await svc.updateBook({ ...req.body, id: req.params.id, station_id: req.body.station_id });
    res.json(book);
  } catch (err) {
    if (isMissingTable(err)) return res.status(503).json({ error: NOT_MIGRATED });
    if (err.status === 400) return res.status(400).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
