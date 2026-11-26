#!/usr/bin/env node
// Exports every contract table to CSV files under export/.
// Usage: node scripts/export-csv.ts [output-dir]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { db } from '../src/prisma/db.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, process.argv[2] ?? 'export');
mkdirSync(outDir, { recursive: true });

const contract = JSON.parse(readFileSync(resolve(root, 'src/prisma/contract.json'), 'utf8')) as {
  storage?: {
    namespaces?: Record<
      string,
      { entries?: { table?: Record<string, { columns?: Record<string, unknown> }> } }
    >;
  };
};

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

let totalRows = 0;
for (const ns of Object.values(contract.storage?.namespaces ?? {})) {
  for (const [tableName, table] of Object.entries(ns.entries?.table ?? {})) {
    const columns = Object.keys(table.columns ?? {});
    if (!columns.length) continue;

    const builder = (
      db.sql as unknown as Record<
        string,
        {
          select: (...cols: string[]) => {
            orderBy: (
              fn: (f: Record<string, unknown>) => unknown,
              opts: { direction: string },
            ) => { build: () => never };
          };
        }
      >
    )[tableName];
    const plan = builder
      .select(...columns)
      .orderBy((f) => f.id, { direction: 'asc' })
      .build();
    const rows = (await db.query(plan)) as Record<string, unknown>[];

    const lines = [columns.join(',')];
    for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(','));
    writeFileSync(resolve(outDir, `${tableName}.csv`), lines.join('\n') + '\n');

    totalRows += rows.length;
    console.log(`${tableName}.csv: ${rows.length} rows`);
  }
}

console.log(`Done. ${totalRows} rows exported to ${outDir}`);
await db.close();
