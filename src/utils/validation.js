'use strict';

const path = require('path');
const { userError } = require('./diagnostics');

const ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const PLAYER_RE = /^[a-zA-Z0-9_]{1,16}$/;
const TEXT_EXTS = new Set(['.properties', '.json', '.yml', '.yaml', '.txt', '.log', '.toml', '.cfg', '.conf']);

function assertServerId(id) {
  if (!id || !ID_RE.test(String(id))) {
    throw userError('Identificador de servidor inválido.', {
      statusCode: 400,
      code: 'INVALID_SERVER_ID',
      suggestion: 'Use apenas letras, números, ponto, hífen ou underline.',
    });
  }
  return String(id);
}

function sanitizeName(name, fallback) {
  const clean = String(name || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 48);
  return clean || fallback;
}

function normalizeRam(value, fallback = 1) {
  const ram = Number(value || fallback);
  if (!Number.isFinite(ram)) return fallback;
  return Math.min(16, Math.max(0.5, Math.round(ram * 2) / 2));
}

function assertPlayer(player) {
  if (!player || !PLAYER_RE.test(String(player))) {
    throw userError('Nome de jogador inválido.', {
      statusCode: 400,
      code: 'INVALID_PLAYER',
      suggestion: 'Use o nick exato do Minecraft, com até 16 caracteres.',
    });
  }
  return String(player);
}

function sanitizeCommand(cmd) {
  const clean = String(cmd || '').trim().replace(/[\r\n]/g, ' ').slice(0, 256);
  if (!clean) {
    throw userError('Comando vazio.', { statusCode: 400, code: 'EMPTY_COMMAND' });
  }
  return clean.replace(/^\//, '');
}

function safePath(base, rel = '') {
  const root = path.resolve(base);
  const resolved = path.resolve(root, String(rel || ''));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw userError('Caminho fora da pasta segura.', {
      statusCode: 403,
      code: 'PATH_TRAVERSAL_BLOCKED',
      suggestion: 'Escolha um arquivo dentro da pasta de versões do MineBolso.',
    });
  }
  return resolved;
}

function isEditableText(filePath) {
  return TEXT_EXTS.has(path.extname(filePath).toLowerCase());
}

function assertJarUrl(rawUrl) {
  let url;
  try { url = new URL(String(rawUrl || '')); } catch { url = null; }
  if (!url || !['https:', 'http:'].includes(url.protocol)) {
    throw userError('URL do server.jar inválida.', {
      statusCode: 400,
      code: 'INVALID_JAR_URL',
      suggestion: 'Cole um link direto para um arquivo .jar do servidor.',
    });
  }
  return url.toString();
}

module.exports = {
  assertServerId,
  sanitizeName,
  normalizeRam,
  assertPlayer,
  sanitizeCommand,
  safePath,
  isEditableText,
  assertJarUrl,
};
