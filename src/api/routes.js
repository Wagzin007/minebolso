'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
        codex/revise-project-architecture-for-version-2.0-z7j7v2
const { spawn } = require('child_process');
const router = express.Router();

const manager = require('../server/ServerManager');
const scanner = require('../server/ServerScanner');

const router = express.Router();

const manager = require('../server/ServerManager');
        main
const playit = require('../tunnel/PlayitManager');
const { readConfig, writeConfig } = require('../config');
const { log, userError, errorPayload } = require('../utils/diagnostics');
const {
  assertServerId,
  sanitizeName,
  normalizeRam,
  assertPlayer,
  sanitizeCommand,
  safePath,
  isEditableText,
  assertJarUrl,
} = require('../utils/validation');

const json = express.json({ limit: '2mb' });
const ok = (res, data = {}) => res.json({ ok: true, ...data });

function asyncRoute(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch(error => fail(res, error, req));
}

function fail(res, error, req) {
  const status = error.statusCode || 500;
  if (status >= 500) log('error', 'Falha em rota API', { method: req.method, url: req.originalUrl, error });
  res.status(status).json({ ok: false, error: errorPayload(error) });
}
        codex/revise-project-architecture-for-version-2.0-z7j7v2

function ensureServerExists(id) {
  const server = manager.getStatus(assertServerId(id));
  if (!server) {
    throw userError('Servidor não encontrado.', {
      statusCode: 404,
      code: 'SERVER_NOT_FOUND',
      suggestion: 'Crie um servidor ou confira se a pasta contém um server.jar.',
    });
  }
  return server;
}

router.get('/health', (req, res) => ok(res, { status: 'ready', uptime: process.uptime() }));


// VERSION LIBRARY
router.get('/versions', asyncRoute((req, res) => ok(res, {
  library: scanner.getLibraryStatus(),
  versions: scanner.scanVersions({ force: req.query.force === '1' }),
})));

router.post('/versions/rescan', asyncRoute((req, res) => ok(res, {
  library: scanner.getLibraryStatus(),
  versions: scanner.scanVersions({ force: true }),
})));

router.post('/versions/import', json, asyncRoute((req, res) => {
  const result = scanner.importInstallation(req.body?.sourcePath, { limit: Number(req.body?.limit) || 40 });
  ok(res, { import: result, library: scanner.getLibraryStatus(), versions: scanner.scanVersions({ force: true }) });
}));

router.post('/minecraft/open', asyncRoute((req, res) => {
  const cfg = readConfig();
  openFolder(req.body?.target === 'versions' ? cfg.versionsDir : cfg.baseDir);
  ok(res, { opened: true, path: req.body?.target === 'versions' ? cfg.versionsDir : cfg.baseDir });
}));

// SERVERS
router.get('/servers', asyncRoute((req, res) => ok(res, { servers: manager.listAll() })));

