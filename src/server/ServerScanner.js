'use strict';

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const { readConfig, ensureDirs } = require('../config');
const { log, userError } = require('../utils/diagnostics');

const LOADER_MARKERS = [
  ['neoforge', /neoforge/i],
  ['forge', /(^|[-_. ])forge([-_. ]|$)/i],
  ['fabric', /fabric/i],
  ['quilt', /quilt/i],
  ['paper', /paper/i],
  ['spigot', /spigot/i],
  ['bukkit', /bukkit/i],
  ['vanilla', /vanilla|server/i],
];
const SERVER_JAR_RE = /(server|forge|neoforge|fabric-server|quilt-server|paper|spigot|bukkit).*\.jar$/i;
const CLIENT_ONLY_RE = /^(client|minecraft|\d+\.\d+(?:\.\d+)?)\.jar$/i;

let cache = { at: 0, fingerprint: '', versions: [], duplicates: [] };
let watcher = null;

function scanVersions({ force = false } = {}) {
  ensureDirs();
  const cfg = readConfig();
  const fingerprint = getFingerprint(cfg.versionsDir);
  const ttl = cfg.scanner?.cacheTtlMs ?? 2_000;
  if (!force && Date.now() - cache.at < ttl && cache.fingerprint === fingerprint) {
    return cache.versions;
  }

  const versions = [];
  const seenIds = new Map();
  for (const entry of safeReadDir(cfg.versionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(cfg.versionsDir, entry.name);
    const meta = inspectVersionDir(dir, entry.name, cfg);
    if (seenIds.has(meta.normalizedId)) {
      meta.integrity.status = 'warning';
      meta.integrity.issues.push('Existe outra versão com nome muito parecido. Renomeie uma das pastas para evitar confusão.');
      meta.duplicateOf = seenIds.get(meta.normalizedId);
    } else {
      seenIds.set(meta.normalizedId, meta.id);
    }
    versions.push(meta);
  }

  versions.sort((a, b) => Number(b.available) - Number(a.available) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  cache = { at: Date.now(), fingerprint, versions, duplicates: versions.filter(v => v.duplicateOf) };
  return versions;
}

function inspectVersionDir(dir, folderName, cfg = readConfig()) {
  const jsonFiles = findFiles(dir, file => file.endsWith('.json'), 2, 16);
  const jars = findFiles(dir, file => file.endsWith('.jar'), 3, 80);
  const runnableJar = chooseRunnableJar(jars, dir);
  const scripts = findFiles(dir, file => /^(run|start|server)\.(sh|bat|cmd)$/i.test(path.basename(file)), 2, 8);
  const modsDir = path.join(dir, 'mods');
  const pluginsDir = path.join(dir, 'plugins');
  const modCount = countFiles(modsDir, '.jar');
  const pluginCount = countFiles(pluginsDir, '.jar');
  const versionJson = parseBestVersionJson(jsonFiles);
  const loader = detectLoader({ folderName, dir, jars, jsonFiles, versionJson, modCount, pluginCount });
  const minecraftVersion = detectMinecraftVersion(folderName, versionJson);
  const integrity = validateVersion({ dir, jsonFiles, jars, runnableJar, scripts, versionJson, cfg });
  const launch = buildLaunchPlan({ dir, runnableJar, scripts });

  return {
    id: folderName,
    normalizedId: normalizeId(folderName),
    name: folderName,
    dir,
    jarPath: launch.jarPath,
    launch,
    loader,
    minecraftVersion,
    available: integrity.status !== 'broken' && Boolean(launch.type),
    integrity,
    hasMods: fs.existsSync(modsDir),
    hasPlugins: fs.existsSync(pluginsDir),
    modCount,
    pluginCount,
    type: loader,
    hasEula: fs.existsSync(path.join(dir, 'eula.txt')),
    hasProperties: fs.existsSync(path.join(dir, 'server.properties')),
    worldSize: getDirSize(path.join(dir, 'world'), 2),
    source: detectSource(dir),
    discoveredAt: new Date().toISOString(),
  };
}

function validateVersion({ dir, jsonFiles, jars, runnableJar, scripts, versionJson, cfg }) {
  const issues = [];
  const hints = [];
  if (!jsonFiles.length) hints.push('Nenhum JSON de versão foi encontrado. Tudo bem para alguns servidores, mas modpacks exportados costumam incluir JSON.');
  if (jsonFiles.length && !versionJson) issues.push('O JSON da versão parece inválido. Copie a pasta novamente para .minecraft/versions.');
  if (!runnableJar && !scripts.length) issues.push('Não encontrei um server.jar, jar de loader ou script run/start para iniciar esta versão.');
  if (jars.length && !runnableJar && !scripts.length) hints.push('Encontrei jars, mas eles parecem arquivos de cliente ou bibliotecas. Procure exportar/instalar o servidor do modpack.');
  if (versionJson && Array.isArray(versionJson.libraries)) {
    const missing = countMissingLibraries(versionJson.libraries, cfg.librariesDir);
    if (missing > 0) hints.push(`${missing} biblioteca(s) referenciada(s) não estão em .minecraft/libraries; o loader ainda pode baixá-las ao iniciar.`);
  }
  if (!fs.existsSync(dir)) issues.push('A pasta não existe mais. Clique em Reescanear.');

  const status = issues.length ? 'broken' : hints.length ? 'warning' : 'ok';
  return {
    status,
    label: status === 'ok' ? 'Pronta' : status === 'warning' ? 'Atenção' : 'Incompleta',
    issues,
    hints,
    message: status === 'ok'
      ? 'Versão pronta para iniciar.'
      : status === 'warning'
        ? 'A versão parece utilizável, mas há pontos para revisar.'
        : 'A versão selecionada parece incompleta. Copie novamente a pasta para .minecraft/versions.',
  };
}

function buildLaunchPlan({ dir, runnableJar, scripts }) {
  if (scripts.length) {
    const script = scripts.find(s => s.endsWith('.sh')) || scripts[0];
    return { type: 'script', scriptPath: script, jarPath: runnableJar || null };
  }
  if (runnableJar) return { type: 'jar', jarPath: runnableJar, scriptPath: null };
  return { type: null, jarPath: null, scriptPath: null };
}

function chooseRunnableJar(jars, dir) {
  const byName = jars.find(jar => path.basename(jar).toLowerCase() === 'server.jar');
  if (byName) return byName;
  const likely = jars.find(jar => SERVER_JAR_RE.test(path.basename(jar)) && !CLIENT_ONLY_RE.test(path.basename(jar)));
  if (likely) return likely;
  const rootJars = jars.filter(jar => path.dirname(jar) === dir);
  if (rootJars.length === 1 && !CLIENT_ONLY_RE.test(path.basename(rootJars[0]))) return rootJars[0];
  return null;
}

function detectLoader({ folderName, dir, jars, jsonFiles, versionJson, modCount, pluginCount }) {
  const haystack = [folderName, ...jars.map(file => path.basename(file)), ...jsonFiles.map(file => path.basename(file)), JSON.stringify(versionJson?.libraries || [])].join(' ');
  for (const [loader, re] of LOADER_MARKERS) if (re.test(haystack)) return loader;
  if (fs.existsSync(path.join(dir, 'fabric.mod.json')) || fs.existsSync(path.join(dir, 'fabric-server-launch.jar'))) return 'fabric';
  if (fs.existsSync(path.join(dir, 'quilt.mod.json'))) return 'quilt';
  if (pluginCount > 0) return 'plugins';
  if (modCount > 0) return 'modded';
  return 'custom';
}

function detectMinecraftVersion(folderName, versionJson) {
  const jsonId = versionJson?.inheritsFrom || versionJson?.id || versionJson?.minecraftVersion;
  const fromJson = String(jsonId || '').match(/\d+\.\d+(?:\.\d+)?/);
  if (fromJson) return fromJson[0];
  const fromName = String(folderName || '').match(/\d+\.\d+(?:\.\d+)?/);
  return fromName ? fromName[0] : 'desconhecida';
}

function parseBestVersionJson(jsonFiles) {
  for (const file of jsonFiles) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {}
  }
  return null;
}

function countMissingLibraries(libraries = [], librariesDir) {
  let missing = 0;
  for (const lib of libraries.slice(0, 250)) {
    const name = lib?.name;
    if (!name || typeof name !== 'string') continue;
    const rel = mavenPath(name);
    if (rel && !fs.existsSync(path.join(librariesDir, rel))) missing++;
  }
  return missing;
}

function mavenPath(name) {
  const parts = name.split(':');
  if (parts.length < 3) return null;
  const [group, artifact, version] = parts;
  return path.join(...group.split('.'), artifact, version, `${artifact}-${version}.jar`);
}

function importInstallation(sourcePath, options = {}) {
  ensureDirs();
  const cfg = readConfig();
  const source = path.resolve(String(sourcePath || ''));
  if (!source || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw userError('Pasta de instalação não encontrada.', {
      statusCode: 404,
      code: 'IMPORT_SOURCE_NOT_FOUND',
      suggestion: 'Selecione a pasta .minecraft, Prism, MultiMC, CurseForge ou Modrinth que contém versions/ ou instances/.',
    });
  }
  const candidates = findImportCandidates(source);
  if (!candidates.length) {
    throw userError('Não encontrei versões para importar nessa pasta.', {
      code: 'IMPORT_EMPTY',
      suggestion: 'Escolha uma instalação que contenha versions/ ou instances/ com modpacks exportados.',
    });
  }

  copySharedMinecraftDirs(source, cfg);

  const imported = [];
  const skipped = [];
  for (const candidate of candidates.slice(0, options.limit || 40)) {
    const safeName = uniqueName(cfg.versionsDir, sanitizeFolderName(candidate.name));
    const dest = path.join(cfg.versionsDir, safeName);
    try {
      fs.cpSync(candidate.dir, dest, { recursive: true, errorOnExist: false, dereference: false, filter: importFilter });
      imported.push({ name: safeName, from: candidate.dir });
    } catch (error) {
      skipped.push({ name: candidate.name, reason: error.message });
      log('warn', 'Falha ao importar versão', { candidate: candidate.dir, error });
    }
  }
  scanVersions({ force: true });
  return { imported, skipped, detected: candidates.length };
}

function copySharedMinecraftDirs(source, cfg) {
  const shared = [
    ['libraries', cfg.librariesDir],
    ['assets', cfg.assetsDir],
    ['runtime', cfg.runtimeDir],
  ];
  for (const [name, dest] of shared) {
    const src = path.join(source, name);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
    try {
      fs.cpSync(src, dest, { recursive: true, errorOnExist: false, dereference: false, filter: importFilter });
    } catch (error) {
      log('warn', `Falha ao importar pasta compartilhada ${name}`, { source: src, error });
    }
  }
}

function findImportCandidates(source) {
  const roots = [path.join(source, 'versions'), path.join(source, 'instances'), path.join(source, 'minecraft', 'instances'), source];
  const candidates = [];
  const seen = new Set();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of safeReadDir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = path.join(root, entry.name);
      if (seen.has(dir)) continue;
      const hasInteresting = findFiles(dir, file => /\.(jar|json)$/i.test(file) || /^(run|start|server)\.(sh|bat|cmd)$/i.test(path.basename(file)), 3, 3).length > 0;
      if (hasInteresting) {
        seen.add(dir);
        candidates.push({ name: entry.name, dir });
      }
    }
  }
  return candidates;
}

