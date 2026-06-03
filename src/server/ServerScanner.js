'use strict';

const fs   = require('fs');
const path = require('path');
const { readConfig } = require('../config');

/**
 * Escaneia ~/minebolso/.minecraft/versions/ e retorna metadados
 * de cada pasta que contém um server.jar válido.
 *
 * Estrutura retornada por servidor:
 * {
 *   id:           "1.20.4",            // nome da pasta
 *   dir:          "/abs/path/1.20.4",
 *   jarPath:      "/abs/path/1.20.4/server.jar",
 *   hasMods:      false,
 *   hasPlugins:   false,
 *   modCount:     0,
 *   pluginCount:  0,
 *   type:         "vanilla"|"modded"|"plugins"|"unknown",
 *   hasEula:      true,
 *   hasProperties: true,
 *   worldSize:    12345678,   // bytes, 0 se não existir
 * }
 */
function scanVersions() {
  const cfg        = readConfig();
  const versionsDir = cfg.versionsDir;

  if (!fs.existsSync(versionsDir)) return [];

  let entries;
  try {
    entries = fs.readdirSync(versionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dir     = path.join(versionsDir, entry.name);
    const jarPath = path.join(dir, 'server.jar');

    // Só considera válido se tiver server.jar
    if (!fs.existsSync(jarPath)) continue;

    const modsDir    = path.join(dir, 'mods');
    const pluginsDir = path.join(dir, 'plugins');
    const hasMods    = fs.existsSync(modsDir);
    const hasPlugins = fs.existsSync(pluginsDir);

    const modCount    = hasMods    ? countFiles(modsDir,    '.jar') : 0;
    const pluginCount = hasPlugins ? countFiles(pluginsDir, '.jar') : 0;

    let type = 'vanilla';
    if (hasMods && modCount > 0)       type = 'modded';
    else if (hasPlugins && pluginCount > 0) type = 'plugins';
    else if (hasMods || hasPlugins)    type = 'unknown';

    const worldDir  = path.join(dir, 'world');
    const worldSize = hasPlugins || hasMods || fs.existsSync(worldDir)
      ? getDirSize(worldDir)
      : 0;

    results.push({
      id:            entry.name,
      dir,
      jarPath,
      hasMods,
      hasPlugins,
      modCount,
      pluginCount,
      type,
      hasEula:       fs.existsSync(path.join(dir, 'eula.txt')),
      hasProperties: fs.existsSync(path.join(dir, 'server.properties')),
      worldSize,
    });
  }

  // Ordena por nome da pasta (version string)
  results.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
  return results;
}

/**
 * Conta arquivos com extensão específica em um diretório (não-recursivo).
 */
function countFiles(dir, ext) {
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith(ext)).length;
  } catch {
    return 0;
  }
}

/**
 * Tamanho aproximado de um diretório (não-recursivo, apenas 1 nível).
 * Suficiente pra estimar tamanho do world sem overhead.
 */
function getDirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir).reduce((acc, f) => {
      try {
        return acc + fs.statSync(path.join(dir, f)).size;
      } catch {
        return acc;
      }
    }, 0);
  } catch {
    return 0;
  }
}

/**
 * Retorna metadados de uma versão específica (por id).
 */
function getVersion(id) {
  return scanVersions().find(v => v.id === id) || null;
}

module.exports = { scanVersions, getVersion };
