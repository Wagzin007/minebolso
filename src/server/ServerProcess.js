'use strict';

const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');
const { EventEmitter } = require('events');
const { readConfig }   = require('../config');
const { userError }    = require('../utils/diagnostics');

// Regex para extrair nível de log do Minecraft
const LOG_LEVEL_RE = /\[(.*?)\/(INFO|WARN|ERROR|FATAL|DEBUG)\]/;
// Regex para capturar TPS do tick watchdog do Paper/Spigot
const TPS_RE = /TPS from last 1m, 5m, 15m: ([\d.]+), ([\d.]+), ([\d.]+)/;
// Regex para detectar "Done" (servidor pronto)
const DONE_RE = /Done \([\d.]+s\)!/;
// Regex para jogador entrou/saiu
const JOIN_RE  = /(\w+) joined the game/;
const LEAVE_RE = /(\w+) left the game/;

/**
 * ServerProcess encapsula um único processo Java de servidor Minecraft.
 * Emite:
 *   'log'    { line: string, level: 'INFO'|'WARN'|'ERROR'|'FATAL'|'RAW' }
 *   'ready'  {}   — quando detecta "Done (...s)!"
 *   'exit'   { code: number|null, signal: string|null }
 *   'tps'    { tps1m: number, tps5m: number, tps15m: number }
 *   'join'   { player: string }
 *   'leave'  { player: string }
 */
class ServerProcess extends EventEmitter {
  constructor(versionMeta, serverCfg) {
    super();
    this.meta    = versionMeta;   // do ServerScanner
    this.cfg     = serverCfg;     // { ram, javaFlags, ... }
    this.proc    = null;
    this.ready   = false;
    this.pid     = null;
    this._logBuf = '';            // buffer para linhas incompletas
  }

  // ── Inicia o processo Java ──────────────────────────────────────
  start() {
    if (this.proc) throw new Error('Processo já está rodando');

    const config   = readConfig();
    const javaPath = this.cfg.javaPath || config.javaPath || 'java';
    const ram      = this.cfg.ram || 1;          // GB
    const extraFlags = this.cfg.javaFlags || '';

    const launch = this.meta.launch || { type: 'jar', jarPath: this.meta.jarPath };
    if (launch.type === 'jar' && !fs.existsSync(launch.jarPath)) {
      throw userError('Arquivo de servidor não encontrado.', {
        statusCode: 404,
        code: 'SERVER_JAR_NOT_FOUND',
        suggestion: 'Copie novamente a pasta para .minecraft/versions e tente de novo.',
      });
    }
    if (launch.type === 'script' && !fs.existsSync(launch.scriptPath)) {
      throw userError('Script de inicialização não encontrado.', {
        statusCode: 404,
        code: 'SERVER_SCRIPT_NOT_FOUND',
        suggestion: 'Copie novamente a pasta para .minecraft/versions e tente de novo.',
      });
    }

    // Aceita EULA automaticamente — grava arquivo se não existir
    this._ensureEula();

    const baseFlags = [
      `-Xms${ram}G`,
      `-Xmx${ram}G`,
      '-XX:+UseG1GC',
      '-XX:+ParallelRefProcEnabled',
      '-XX:MaxGCPauseMillis=200',
      '-XX:+UnlockExperimentalVMOptions',
      '-XX:+DisableExplicitGC',
      '-XX:G1NewSizePercent=30',
      '-XX:G1MaxNewSizePercent=40',
      '-XX:G1HeapRegionSize=8M',
      '-XX:G1ReservePercent=20',
      '-XX:G1HeapWastePercent=5',
      '-XX:InitiatingHeapOccupancyPercent=15',
      '-XX:SurvivorRatio=32',
      '-XX:+PerfDisableSharedMem',
      '-XX:MaxTenuringThreshold=1',
      ...(extraFlags ? extraFlags.split(/\s+/).filter(Boolean).slice(0, 40) : []),
    ];

    let command = javaPath;
    let args = [...baseFlags, '-jar', launch.jarPath, '--nogui'];
    const env = { ...process.env, JAVA_TOOL_OPTIONS: '', MINEBOLSO_JAVA: javaPath, MINEBOLSO_XMS: `${ram}G`, MINEBOLSO_XMX: `${ram}G` };

    if (launch.type === 'script') {
      if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(launch.scriptPath)) {
        command = 'cmd.exe';
        args = ['/c', launch.scriptPath];
      } else {
        try { fs.chmodSync(launch.scriptPath, 0o755); } catch {}
        command = 'sh';
        args = [launch.scriptPath];
      }
      this.emit('log', { line: `[MineBolso] Usando script de inicialização: ${path.basename(launch.scriptPath)}`, level: 'INFO' });
    }

