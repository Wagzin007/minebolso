'use strict';

const { spawn }        = require('child_process');
const { EventEmitter } = require('events');
const fs               = require('fs');
const path             = require('path');
const os               = require('os');
const https            = require('https');
const { execSync }     = require('child_process');
const { readConfig }   = require('../config');

// Endereço do tunnel gerado pelo playit
const ADDR_RE = /([a-z0-9.-]+\.(?:joinmc\.link|playit\.gg):\d+)/i;
const CLAIM_RE = /(https?:\/\/[^\s]+)/i;

// Binários por plataforma — GitHub Releases v1.0.6
const PLAYIT_BINS = {
  'linux-x64':    'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-linux-amd64',
  'linux-arm64':  'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-linux-aarch64',
  'linux-arm':    'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-linux-armv7',
  'win32-x64':    'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-windows-x86_64.exe',
  'darwin-x64':   'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-linux-amd64',
  'darwin-arm64': 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-linux-aarch64',
};

class PlayitManager extends EventEmitter {
  constructor() {
    super();
    this.proc       = null;
    this.address    = null;
    this._ready     = false;
    this._secretPath = path.join(os.homedir(), '.config', 'playit_gg', 'playit.toml');
    this._socketPath = null;
  }

  // ── Verifica se o secret já está configurado ──────────────────
  hasSecret() { return true; }

  // ── Grava o secret_key no playit.toml ─────────────────────────
  saveSecret() { return true; }

  // ── Inicia o daemon ───────────────────────────────────────────
  async start() {
    if (this.proc) return;

    // Se não tem secret, emite evento para a UI pedir ao usuário
    

    const cfg     = readConfig();
    const binPath = cfg.playitBin;

    if (!fs.existsSync(binPath)) {
      try {
        await this._download(binPath);
      } catch (e) {
        this.emit('log', { line: `[playit.gg] Erro ao baixar: ${e.message}` });
        return;
      }
    }

    if (process.platform !== 'win32') {
      try { fs.chmodSync(binPath, 0o755); } catch {}
    }

    this._socketPath = path.join(path.dirname(binPath), 'playitd.sock');

    // Remove socket antigo se existir (evita "already running")
    if (fs.existsSync(this._socketPath)) {
      try { fs.unlinkSync(this._socketPath); } catch {}
    }

    this.emit('log', { line: '[playit.gg] Iniciando tunnel...' });

    this.proc = spawn(binPath, [], { stdio: ['ignore', 'pipe', 'pipe'] });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');

    const handle = d => {
      for (const line of d.split('\n').filter(Boolean)) {
        this.emit('log', { line: `[playit.gg] ${line.trim()}` });
        this._parseAddress(line); const c=line.match(CLAIM_RE); if(c){this.emit('claim',{url:c[1]});}
      }
    };

    this.proc.stdout.on('data', handle);
    this.proc.stderr.on('data', handle);

    this.proc.on('exit', (code, signal) => {
      this.proc    = null;
      this.address = null;
      this._ready  = false;
      // Limpa socket morto
      if (this._socketPath && fs.existsSync(this._socketPath)) {
        try { fs.unlinkSync(this._socketPath); } catch {}
      }
      this.emit('exit', { code, signal });
      this.emit('log', { line: `[playit.gg] Processo encerrado (code=${code})` });
    });
  }

  stop() {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
    if (this._socketPath && fs.existsSync(this._socketPath)) {
      try { fs.unlinkSync(this._socketPath); } catch {}
    }
  }

  isRunning()  { return this.proc !== null; }
  getAddress() { return this.address; }

  _parseAddress(line) {
    if (this._ready) return;
    const m = ADDR_RE.exec(line);
    if (!m) return;
    this.address = m[1];
    this._ready  = true;
    this.emit('address', { address: this.address });
    this.emit('log', { line: `[playit.gg] ✅ Tunnel ativo: ${this.address}` });
  }

  _download(destPath) {
    return new Promise((resolve, reject) => {
      let key;
      if (process.platform === 'win32') {
        key = 'win32-x64';
      } else if (process.platform === 'darwin') {
        key = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
      } else {
        const arch = process.arch;
        if      (arch === 'arm64' || arch === 'aarch64') key = 'linux-arm64';
        else if (arch === 'arm')                          key = 'linux-arm';
        else                                              key = 'linux-x64';
      }

      const url = PLAYIT_BINS[key];
      if (!url) return reject(new Error(`Plataforma não suportada: ${process.platform}/${process.arch}`));

      this.emit('log', { line: `[playit.gg] Baixando binário (${key})...` });

      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const fetch = (url, attempt) => {
        if (attempt > 6) return reject(new Error('Muitos redirects'));
        https.get(url, { headers: { 'User-Agent': 'MineBolso/1.0' } }, res => {
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
            res.resume();
            return fetch(res.headers.location, attempt + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
          file.on('error',  err => { fs.unlink(destPath, () => {}); reject(err); });
        }).on('error', err => { fs.unlink(destPath, () => {}); reject(err); });
      };

      fetch(url, 0);
    });
  }
}

module.exports = new PlayitManager();
