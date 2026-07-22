const router = require('express').Router();
const pool   = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { requireStationId } = require('../middleware/stationAccess');
const { requirePerm } = require('../middleware/permissions');
