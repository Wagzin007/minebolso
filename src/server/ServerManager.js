'use strict';

const { EventEmitter } = require('events');
const { readServers, writeServers, readConfig } = require('../config');
const { scanVersions, getVersion } = require('./ServerScanner');
const ServerProcess = require('./ServerProcess');
const { userError, log } = require('../utils/diagnostics');
const { assertServerId, normalizeRam, sanitizeCommand, sanitizeName } = require('../utils/validation');

class ServerManager extends EventEmitter {
  constructor() {
    super();
    this._instances = new Map();
    this._starting = new Set();
    this._lastScanAt = 0;
    this._lastScan = [];
  }

  listAll() {
    const now = Date.now();
    if (now - this._lastScanAt > 1500) {
      this._lastScan = scanVersions();
      this._lastScanAt = now;
    }

    const savedList = readServers();
    const savedMap = Object.fromEntries(savedList.map(s => [s.id, s]));

    return this._lastScan.map(version => {
      const saved = savedMap[version.id] || {};
      const instance = this._instances.get(version.id);
      const running = Boolean(instance?.proc.isRunning());
      return {
        ...version,
        name: sanitizeName(saved.name, version.id),
        ram: normalizeRam(saved.ram, readConfig().defaultRam || 1),
        javaFlags: saved.javaFlags || '',
        autoStart: Boolean(saved.autoStart),
        autoRestart: saved.autoRestart !== false,
        lastStarted: saved.lastStarted || null,
        lastExit: saved.lastExit || null,
        running,
        starting: this._starting.has(version.id) && !running,
        ready: Boolean(instance?.proc.ready),
        pid: running ? instance.proc.pid : null,
        tps: instance?.state.tps || null,
        players: instance ? [...instance.state.players] : [],
        ramUsed: instance?.state.ramUsed || 0,
        health: instance?.state.health || 'offline',
        uptime: instance?.state.startedAt ? Math.floor((now - instance.state.startedAt) / 1000) : 0,
      };
    });
  }

  getStatus(id) {
    id = assertServerId(id);
    return this.listAll().find(s => s.id === id) || null;
  }

  start(id) {
    id = assertServerId(id);
    const existing = this._instances.get(id);
    if (existing?.proc.isRunning()) {
      throw userError(`Servidor ${id} já está rodando.`, { code: 'SERVER_ALREADY_RUNNING' });
    }
    if (this._starting.has(id)) {
      throw userError(`Servidor ${id} já está iniciando.`, { code: 'SERVER_STARTING' });
    }
    this._instances.delete(id);

    const meta = getVersion(id);
    if (!meta) {
      throw userError(`Versão ${id} não encontrada.`, {
        statusCode: 404,
        code: 'SERVER_VERSION_NOT_FOUND',
        suggestion: 'Copie a pasta da versão para .minecraft/versions e clique em Reescanear.',
      });
    }
    if (!meta.available) {
      throw userError(meta.integrity?.message || 'Versão incompleta.', {
        statusCode: 409,
        code: 'VERSION_NOT_RUNNABLE',
        details: meta.integrity?.issues || [],
        suggestion: 'Copie novamente a instalação ou exporte a versão em modo servidor para .minecraft/versions.',
      });
    }

    const saved = readServers().find(s => s.id === id) || {};
    const appCfg = readConfig();
    const cfg = {
      ram: normalizeRam(saved.ram, appCfg.defaultRam || 1),
      javaFlags: saved.javaFlags || '',
      javaPath: appCfg.javaPath || 'java',
    };

    const proc = new ServerProcess(meta, cfg);
    const state = {
      startedAt: null,
      tps: { tps1m: 20, tps5m: 20, tps15m: 20 },
      players: [],
      ramUsed: 0,
      health: 'starting',
      expectedStop: false,
      crashCount: existing?.state.crashCount || 0,
    };

    this._starting.add(id);
    this._instances.set(id, { proc, meta, cfg, state });
    this._wireProcess(id, proc, state);

    try {
      proc.start();
    } catch (error) {
      this._starting.delete(id);
      this._instances.delete(id);
      throw error;
    }

    this.emit('log', { serverId: id, line: `[MineBolso] Iniciando ${id} com ${cfg.ram}GB de RAM...`, level: 'INFO' });
    this.emit('status', { serverId: id, event: 'starting', ...this.getStatus(id) });
    return { id, started: true };
  }

