#!/usr/bin/env node
// Generates the schema artifacts from the emitted Prisma 8 contract:
//   src/prisma/contract.json -> schema/schema.dbml -> schema/schema.svg -> schema/schema.png
// Usage: node scripts/contract-to-dbml.ts [output-dir]
// Run `pnpm prisma contract emit` first if contract.json is stale.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ParseDbmlToSvg } from 'dbml-to-svg';
import { Resvg } from '@resvg/resvg-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, process.argv[2] ?? 'schema');
mkdirSync(outDir, { recursive: true });

interface ContractTable {
  columns?: Record<
    string,
    {
      codecId?: string;
      dataType?: string;
      nullable?: boolean;
      default?: { kind: 'literal'; value: unknown } | { kind: 'function'; expression: string };
      valueSet?: { entityName?: string };
    }
  >;
  primaryKey?: { columns?: string[] };
  uniques?: { columns: string[] }[];
  indexes?: { columns: string[]; name: string; unique?: boolean }[];
  foreignKeys?: {
    source: { columns: string[]; tableName: string };
    target: { columns: string[]; tableName: string };
  }[];
}

const contract = JSON.parse(readFileSync(resolve(root, 'src/prisma/contract.json'), 'utf8')) as {
  domain?: {
    namespaces?: Record<string, { enum?: Record<string, { members?: { name: string }[] }> }>;
  };
  storage?: {
    namespaces?: Record<string, { entries?: { table?: Record<string, ContractTable> } }>;
  };
};

const TYPE_MAP: Record<string, string> = {
  'sqlite/integer@1': 'int',
  'sqlite/real@1': 'float',
  'sqlite/text@1': 'text',
  'sqlite/boolean@1': 'boolean',
  'sqlite/datetime@1': 'datetime',
};

const q = (s: string) => `"${s.replaceAll('"', '\\"')}"`;

// ---------- contract.json -> DBML ----------
const lines: string[] = [
  '// Generated from src/prisma/contract.json — do not edit by hand.',
  '// Regenerate: pnpm prisma contract emit && node scripts/contract-to-dbml.ts',
  '',
];

for (const ns of Object.values(contract.domain?.namespaces ?? {})) {
  for (const [name, en] of Object.entries(ns.enum ?? {})) {
    lines.push(`enum ${name} {`);
    for (const m of en.members ?? []) lines.push(`  ${m.name}`);
    lines.push('}', '');
  }
}

const tables: { name: string; table: ContractTable }[] = [];
for (const ns of Object.values(contract.storage?.namespaces ?? {})) {
  for (const [tableName, t] of Object.entries(ns.entries?.table ?? {})) {
    tables.push({ name: tableName, table: t });
  }
}
tables.sort((a, b) => a.name.localeCompare(b.name));

for (const { name, table } of tables) {
  lines.push(`Table ${name} {`);

  const pkCols = new Set(table.primaryKey?.columns ?? []);
  const uniqueSets = (table.uniques ?? []).map((u) => u.columns);
  const singleUniques = new Set(uniqueSets.filter((c) => c.length === 1).map((c) => c[0]));

  for (const [colName, col] of Object.entries(table.columns ?? {})) {
    const type = col.valueSet?.entityName ?? TYPE_MAP[col.codecId ?? ''] ?? col.dataType ?? 'text';
    const settings: string[] = [];
    if (pkCols.has(colName)) settings.push('pk');
    else if (singleUniques.has(colName)) settings.push('unique');
    if (!col.nullable) settings.push('not null');
    if (col.default) {
      const d = col.default;
      if (d.kind === 'literal') {
        settings.push(`default: ${typeof d.value === 'string' ? `'${d.value}'` : String(d.value)}`);
      } else if (d.kind === 'function') {
        settings.push(`default: \`${d.expression}\``);
      }
    }
    const suffix = settings.length ? ` [${settings.join(', ')}]` : '';
    lines.push(`  ${colName} ${type}${suffix}`);
  }

  const compositeUniques = uniqueSets.filter((c) => c.length > 1);
  const allIdx = [
    ...compositeUniques.map((cols) => ({
      columns: cols,
      name: `${name}_${cols.join('_')}_key`,
      unique: true,
    })),
    ...(table.indexes ?? []),
  ];
  if (allIdx.length) {
    lines.push('');
    lines.push('  indexes {');
    for (const idx of allIdx) {
      const cols = idx.columns.map(q).join(', ');
      const attrs = [`name: '${idx.name}'`];
      if (idx.unique) attrs.push('unique');
      lines.push(`    (${cols}) [${attrs.join(', ')}]`);
    }
    lines.push('  }');
  }

  lines.push('}', '');
}

for (const { name, table } of tables) {
  for (const fk of table.foreignKeys ?? []) {
    const src = fk.source.columns.map((c) => `${q(name)}.${q(c)}`).join(', ');
    const dst = fk.target.columns.map((c) => `${q(fk.target.tableName)}.${q(c)}`).join(', ');
    lines.push(`ref: ${src} > ${dst}`);
  }
}
lines.push('');

const dbml = lines.join('\n');
const dbmlPath = resolve(outDir, 'schema.dbml');
writeFileSync(dbmlPath, dbml);
console.log(`wrote ${dbmlPath}`);

// ---------- DBML -> SVG ----------
const svg = await ParseDbmlToSvg(dbml);
const svgPath = resolve(outDir, 'schema.svg');
writeFileSync(svgPath, svg);
console.log(`wrote ${svgPath}`);

// ---------- SVG -> PNG ----------
const resvg = new Resvg(svg, {
  fitTo: { mode: 'original' },
  font: { loadSystemFonts: true },
});
const png = resvg.render().asPng();
const pngPath = resolve(outDir, 'schema.png');
writeFileSync(pngPath, png);
console.log(`wrote ${pngPath} (${(png.length / 1024 / 1024).toFixed(1)} MB)`);