function startWatcher(onChange) {
  const cfg = readConfig();
  if (watcher || cfg.scanner?.watch === false) return watcher;
  watcher = chokidar.watch(cfg.versionsDir, { ignoreInitial: true, depth: 4, awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 120 } });
  const refresh = () => {
    cache.at = 0;
    try { scanVersions({ force: true }); } catch (error) { log('warn', 'Falha ao reescanear versões', { error }); }
    if (typeof onChange === 'function') onChange(cache.versions);
  };
  watcher.on('addDir', refresh).on('unlinkDir', refresh).on('add', refresh).on('unlink', refresh).on('change', refresh).on('error', error => log('warn', 'Watcher de versões falhou', { error }));
  return watcher;
}

function stopWatcher() {
  if (!watcher) return;
  watcher.close().catch(() => {});
  watcher = null;
}

function getVersion(id) {
  return scanVersions().find(v => v.id === id) || null;
}

function getLibraryStatus() {
  const cfg = readConfig();
  const versions = scanVersions();
  return {
    baseDir: cfg.baseDir,
    versionsDir: cfg.versionsDir,
    librariesDir: cfg.librariesDir,
    total: versions.length,
    ready: versions.filter(v => v.integrity.status === 'ok').length,
    warnings: versions.filter(v => v.integrity.status === 'warning').length,
    broken: versions.filter(v => v.integrity.status === 'broken').length,
    duplicates: versions.filter(v => v.duplicateOf).length,
    cacheAgeMs: Date.now() - cache.at,
  };
}

