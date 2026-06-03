'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const router   = express.Router();

const manager  = require('../server/ServerManager');
const playit   = require('../tunnel/PlayitManager');
const { readConfig, writeConfig } = require('../config');

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
const ok  = (res, data)  => res.json({ ok: true,  ...data });
const err = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

// Previne path traversal — só permite acesso dentro do versionsDir
function safePath(base, rel) {
  const resolved = path.resolve(base, rel || '');
  if (!resolved.startsWith(path.resolve(base))) return null;
  return resolved;
}

// ─────────────────────────────────────────────────────────────────
// SERVERS
// ─────────────────────────────────────────────────────────────────

// GET /api/servers — lista todos
router.get('/servers', (req, res) => {
  try {
    ok(res, { servers: manager.listAll() });
  } catch (e) {
    err(res, e.message, 500);
  }
});

// GET /api/servers/:id — status de um
router.get('/servers/:id', (req, res) => {
  const s = manager.getStatus(req.params.id);
  if (!s) return err(res, 'Servidor não encontrado', 404);
  ok(res, { server: s });
});

// POST /api/servers/:id/start
router.post('/servers/:id/start', (req, res) => {
  try {
    ok(res, manager.start(req.params.id));
  } catch (e) {
    err(res, e.message);
  }
});

// POST /api/servers/:id/stop
router.post('/servers/:id/stop', (req, res) => {
  try {
    ok(res, manager.stop(req.params.id));
  } catch (e) {
    err(res, e.message);
  }
});

// POST /api/servers/:id/restart
router.post('/servers/:id/restart', (req, res) => {
  try {
    ok(res, manager.restart(req.params.id));
  } catch (e) {
    err(res, e.message);
  }
});

// POST /api/servers/:id/command
router.post('/servers/:id/command', express.json(), (req, res) => {
  const { cmd } = req.body || {};
  if (!cmd) return err(res, 'Campo cmd obrigatório');
  try {
    ok(res, manager.sendCommand(req.params.id, cmd));
  } catch (e) {
    err(res, e.message);
  }
});

// PATCH /api/servers/:id — atualiza config (ram, name, etc)
router.patch('/servers/:id', express.json(), (req, res) => {
  try {
    const updated = manager.updateServerConfig(req.params.id, req.body);
    ok(res, { server: updated });
  } catch (e) {
    err(res, e.message);
  }
});

// ─────────────────────────────────────────────────────────────────
// FILE MANAGER
// ─────────────────────────────────────────────────────────────────

// GET /api/files?serverId=1.20.4&path=.
router.get('/files', (req, res) => {
  const cfg  = readConfig();
  const base = req.query.serverId
    ? path.join(cfg.versionsDir, req.query.serverId)
    : cfg.versionsDir;

  const target = safePath(cfg.versionsDir, req.query.serverId
    ? path.join(req.query.serverId, req.query.path || '')
    : (req.query.path || ''));

  if (!target) return err(res, 'Caminho inválido', 403);
  if (!fs.existsSync(target)) return err(res, 'Caminho não encontrado', 404);

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    try {
      const entries = fs.readdirSync(target, { withFileTypes: true }).map(e => ({
        name:  e.name,
        isDir: e.isDirectory(),
        size:  e.isDirectory() ? null : fs.statSync(path.join(target, e.name)).size,
      }));
      ok(res, { path: target, entries });
    } catch (e) {
      err(res, e.message, 500);
    }
  } else {
    // Arquivo — só lê textos (server.properties, json, yaml, txt, log)
    const TEXT_EXTS = ['.properties', '.json', '.yml', '.yaml', '.txt', '.log', '.toml', '.cfg', '.conf'];
    if (!TEXT_EXTS.includes(path.extname(target).toLowerCase())) {
      return err(res, 'Tipo de arquivo não suportado para edição');
    }
    try {
      const content = fs.readFileSync(target, 'utf8');
      ok(res, { path: target, content });
    } catch (e) {
      err(res, e.message, 500);
    }
  }
});

// PUT /api/files — salva conteúdo de arquivo texto
router.put('/files', express.json({ limit: '2mb' }), (req, res) => {
  const cfg    = readConfig();
  const { filePath, content } = req.body || {};
  if (!filePath || content === undefined) return err(res, 'filePath e content obrigatórios');

  const target = safePath(cfg.versionsDir, filePath);
  if (!target) return err(res, 'Caminho inválido', 403);

  try {
    fs.writeFileSync(target, content, 'utf8');
    ok(res, { path: target });
  } catch (e) {
    err(res, e.message, 500);
  }
});

