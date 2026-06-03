'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_TERMUX = Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes('com.termux'));
const IS_ANDROID = IS_TERMUX;
const HOME_DIR = IS_TERMUX
  ? path.join(process.env.HOME || '/data/data/com.termux/files/home')
  : os.homedir();

const PROJECT_ROOT = path.resolve(__dirname, '..');
const BASE_DIR = path.join(PROJECT_ROOT, '.minecraft');
const VERSIONS_DIR = path.join(BASE_DIR, 'versions');
const LIBRARIES_DIR = path.join(BASE_DIR, 'libraries');
const ASSETS_DIR = path.join(BASE_DIR, 'assets');
const RUNTIME_DIR = path.join(BASE_DIR, 'runtime');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const CONFIG_FILE = path.join(DATA_DIR, 'minebolso.config.json');
const SERVERS_FILE = path.join(DATA_DIR, 'servers.json');

const DEFAULTS = {
        codex/revise-project-architecture-for-version-2.0-z7j7v2
  port: 25580,
  defaultRam: 1,
  javaPath: 'java',
  projectRoot: PROJECT_ROOT,
  baseDir: BASE_DIR,
  versionsDir: VERSIONS_DIR,
  librariesDir: LIBRARIES_DIR,
  assetsDir: ASSETS_DIR,
  runtimeDir: RUNTIME_DIR,
  autoTunnel: true,
  playitBin: IS_TERMUX

  port:          25580,
  defaultRam:    1,
  javaPath:      'java',          // espera estar no PATH
  baseDir:       BASE_DIR,
  versionsDir:   VERSIONS_DIR,
  autoTunnel:    true,
  playitBin:     IS_TERMUX
        main
    ? path.join(HOME_DIR, '.local', 'bin', 'playit')
    : path.join(PROJECT_ROOT, '.minecraft', 'runtime', 'playit'),
  scanner: {
    watch: true,
    cacheTtlMs: 2_000,
  },
  watchdog: {
    enabled: true,
    autoRestart: true,
    tpsThreshold: 15,
    tpsAlertCycles: 3,
    ramThreshold: 90,
    checkIntervalMs: 10_000,
        codex/revise-project-architecture-for-version-2.0-z7j7v2
    crashWindowMs: 60_000,
    maxRestarts: 3,

    crashWindowMs:   60_000,
    maxRestarts:     3,
        main
  },
};

function ensureDirs() {
  [DATA_DIR, LOG_DIR, BASE_DIR, VERSIONS_DIR, LIBRARIES_DIR, ASSETS_DIR, RUNTIME_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function readConfig() {
  ensureDirs();
  if (!fs.existsSync(CONFIG_FILE)) {
    atomicWriteJson(CONFIG_FILE, DEFAULTS);
    return { ...DEFAULTS };
  }

  try {
    const stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const migrated = migrateConfig(deepMerge(DEFAULTS, stored));
    return migrated;
  } catch {
    return { ...DEFAULTS };
  }
}

function writeConfig(updates) {
  ensureDirs();
  const current = readConfig();
        codex/revise-project-architecture-for-version-2.0-z7j7v2
  const next = migrateConfig(deepMerge(current, updates || {}));

  const next    = deepMerge(current, updates || {});
        main
  atomicWriteJson(CONFIG_FILE, next);
  return next;
}

function readServers() {
  ensureDirs();
  if (!fs.existsSync(SERVERS_FILE)) {
    atomicWriteJson(SERVERS_FILE, []);
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(SERVERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeServers(servers) {
  ensureDirs();
  atomicWriteJson(SERVERS_FILE, Array.isArray(servers) ? servers : []);
}

function migrateConfig(config) {
  // MineBolso 2.x intentionally standardizes on the project-local .minecraft.
  return {
    ...config,
    projectRoot: PROJECT_ROOT,
    baseDir: BASE_DIR,
    versionsDir: VERSIONS_DIR,
    librariesDir: LIBRARIES_DIR,
    assetsDir: ASSETS_DIR,
    runtimeDir: RUNTIME_DIR,
  };
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override || {})) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object'
    ) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function atomicWriteJson(file, value) {
  ensureParent(file);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function ensureParent(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  IS_TERMUX,
  IS_ANDROID,
  HOME_DIR,
  PROJECT_ROOT,
  BASE_DIR,
  VERSIONS_DIR,
  LIBRARIES_DIR,
  ASSETS_DIR,
  RUNTIME_DIR,
  DATA_DIR,
  LOG_DIR,
  readConfig,
  writeConfig,
  readServers,
  writeServers,
  ensureDirs,
};
