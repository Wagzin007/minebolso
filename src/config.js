'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Detecta ambiente ──────────────────────────────────────────────
const IS_TERMUX  = Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes('com.termux'));
const IS_ANDROID = IS_TERMUX;  // por ora, Android = Termux

// ── Paths base ────────────────────────────────────────────────────
const HOME_DIR      = IS_TERMUX
  ? path.join(process.env.HOME || '/data/data/com.termux/files/home')
  : os.homedir();

const BASE_DIR      = path.join(HOME_DIR, 'minebolso', '.minecraft');
const VERSIONS_DIR  = path.join(BASE_DIR, 'versions');
const DATA_DIR      = path.join(__dirname, '..', 'data');
const CONFIG_FILE   = path.join(DATA_DIR, 'minebolso.config.json');
const SERVERS_FILE  = path.join(DATA_DIR, 'servers.json');

// ── Defaults ──────────────────────────────────────────────────────
const DEFAULTS = {
  port:          25580,
  javaPath:      'java',          // espera estar no PATH
  baseDir:       BASE_DIR,
  versionsDir:   VERSIONS_DIR,
  autoTunnel:    true,
  playitBin:     IS_TERMUX
    ? path.join(HOME_DIR, '.local', 'bin', 'playit')
    : path.join(HOME_DIR, '.minebolso', 'playit'),
  watchdog: {
    enabled:         true,
    autoRestart:     true,
    tpsThreshold:    15,
    tpsAlertCycles:  3,
    ramThreshold:    90,        // % do alocado
    checkIntervalMs: 10_000,
  },
};

// ── Garante dirs ─────────────────────────────────────────────────
function ensureDirs() {
  [DATA_DIR, BASE_DIR, VERSIONS_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ── Lê config global ─────────────────────────────────────────────
function readConfig() {
  ensureDirs();
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2));
    return { ...DEFAULTS };
  }
  try {
    const stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // merge com defaults para garantir que novos campos existam
    return deepMerge(DEFAULTS, stored);
  } catch {
    return { ...DEFAULTS };
  }
}

// ── Escreve config global ─────────────────────────────────────────
function writeConfig(updates) {
  ensureDirs();
  const current = readConfig();
  const next    = deepMerge(current, updates);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

// ── Lê lista de servidores ─────────────────────────────────────────
function readServers() {
  ensureDirs();
  if (!fs.existsSync(SERVERS_FILE)) {
    fs.writeFileSync(SERVERS_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

// ── Escreve lista de servidores ────────────────────────────────────
function writeServers(servers) {
  ensureDirs();
  fs.writeFileSync(SERVERS_FILE, JSON.stringify(servers, null, 2));
}

// ── Util: deep merge simples ───────────────────────────────────────
function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object'
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

module.exports = {
  IS_TERMUX,
  IS_ANDROID,
  HOME_DIR,
  BASE_DIR,
  VERSIONS_DIR,
  DATA_DIR,
  readConfig,
  writeConfig,
  readServers,
  writeServers,
  ensureDirs,
};