function findFiles(root, predicate, maxDepth = 2, limit = 50, depth = 0, acc = []) {
  if (acc.length >= limit || depth > maxDepth || !fs.existsSync(root)) return acc;
  for (const entry of safeReadDir(root, { withFileTypes: true })) {
    if (acc.length >= limit) break;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!['libraries', 'assets', 'runtime', '.git', 'logs', 'saves'].includes(entry.name)) findFiles(full, predicate, maxDepth, limit, depth + 1, acc);
    } else if (predicate(full)) {
      acc.push(full);
    }
  }
  return acc;
}

function safeReadDir(dir, options) {
  try { return fs.readdirSync(dir, options); } catch { return []; }
}

function countFiles(dir, ext) {
  return safeReadDir(dir).filter(file => file.toLowerCase().endsWith(ext)).length;
}

function getDirSize(dir, maxDepth = 1, depth = 0) {
  if (!fs.existsSync(dir) || depth > maxDepth) return 0;
  return safeReadDir(dir, { withFileTypes: true }).reduce((total, entry) => {
    try {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return total + getDirSize(full, maxDepth, depth + 1);
      return total + fs.statSync(full).size;
    } catch { return total; }
  }, 0);
}

function getFingerprint(dir) {
  const entries = safeReadDir(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => {
      try {
        const stat = fs.statSync(path.join(dir, entry.name));
        return `${entry.name}:${stat.mtimeMs}:${stat.size}`;
      } catch { return entry.name; }
    });
  return entries.join('|');
}

function normalizeId(id) {
  return String(id || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sanitizeFolderName(name) {
  return String(name || 'Versao importada').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Versao importada';
}

function uniqueName(parent, base) {
  let name = base;
  let i = 2;
  while (fs.existsSync(path.join(parent, name))) name = `${base} (${i++})`;
  return name;
}

function importFilter(src) {
  const base = path.basename(src).toLowerCase();
  if (['.git', 'logs', 'crash-reports', 'screenshots', 'backups'].includes(base)) return false;
  try {
    const stat = fs.statSync(src);
    return stat.isDirectory() || stat.size <= 250 * 1024 * 1024;
  } catch { return false; }
}

function detectSource(dir) {
  if (fs.existsSync(path.join(dir, 'instance.cfg'))) return 'MultiMC/Prism';
  if (fs.existsSync(path.join(dir, 'minecraftinstance.json'))) return 'CurseForge';
  if (fs.existsSync(path.join(dir, 'modrinth.index.json'))) return 'Modrinth';
  return 'Pasta local';
}

module.exports = {
  scanVersions,
  getVersion,
  inspectVersionDir,
  importInstallation,
  startWatcher,
  stopWatcher,
  getLibraryStatus,
};
