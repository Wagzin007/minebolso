'use strict';

const pidusage = require('pidusage');
const { readConfig } = require('../config');

class Watchdog {
  constructor(manager) {
    this.manager = manager;
    this._timer = null;
    this._running = false;
    this._tpsBad = new Map();
    this._restartHistory = new Map();
  }

  start() {
    const cfg = readConfig().watchdog;
    if (!cfg.enabled || this._timer) return;
    this._timer = setInterval(() => this._tick().catch(error => {
      this.manager.emit('alert', { serverId: 'system', type: 'watchdog_error', message: `Watchdog falhou: ${error.message}` });
    }), cfg.checkIntervalMs);
    if (this._timer.unref) this._timer.unref();
    console.log(`[Watchdog] Monitoramento ativo (${cfg.checkIntervalMs}ms)`);
  }

  stop() {
    if (!this._timer) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  async _tick() {
    if (this._running) return;
    this._running = true;
    try {
      const cfg = readConfig().watchdog;
      const list = this.manager.listAll();
      for (const srv of list) await this._inspectServer(srv, cfg);
    } finally {
      this._running = false;
    }
  }

  async _inspectServer(srv, cfg) {
    const proc = this.manager.getProcess(srv.id);
    const state = this.manager.getState(srv.id);

    if (!srv.running) {
      if (proc && state?.health === 'crashed') this._recoverCrash(srv, cfg);
      return;
    }

    if (srv.pid) await this._measureRam(srv, cfg);
    this._inspectTps(srv, cfg);
  }

  _recoverCrash(srv, cfg) {
    if (srv.autoRestart === false || !cfg.autoRestart) return;
    const now = Date.now();
    const windowMs = cfg.crashWindowMs || 60_000;
    const maxRestarts = cfg.maxRestarts || 3;
    const history = (this._restartHistory.get(srv.id) || []).filter(ts => now - ts < windowMs);
    if (history.length >= maxRestarts) {
      this.manager.emit('alert', {
        serverId: srv.id,
        type: 'restart_limit',
        message: `Servidor ${srv.id} crashou repetidamente. Reinício automático pausado para evitar loop.`,
      });
      this.manager.removeDeadInstance(srv.id);
      this._restartHistory.set(srv.id, history);
      return;
    }

    history.push(now);
    this._restartHistory.set(srv.id, history);
    this.manager.emit('alert', { serverId: srv.id, type: 'crash', message: `Servidor ${srv.id} caiu. Tentando recuperar automaticamente...` });
    this.manager.removeDeadInstance(srv.id);
    setTimeout(() => {
      try { this.manager.start(srv.id); }
      catch (error) { this.manager.emit('alert', { serverId: srv.id, type: 'restart_failed', message: `Falha ao reiniciar: ${error.message}` }); }
    }, 3000);
  }

  async _measureRam(srv, cfg) {
    try {
      const usage = await pidusage(srv.pid);
      const state = this.manager.getState(srv.id);
      if (state) state.ramUsed = usage.memory;
      const allocatedBytes = (srv.ram || 1) * 1024 * 1024 * 1024;
      const pct = allocatedBytes ? (usage.memory / allocatedBytes) * 100 : 0;
      if (pct > cfg.ramThreshold) {
        this.manager.emit('alert', { serverId: srv.id, type: 'high_ram', message: `RAM alta: ${Math.round(pct)}% do limite configurado.` });
      }
    } catch {
      // O processo pode encerrar durante a coleta; será tratado no próximo ciclo.
    }
  }

  _inspectTps(srv, cfg) {
    if (!srv.tps) return;
    const tps1m = srv.tps.tps1m ?? 20;
    const badCycles = tps1m < cfg.tpsThreshold ? (this._tpsBad.get(srv.id) || 0) + 1 : 0;
    this._tpsBad.set(srv.id, badCycles);
    if (badCycles >= cfg.tpsAlertCycles) {
      this._tpsBad.set(srv.id, 0);
      this.manager.emit('alert', { serverId: srv.id, type: 'low_tps', message: `TPS baixo (${tps1m.toFixed(1)}/20). Reduza players/mods ou aumente RAM.` });
    }
  }
}

module.exports = Watchdog;