router.post('/servers', json, asyncRoute(async (req, res) => {
  const cfg = readConfig();
  const id = assertServerId(req.body?.id || req.body?.version);
  const name = sanitizeName(req.body?.name, id);
  const ram = normalizeRam(req.body?.ram, cfg.defaultRam || 1);
  const jarUrl = req.body?.jarUrl ? assertJarUrl(req.body.jarUrl) : null;
  const serverDir = safePath(cfg.versionsDir, id);
  const jarPath = path.join(serverDir, 'server.jar');

  if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
  if (jarUrl && !fs.existsSync(jarPath)) await downloadFile(jarUrl, jarPath, 140 * 1024 * 1024);
  if (!fs.existsSync(jarPath)) {
    throw userError('server.jar não encontrado para esta versão.', {
      statusCode: 409,
      code: 'JAR_REQUIRED',
      suggestion: `Coloque o arquivo em ${jarPath} ou informe um link direto no campo jarUrl.`,
    });
  }



function ensureServerExists(id) {
  const server = manager.getStatus(assertServerId(id));
  if (!server) {
    throw userError('Servidor não encontrado.', {
      statusCode: 404,
      code: 'SERVER_NOT_FOUND',
      suggestion: 'Crie um servidor ou confira se a pasta contém um server.jar.',
    });
  }
  return server;
}

router.get('/health', (req, res) => ok(res, { status: 'ready', uptime: process.uptime() }));

// SERVERS
router.get('/servers', asyncRoute((req, res) => ok(res, { servers: manager.listAll() })));

router.post('/servers', json, asyncRoute(async (req, res) => {
  const cfg = readConfig();
  const id = assertServerId(req.body?.id || req.body?.version);
  const name = sanitizeName(req.body?.name, id);
  const ram = normalizeRam(req.body?.ram, cfg.defaultRam || 1);
  const jarUrl = req.body?.jarUrl ? assertJarUrl(req.body.jarUrl) : null;
  const serverDir = safePath(cfg.versionsDir, id);
  const jarPath = path.join(serverDir, 'server.jar');

  if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });
  if (jarUrl && !fs.existsSync(jarPath)) await downloadFile(jarUrl, jarPath, 140 * 1024 * 1024);
  if (!fs.existsSync(jarPath)) {
    throw userError('server.jar não encontrado para esta versão.', {
      statusCode: 409,
      code: 'JAR_REQUIRED',
      suggestion: `Coloque o arquivo em ${jarPath} ou informe um link direto no campo jarUrl.`,
    });
  }

        main
  manager.updateServerConfig(id, { name, ram, autoRestart: true, lastCreated: new Date().toISOString() });
  ok(res, { server: manager.getStatus(id) });
}));

router.get('/servers/:id', asyncRoute((req, res) => ok(res, { server: ensureServerExists(req.params.id) })));
router.post('/servers/:id/start', asyncRoute((req, res) => ok(res, manager.start(assertServerId(req.params.id)))));
router.post('/servers/:id/stop', asyncRoute((req, res) => ok(res, manager.stop(assertServerId(req.params.id)))));
router.post('/servers/:id/restart', asyncRoute((req, res) => ok(res, manager.restart(assertServerId(req.params.id)))));
router.post('/servers/:id/command', json, asyncRoute((req, res) => {
  ok(res, manager.sendCommand(assertServerId(req.params.id), sanitizeCommand(req.body?.cmd)));
}));
router.patch('/servers/:id', json, asyncRoute((req, res) => {
  const id = assertServerId(req.params.id);
  ensureServerExists(id);
  const updates = {};
  if ('name' in req.body) updates.name = sanitizeName(req.body.name, id);
  if ('ram' in req.body) updates.ram = normalizeRam(req.body.ram);
  if ('autoStart' in req.body) updates.autoStart = Boolean(req.body.autoStart);
  if ('autoRestart' in req.body) updates.autoRestart = Boolean(req.body.autoRestart);
  if ('javaFlags' in req.body) updates.javaFlags = String(req.body.javaFlags || '').slice(0, 300);
  ok(res, { server: manager.updateServerConfig(id, updates) });
}));

// FILES
router.get('/files', asyncRoute((req, res) => {
  const cfg = readConfig();
  const rel = req.query.serverId ? path.join(assertServerId(req.query.serverId), req.query.path || '') : (req.query.path || '');
  const target = safePath(cfg.versionsDir, rel);
  if (!fs.existsSync(target)) throw userError('Caminho não encontrado.', { statusCode: 404, code: 'PATH_NOT_FOUND' });

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(target, { withFileTypes: true }).map(e => {
      const entryPath = path.join(target, e.name);
      let size = null;
      try { size = e.isDirectory() ? null : fs.statSync(entryPath).size; } catch {}
      return { name: e.name, isDir: e.isDirectory(), size };
    }).sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
    return ok(res, { path: target, entries });
  }

  if (!isEditableText(target)) throw userError('Tipo de arquivo não suportado para edição.', { statusCode: 415, code: 'UNSUPPORTED_FILE_TYPE' });
  ok(res, { path: target, content: fs.readFileSync(target, 'utf8') });
}));

router.put('/files', json, asyncRoute((req, res) => {
  const cfg = readConfig();
  const { filePath, content } = req.body || {};
  if (!filePath || content === undefined) throw userError('filePath e content são obrigatórios.', { code: 'MISSING_FILE_PAYLOAD' });
  const target = safePath(cfg.versionsDir, filePath);
  if (!isEditableText(target)) throw userError('Tipo de arquivo não suportado para edição.', { statusCode: 415, code: 'UNSUPPORTED_FILE_TYPE' });
  fs.writeFileSync(target, String(content), 'utf8');
  ok(res, { path: target });
}));

// PLAYERS
router.get('/players/:id', asyncRoute((req, res) => ok(res, { players: ensureServerExists(req.params.id).players || [] })));
router.post('/players/:id/kick', json, asyncRoute((req, res) => {
  const player = assertPlayer(req.body?.player);
  const reason = req.body?.reason ? String(req.body.reason).replace(/[\r\n]/g, ' ').slice(0, 120) : '';
  ok(res, manager.sendCommand(assertServerId(req.params.id), `kick ${player}${reason ? ` ${reason}` : ''}`));
}));
router.post('/players/:id/ban', json, asyncRoute((req, res) => {
  const player = assertPlayer(req.body?.player);
  const reason = req.body?.reason ? String(req.body.reason).replace(/[\r\n]/g, ' ').slice(0, 120) : '';
  ok(res, manager.sendCommand(assertServerId(req.params.id), `ban ${player}${reason ? ` ${reason}` : ''}`));
}));
router.post('/players/:id/op', json, asyncRoute((req, res) => ok(res, manager.sendCommand(assertServerId(req.params.id), `op ${assertPlayer(req.body?.player)}`))));

