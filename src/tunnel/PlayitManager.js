'use strict';

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { readConfig } = require('../config');
const { log } = require('../utils/diagnostics');

const ADDR_RE = /([a-z0-9.-]+\.(?:joinmc\.link|playit\.gg):\d+)/i;
const CLAIM_RE = /(https?:\/\/[^\s]+)/i;
const SECRET_RE = /secret_key\s*=\s*['\"]?([^'\"\s]+)/i;

const PLAYIT_BINS = {
  'linux-x64': 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-linux-amd64',
  'linux-arm64': 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-linux-aarch64',
  'linux-arm': 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-linux-armv7',
  'win32-x64': 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-windows-x86_64.exe',
  'darwin-x64': 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-darwin-amd64',
  'darwin-arm64': 'https://github.com/playit-cloud/playit-agent/releases/download/v1.0.6/playit-darwin-aarch64',
};

class PlayitManager extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.address = null;
    this.claimUrl = null;
    this.status = 'offline';
    this.lastError = null;
    this._ready = false;
    this._secretPath = path.join(os.homedir(), '.config', 'playit_gg', 'playit.toml');
    this._socketPath = null;
    this._restartTimer = null;
    this._manualStop = false;
  }

  hasSecret() {
    try {
      return SECRET_RE.test(fs.readFileSync(this._secretPath, 'utf8'));
    } catch { return false; }
  }

  saveSecret(secretKey) {
    const clean = String(secretKey || '').trim();
    const dir = path.dirname(this._secretPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._secretPath, `secret_key = "${clean.replace(/"/g, '')}"\n`, 'utf8');
    return true;
  }

  async start() {
    if (this.proc) return this.getStatus();
    this._manualStop = false;
    this._setStatus(this.hasSecret() ? 'connecting' : 'claim_required');

    const cfg = readConfig();
    const binPath = cfg.playitBin;
    if (!fs.existsSync(binPath)) await this._download(binPath);
    if (process.platform !== 'win32') { try { fs.chmodSync(binPath, 0o755); } catch {} }

    this._socketPath = path.join(path.dirname(binPath), 'playitd.sock');
    this._unlinkSocket();
    this.emit('log', { line: '[playit.gg] Iniciando túnel automático...' });

    this.proc = spawn(binPath, [], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');

    const handle = data => {
      for (const raw of String(data).split('\n').filter(Boolean)) {
        const line = raw.trim();
        this.emit('log', { line: `[playit.gg] ${line}` });
        this._parseAddress(line);
        const claim = CLAIM_RE.exec(line);
        if (claim && !this.address) {
          this.claimUrl = claim[1];
          this._setStatus('claim_required');
          this.emit('claim', { url: this.claimUrl });
        }
      }
    };

    this.proc.stdout.on('data', handle);
    this.proc.stderr.on('data', handle);
    this.proc.on('error', error => this._handleExit(error, null, null));
    this.proc.on('exit', (code, signal) => this._handleExit(null, code, signal));
    return this.getStatus();
  }

  stop() {
    this._manualStop = true;
    if (this._restartTimer) clearTimeout(this._restartTimer);
    this._restartTimer = null;
    if (this.proc) {
      const proc = this.proc;
      this.proc = null;
      try { proc.kill('SIGTERM'); } catch {}
    }
    this.address = null;
    this._ready = false;
    this._unlinkSocket();
    this._setStatus('offline');
  }

  isRunning() { return this.proc !== null; }
  getAddress() { return this.address; }
  getStatus() {
    return {
      running: this.isRunning(),
      status: this.status,
      address: this.address,
      claimUrl: this.claimUrl,
      hasSecret: this.hasSecret(),
      lastError: this.lastError,
    };
  }

  _parseAddress(line) {
    const match = ADDR_RE.exec(line);
    if (!match) return;
    this.address = match[1];
    this._ready = true;
    this.claimUrl = null;
    this.lastError = null;
    this._setStatus('online');
    this.emit('address', { address: this.address });
    this.emit('log', { line: `[playit.gg] ✅ Túnel ativo: ${this.address}` });
  }

  _handleExit(error, code, signal) {
    this.proc = null;
    this.address = null;
    this._ready = false;
    this._unlinkSocket();
    if (error) this.lastError = error.message;
    this.emit('exit', { code, signal, error: error?.message || null });
    this.emit('log', { line: `[playit.gg] Processo encerrado${error ? `: ${error.message}` : ` (code=${code}, signal=${signal || 'none'})`}` });

    if (!this._manualStop) {
      this._setStatus('reconnecting');
      this._restartTimer = setTimeout(() => this.start().catch(err => {
        this.lastError = err.message;
        this._setStatus('error');
        log('warn', 'Falha ao reconectar playit', { error: err });
      }), 5000);
      if (this._restartTimer.unref) this._restartTimer.unref();
    } else {
      this._setStatus('offline');
    }
  }

  _setStatus(status) {
    this.status = status;
    this.emit('status', this.getStatus());
  }

  _unlinkSocket() {
    if (this._socketPath && fs.existsSync(this._socketPath)) {
      try { fs.unlinkSync(this._socketPath); } catch {}
    }
  }

  _download(destPath) {
    return new Promise((resolve, reject) => {
      const key = platformKey();
      const url = PLAYIT_BINS[key];
      if (!url) return reject(new Error(`Plataforma não suportada: ${process.platform}/${process.arch}`));
      this.emit('log', { line: `[playit.gg] Baixando agente (${key})...` });
      const dir = path.dirname(destPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${destPath}.download`;

      const fetch = (nextUrl, attempt = 0) => {
        if (attempt > 6) return reject(new Error('Muitos redirects ao baixar playit.'));
        const req = https.get(nextUrl, { headers: { 'User-Agent': 'MineBolso/2.0' } }, res => {
          if ([301, 302, 307, 308].includes(res.statusCode)) { res.resume(); return fetch(res.headers.location, attempt + 1); }
          if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
          const file = fs.createWriteStream(tmp);
          res.pipe(file);
          file.on('finish', () => file.close(() => { fs.renameSync(tmp, destPath); resolve(); }));
          file.on('error', err => { fs.unlink(tmp, () => {}); reject(err); });
        });
        req.on('error', err => { fs.unlink(tmp, () => {}); reject(err); });
        req.setTimeout(30_000, () => req.destroy(new Error('Timeout baixando playit.')));
      };
      fetch(url);
    });
  }
}

function platformKey() {
  if (process.platform === 'win32') return 'win32-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (process.arch === 'arm64' || process.arch === 'aarch64') return 'linux-arm64';
  if (process.arch === 'arm') return 'linux-arm';
  return 'linux-x64';
}

module.exports = new PlayitManager();