  stop(id) {
    id = assertServerId(id);
    const inst = this._instances.get(id);
    if (!inst?.proc.isRunning()) {
      throw userError(`Servidor ${id} não está rodando.`, { code: 'SERVER_NOT_RUNNING' });
    }
    inst.state.expectedStop = true;
    inst.state.health = 'stopping';
    inst.proc.stop();
    this.emit('status', { serverId: id, event: 'stopping', ...this.getStatus(id) });
    return { id, stopping: true };
  }

  restart(id) {
    id = assertServerId(id);
    const inst = this._instances.get(id);
    if (inst?.proc.isRunning()) {
      inst.proc.once('exit', () => setTimeout(() => {
        try { this.start(id); } catch (error) { this.emit('alert', this._alert(id, 'restart_failed', error.message)); }
      }, 1200));
      inst.state.expectedStop = true;
      inst.proc.stop();
      return { id, restarting: true };
    }
    return this.start(id);
  }

  sendCommand(id, cmd) {
    id = assertServerId(id);
    cmd = sanitizeCommand(cmd);
    const inst = this._instances.get(id);
    if (!inst?.proc.isRunning()) throw userError(`Servidor ${id} não está rodando.`, { code: 'SERVER_NOT_RUNNING' });
    if (!inst.proc.sendCommand(cmd)) throw userError('Console indisponível no momento.', { code: 'STDIN_UNAVAILABLE' });
    return { id, cmd };
  }

  getProcess(id) { return this._instances.get(id)?.proc || null; }
  getState(id) { return this._instances.get(id)?.state || null; }

  invalidateScan() {
    this._lastScanAt = 0;
    this._lastScan = [];
  }

  removeDeadInstance(id) {
    const inst = this._instances.get(id);
    if (inst && !inst.proc.isRunning()) this._instances.delete(id);
  }

  updateServerConfig(id, updates) {
    id = assertServerId(id);
    const clean = { ...updates, id };
    if ('name' in clean) clean.name = sanitizeName(clean.name, id);
    if ('ram' in clean) clean.ram = normalizeRam(clean.ram);
    if ('javaFlags' in clean) clean.javaFlags = String(clean.javaFlags || '').slice(0, 300);
    this._saveServerMeta(id, clean);
    return readServers().find(s => s.id === id);
  }

  _wireProcess(id, proc, state) {
    proc.on('log', ({ line, level }) => this.emit('log', { serverId: id, line, level }));
    proc.on('ready', () => {
      this._starting.delete(id);
      state.startedAt = Date.now();
      state.health = 'online';
      state.crashCount = 0;
      this._saveServerMeta(id, { lastStarted: new Date().toISOString() });
      this.emit('status', { serverId: id, event: 'ready', ...this.getStatus(id) });
    });
    proc.on('tps', tps => { state.tps = tps; this.emit('status', { serverId: id, event: 'tps', tps }); });
    proc.on('join', ({ player }) => { if (!state.players.includes(player)) state.players.push(player); this.emit('status', { serverId: id, event: 'join', player, players: [...state.players] }); });
    proc.on('leave', ({ player }) => { state.players = state.players.filter(p => p !== player); this.emit('status', { serverId: id, event: 'leave', player, players: [...state.players] }); });
    proc.on('exit', ({ code, signal }) => {
      this._starting.delete(id);
      state.health = state.expectedStop ? 'offline' : 'crashed';
      state.players = [];
      this._saveServerMeta(id, { lastExit: new Date().toISOString(), lastExitCode: code, lastExitSignal: signal });
      log(state.expectedStop ? 'info' : 'warn', `Servidor ${id} encerrou`, { code, signal, expected: state.expectedStop });
      this.emit('status', { serverId: id, event: 'exit', code, signal, expected: state.expectedStop, ...this.getStatus(id) });
    });
    proc.on('error', error => {
      state.health = 'error';
      this.emit('alert', this._alert(id, 'process_error', error.message));
    });
  }

  _saveServerMeta(id, updates) {
    const list = readServers().filter(Boolean);
    const idx = list.findIndex(s => s.id === id);
    const next = { id, ...(idx >= 0 ? list[idx] : {}), ...updates };
    if (idx >= 0) list[idx] = next;
    else list.push(next);
    writeServers(list);
  }

  _alert(serverId, type, message) {
    return { serverId, type, message, suggestion: 'Abra o console para detalhes e tente reiniciar o servidor.' };
  }
}

module.exports = new ServerManager();
