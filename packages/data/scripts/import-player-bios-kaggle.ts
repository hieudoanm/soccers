#!/usr/bin/env node
// Fills player bio fields (date_of_birth, height_cm, weight_kg, preferred_foot)
// from the Kaggle "European Soccer Database" (hugomathien/soccer), mirrored on
// Hugging Face. Covers ~11k players in 11 European leagues, seasons 2008–2016.
//
// Source quirks: Player.height is already cm (float), Player.weight is lbs,
// preferred_foot lives in Player_Attributes (latest row per player).
//
// Usage:
//   node scripts/import-player-bios-kaggle.ts [--dry-run] [--file path]

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const fileArg = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : resolve('scripts/.cache/soccer-kaggle.sqlite');

const dbPath = resolve(process.env['DATABASE_URL'] ?? './dev.db');
const db = new DatabaseSync(dbPath);

if (!existsSync(fileArg)) {
  console.error(`kaggle database not found: ${fileArg}`);
  console.error(
    'download: https://huggingface.co/datasets/julien-c/kaggle-hugomathien-soccer/resolve/main/database.sqlite',
  );
  process.exit(1);
}
const kaggle = new DatabaseSync(fileArg, { readOnly: true });

// ---------- helpers ----------

function normalizeName(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

interface Candidate {
  name: string;
  tokens: Set<string>;
  dob?: string;
  height?: number;
  weight?: number;
  foot?: string;
  fields: number;
}

function fieldCount(c: Omit<Candidate, 'fields'>): number {
  return (
    (c.dob ? 1 : 0) + (c.height != null ? 1 : 0) + (c.weight != null ? 1 : 0) + (c.foot ? 1 : 0)
  );
}

function scoreMatch(playerTokens: Set<string>, c: Candidate): number {
  // A single-token candidate ("Ronaldo", "Guerrero") is too ambiguous to match
  // a full name — too many distinct players share mononyms.
  if (c.tokens.size === 1 && playerTokens.size > 1) return -1;
  let inter = 0;
  for (const t of c.tokens) if (playerTokens.has(t)) inter++;
  if (inter === 0) return -1;
  const contained = inter === c.tokens.size || inter === playerTokens.size;
  return contained ? inter * 100 + Math.min(c.tokens.size, playerTokens.size) : -1;
}

// ---------- load source data ----------

interface KaggleRow {
  player_name: string;
  birthday: string | null;
  height: number | null;
  weight: number | null;
  preferred_foot: string | null;
}

// Player_Attributes has no index on player_api_id, so a correlated subquery
// would full-scan 183k rows per player. Use a window function instead.
const footRows = kaggle
  .prepare(
    `SELECT player_api_id, preferred_foot FROM (
       SELECT player_api_id, preferred_foot,
              ROW_NUMBER() OVER (PARTITION BY player_api_id ORDER BY date DESC) AS rn
       FROM Player_Attributes
     ) WHERE rn = 1`,
  )
  .all() as unknown as { player_api_id: number; preferred_foot: string | null }[];
const footByApiId = new Map(footRows.map((r) => [r.player_api_id, r.preferred_foot]));

const rows = (
  kaggle
    .prepare('SELECT player_api_id, player_name, birthday, height, weight FROM Player')
    .all() as unknown as (KaggleRow & { player_api_id: number })[]
).map((r) => ({ ...r, preferred_foot: footByApiId.get(r.player_api_id) ?? null }));

const candidates: Candidate[] = [];
for (const r of rows) {
  const height =
    r.height != null && r.height >= 120 && r.height <= 230 ? Math.round(r.height) : undefined;
  const weight = r.weight != null ? Math.round(r.weight * 0.45359237) : undefined;
  const weightOk = weight != null && weight >= 30 && weight <= 150 ? weight : undefined;
  const foot =
    r.preferred_foot?.trim().toLowerCase() === 'left'
      ? 'LEFT'
      : r.preferred_foot?.trim().toLowerCase() === 'right'
        ? 'RIGHT'
        : undefined;
  const base = {
    name: r.player_name,
    tokens: new Set(normalizeName(r.player_name)),
    dob: r.birthday ? r.birthday.slice(0, 10) : undefined,
    height,
    weight: weightOk,
    foot,
  };
  const fields = fieldCount(base);
  if (fields > 0) candidates.push({ ...base, fields });
}
console.log(`${candidates.length} kaggle candidates with bio data`);

const byFirstToken = new Map<string, Candidate[]>();
for (const c of candidates) {
  for (const t of c.tokens) {
    const list = byFirstToken.get(t) ?? [];
    list.push(c);
    byFirstToken.set(t, list);
  }
}

// ---------- match and update ----------

interface PlayerRow {
  id: number;
  name: string;
  date_of_birth: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  preferred_foot: string | null;
}

const players = db
  .prepare(
    `SELECT id, name, date_of_birth, height_cm, weight_kg, preferred_foot
     FROM player
     WHERE date_of_birth IS NULL OR height_cm IS NULL
        OR weight_kg IS NULL OR preferred_foot IS NULL`,
  )
  .all() as unknown as PlayerRow[];

console.log(`${players.length} players missing bio fields`);

const update = db.prepare(
  `UPDATE player SET date_of_birth = ?, height_cm = ?, weight_kg = ?,
     preferred_foot = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = ?`,
);

let matched = 0;
let ambiguous = 0;
let updated = 0;
if (!dryRun) db.exec('BEGIN');

for (const [i, player] of players.entries()) {
  const tokens = new Set(normalizeName(player.name));
  const pool = new Set<Candidate>();
  for (const t of tokens) {
    for (const c of byFirstToken.get(t) ?? []) pool.add(c);
  }
  let best: Candidate | null = null;
  let bestScore = -1;
  let tie = false;
  for (const c of pool) {
    const score = scoreMatch(tokens, c);
    if (score < 0) continue;
    const total = score * 10 + c.fields;
    if (total > bestScore) {
      bestScore = total;
      best = c;
      tie = false;
    } else if (total === bestScore && best !== c) {
      tie = true;
    }
  }
  if (!best || tie) {
    if (tie) ambiguous++;
    continue;
  }
  matched++;
  const dob = player.date_of_birth == null ? (best.dob ?? null) : player.date_of_birth;
  const height = player.height_cm == null ? (best.height ?? null) : player.height_cm;
  const weight = player.weight_kg == null ? (best.weight ?? null) : player.weight_kg;
  const foot = player.preferred_foot == null ? (best.foot ?? null) : player.preferred_foot;
  if (dob == null && height == null && weight == null && foot == null) continue;
  updated++;
  if (!dryRun) update.run(dob, height, weight, foot, player.id);
  if (i % 500 === 0) console.log(`progress ${i}/${players.length}`);
}

if (!dryRun) db.exec('COMMIT');
console.log(
  `done: ${matched} name matches (${ambiguous} ambiguous skipped), ${updated} players updated${dryRun ? ' (dry-run)' : ''}`,
);
db.close();
kaggle.close();
