#!/usr/bin/env node
// Backfills player.current_team_id with the team from each player's most
// recent match_lineup appearance.
//
// Usage:
//   node scripts/backfill-player-teams.ts [--dry-run]

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const dbPath = resolve(process.env['DATABASE_URL'] ?? './dev.db');
const db = new DatabaseSync(dbPath);

const pending = db
  .prepare(
    `SELECT COUNT(*) AS c
     FROM player p
     WHERE p.current_team_id IS NULL
       AND EXISTS (
         SELECT 1 FROM match_lineup ml WHERE ml.player_id = p.id
       )`,
  )
  .get() as { c: number };

const stale = db
  .prepare(
    `SELECT COUNT(*) AS c
     FROM player p
     JOIN match_lineup ml ON ml.player_id = p.id
     JOIN match m ON m.id = ml.match_id
     WHERE p.current_team_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM match_lineup ml2
         JOIN match m2 ON m2.id = ml2.match_id
         WHERE ml2.player_id = p.id
           AND ml2.team_id = p.current_team_id
           AND (m2.date > m.date OR (m2.date = m.date AND ml2.id >= ml.id))
       )`,
  )
  .get() as { c: number };

console.log(
  `${pending.c} players missing current_team, ${stale.c} players whose current_team is not their latest appearance`,
);

// Latest club appearance (league/cup competitions) per player; international
// and friendly appearances don't count as a player's "current team".
const clubTeam = db.prepare(
  `SELECT ml.player_id, ml.team_id
   FROM match_lineup ml
   JOIN match m ON m.id = ml.match_id
   JOIN season s ON s.id = m.season_id
   JOIN league l ON l.id = s.league_id
   WHERE l.type IN ('LEAGUE', 'CUP')
     AND ml.id = (
       SELECT ml2.id FROM match_lineup ml2
       JOIN match m2 ON m2.id = ml2.match_id
       JOIN season s2 ON s2.id = m2.season_id
       JOIN league l2 ON l2.id = s2.league_id
       WHERE ml2.player_id = ml.player_id
         AND l2.type IN ('LEAGUE', 'CUP')
       ORDER BY m2.date DESC, ml2.id DESC
       LIMIT 1
     )`,
);

// Fallback for players with no club appearance: latest appearance overall.
const anyTeam = db.prepare(
  `SELECT ml.player_id, ml.team_id
   FROM match_lineup ml
   JOIN match m ON m.id = ml.match_id
   WHERE ml.id = (
     SELECT ml2.id FROM match_lineup ml2
     JOIN match m2 ON m2.id = ml2.match_id
     WHERE ml2.player_id = ml.player_id
     ORDER BY m2.date DESC, ml2.id DESC
     LIMIT 1
   )`,
);

const clubRows = clubTeam.all() as { player_id: number; team_id: number }[];
const anyRows = anyTeam.all() as { player_id: number; team_id: number }[];
const clubPlayers = new Set(clubRows.map((r) => r.player_id));
const rows = [...clubRows, ...anyRows.filter((r) => !clubPlayers.has(r.player_id))];
console.log(
  `${clubRows.length} players resolved via club competitions, ${rows.length - clubRows.length} via any competition`,
);

if (dryRun) {
  console.log('dry-run: no changes written');
  db.close();
  process.exit(0);
}

const update = db.prepare(
  "UPDATE player SET current_team_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
);

let changed = 0;
db.exec('BEGIN');
for (const row of rows) {
  const res = update.run(row.team_id, row.player_id);
  changed += Number(res.changes);
}
db.exec('COMMIT');

console.log(`updated ${changed} players`);
db.close();
