// src/index.js
require('dotenv').config();
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
const io     = new Server(server, {
  cors: {
    origin: ['https://pumpini.vercel.app','https://www.pumpini.in','https://pumpini.in','http://localhost:3000','http://localhost:3001'],
    credentials: true
  }
});

// ── Middleware ──────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      process.env.FRONTEND_URL || 'http://localhost:3000',
      'https://pumpini.vercel.app',
      'https://www.pumpini.in',
      'https://pumpini.in',
      'http://localhost:3000',
      'http://localhost:3001',
    ];
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin || allowed.some(a => origin.startsWith(a))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  },
  credentials: true
}));
app.use(morgan('combined', { stream: { write: m => logger.info(m.trim()) } }));
app.use(express.json({ limit: '10mb' }));
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
app.use('/api/dashboard',  dashboardRoutes);
app.use('/api/alerts',     alertRoutes);
app.use('/api/receipts',   receiptRoutes);
app.use('/api/prices',     priceRoutes);
app.use('/api/rfid',       rfidRoutes);
app.use('/api/templates',  templateRoutes);
app.use('/api/groups',     groupRoutes);
app.use('/api/superadmin', superadminRoutes);
app.use('/api/invoices',   require('./routes/invoices'));
app.use('/api/deliveries', require('./routes/deliveries'));
app.use('/api/voice',      voiceRoutes);
app.use('/api/products',   productsRoutes);
app.use('/api/whatsapp',   require('./routes/whatsapp'));
app.use('/api/ai-chat',   require('./routes/ai-chat'));
app.use('/api/auth/passkey', require('./routes/passkey'));
app.use('/api/leads',     require('./routes/leads'));

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

app.use(errorHandler);

// ── Socket.IO ────────────────────────────────────────────
io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('join_station', (stationId) => {
    socket.join(`station:${stationId}`);
    logger.info(`Socket ${socket.id} joined station:${stationId}`);
  });

  socket.on('join_shift', (shiftId) => {
    socket.join(`shift:${shiftId}`);
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

// ── Start Server ─────────────────────────────────────────
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  logger.info(`🚀  Petrol DMS backend running on port ${PORT}`);
});

module.exports = { app, io };
