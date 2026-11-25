#!/usr/bin/env node
// Prints file sizes for all .csv and .db files in the project (excluding
// node_modules). Usage: node scripts/file-sizes.ts [--dir csv]

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null;

const SKIP = new Set(['node_modules', '.git', 'dist']);
const EXTS = new Set(['.csv', '.db']);

interface Row {
  path: string;
  size: number;
}

function walk(dir: string, out: Row[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(p, out);
    } else if (EXTS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      out.push({ path: p, size: statSync(p).size });
    }
  }
}

const rows: Row[] = [];
walk(dirArg ? resolve(root, dirArg) : root, rows);
rows.sort((a, b) => b.size - a.size);

const fmt = (n: number) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} KB`;
  return `${n} B`;
};

const nameWidth = Math.min(60, Math.max(...rows.map((r) => r.path.length), 10));
let total = 0;
for (const r of rows) {
  const rel = r.path.startsWith(root) ? r.path.slice(root.length + 1) : r.path;
  total += r.size;
  console.log(`${rel.padEnd(nameWidth)} ${fmt(r.size).padStart(10)}`);
}
console.log(`${''.padEnd(nameWidth)} ${'-'.repeat(10)}`);
console.log(`${'TOTAL'.padEnd(nameWidth)} ${fmt(total).padStart(10)}  (${rows.length} files)`);
