// src/config/roles.js
// Single registry of ROLES (identity) — distinct from RESPONSIBILITIES (the
// function/module sets, which live in role_templates and are the real access gate).
//
// The clean model (docs/access-model-cleanup.md):
//   • Role  = WHO you are + a few hard guardrails that a responsibility can NEVER grant.
//   • Responsibility = WHAT sidebar functions you have (module set). The gate.
//   • Entitlement (outlet) = lite | pumpini ceiling.
//
// Role does NOT grant functions — that is entirely the responsibility. Role only:
//   (a) names the identity, (b) picks a DEFAULT responsibility, (c) is checked by the
//   handful of role-affinity guardrails below.

// category: 'operational' loads the full app; 'restricted' lands on a minimal surface.
const ROLES = {
  owner:      { category: 'operational', defaultResponsibility: 'Owner — Full' },
  manager:    { category: 'operational', defaultResponsibility: 'Manager — Operations' },
  accountant: { category: 'operational', defaultResponsibility: 'Accountant' },
  cco:        { category: 'operational', defaultResponsibility: 'CCO' },
  corporate:  { category: 'operational', defaultResponsibility: 'Corporate' },
  rsa:        { category: 'operational', defaultResponsibility: 'Cashier / RSA' },
  attendant:  { category: 'restricted',  defaultResponsibility: 'Attendant — Settlement' },
};

const VALID_ROLES = Object.keys(ROLES);

// Role-affinity guardrails: a module here may ONLY ever be assigned to the listed
// roles. Enforced when a responsibility is created/edited/assigned (superadmin only),
// so e.g. POS can never land on a manager, or the Group Dashboard on a non-owner.
// (financials/margins have no module — they are owner-only at the route level.)
const MODULE_ROLE_AFFINITY = {
  'dispense.entry': ['attendant', 'rsa'],
  'dispense.view':  ['attendant', 'rsa'],
  'group.view':     ['owner'],
  'users.manage':   ['owner'],
  // Accounts is owner/accountant work (the optional bookkeeping module) — never
  // assignable to a forecourt role. Owner also reaches it via the 'ALL' sentinel.
  'accounts.view':   ['owner', 'accountant'],
  'accounts.manage': ['owner', 'accountant'],
};

function isValidRole(role) {
  return VALID_ROLES.includes(role);
}

// Is `module` allowed on a responsibility that will be held by `role`?
// Modules with no affinity entry are freely assignable.
function moduleAllowedForRole(moduleCode, role) {
  const allowed = MODULE_ROLE_AFFINITY[moduleCode];
  return !allowed || allowed.includes(role);
}

module.exports = { ROLES, VALID_ROLES, MODULE_ROLE_AFFINITY, isValidRole, moduleAllowedForRole };
