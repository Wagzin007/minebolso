'use strict';

const pidusage = require('pidusage');
const { readConfig } = require('../config');

/**
 * Watchdog monitora instâncias ativas a cada N segundos.
 * Quando detecta crash, reinicia se autoRestart=true.
 * Atualiza state.ramUsed para o status API.
 * Emite alertas via ServerManager (já conectado ao WS).
 */
class Watchdog {
  constructor(manager) {
    this.manager  = manager;   // ServerManager singleton
    this._timer   = null;
    this._tpsBad  = {};        // serverId → contagem de ciclos ruins
  }

  start() {
    const cfg = readConfig().watchdog;
    if (!cfg.enabled) return;

    this._timer = setInterval(() => this._tick(), cfg.checkIntervalMs);
    // Evita que o timer impeça o processo de encerrar
    if (this._timer.unref) this._timer.unref();

    console.log(`[Watchdog] Monitoramento ativo (intervalo: ${cfg.checkIntervalMs}ms)`);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _tick() {
    const cfg  = readConfig().watchdog;
    const list = this.manager.listAll();

    for (const srv of list) {
      if (!srv.running) {
        // Se tiver processo morto mas estava rodando → crash
        const proc = this.manager.getProcess(srv.id);
        if (proc && !proc.isRunning() && proc.ready === false && proc.pid === null) {
          // Já foi 'exit' — limpa e reinicia se configurado
          if (cfg.autoRestart && srv.autoRestart !== false) {
            this.manager.emit('alert', {
              serverId: srv.id,
              type:     'crash',
              message:  `Servidor ${srv.id} crashou. Reiniciando...`,
            });
            // Pequeno delay antes de reiniciar
            setTimeout(() => {
              try { this.manager.start(srv.id); } catch (e) {
                this.manager.emit('alert', {
                  serverId: srv.id,
                  type:     'restart_failed',
                  message:  `Falha ao reiniciar ${srv.id}: ${e.message}`,
                });
              }
            }, 3000);
          }
        }
        continue;
      }

      // ── Mede RAM do processo Java ──
      if (srv.pid) {
        try {
          const usage = await pidusage(srv.pid);
          const state = this.manager.getState(srv.id);
          if (state) state.ramUsed = usage.memory;   // bytes

          // Alerta se RAM > threshold% do alocado
          const allocatedBytes = (srv.ram || 1) * 1024 * 1024 * 1024;
          const pct = (usage.memory / allocatedBytes) * 100;
          if (pct > cfg.ramThreshold) {
            this.manager.emit('alert', {
              serverId: srv.id,
              type:     'high_ram',
              message:  `RAM alta em ${srv.id}: ${Math.round(pct)}% do alocado`,
            });
          }
        } catch {
          // processo pode ter morrido entre o listAll e o pidusage — ignora
        }
      }

      // ── Verifica TPS ──
      if (srv.tps) {
        const tps1m = srv.tps.tps1m ?? 20;
        if (tps1m < cfg.tpsThreshold) {
          this._tpsBad[srv.id] = (this._tpsBad[srv.id] || 0) + 1;
          if (this._tpsBad[srv.id] >= cfg.tpsAlertCycles) {
            this._tpsBad[srv.id] = 0;   // reset para não spam
            this.manager.emit('alert', {
              serverId: srv.id,
              type:     'low_tps',
              message:  `TPS baixo em ${srv.id}: ${tps1m.toFixed(1)}/20.0`,
            });
          }
        } else {
          this._tpsBad[srv.id] = 0;
        }
      }
    }
  }
}

module.exports = Watchdog;