// SYSTEM
router.get('/system', asyncRoute(async (req, res) => ok(res, { system: await readSystemStats() })));

// TUNNEL
router.get('/tunnel', (req, res) => ok(res, playit.getStatus()));
router.post('/tunnel/secret', json, asyncRoute(async (req, res) => {
  const secretKey = String(req.body?.secretKey || '').trim();
  if (secretKey.length < 10) throw userError('Secret inválido.', { code: 'INVALID_SECRET', suggestion: 'Cole o secret completo gerado no painel do playit.gg.' });
  playit.stop();
  playit.saveSecret(secretKey);
  await playit.start();
  ok(res, { saved: true, tunnel: playit.getStatus() });
}));
router.post('/tunnel/start', asyncRoute(async (req, res) => { await playit.start(); ok(res, { tunnel: playit.getStatus() }); }));
router.post('/tunnel/stop', (req, res) => { playit.stop(); ok(res, { tunnel: playit.getStatus() }); });
router.post('/tunnel/restart', asyncRoute(async (req, res) => { playit.stop(); await wait(800); await playit.start(); ok(res, { tunnel: playit.getStatus() }); }));

// CONFIG
router.get('/config', (req, res) => ok(res, { config: readConfig() }));
router.patch('/config', json, asyncRoute((req, res) => {
  const body = req.body || {};
  const updates = {};
  if ('javaPath' in body) updates.javaPath = String(body.javaPath || 'java').trim() || 'java';
        codex/revise-project-architecture-for-version-2.0-z7j7v2

  if ('baseDir' in body) updates.baseDir = String(body.baseDir || '').trim();
  if ('versionsDir' in body) updates.versionsDir = String(body.versionsDir || '').trim();
        main
  if ('port' in body) updates.port = Math.min(65535, Math.max(1024, Number.parseInt(body.port, 10) || 25580));
  if ('defaultRam' in body) updates.defaultRam = normalizeRam(body.defaultRam);
  if ('autoTunnel' in body) updates.autoTunnel = Boolean(body.autoTunnel);
  ok(res, { config: writeConfig(updates) });
}));

async function readSystemStats() {
  try {
    const si = require('systeminformation');
    const [cpu, mem, disk] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
    const primaryDisk = Array.isArray(disk) ? disk.find(d => d.mount === '/') || disk[0] : null;
    return { cpu: Math.round(cpu.currentLoad), ram: { used: mem.active, total: mem.total }, disk: primaryDisk ? { used: primaryDisk.used, size: primaryDisk.size } : null };
  } catch {
    return readProcStats();
  }
}

function readProcStats() {
  let ramUsed = 0, ramTotal = 0;
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const getVal = key => { const m = new RegExp(`${key}:\\s+(\\d+)`).exec(meminfo); return m ? Number.parseInt(m[1], 10) * 1024 : 0; };
    ramTotal = getVal('MemTotal');
    ramUsed = ramTotal - getVal('MemFree') - getVal('Buffers') - getVal('Cached');
  } catch {}
  return { cpu: null, ram: { used: Math.max(0, ramUsed), total: ramTotal }, disk: null };
}

function downloadFile(url, destPath, maxBytes) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve, reject) => {
    const tmp = `${destPath}.download`;
    const request = client.get(url, { headers: { 'User-Agent': 'MineBolso/2.0' } }, response => {
      if ([301, 302, 307, 308].includes(response.statusCode)) {
        response.resume();
        return downloadFile(response.headers.location, destPath, maxBytes).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(userError(`Download falhou (HTTP ${response.statusCode}).`, { statusCode: 502, code: 'JAR_DOWNLOAD_FAILED' }));
      }
      let received = 0;
      const file = fs.createWriteStream(tmp);
      response.on('data', chunk => {
        received += chunk.length;
        if (received > maxBytes) {
          request.destroy(userError('Arquivo jar maior que o limite seguro.', { statusCode: 413, code: 'JAR_TOO_LARGE' }));
        }
      });
      response.pipe(file);
      file.on('finish', () => file.close(() => { fs.renameSync(tmp, destPath); resolve(); }));
      file.on('error', reject);
    });
    request.on('error', error => { fs.unlink(tmp, () => {}); reject(error); });
    request.setTimeout(45_000, () => request.destroy(userError('Tempo limite ao baixar o jar.', { statusCode: 504, code: 'JAR_DOWNLOAD_TIMEOUT' })));
  });
}
        codex/revise-project-architecture-for-version-2.0-z7j7v2

function openFolder(folderPath) {
  const platform = process.platform;
  const cmd = platform === 'win32' ? 'explorer.exe' : platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(cmd, [folderPath], { detached: true, stdio: 'ignore' });
  child.on('error', error => log('warn', 'Não foi possível abrir pasta automaticamente', { folderPath, error }));
  child.unref();
}

        main

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

module.exports = router;
