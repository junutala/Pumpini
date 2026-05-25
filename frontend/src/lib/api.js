// src/lib/api.js
import axios from 'axios';
import Cookies from 'js-cookie';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = Cookies.get('token') || (typeof window !== 'undefined' && localStorage.getItem('token'));
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      Cookies.remove('token');
      localStorage.removeItem('token');
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
    return Promise.reject(err.response?.data || err);
  }
);

export default api;

// Auth
export const login  = (data)  => api.post('/auth/login', data);
export const getMe  = ()      => api.get('/auth/me');

// Dashboard
export const getOwnerDashboard   = (stationId, date)     => api.get(`/dashboard/owner?station_id=${stationId}&date=${date || ''}`);
export const getManagerDashboard = (stationId, shiftId)  => api.get(`/dashboard/manager?station_id=${stationId}&shift_id=${shiftId}`);
export const getCorporateDashboard = (id)                => api.get(`/dashboard/corporate/${id}`);
export const getAttendantDashboard = (aId, shiftId)      => api.get(`/dashboard/attendant?attendant_id=${aId}&shift_id=${shiftId}`);

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
export const getCorporates       = ()         => api.get('/corporate');
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
export const getTankStock   = (stationId) => api.get(`/dipstick/tanks/${stationId}`);

// Prices
export const getCurrentPrices = (stationId) => api.get(`/prices/${stationId}/current`);
export const setPrice         = (data)       => api.post('/prices', data);

// Alerts
export const getAlerts        = (params) => api.get('/alerts', { params });
export const acknowledgeAlert = (id)     => api.patch(`/alerts/${id}/acknowledge`);

// Users
export const getUsers  = (params) => api.get('/users', { params });
export const updateUser = (id, d) => api.patch(`/users/${id}`, d);

// RFID
export const getRfidTags  = (stationId) => api.get(`/rfid?station_id=${stationId}`);
export const addRfidTag   = (data)      => api.post('/rfid', data);
export const resetRfidTag = (id)        => api.patch(`/rfid/${id}/reset`);

// Stations
export const getStations  = ()     => api.get('/stations');
export const getNozzles   = (sid)  => api.get(`/stations/${sid}/nozzles`);
