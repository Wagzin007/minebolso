'use strict';

const { EventEmitter } = require('events');
const { readServers, writeServers, readConfig } = require('../config');
const { scanVersions, getVersion } = require('./ServerScanner');
const ServerProcess = require('./ServerProcess');

/**
 * ServerManager é o coração do MineBolso.
 * Mantém um Map de instâncias ServerProcess ativas e
 * sincroniza metadados com servers.json.
 *
 * Emite (para o WebSocket repassar):
 *   'log'    { serverId, line, level }
 *   'status' { serverId, ...statusObj }
 *   'alert'  { serverId, type, message }
 */
class ServerManager extends EventEmitter {
  constructor() {
    super();
    // serverId (string) → { process: ServerProcess, meta: obj, cfg: obj, state: obj }
    this._instances = new Map();
  }

  // ── Lista todos os servidores detectados + status ───────────────
  listAll() {
    const versions  = scanVersions();       // do filesystem
    const savedList = readServers();        // metadados salvos
    const savedMap  = Object.fromEntries(savedList.map(s => [s.id, s]));

    return versions.map(v => {
      const saved    = savedMap[v.id] || {};
      const instance = this._instances.get(v.id);
      return {
        ...v,
        // Config salva
        name:       saved.name       || v.id,
        ram:        saved.ram        || 1,
        javaFlags:  saved.javaFlags  || '',
        autoStart:  saved.autoStart  || false,
        // Estado em tempo real
        running:    instance ? instance.proc.isRunning() : false,
        ready:      instance ? instance.proc.ready       : false,
        pid:        instance ? instance.proc.pid         : null,
        tps:        instance ? instance.state.tps        : null,
        players:    instance ? instance.state.players    : [],
        ramUsed:    instance ? instance.state.ramUsed    : 0,
        uptime:     instance ? instance.state.startedAt
          ? Math.floor((Date.now() - instance.state.startedAt) / 1000) : 0 : 0,
      };
    });
  }

  // ── Retorna status de um servidor específico ───────────────────
  getStatus(id) {
    return this.listAll().find(s => s.id === id) || null;
  }

  // ── Inicia servidor ────────────────────────────────────────────
  start(id) {
    if (this._instances.has(id)) {
      const inst = this._instances.get(id);
      if (inst.proc.isRunning()) throw new Error(`Servidor ${id} já está rodando`);
      // Limpa instância morta
      this._instances.delete(id);
    }

    const meta = getVersion(id);
    if (!meta) throw new Error(`Versão ${id} não encontrada em versions/`);

    const saved = readServers().find(s => s.id === id) || {};
    const cfg   = {
      ram:       saved.ram       || readConfig().defaultRam || 1,
      javaFlags: saved.javaFlags || '',
    };

    const proc  = new ServerProcess(meta, cfg);
    const state = {
      startedAt: null,
      tps:       { tps1m: 20, tps5m: 20, tps15m: 20 },
      players:   [],
      ramUsed:   0,
    };

    const instance = { proc, meta, cfg, state };
    this._instances.set(id, instance);

    // ── Eventos do processo ──
    proc.on('log', ({ line, level }) => {
      this.emit('log', { serverId: id, line, level });
    });

    proc.on('ready', () => {
      state.startedAt = Date.now();
      this._saveServerMeta(id, { lastStarted: new Date().toISOString() });
      this.emit('status', { serverId: id, event: 'ready', ...this.getStatus(id) });
    });

    proc.on('tps', tps => {
      state.tps = tps;
      this.emit('status', { serverId: id, event: 'tps', tps });
    });

    proc.on('join', ({ player }) => {
      if (!state.players.includes(player)) state.players.push(player);
      this.emit('status', { serverId: id, event: 'join', player, players: [...state.players] });
    });

    proc.on('leave', ({ player }) => {
      state.players = state.players.filter(p => p !== player);
      this.emit('status', { serverId: id, event: 'leave', player, players: [...state.players] });
    });

    proc.on('exit', ({ code, signal }) => {
      this.emit('status', { serverId: id, event: 'exit', code, signal });
      // Não remove do Map aqui — o Watchdog decide se reinicia
    });

    proc.start();
    this.emit('log', {
      serverId: id,
      line: `[MineBolso] Iniciando servidor ${id}...`,
      level: 'INFO',
    });

    return { ok: true, id };
  }

  // ── Para servidor ──────────────────────────────────────────────
  stop(id) {
    const inst = this._instances.get(id);
    if (!inst) throw new Error(`Servidor ${id} não está rodando`);
    inst.proc.stop();
    return { ok: true, id };
  }

  // ── Reinicia servidor ──────────────────────────────────────────
  restart(id) {
    const inst = this._instances.get(id);
    if (inst?.proc.isRunning()) {
      inst.proc.once('exit', () => {
        setTimeout(() => this.start(id), 1500);
      });
      inst.proc.stop();
    } else {
      this.start(id);
    }
    return { ok: true, id };
  }

  // ── Envia comando ao stdin ─────────────────────────────────────
  sendCommand(id, cmd) {
    const inst = this._instances.get(id);
    if (!inst?.proc.isRunning()) throw new Error(`Servidor ${id} não está rodando`);
    const ok = inst.proc.sendCommand(cmd);
    if (!ok) throw new Error('stdin não disponível');
    return { ok: true, cmd };
  }

  // ── Retorna o processo (para o Watchdog) ───────────────────────
  getProcess(id) {
    return this._instances.get(id)?.proc || null;
  }

  // ── Retorna state mutável (para o Watchdog atualizar ramUsed) ──
  getState(id) {
    return this._instances.get(id)?.state || null;
  }

  // ── Salva/atualiza metadados de um servidor em servers.json ────
  _saveServerMeta(id, updates) {
    const list  = readServers();
    const idx   = list.findIndex(s => s.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...updates };
    } else {
      list.push({ id, ...updates });
    }
    writeServers(list);
  }

  // ── Atualiza config de um servidor (ram, name, etc) ────────────
  updateServerConfig(id, updates) {
    this._saveServerMeta(id, updates);
    return readServers().find(s => s.id === id);
  }
}

// Singleton
module.exports = new ServerManager();
