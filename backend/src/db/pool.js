// src/db/pool.js
const { Pool } = require('pg');
require('dotenv').config();

// Supabase / hosted Postgres: use DATABASE_URL if set, else individual vars
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },  // required for Supabase
    }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME     || 'petrol_dms',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
      // Enable SSL for remote hosts (Supabase, RDS, etc.)
      ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
    };

const pool = new Pool({
  ...poolConfig,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Hard ceilings so one slow/hung query can't pin a connection while every
  // outlet's dashboard polls pile up behind it.
  statement_timeout: 15000,             // 15s per statement
  query_timeout: 20000,                 // client-side guard above that
  application_name: 'pumpini-backend',
});

pool.on('error', (err) => {
  // Logged via logger (not console) so it reaches persisted Railway logs.
  try { require('../utils/logger').error('Unexpected DB pool error', err); }
  catch { console.error('Unexpected DB pool error', err); }
});

module.exports = pool;
