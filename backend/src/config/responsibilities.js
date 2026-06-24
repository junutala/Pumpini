// src/config/responsibilities.js
// Single source of truth for the system 'Manager_lite' responsibility.
//
// IMPORTANT: this list MUST stay in sync with the canonical seed
// `src/db/migrations/006_seed_manager_lite.sql`. Previously the station-creation
// path in superadmin.js carried its own hardcoded copy that drifted (it was
// missing settings.manage), so every bunk created via the console was born one
// permission short. Both paths now reference this constant — they can no longer
// diverge.
//
// Manager_lite = the operational set (NO user-management; the platform admin
// creates all users). settings.manage lets the manager define tanks/nozzles/
// selling prices in Settings.
const MANAGER_LITE_MODULES = [
  'shifts.view',      // Start/End Shift
  'deliveries.view',  // Deliveries
  'stock.reconcile',  // Stock Reco
  'invoice.generate', // Credit Invoices / Receipts / Notes
  'pettycash.manage', // Petty Cash
  'deposits.manage',  // Bank Deposits
  'reports.view',     // Reports / Credit Reports
  'corporate.view',   // Credit Customers
  'attendant.add',    // Add Attendant
  'settings.manage',  // Settings — tanks, nozzles, selling prices
];

const MANAGER_LITE_DESCRIPTION =
  'Operational manager — shifts, deliveries, stock reco, credit invoices, ' +
  'petty cash, deposits, reports, credit customers, add attendant, settings ' +
  '(tanks/nozzles/prices)';

module.exports = { MANAGER_LITE_MODULES, MANAGER_LITE_DESCRIPTION };
