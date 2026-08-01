// src/lib/api.js
import axios from 'axios';
import Cookies from 'js-cookie';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = Cookies.get('token') || (typeof window !== 'undefined' && sessionStorage.getItem('token'));
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      Cookies.remove('token');
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err.response?.data || err);
  }
);

export default api;

// Auth
export const login    = (data) => api.post('/auth/login', data);
export const getMe    = ()     => api.get('/auth/me');
export const logoutApi = ()    => api.post('/auth/logout', {});

// Dashboard
export const getOwnerDashboard   = (stationId, date)     => api.get(`/dashboard/owner?station_id=${stationId}&date=${date || ''}`);
export const getManagerDashboard = (stationId, shiftId)  => api.get(`/dashboard/manager?station_id=${stationId}&shift_id=${shiftId}`);
export const getCorporateDashboard = (id)                => api.get(`/dashboard/corporate/${id}`);
export const getAttendantDashboard = (aId, shiftId)      => api.get(`/dashboard/attendant?attendant_id=${aId}&shift_id=${shiftId}`);
export const getFuelMargin = (stationId, date) => api.get('/dashboard/margin', { params: { station_id: stationId, date } });

// Data-health tripwire (read-only). Per-station flags + owner-group rollup.
export const getStationDataHealth = (stationId) => api.get('/data-health/station', { params: { station_id: stationId } });
export const getGroupDataHealth   = (groupId)   => api.get(`/data-health/group/${groupId}`);

// Shifts
export const getShifts       = (params) => api.get('/shifts', { params });
export const getShift        = (id)     => api.get(`/shifts/${id}`);
export const openShift       = (data)   => api.post('/shifts', data);
export const closeShift      = (id)     => api.patch(`/shifts/${id}/close`);
export const assignRfid      = (id, d)  => api.post(`/shifts/${id}/assign-rfid`, d);
export const getShiftEvents  = (id)     => api.get(`/shifts/${id}/events`);

// Dispense
export const getDispenseEvents = (params) => api.get('/dispense', { params });
export const recordDispense    = (data)   => api.post('/dispense', data);

// Reconcile
export const submitReco  = (data) => api.post('/reconcile', data);
export const getReco     = (sid)  => api.get(`/reconcile/${sid}`);

// Corporate
// station_id is REQUIRED by the route guard — without it the endpoint 400s rather
// than returning every outlet's customers (see middleware/stationAccess).
export const getCorporates       = (params)   => api.get('/corporate', { params });
export const createCorporate     = (data)     => api.post('/corporate', data);
export const getDrivers          = (id)       => api.get(`/corporate/${id}/drivers`);
export const addDriver           = (id, data) => api.post(`/corporate/${id}/drivers`, data);
export const verifyBiometric     = (data)     => api.post('/corporate/verify-biometric', data);
export const recordCorpTransaction = (data)   => api.post('/corporate/transaction', data);
export const getCorpStatement    = (id, m)    => api.get(`/corporate/${id}/statement?month=${m}`);

// Attendance
export const getAttendance  = (params) => api.get('/attendance', { params });
export const markAttendance = (data)   => api.post('/attendance', data);

// Dipstick
export const getDipstick    = (params)    => api.get('/dipstick', { params });
export const recordDipstick = (data)      => api.post('/dipstick', data);
// Reads an ATG/Pinelabs tank-status screen photo into pre-fill rows. No READING is
// saved — the manager still reviews and submits via recordDipstick — but the screen
// PHOTO is now kept, and the response carries its artifact_id. Pass that id to
// recordDipstick for each tank it filled so every figure points at the picture it
// came from. Send shift_id + reading_type ('opening'|'closing') so the image files
// under the right shift. Generous timeout: vision + a Railway cold start can outrun
// the default.
export const parseGaugeScreen = (data)    => api.post('/dipstick/parse-gauge', data, { timeout: 90000 });
export const getTankStock   = (stationId) => api.get(`/dipstick/tanks/${stationId}`);
export const getDensityRegister = (params) => api.get('/dipstick/density-register', { params });

// Tank calibration (formula-based: diameter x length)
export const getCalibrationCharts = ()             => api.get('/calibration/charts');
export const setTankChart         = (tankId, data) => api.patch(`/calibration/tank/${tankId}`, data);

// Credit slip books — the control record over requisition-coupon books issued to
// credit customers (cheque-book model). Books are per OUTLET, so a coupon number
// resolves to exactly one book and therefore one customer. See
// docs/credit-slip-invoicing.md.
export const getCreditSlipBooks   = (params)   => api.get('/credit-slip-books', { params });
export const issueCreditSlipBook  = (data)     => api.post('/credit-slip-books', data);
export const updateCreditSlipBook = (id, data) => api.patch(`/credit-slip-books/${id}`, data);
export const resolveCouponBook    = (params)   => api.get('/credit-slip-books/resolve', { params });

