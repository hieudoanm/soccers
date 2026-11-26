#!/usr/bin/env node
// Imports football awards and their winners/podium finishes from Wikipedia
// wikitext tables. Covers Ballon d'Or (men + women), FIFA World Player of the
// Year, The Best FIFA Football Awards (players, goalkeepers, coaches), the
// PFA Players' Player of the Year, and the European Golden Shoe.
//
// Raw wikitext is cached under import/wiki/<slug>.wiki; reruns reuse it.
// Idempotent via award.external_id and award_winner.external_id.
//
// Usage:
//   node scripts/import-awards.ts [--dry-run] [--refresh]

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dryRun = process.argv.includes('--dry-run');
const refresh = process.argv.includes('--refresh');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIKI_DIR = resolve(ROOT, 'import', 'wiki');
mkdirSync(WIKI_DIR, { recursive: true });

const UA = 'soccers-awards-importer/1.0 (football data research; contact: local dev)';
const dbPath = resolve(process.env['DATABASE_URL'] ?? './dev.db');
const db = new DatabaseSync(dbPath);

// ---------- text helpers ----------

function normalizeName(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// First person name out of a wikitext cell: {{sortname|First|Last|...}} wins,
// otherwise the first [[link|display]] (display text preferred).
function extractPerson(cell: string): string | null {
  const sort = cell.match(/\{\{sortname\|([^}|]+)\|([^}|]+)/i);
  if (sort) return `${sort[1].trim()} ${sort[2].trim()}`.trim();
  const link = cell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (!link) return null;
  const raw = (link[2] ?? link[1]).trim();
  // strip disambiguation parens from targets used as display
  return (
    raw
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || null
  );
}

function extractNumber(cell: string | undefined): number | null {
  if (!cell) return null;
  const m = cell.replace(/<[^>]+>/g, ' ').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// "1956", "[[1956 Ballon d'Or|1956]]", "1973–74", "1967–68" -> { year, season }
function extractYearSeason(cell: string): { year: number; season: string | null } | null {
  const m = cell.match(/(\d{4})\s*(?:[–—-]\s*(\d{2,4}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  // "1973–74" / "1967-68" -> "1973/74" to match Season.name convention
  const season = m[2] ? `${year}/${m[2].slice(-2)}` : null;
  return { year, season };
}

function extractPlace(cell: string | undefined): number | null {
  if (!cell) return null;
  const m = cell.replace(/<[^>]+>/g, ' ').match(/(\d+)(?:st|nd|rd|th)/i) ?? cell.match(/\b(\d)\b/);
  return m ? Number(m[1]) : null;
}

// ---------- wikitext table parser ----------

interface WtTable {
  rows: string[][]; // aligned cells per row (rowspan-carried)
}

function splitCells(line: string, marker: '|' | '!'): string[] {
  // strip leading marker run, then split on || / !! separators.
  // MediaWiki splits table cells before template expansion, so || normally
  // always separates — EXCEPT inside {{sortname|...}} whose 4th parameter is
  // written with a literal || (e.g. {{sortname|Gerd|Müller||Muller, Gerd}}).
  // Unclosed templates ({{sort|{{flagicon|...}}||) still split, matching the
  // rendered table.
  const body = line.replace(new RegExp(`^\\${marker}+`), '');
  const sep = marker === '|' ? '||' : '!!';
  const cells: string[] = [];
  const stack: string[] = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith('{{', i)) {
      const name = (body.slice(i + 2).match(/^\s*([^}|\s]+)/) ?? [''])[0].toLowerCase();
      stack.push(name);
      cur += '{{';
      i++;
      continue;
    }
    if (body.startsWith('}}', i)) {
      stack.pop();
      cur += '}}';
      i++;
      continue;
    }
    const insideSortname = stack[stack.length - 1] === 'sortname';
    if (!insideSortname && body.startsWith(sep, i)) {
      cells.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += body[i];
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseWikitextTables(wt: string): WtTable[] {
  const tables: WtTable[] = [];
  const re = /\{\|[^\n]*\n([\s\S]*?)\n\|\}/g;
  let tm: RegExpExecArray | null;
  while ((tm = re.exec(wt))) {
    const body = tm[1];
    const rowsRaw: string[][] = [];
    let cur: string[] = [];
    const flush = () => {
      if (cur.length) rowsRaw.push(cur);
      cur = [];
    };
    for (const line of body.split('\n')) {
      const t = line.trim();
      if (t.startsWith('|-')) {
        flush();
        continue;
      }
      if (t.startsWith('|+') || t.startsWith('|}') || t === '') continue;
      if (t.startsWith('!')) {
        // header-ish row cells; also used as row headers (!1967–68)
        cur.push(...splitCells(t, '!'));
      } else if (t.startsWith('|')) {
        cur.push(...splitCells(t, '|'));
      } else if (cur.length) {
        // continuation line of previous cell — append to last cell
        cur[cur.length - 1] += ' ' + t;
      }
    }
    flush();

    // rowspan carry: map colIdx -> { value, left }
    const carry = new Map<number, { value: string; left: number }>();
    const rows: string[][] = [];
    for (const raw of rowsRaw) {
      // skip separator/header rows: colspan rows and pure !header rows
      const joined = raw.join(' ');
      if (/colspan/i.test(joined)) continue;
      const out: string[] = [];
      let ci = 0;
      let ri = 0;
      while (ri < raw.length) {
        // find next free column
        while (carry.has(ci) && carry.get(ci)!.left > 0) {
          out[ci] = carry.get(ci)!.value;
          const c = carry.get(ci)!;
          c.left--;
          ci++;
        }
        const cell = raw[ri];
        const rs = cell.match(/rowspan\s*=\s*"?(\d+)/i);
        const clean = cell.replace(/rowspan\s*=\s*"?\d+"?/gi, '').trim();
        out[ci] = clean;
        if (rs) {
          const n = Number(rs[1]);
          if (n > 1) carry.set(ci, { value: clean, left: n - 1 });
        }
        ci++;
        ri++;
      }
      // flush remaining carried columns
      for (const [col, c] of carry) {
        if (c.left > 0 && out[col] === undefined) {
          out[col] = c.value;
          c.left--;
        }
      }
      if (out.some((c) => c && c.trim())) rows.push(out);
    }
    if (rows.length) tables.push({ rows });
  }
  return tables;
}

function sectionSlice(wt: string, heading: string): string {
  const idx = wt.indexOf(`===${heading}===`);
  if (idx < 0) throw new Error(`section not found: ${heading}`);
  const rest = wt.slice(idx);
  const next = rest.slice(3).search(/\n==+[^=]/);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

// ---------- entity matching ----------

interface DbEntity {
  id: number;
  name: string;
}

function buildEntityIndex(rows: DbEntity[]): Map<string, DbEntity[]> {
  const idx = new Map<string, DbEntity[]>();
  for (const e of rows) {
    for (const t of new Set(normalizeName(e.name))) {
      const list = idx.get(t) ?? [];
      list.push(e);
      idx.set(t, list);
    }
  }
  return idx;
}

function matchEntity(
  rawName: string,
  index: Map<string, DbEntity[]>,
  all: DbEntity[],
): { id: number | null; ambiguous: boolean } {
  const tokens = normalizeName(rawName);
  if (!tokens.length) return { id: null, ambiguous: false };
  const tset = new Set(tokens);
  const candidates = new Map<number, number>(); // id -> overlap
  for (const [tok, list] of index) {
    if (!tset.has(tok)) continue;
    for (const e of list) candidates.set(e.id, (candidates.get(e.id) ?? 0) + 1);
  }
  // containment: every award-name token must appear in the entity name
  const valid = [...candidates.entries()].filter(([id]) => {
    const e = all.find((x) => x.id === id)!;
    const eset = new Set(normalizeName(e.name));
    return [...tset].every((t) => eset.has(t));
  });
  if (!valid.length) return { id: null, ambiguous: false };
  // prefer fewest extra name tokens (closest match), then lowest id
  valid.sort((a, b) => {
    const ea = all.find((x) => x.id === a[0])!;
    const eb = all.find((x) => x.id === b[0])!;
    const extra =
      normalizeName(ea.name).length - tset.size - (normalizeName(eb.name).length - tset.size);
    return extra !== 0 ? extra : a[0] - b[0];
  });
  const bestExtra = normalizeName(all.find((x) => x.id === valid[0][0])!.name).length - tset.size;
  const tied = valid.filter(
    ([id]) => normalizeName(all.find((x) => x.id === id)!.name).length - tset.size === bestExtra,
  );
  return { id: valid[0][0], ambiguous: tied.length > 1 };
}

// ---------- award specs ----------

interface AwardSpec {
  key: string;
  name: string;
  category: 'PLAYER' | 'TEAM' | 'MANAGER';
  page: string;
  section?: string;
  tableIndex: number; // table within (section ?? page)
  cols: {
    year: number;
    rank?: number;
    person: number;
    team?: number;
    points?: number;
    goals?: number;
  };
}

const AWARDS: AwardSpec[] = [
  {
    key: 'ballon-dor',
    name: "Ballon d'Or",
    category: 'PLAYER',
    page: "Ballon d'Or",
    tableIndex: 1, // 0 = legend table
    cols: { year: 0, rank: 1, person: 2, team: 3, points: 4 },
  },
  {
    key: 'ballon-dor-feminin',
    name: "Ballon d'Or Féminin",
    category: 'PLAYER',
    page: "Ballon d'Or Féminin",
    tableIndex: 0,
    cols: { year: 0, rank: 1, person: 2, team: 3, points: 4 },
  },
  {
    key: 'fifa-world-player',
    name: 'FIFA World Player of the Year',
    category: 'PLAYER',
    page: 'FIFA World Player of the Year',
    tableIndex: 0,
    cols: { year: 0, rank: 1, person: 2, team: 3, points: 4 },
  },
  {
    key: 'best-fifa-mens-player',
    name: "The Best FIFA Men's Player",
    category: 'PLAYER',
    page: 'The Best FIFA Football Awards',
    section: "The Best FIFA Men's Player",
    tableIndex: 0,
    cols: { year: 0, rank: 1, person: 2, team: 3 },
  },
  {
    key: 'best-fifa-womens-player',
    name: "The Best FIFA Women's Player",
    category: 'PLAYER',
    page: 'The Best FIFA Football Awards',
    section: "The Best FIFA Women's Player",
    tableIndex: 0,
    cols: { year: 0, rank: 1, person: 2, team: 3 },
  },
  {
    key: 'best-fifa-mens-goalkeeper',
    name: "The Best FIFA Men's Goalkeeper",
    category: 'PLAYER',
    page: 'The Best FIFA Football Awards',
    section: "The Best FIFA Men's Goalkeeper",
    tableIndex: 0,
    cols: { year: 0, rank: 1, person: 2, team: 3 },
  },
  {
    key: 'best-fifa-womens-goalkeeper',
    name: "The Best FIFA Women's Goalkeeper",
    category: 'PLAYER',
    page: 'The Best FIFA Football Awards',
    section: "The Best FIFA Women's Goalkeeper",
    tableIndex: 0,
    cols: { year: 0, rank: 1, person: 2, team: 3 },
  },
  {
    key: 'best-fifa-mens-coach',
    name: "The Best FIFA Men's Coach",
    category: 'MANAGER',
    page: 'The Best FIFA Football Awards',
    section: "The Best FIFA Men's Coach",
    tableIndex: 0,
    cols: { year: 0, rank: 1, person: 2, team: 3 },
  },
  {
    key: 'best-fifa-womens-coach',
    name: "The Best FIFA Women's Coach",
    category: 'MANAGER',
    page: 'The Best FIFA Football Awards',
    section: "The Best FIFA Women's Coach",
    tableIndex: 0,
    cols: { year: 0, rank: 1, person: 2, team: 3 },
  },
  {
    key: 'pfa-player-of-year',
    name: "PFA Players' Player of the Year",
    category: 'PLAYER',
    page: "PFA Players' Player of the Year",
    tableIndex: 0,
    cols: { year: 0, person: 2, team: 3 },
  },
  {
    key: 'european-golden-shoe',
    name: 'European Golden Shoe',
    category: 'PLAYER',
    page: 'European Golden Shoe',
    tableIndex: 1, // 0 = legend
    cols: { year: 0, person: 1, team: 2, goals: 4, points: 5 },
  },
];

// ---------- load entity indexes ----------

const dbPlayers = db.prepare('SELECT id, name FROM player').all() as unknown as DbEntity[];
const dbTeams = db.prepare('SELECT id, name FROM team').all() as unknown as DbEntity[];
const dbManagers = db.prepare('SELECT id, name FROM manager').all() as unknown as DbEntity[];

const playerIndex = buildEntityIndex(dbPlayers);
const teamIndex = buildEntityIndex(dbTeams);
const managerIndex = buildEntityIndex(dbManagers);

const matchCache = new Map<string, number | null>();
function cachedMatch(
  kind: 'player' | 'team' | 'manager',
  raw: string,
  index: Map<string, DbEntity[]>,
  all: DbEntity[],
): number | null {
  const key = `${kind}|${raw}`;
  if (matchCache.has(key)) return matchCache.get(key)!;
  const { id } = matchEntity(raw, index, all);
  matchCache.set(key, id);
  return id;
}

// ---------- fetch + parse ----------

async function fetchWiki(slug: string, title: string): Promise<string> {
  const file = resolve(WIKI_DIR, `${slug}.wiki`);
  if (!refresh && existsSync(file)) return readFileSync(file, 'utf8');
  const url = `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`wiki fetch ${title}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}

const awardStmt = db.prepare(
  `INSERT INTO award (name, category, external_id, created_at, updated_at)
   VALUES (?, ?, ?, datetime('now'), datetime('now'))
   ON CONFLICT(external_id) DO UPDATE SET name=excluded.name, category=excluded.category`,
);
const winnerStmt = db.prepare(
  `INSERT INTO award_winner
     (award_id, year, season, place, points, goals, player_id, team_id, manager_id, external_id, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
   ON CONFLICT(external_id) DO UPDATE SET
     year=excluded.year, season=excluded.season, place=excluded.place,
     points=excluded.points, goals=excluded.goals,
     player_id=excluded.player_id, team_id=excluded.team_id, manager_id=excluded.manager_id`,
);

interface Row {
  year: number;
  season: string | null;
  place: number;
  points: number | null;
  goals: number | null;
  personRaw: string;
  teamRaw: string | null;
}

function parseRows(table: WtTable, spec: AwardSpec): Row[] {
  const rows: Row[] = [];
  let lastYear: number | null = null;
  let lastSeason: string | null = null;
  for (const cells of table.rows) {
    const joined = cells.join(' ');
    if (/not awarded|colspan/i.test(joined)) continue;
    const yearCell = cells[spec.cols.year];
    const ys = yearCell ? extractYearSeason(yearCell) : null;
    if (ys) {
      lastYear = ys.year;
      lastSeason = ys.season;
    }
    if (lastYear === null) continue;
    const personRaw = extractPerson(cells[spec.cols.person] ?? '');
    if (!personRaw) continue;
    const rankCell = spec.cols.rank !== undefined ? cells[spec.cols.rank] : undefined;
    const place = spec.cols.rank !== undefined ? (extractPlace(rankCell) ?? 1) : 1;
    const teamCell = spec.cols.team !== undefined ? cells[spec.cols.team] : undefined;
    const teamRaw = teamCell ? (extractPerson(teamCell) ?? undefined) : undefined;
    rows.push({
      year: lastYear,
      season: lastSeason,
      place,
      points: spec.cols.points !== undefined ? extractNumber(cells[spec.cols.points]) : null,
      goals: spec.cols.goals !== undefined ? extractNumber(cells[spec.cols.goals]) : null,
      personRaw,
      teamRaw: teamRaw ?? null,
    });
  }
  return rows;
}

async function main() {
  // group specs by page to fetch each wikitext once
  const byPage = new Map<string, { title: string; specs: AwardSpec[] }>();
  for (const s of AWARDS) {
    const g = byPage.get(s.page) ?? { title: s.page, specs: [] };
    g.specs.push(s);
    byPage.set(s.page, g);
  }

  const stats = {
    awards: 0,
    winners: 0,
    playerMatched: 0,
    playerTotal: 0,
    teamMatched: 0,
    teamTotal: 0,
    skipped: 0,
  };
  const unmatchedPlayers = new Map<string, number>();

  if (!dryRun) db.exec('BEGIN');
  try {
    for (const [page, { title, specs }] of byPage) {
      const slug = page.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const wt = await fetchWiki(slug, title);
      for (const spec of specs) {
        const scope = spec.section ? sectionSlice(wt, spec.section) : wt;
        const tables = parseWikitextTables(scope);
        const table = tables[spec.tableIndex];
        if (!table) {
          console.log(`!! ${spec.key}: table ${spec.tableIndex} not found on ${page}`);
          stats.skipped++;
          continue;
        }
        const rows = parseRows(table, spec);
        if (!rows.length) {
          console.log(`!! ${spec.key}: no rows parsed`);
          stats.skipped++;
          continue;
        }

        let awardId = 0;
        if (!dryRun) {
          awardStmt.run(spec.name, spec.category, spec.key);
          awardId = (
            db.prepare('SELECT id FROM award WHERE external_id = ?').get(spec.key) as { id: number }
          ).id;
        }

        for (const r of rows) {
          const slugName = normalizeName(r.personRaw).join('-');
          const externalId = `${spec.key}:${r.year}:${r.place}:${slugName}`;
          let playerId: number | null = null;
          let teamId: number | null = null;
          let managerId: number | null = null;
          if (spec.category === 'PLAYER') {
            stats.playerTotal++;
            playerId = cachedMatch('player', r.personRaw, playerIndex, dbPlayers);
            if (playerId) stats.playerMatched++;
            else unmatchedPlayers.set(r.personRaw, (unmatchedPlayers.get(r.personRaw) ?? 0) + 1);
          } else if (spec.category === 'MANAGER') {
            managerId = cachedMatch('manager', r.personRaw, managerIndex, dbManagers);
          }
          if (r.teamRaw) {
            stats.teamTotal++;
            teamId = cachedMatch('team', r.teamRaw, teamIndex, dbTeams);
            if (teamId) stats.teamMatched++;
          }
          if (dryRun) continue;
          winnerStmt.run(
            awardId,
            r.year,
            r.season,
            r.place,
            r.points,
            r.goals,
            playerId,
            teamId,
            managerId,
            externalId,
          );
          stats.winners++;
        }
        stats.awards++;
        console.log(
          `${spec.key}: ${rows.length} rows (${rows.filter((r) => r.place === 1).length} winners)`,
        );
      }
    }
    if (!dryRun) db.exec('COMMIT');
  } catch (e) {
    if (!dryRun) db.exec('ROLLBACK');
    throw e;
  }

  console.log(
    `awards: ${stats.awards} | winner rows: ${stats.winners} | ` +
      `players matched: ${stats.playerMatched}/${stats.playerTotal} | ` +
      `teams matched: ${stats.teamMatched}/${stats.teamTotal}`,
  );
  if (unmatchedPlayers.size) {
    console.log('unmatched players (top 30):');
    [...unmatchedPlayers.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .forEach(([n, c]) => console.log(`  ${c}x ${n}`));
  }
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
