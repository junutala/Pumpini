// src/index.js
require('dotenv').config();

// Fail fast on misconfiguration: with no/weak JWT_SECRET every signed token is
// trivially forgeable. Refusing to boot beats discovering it in production.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
  // eslint-disable-next-line no-console
  console.error('FATAL: JWT_SECRET is missing or shorter than 24 characters. Refusing to start.');
  process.exit(1);
}

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const cron       = require('node-cron');

const authRoutes       = require('./routes/auth');
const userRoutes       = require('./routes/users');
const stationRoutes    = require('./routes/stations');
const shiftRoutes      = require('./routes/shifts');
const dispenseRoutes   = require('./routes/dispense');
const reconcileRoutes  = require('./routes/reconcile');
const corporateRoutes  = require('./routes/corporate');
const attendanceRoutes = require('./routes/attendance');
const dipstickRoutes   = require('./routes/dipstick');
const dashboardRoutes  = require('./routes/dashboard');
const alertRoutes      = require('./routes/alerts');
const receiptRoutes    = require('./routes/receipts');
const priceRoutes      = require('./routes/prices');
const rfidRoutes       = require('./routes/rfid');
const templateRoutes   = require('./routes/templates');
const groupRoutes      = require('./routes/groups');
const { router: superadminRoutes } = require('./routes/superadmin');
const voiceRoutes      = require('./routes/voice');
const productsRoutes   = require('./routes/products');

const { startRfidListener } = require('./services/rfidService');
const { sendDailySummaries }  = require('./services/reportService');
const { errorHandler }       = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app    = express();
const server = http.createServer(app);

// Allowed browser origins for CORS — shared by REST and Socket.IO so they can't
// drift. FRONTEND_URL may be a comma-separated list, letting each environment
// (prod, staging) declare its own origin(s) via env with no code change. The
// prod + localhost origins stay as a permanent baseline.
const allowedOrigins = [
  ...String(process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean),
  'https://pumpini.vercel.app',
  'https://www.pumpini.in',
  'https://pumpini.in',
  'http://localhost:3000',
  'http://localhost:3001',
];

const io     = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

// ── Middleware ──────────────────────────────────────────
app.set('trust proxy', 1); // Railway proxy → req.ip = real client IP (rate limiter)
app.use(helmet());
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    // Exact match only — startsWith would let pumpini.in.attacker.com through.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));
// Capture the raw body so signature-verified webhooks (VAWE → Pumpini) can
// HMAC the exact bytes. Additive — req.body still parses as before.
app.use(express.json({ limit: '10mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

// Attach socket.io to req for use in route handlers
app.use((req, _res, next) => { req.io = io; next(); });

// ── Routes ──────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/users',      userRoutes);
app.use('/api/stations',   stationRoutes);
app.use('/api/shifts',     shiftRoutes);
app.use('/api/dispense',   dispenseRoutes);
app.use('/api/reconcile',  reconcileRoutes);
app.use('/api/corporate',  corporateRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dipstick',   dipstickRoutes);
app.use('/api/calibration', require('./routes/calibration'));
app.use('/api/dashboard',  dashboardRoutes);
app.use('/api/alerts',     alertRoutes);
app.use('/api/receipts',   receiptRoutes);
app.use('/api/prices',     priceRoutes);
app.use('/api/rfid',       rfidRoutes);
app.use('/api/templates',  templateRoutes);
app.use('/api/groups',     groupRoutes);
app.use('/api/superadmin', superadminRoutes);
// VAWE → Pumpini: receive interaction items (the "SO Instructions" tile)
app.use('/api/vawe',       require('./routes/vawe'));
app.use('/api/invoices',   require('./routes/invoices'));
app.use('/api/deliveries', require('./routes/deliveries'));
app.use('/api/voice',      voiceRoutes);
app.use('/api/products',   productsRoutes);
app.use('/api/whatsapp',   require('./routes/whatsapp'));
app.use('/api/ai-chat',   require('./routes/ai-chat'));
app.use('/api/auth/passkey', require('./routes/passkey'));
app.use('/api/leads',     require('./routes/leads'));
app.use('/api/product-credit-notes', require('./routes/productReturns'));
app.use('/api/petty-cash', require('./routes/pettyCash'));
app.use('/api/tank-reco', require('./routes/tankReco'));
app.use('/api/cash-deposits', require('./routes/cashDeposits'));
app.use('/api/tally', require('./routes/tally'));
app.use('/api/credit-reports', require('./routes/creditReports'));

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

app.use(errorHandler);

// ── Socket.IO ────────────────────────────────────────────
// Sockets carry live sale data, so they get the same two walls as the REST
// API: a verified JWT on the handshake, and station-membership checks on every
// room join. Room model: staff receive masked events via `station:{id}`;
// owners additionally join `station:{id}:owner` for unmasked events.
const jwt = require('jsonwebtoken');
const { canAccessStation } = require('./middleware/stationAccess');
const pool = require('./db/pool');

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id} (user ${socket.user?.id})`);

  socket.on('join_station', async (stationId) => {
    try {
      if (!stationId || !(await canAccessStation(socket.user.id, stationId))) return;
      socket.join(`station:${stationId}`);
      if (socket.user.role === 'owner') socket.join(`station:${stationId}:owner`);
      logger.info(`Socket ${socket.id} joined station:${stationId}`);
    } catch (err) { logger.warn('join_station failed:', err.message); }
  });

  socket.on('join_shift', async (shiftId) => {
    try {
      if (!shiftId) return;
      const { rows } = await pool.query('SELECT station_id FROM shifts WHERE id=$1', [shiftId]);
      if (!rows.length || !(await canAccessStation(socket.user.id, rows[0].station_id))) return;
      socket.join(`shift:${shiftId}`);
      if (socket.user.role === 'owner') socket.join(`shift:${shiftId}:owner`);
    } catch (err) { logger.warn('join_shift failed:', err.message); }
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// ── RFID Listener (Manager PC agent) ─────────────────────
if (process.env.NODE_ENV !== 'test') {
  startRfidListener(io).catch(err =>
    logger.warn('RFID listener not started:', err.message)
  );
}

// ── Scheduled Jobs ───────────────────────────────────────
// Daily summary at 9 PM
cron.schedule('0 21 * * *', () => {
  sendDailySummaries().catch(err => logger.error('Daily summary error:', err));
});

// ── Process-level safety nets ────────────────────────────
// A stray async error must not take 7 live outlets down silently. Rejections
// are logged and survived; true exceptions log then exit non-zero so Railway
// restarts a clean process instead of a zombie.
process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION — restarting:', err);
  process.exit(1);
});

// ── Start Server ─────────────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  logger.info(`🚀  Petrol DMS backend running on port ${PORT}`);
});

module.exports = { app, io };