// Coupon capture — a filled-in requisition coupon becomes a credit sale through the
// SAME writer the POS uses. Nothing auto-commits: parse pre-fills, validate previews
// the customer + rate + warnings, and the manager confirms. docs/credit-slip-invoicing.md.
export const parseCoupon    = (data)   => api.post('/coupons/parse', data, { timeout: 90000 });
export const validateCoupon = (data)   => api.post('/coupons/validate', data);
export const captureCoupon  = (data)   => api.post('/coupons', data);
export const getCoupons     = (params) => api.get('/coupons', { params });

// Prices
export const getCurrentPrices = (stationId) => api.get(`/prices/${stationId}/current`);
export const setPrice         = (data)       => api.post('/prices', data);

// Alerts
export const getAlerts        = (params) => api.get('/alerts', { params });
export const acknowledgeAlert = (id)     => api.patch(`/alerts/${id}/acknowledge`);

// Users
export const getUsers  = (params) => api.get('/users', { params });
export const updateUser = (id, d) => api.patch(`/users/${id}`, d);
export const addAttendant = (data) => api.post('/users/attendant', data);

// RFID
export const getRfidTags  = (stationId) => api.get(`/rfid?station_id=${stationId}`);
export const addRfidTag   = (data)      => api.post('/rfid', data);
export const resetRfidTag = (id)        => api.patch(`/rfid/${id}/reset`);

// Stations
export const getStations  = ()     => api.get('/stations');
export const getNozzles   = (sid)  => api.get(`/stations/${sid}/nozzles`);

// ── Pumps ─────────────────────────────────────────────────────────────
// The dispenser MACHINE the nozzles hang off: a number, a serial, a model and the
// sample slip it prints. A pump has NO fuel and NO tank — one unit routinely
// dispenses several grades from several tanks, so fuel and tank stay on the NOZZLE.
// The list read returns each pump's nozzles nested.
//
// These ride owner-run DDL (`pumps` table, `nozzles.pump_id`), so the endpoints can
// 404/500 until the migration is applied. EVERY caller must treat a failure as
// "no pumps yet" rather than letting Settings blank out.
export const getPumps   = (sid)        => api.get(`/stations/${sid}/pumps`);
// Longer timeout: the create carries the sample-slip photograph, and the server
// stores it as the pump's artifact in the same call (artifacts are written by the
// flow that produced them — there is no separate upload endpoint).
// Read a sample slip during SETUP to identify the machine. Same parser as the
// shift-time scan, but no shift exists yet — a pump is being defined before it has
// ever run one. Generous timeout: vision plus a Railway cold start.
export const parsePumpSlip = (sid, data) => api.post(`/stations/${sid}/parse-pump-slip`, data, { timeout: 90000 });
export const createPump = (sid, data)  => api.post(`/stations/${sid}/pumps`, data, { timeout: 90000 });
export const updatePump = (sid, id, d) => api.patch(`/stations/${sid}/pumps/${id}`, d);
// Refuses with 409 while the pump still has nozzles — surface that message; the
// doctrine path for a live pump is to RETIRE it (PATCH end_date), never delete.
export const deletePump = (sid, id)    => api.delete(`/stations/${sid}/pumps/${id}`);

// Reconcile (denomination)
export const submitDenomination = (data) => api.post('/reconcile/denomination', data);
export const confirmReco        = (id)   => api.patch(`/reconcile/${id}/confirm`, {});

// AI Chat — longer timeout: model latency + possible Railway cold start
export const sendAiChat = (data) => api.post('/ai-chat', data, { timeout: 60000 });

// ── Stored document images (station_artifacts) ────────────────────────
// The proof behind a record: the credit coupon behind an invoice line, the gauge
// screen behind a dip, the operator's photo at shift start and close. Artifacts are
// WRITTEN by the flow that produced them (coupon capture, gauge scan, shift assign),
// never uploaded separately — that is what keeps the image and its parent in one
// transaction. These two are the read side only.
export const getArtifacts = (entity_type, entity_id) =>
  api.get('/artifacts', { params: { entity_type, entity_id } });

// The image itself, as an object URL for an <img src>. It cannot be a plain URL:
// the API authenticates on the Authorization header, which the browser does not
// send for an <img> request — so the bytes are fetched through the same axios
// instance and wrapped locally. Revoke the URL when the component unmounts.
export const fetchArtifactImageUrl = async (id) => {
  const blob = await api.get(`/artifacts/${id}/image`, { responseType: 'blob', timeout: 60000 });
  return URL.createObjectURL(blob);
};

// VAWE "SO Instructions" — operational tasks pushed from VAWE. Manager acts;
// owner observes read-only (the write calls 403 for non-managers server-side).
export const getVaweInteractions     = (stationId)         => api.get('/vawe/interactions', { params: { station_id: stationId } });
export const commitVaweInteraction   = (id, committedDate) => api.patch(`/vawe/interactions/${id}/commit`, { committed_date: committedDate });
export const completeVaweInteraction = (id)                => api.patch(`/vawe/interactions/${id}/complete`, {});
export const uploadVaweArtifact      = (id, payload)       => api.post(`/vawe/interactions/${id}/artifact`, payload);
export const getVaweArtifact         = (id)                => api.get(`/vawe/interactions/${id}/artifact`);
export const getLitePromo            = ()                  => api.get('/vawe/lite-promo');