    this.proc = spawn(command, args, {
      cwd: this.meta.dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.pid = this.proc.pid;
    this.ready = false;

    this.proc.stdout.setEncoding('utf8');
    this.proc.stderr.setEncoding('utf8');

    this.proc.stdout.on('data', d => this._handleData(d));
    this.proc.stderr.on('data', d => this._handleData(d));

    this.proc.on('exit', (code, signal) => {
      if (this._forceKillTimer) clearTimeout(this._forceKillTimer);
      this._flushLogBuffer();
      this.proc  = null;
      this.pid   = null;
      this.ready = false;
      this.emit('exit', { code, signal });
    });

    this.proc.on('error', err => {
      this.emit('log', { line: `[MineBolso] Erro ao iniciar Java: ${err.message}`, level: 'ERROR' });
      this.emit('error', err);
    });
  }

  // ── Envia comando ao stdin do servidor ─────────────────────────
  sendCommand(cmd) {
    if (!this.proc?.stdin?.writable) return false;
    this.proc.stdin.write(String(cmd).trim().replace(/[\r\n]/g, ' ') + '\n');
    return true;
  }

  // ── Para o servidor gracefully (tenta /stop, força em 10s) ─────
  stop(forceAfterMs = 10_000) {
    if (!this.proc) return;

    if (!this.sendCommand('stop')) this.proc.kill('SIGTERM');

    this._forceKillTimer = setTimeout(() => {
      if (this.proc) {
        this.emit('log', { line: '[MineBolso] Forçando encerramento (timeout).', level: 'WARN' });
        this.proc.kill('SIGKILL');
      }
    }, forceAfterMs);

    if (this._forceKillTimer.unref) this._forceKillTimer.unref();
    this.once('exit', () => clearTimeout(this._forceKillTimer));
  }

  // ── Verifica se o processo está vivo ───────────────────────────
  isRunning() {
    return this.proc !== null && this.pid !== null;
  }

  // ── Procesamento de output ─────────────────────────────────────
  _handleData(data) {
    // Junta com buffer e processa linha a linha
    this._logBuf += data;
    const lines = this._logBuf.split('\n');
    this._logBuf = lines.pop();  // último fragmento sem \n fica no buffer

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line) continue;

      const level = this._parseLevel(line);
      this.emit('log', { line, level });

      // Detecta servidor pronto
      if (!this.ready && DONE_RE.test(line)) {
        this.ready = true;
        this.emit('ready');
      }

      // Extrai TPS
      const tpsMatch = TPS_RE.exec(line);
      if (tpsMatch) {
        this.emit('tps', {
          tps1m:  parseFloat(tpsMatch[1]),
          tps5m:  parseFloat(tpsMatch[2]),
          tps15m: parseFloat(tpsMatch[3]),
        });
      }

      // Jogador entrou
      const joinMatch = JOIN_RE.exec(line);
      if (joinMatch) this.emit('join', { player: joinMatch[1] });

      // Jogador saiu
      const leaveMatch = LEAVE_RE.exec(line);
      if (leaveMatch) this.emit('leave', { player: leaveMatch[1] });
    }
  }

  _flushLogBuffer() {
    const line = this._logBuf.trim();
    this._logBuf = '';
    if (line) this.emit('log', { line, level: this._parseLevel(line) });
  }

  _parseLevel(line) {
    const m = LOG_LEVEL_RE.exec(line);
    return m ? m[2] : 'RAW';
  }

  // ── Garante eula.txt=true ─────────────────────────────────────
  _ensureEula() {
    const eulaPath = path.join(this.meta.dir, 'eula.txt');
    if (!fs.existsSync(eulaPath)) {
      fs.writeFileSync(eulaPath,
        `# MineBolso — EULA aceita automaticamente\n` +
        `# Ao usar o MineBolso você concorda com os termos em https://aka.ms/MinecraftEULA\n` +
        `eula=true\n`
      );
    } else {
      // Garante que eula=true mesmo se já existir
      let content = fs.readFileSync(eulaPath, 'utf8');
      if (!content.includes('eula=true')) {
        content = content.replace(/eula=false/gi, 'eula=true');
        if (!content.includes('eula=true')) content += '\neula=true\n';
        fs.writeFileSync(eulaPath, content);
      }
    }
  }
}

module.exports = ServerProcess;
