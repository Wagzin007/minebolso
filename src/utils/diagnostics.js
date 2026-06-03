'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR, ensureDirs } = require('../config');

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const LOG_FILE = path.join(DATA_DIR, 'minebolso.log');

function serializeMeta(meta = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (/secret|token|password|key/i.test(key)) safe[key] = '[redacted]';
    else if (value instanceof Error) safe[key] = { message: value.message, stack: value.stack };
    else safe[key] = value;
  }
  return safe;
}

function log(level, message, meta = {}) {
  const normalized = LEVELS.has(level) ? level : 'info';
  const entry = {
    ts: new Date().toISOString(),
    level: normalized,
    message,
    ...serializeMeta(meta),
  };

  const line = JSON.stringify(entry);
  const consoleMethod = normalized === 'error' ? 'error' : normalized === 'warn' ? 'warn' : 'log';
  console[consoleMethod](`[${entry.ts}] [${normalized.toUpperCase()}] ${message}`);

  try {
    ensureDirs();
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  } catch {
    // Logging must never break the product.
  }
}

function userError(message, options = {}) {
  const err = new Error(message);
  err.statusCode = options.statusCode || 400;
  err.code = options.code || 'USER_ERROR';
  err.details = options.details || null;
  err.suggestion = options.suggestion || null;
  return err;
}

function errorPayload(error) {
  return {
    message: error?.message || 'Erro inesperado',
    code: error?.code || 'INTERNAL_ERROR',
    details: error?.details || null,
    suggestion: error?.suggestion || 'Tente novamente. Se persistir, consulte os logs do MineBolso.',
  };
}

module.exports = { log, userError, errorPayload, LOG_FILE };
