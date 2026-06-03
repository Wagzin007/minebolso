'use strict';

const http    = require('http');
const path    = require('path');
const express = require('express');
const { readConfig, ensureDirs } = require('./config');
const manager  = require('./server/ServerManager');
const playit   = require('./tunnel/PlayitManager');
const Watchdog = require('./watchdog/Watchdog');
const TerminalSocket = require('./ws/TerminalSocket');
const apiRoutes = require('./api/routes');

// ── Bootstrap ──────────────────────────────────────────────────────
async function main() {
  ensureDirs();
  const cfg = readConfig();

  const app    = express();
  const server = http.createServer(app);

  // ── Middleware ──
  app.use((req, res, next) => {
    res.setHeader('X-Powered-By', 'MineBolso');
    next();
  });

  // ── API ──
  app.use('/api', apiRoutes);

  // ── UI estática (single file HTML) ──
  const publicDir = path.join(__dirname, 'public');
  app.use(express.static(publicDir));

  // SPA fallback — qualquer rota não-API serve o index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // ── WebSocket Terminal ──
  new TerminalSocket(server, manager);

  // ── Watchdog ──
  const watchdog = new Watchdog(manager);
  watchdog.start();

  // ── playit.gg tunnel (se configurado) ──
  if (cfg.autoTunnel) {
    playit.on('log',     ({ line }) => console.log(line));
    playit.on('address', ({ address }) => {
      console.log(`\n🔗  Tunnel ativo: ${address}\n`);
    });
    playit.on('needs_secret', () => {
      console.log('\n[playit.gg] ⚠ Secret não configurado.');
      console.log('[playit.gg] Abra http://localhost:' + (process.env.PORT || cfg.port || 25580) + ' → aba Tunnel → cole seu secret.\n');
    });
    // Inicia sem bloquear o servidor
    playit.start().catch(() => {});
  }

  // ── Inicia HTTP ──
  const PORT = process.env.PORT || cfg.port || 25580;
  server.listen(PORT, '0.0.0.0', () => {
    const divider = '─'.repeat(52);
    console.log(`\n${divider}`);
    console.log(`  ⬛  MineBolso v1.0.0`);
    console.log(`${divider}`);
    console.log(`  🌐  http://localhost:${PORT}`);
    console.log(`  📂  Versões: ${cfg.versionsDir}`);
    console.log(`  📡  WebSocket: ws://localhost:${PORT}/terminal`);
    console.log(`${divider}\n`);

    // Abre o navegador automaticamente
    const url = `http://localhost:${PORT}`;
    try {
      const { execSync } = require('child_process');
      const cmd = process.platform === 'win32' ? `start "" "${url}"`
        : process.platform === 'darwin'        ? `open "${url}"`
        : `xdg-open "${url}" 2>/dev/null || termux-open-url "${url}" 2>/dev/null || true`;
      execSync(cmd, { shell: true, timeout: 3000 });
    } catch {}
  });

  // ── Graceful shutdown ──
  const shutdown = (sig) => {
    console.log(`\n[MineBolso] ${sig} recebido — encerrando...`);
    watchdog.stop();
    playit.stop();

    // Para todos os servidores ativos
    const running = manager.listAll().filter(s => s.running);
    if (running.length === 0) return process.exit(0);

    let stopped = 0;
    for (const srv of running) {
      const proc = manager.getProcess(srv.id);
      if (!proc) { stopped++; continue; }
      proc.once('exit', () => {
        stopped++;
        if (stopped === running.length) process.exit(0);
      });
      proc.stop(5000);
    }

    // Força saída após 8s no máximo
    setTimeout(() => process.exit(1), 8000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch(e => {
  console.error('[MineBolso] Erro fatal:', e);
  process.exit(1);
});
