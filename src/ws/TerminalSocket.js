'use strict';

const { WebSocketServer } = require('ws');

/**
 * TerminalSocket: bridge WebSocket ↔ processos Java.
 *
 * Protocolo (JSON em ambas direções):
 *
 * Cliente → Servidor:
 *   { type: "subscribe", serverId: "1.20.4" }
 *   { type: "command",   serverId: "1.20.4", cmd: "say hello" }
 *   { type: "ping" }
 *
 * Servidor → Cliente:
 *   { type: "log",    serverId, line, level }
 *   { type: "status", serverId, ...campos }
 *   { type: "alert",  serverId, alertType, message }
 *   { type: "pong" }
 *   { type: "error",  message }
 */
class TerminalSocket {
  constructor(httpServer, manager, tunnel = null) {
    this.manager = manager;
    this.tunnel = tunnel;
    this.wss     = new WebSocketServer({ server: httpServer, path: '/terminal' });

    // Set de clientes por serverId
    // serverId → Set<WebSocket>
    this._subs = new Map();

    this._setupManagerEvents();
    this._setupTunnelEvents();
    this._setupWSS();
  }

  // ── Conecta eventos do ServerManager ao broadcast ──────────────
  _setupManagerEvents() {
    this.manager.on('log', payload => {
      this._broadcast(payload.serverId, { type: 'log', ...payload });
    });

    this.manager.on('status', payload => {
      this._broadcast(payload.serverId, { type: 'status', ...payload });
    });

    this.manager.on('alert', payload => {
      this._broadcast(payload.serverId, {
        type:      'alert',
        serverId:  payload.serverId,
        alertType: payload.type,
        message:   payload.message,
      });
    });

    this.manager.on('library', payload => {
      this._broadcastAll({ type: 'library', ...payload });
    });
  }

  _setupTunnelEvents() {
    if (!this.tunnel) return;
    this.tunnel.on('status', status => this._broadcastAll({ type: 'tunnel', ...status }));
    this.tunnel.on('address', ({ address }) => this._broadcastAll({ type: 'tunnel_address', address }));
    this.tunnel.on('claim', ({ url }) => this._broadcastAll({ type: 'tunnel_claim', url }));
  }

  _setupTunnelEvents() {
    if (!this.tunnel) return;
    this.tunnel.on('status', status => this._broadcastAll({ type: 'tunnel', ...status }));
    this.tunnel.on('address', ({ address }) => this._broadcastAll({ type: 'tunnel_address', address }));
    this.tunnel.on('claim', ({ url }) => this._broadcastAll({ type: 'tunnel_claim', url }));
  }

  // ── Gerencia conexões WebSocket ────────────────────────────────
  _setupWSS() {
    this.wss.on('connection', (ws, req) => {
      const ip = req.socket.remoteAddress;
      console.log(`[WS] Cliente conectado: ${ip}`);

      // Conjunto de serverIds que este ws está inscrito
      ws._subscriptions = new Set();

      ws.on('message', raw => {
        let msg;
        if (raw.length > 4096) {
          this._send(ws, { type: 'error', message: 'Mensagem muito grande' });
          return;
        }
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          this._send(ws, { type: 'error', message: 'JSON inválido' });
          return;
        }

        this._handleMessage(ws, msg);
      });

      ws.on('close', () => {
        // Remove das listas de subscriber
        for (const sid of ws._subscriptions) {
          const set = this._subs.get(sid);
          if (set) set.delete(ws);
        }
        console.log(`[WS] Cliente desconectado: ${ip}`);
      });

      ws.on('error', err => {
        console.error(`[WS] Erro no cliente ${ip}:`, err.message);
      });
    });
  }

  _handleMessage(ws, msg) {
    switch (msg.type) {

      case 'ping':
        this._send(ws, { type: 'pong' });
        break;

      case 'subscribe': {
        const sid = msg.serverId;
        if (!sid) { this._send(ws, { type: 'error', message: 'serverId obrigatório' }); return; }

        if (!this._subs.has(sid)) this._subs.set(sid, new Set());
        this._subs.get(sid).add(ws);
        ws._subscriptions.add(sid);

        // Envia status inicial
        const status = this.manager.getStatus(sid);
        if (status) this._send(ws, { type: 'status', serverId: sid, event: 'init', ...status });
        break;
      }

      case 'command': {
        const { serverId, cmd } = msg;
        if (!serverId || !cmd) {
          this._send(ws, { type: 'error', message: 'serverId e cmd obrigatórios' });
          return;
        }
        try {
          this.manager.sendCommand(serverId, cmd);
          // Ecoa o comando na saída como log
          this._broadcast(serverId, {
            type:     'log',
            serverId,
            line:     `> ${cmd}`,
            level:    'CMD',
          });
        } catch (e) {
          this._send(ws, { type: 'error', message: e.message });
        }
        break;
      }

      default:
        this._send(ws, { type: 'error', message: `Tipo desconhecido: ${msg.type}` });
    }
  }

  // ── Envia para todos os subscribers de um servidor ─────────────
  _broadcast(serverId, payload) {
    const set = this._subs.get(serverId);
    if (!set || set.size === 0) return;
    const data = JSON.stringify(payload);
    for (const ws of set) {
      if (ws.readyState === 1 /* OPEN */) {
        try { ws.send(data); } catch {}
      }
    }
  }

  _broadcastAll(payload) {
    const data = JSON.stringify(payload);
    for (const client of this.wss.clients) {
      if (client.readyState === 1) {
        try { client.send(data); } catch {}
      }
    }
  }

  // ── Envia para um cliente específico ───────────────────────────
  _send(ws, payload) {
    if (ws.readyState === 1) { try { ws.send(JSON.stringify(payload)); } catch {} }
  }
}

module.exports = TerminalSocket;