// ─────────────────────────────────────────────────────────────────
// PLAYERS
// ─────────────────────────────────────────────────────────────────

// GET /api/players/:id — jogadores online (estado em memória)
router.get('/players/:id', (req, res) => {
  const s = manager.getStatus(req.params.id);
  if (!s) return err(res, 'Servidor não encontrado', 404);
  ok(res, { players: s.players });
});

// POST /api/players/:id/kick
router.post('/players/:id/kick', express.json(), (req, res) => {
  const { player, reason } = req.body || {};
  if (!player) return err(res, 'player obrigatório');
  try {
    const cmd = reason ? `kick ${player} ${reason}` : `kick ${player}`;
    ok(res, manager.sendCommand(req.params.id, cmd));
  } catch (e) { err(res, e.message); }
});

// POST /api/players/:id/ban
router.post('/players/:id/ban', express.json(), (req, res) => {
  const { player, reason } = req.body || {};
  if (!player) return err(res, 'player obrigatório');
  try {
    const cmd = reason ? `ban ${player} ${reason}` : `ban ${player}`;
    ok(res, manager.sendCommand(req.params.id, cmd));
  } catch (e) { err(res, e.message); }
});

// POST /api/players/:id/op
router.post('/players/:id/op', express.json(), (req, res) => {
  const { player } = req.body || {};
  if (!player) return err(res, 'player obrigatório');
  try {
    ok(res, manager.sendCommand(req.params.id, `op ${player}`));
  } catch (e) { err(res, e.message); }
});

// ─────────────────────────────────────────────────────────────────
// SYSTEM STATS
// ─────────────────────────────────────────────────────────────────

router.get('/system', async (req, res) => {
  try {
    let stats;
    try {
      const si = require('systeminformation');
      const [cpu, mem, disk] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
      ]);
      stats = {
        cpu:  Math.round(cpu.currentLoad),
        ram:  { used: mem.active, total: mem.total },
        disk: disk[0] ? { used: disk[0].used, size: disk[0].size } : null,
      };
    } catch {
      // Fallback Android/Termux via /proc
      stats = readProcStats();
    }
    ok(res, { system: stats });
  } catch (e) {
    err(res, e.message, 500);
  }
});

function readProcStats() {
  let ramUsed = 0, ramTotal = 0;
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const getVal  = key => {
      const m = new RegExp(`${key}:\\s+(\\d+)`).exec(meminfo);
      return m ? parseInt(m[1]) * 1024 : 0;
    };
    ramTotal = getVal('MemTotal');
    const free    = getVal('MemFree');
    const buffers = getVal('Buffers');
    const cached  = getVal('Cached');
    ramUsed = ramTotal - free - buffers - cached;
  } catch {}
  return { cpu: null, ram: { used: ramUsed, total: ramTotal }, disk: null };
}

// ─────────────────────────────────────────────────────────────────
// TUNNEL
// ─────────────────────────────────────────────────────────────────

router.get('/tunnel', (req, res) => {
  ok(res, {
    running:   playit.isRunning(),
    address:   playit.getAddress(),
    hasSecret: playit.hasSecret(),
  });
});

// POST /api/tunnel/secret — salva o secret_key e (re)inicia o tunnel
router.post('/tunnel/secret', express.json(), async (req, res) => {
  const { secretKey } = req.body || {};
  if (!secretKey || secretKey.trim().length < 10) {
    return err(res, 'secretKey inválido');
  }
  try {
    playit.stop();
    playit.saveSecret(secretKey);
    setTimeout(async () => { try { await playit.start(); } catch {} }, 500);
    ok(res, { saved: true });
  } catch (e) { err(res, e.message); }
});

router.post('/tunnel/start', async (req, res) => {
  try {
    await playit.start();
    ok(res, { started: true });
  } catch (e) { err(res, e.message); }
});

router.post('/tunnel/stop', (req, res) => {
  playit.stop();
  ok(res, { stopped: true });
});

router.post('/tunnel/restart', async (req, res) => {
  playit.stop();
  setTimeout(async () => {
    try { await playit.start(); } catch {}
  }, 1500);
  ok(res, { restarting: true });
});

// ─────────────────────────────────────────────────────────────────
// CONFIG GLOBAL
// ─────────────────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  ok(res, { config: readConfig() });
});

router.patch('/config', express.json(), (req, res) => {
  try {
    const updated = writeConfig(req.body);
    ok(res, { config: updated });
  } catch (e) { err(res, e.message, 500); }
});

module.exports = router;
