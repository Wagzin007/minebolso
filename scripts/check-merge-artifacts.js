'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MARKERS = ['<'.repeat(7), '='.repeat(7), '>'.repeat(7)];
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const SKIP_FILES = new Set(['package-lock.json']);
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

const findings = [];
walk(ROOT);

if (findings.length) {
  console.error('Merge conflict artifacts found. Resolve them before committing:\n');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: ${finding.marker}`);
  }
  process.exit(1);
}

console.log('No merge conflict artifacts found.');

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      continue;
    }

    if (!entry.isFile() || SKIP_FILES.has(entry.name)) continue;
    inspectFile(path.join(dir, entry.name));
  }
}

function inspectFile(filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return; }
  if (stat.size > MAX_TEXT_BYTES) return;

  let buffer;
  try { buffer = fs.readFileSync(filePath); } catch { return; }
  if (buffer.includes(0)) return;

  const rel = path.relative(ROOT, filePath) || path.basename(filePath);
  const lines = buffer.toString('utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trimStart();
    const marker = MARKERS.find(value => trimmed.startsWith(value));
    if (marker) findings.push({ file: rel, line: index + 1, marker });
  });
}
