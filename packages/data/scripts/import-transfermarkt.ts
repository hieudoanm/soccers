#!/usr/bin/env node
// Imports transfers and current injuries from a Transfermarkt scrape mirrored
// on Hugging Face (ngeorgea/transfermarkt-player-scores), plus injury/suspension
// lists scraped live from transfermarkt.com club pages.
//
// CSVs are cached under import/tm-*.csv; injury pages under
// import/injuries/. Reruns are idempotent: transfers dedupe on
// (player, date, teams), injuries on (player, reason, start date), and player
// bio/photo fields are only filled when NULL.
//
// Usage:
//   node scripts/import-transfermarkt.ts [--dry-run] [--no-injuries]

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dryRun = process.argv.includes('--dry-run');
const noInjuries = process.argv.includes('--no-injuries');

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'import');
const INJURY_DIR = resolve(CACHE_DIR, 'injuries');
mkdirSync(INJURY_DIR, { recursive: true });

const HF_BASE = 'https://huggingface.co/datasets/ngeorgea/transfermarkt-player-scores/resolve/main';
const UA = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'en',
};

const dbPath = resolve(process.env['DATABASE_URL'] ?? './dev.db');
const db = new DatabaseSync(dbPath);

// ---------- helpers ----------

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

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function fetchText(url: string, dest: string): Promise<string> {
  if (existsSync(dest)) return readFileSync(dest, 'utf8');
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  writeFileSync(dest, text);
  return text;
}

function toRows(text: string): Record<string, string>[] {
  const table = parseCsv(text);
  const header = table[0];
  return table.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function posGroup(pos: string | null | undefined): 'GK' | 'DEF' | 'MID' | 'FWD' | null {
  if (!pos) return null;
  const n = pos.toLowerCase();
  if (n.includes('goalkeeper')) return 'GK';
  if (n.includes('midf')) return 'MID';
  if (n.includes('defen') || n.includes('back')) return 'DEF';
  if (n.includes('attack') || n.includes('forward') || n.includes('striker') || n.includes('wing'))
    return 'FWD';
  return null;
}

function tmPosGroup(position: string, subPosition: string): 'GK' | 'DEF' | 'MID' | 'FWD' | null {
  const p = position.toLowerCase();
  if (p === 'goalkeeper') return 'GK';
  if (p === 'defender') return 'DEF';
  if (p === 'midfielder') return 'MID';
  if (p === 'attack') {
    const s = subPosition.toLowerCase();
    if (s.includes('mid')) return 'MID';
    return 'FWD';
  }
  return null;
}

function parseEuDate(s: string | undefined): string | null {
  // TM CSV dates are ISO; injury pages use DD/MM/YYYY.
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s.trim());
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return null;
}

const sleepBetween = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- download / parse source data ----------

console.log('loading transfermarkt csvs…');
const [transfersText, playersText, clubsText] = await Promise.all([
  fetchText(`${HF_BASE}/transfers.csv`, resolve(CACHE_DIR, 'tm-transfers.csv')),
  fetchText(`${HF_BASE}/players.csv`, resolve(CACHE_DIR, 'tm-players.csv')),
  fetchText(`${HF_BASE}/clubs.csv`, resolve(CACHE_DIR, 'tm-clubs.csv')),
]);

interface TmPlayer {
  id: string;
  name: string;
  dob?: string;
  height?: number;
  foot?: 'LEFT' | 'RIGHT';
  position?: string;
  subPosition?: string;
  citizenship?: string;
  clubName?: string;
  photo?: string;
}
const tmPlayers = new Map<string, TmPlayer>();
for (const r of toRows(playersText)) {
  const foot = r['foot']?.trim().toLowerCase();
  tmPlayers.set(r['player_id'], {
    id: r['player_id'],
    name: r['name'] || `${r['first_name']} ${r['last_name']}`.trim(),
    dob: parseEuDate(r['date_of_birth']) ?? undefined,
    height: r['height_in_cm'] ? Math.round(parseFloat(r['height_in_cm'])) : undefined,
    foot: foot === 'left' ? 'LEFT' : foot === 'right' ? 'RIGHT' : undefined,
    position: r['position'] || undefined,
    subPosition: r['sub_position'] || undefined,
    citizenship: r['country_of_citizenship'] || undefined,
    clubName: r['current_club_name'] || undefined,
    photo: r['image_url'] || undefined,
  });
}
console.log(`${tmPlayers.size} tm players`);

interface TmClub {
  id: string;
  code: string;
  name: string;
}
const tmClubs = new Map<string, TmClub>();
for (const r of toRows(clubsText)) {
  tmClubs.set(r['club_id'], { id: r['club_id'], code: r['club_code'], name: r['name'] });
}

interface TmTransfer {
  playerId: string;
  date: string | null;
  fromClubId: string;
  toClubId: string;
  fee: number | null;
}
const tmTransfers: TmTransfer[] = [];
for (const r of toRows(transfersText)) {
  const fee = parseFloat(r['transfer_fee']);
  tmTransfers.push({
    playerId: r['player_id'],
    date: parseEuDate(r['transfer_date']),
    fromClubId: r['from_club_id'],
    toClubId: r['to_club_id'],
    fee: Number.isFinite(fee) && fee > 0 ? fee : null,
  });
}
console.log(`${tmTransfers.length} tm transfers`);

// ---------- load our data ----------

interface DbPlayer {
  id: number;
  name: string;
  nationality: string | null;
  position: string | null;
  date_of_birth: string | null;
  height_cm: number | null;
  preferred_foot: string | null;
  photo_url: string | null;
  current_team_id: number | null;
}
const dbPlayers = db
  .prepare(
    `SELECT p.id, p.name, c.name AS nationality, p.position, p.date_of_birth,
            p.height_cm, p.preferred_foot, p.photo_url, p.current_team_id
     FROM player p LEFT JOIN country c ON c.id = p.nationality_id`,
  )
  .all() as unknown as DbPlayer[];

interface DbTeam {
  id: number;
  name: string;
  shortName: string | null;
}
const dbTeams = db
  .prepare('SELECT id, name, short_name AS shortName FROM team')
  .all() as unknown as DbTeam[];

// Token index over our players (shared tokens → candidate list).
const playerByToken = new Map<string, DbPlayer[]>();
for (const p of dbPlayers) {
  for (const t of new Set(normalizeName(p.name))) {
    const list = playerByToken.get(t) ?? [];
    list.push(p);
    playerByToken.set(t, list);
  }
}

// Team index: normalized token string → team ids (name + short_name).
const teamByTokens = new Map<string, number[]>();
for (const t of dbTeams) {
  for (const label of [t.name, t.shortName].filter(Boolean) as string[]) {
    const key = normalizeName(label).join(' ');
    if (!key) continue;
    const list = teamByTokens.get(key) ?? [];
    list.push(t.id);
    teamByTokens.set(key, list);
  }
}

// The team table contains duplicate clubs imported from different sources —
// weight each team by match appearances so ambiguous name hits resolve to the
// primary record.
const teamWeight = new Map<number, number>();
for (const r of db
  .prepare(
    `SELECT home_team_id AS id, COUNT(*) AS c FROM match GROUP BY home_team_id
     UNION ALL
     SELECT away_team_id AS id, COUNT(*) AS c FROM match GROUP BY away_team_id`,
  )
  .all() as { id: number; c: number }[]) {
  teamWeight.set(r.id, (teamWeight.get(r.id) ?? 0) + r.c);
}

// Fuzzy token equality: exact, or prefix match for tokens ≥4 chars (catches
// "Inter" ~ "Internacional", "Atletico" ~ "Athletico" is NOT covered — accents
// are already stripped).
function tokEq(a: string, b: string): boolean {
  if (a === b) return true;
  const m = Math.min(a.length, b.length);
  return m >= 4 && (a.startsWith(b) || b.startsWith(a));
}

// scored: team id → (coverage ratio of our name tokens, absolute covered count)
function pickTeam(scored: Map<number, [number, number]>): number | null {
  if (scored.size === 0) return null;
  let best: number | null = null;
  let bestKey: [number, number, number] | null = null;
  for (const [id, [ratio, count]] of scored) {
    const w = teamWeight.get(id) ?? 0;
    const better =
      bestKey === null ||
      ratio > bestKey[0] ||
      (ratio === bestKey[0] &&
        (count > bestKey[1] ||
          (count === bestKey[1] &&
            (w > bestKey[2] || (w === bestKey[2] && best !== null && id < best)))));
    if (better) {
      bestKey = [ratio, count, w];
      best = id;
    }
  }
  return best;
}

function matchTeam(tmName: string): number | null {
  const tokens = normalizeName(tmName);
  if (tokens.length === 0) return null;
  const key = tokens.join(' ');
  const direct = teamByTokens.get(key);
  if (direct && direct.length === 1) return direct[0];
  // Score each candidate by coverage ratio of OUR name tokens (then absolute
  // count, then match weight). Ratio-first stops longer unrelated names from
  // winning on partial overlap — TM "Arsenal FC" must prefer our "Arsenal"
  // (1/1 tokens) over "FC Arsenal Tula" (2/3 tokens).
  const scored = new Map<number, [number, number]>();
  for (const [k, ids] of teamByTokens) {
    const kt = k.split(' ');
    const ktCovered = kt.filter((t) => tokens.some((x) => tokEq(t, x))).length;
    const tmCovered = tokens.filter((t) => kt.some((x) => tokEq(t, x))).length;
    if (ktCovered !== kt.length && tmCovered !== tokens.length) continue;
    const ratio = ktCovered / kt.length;
    for (const id of ids) {
      const prev = scored.get(id);
      if (!prev || ratio > prev[0] || (ratio === prev[0] && ktCovered > prev[1])) {
        scored.set(id, [ratio, ktCovered]);
      }
    }
  }
  return pickTeam(scored);
}

function scorePlayer(tm: TmPlayer, p: DbPlayer): number {
  const pt = new Set(normalizeName(p.name));
  const tt = new Set(normalizeName(tm.name));
  if (tt.size === 1 && pt.size > 1) return -1; // mononym guard
  let inter = 0;
  for (const t of tt) if (pt.has(t)) inter++;
  if (inter === 0) return -1;
  const contained = inter === tt.size || inter === pt.size;
  if (!contained) return -1;
  let score = inter * 100 + Math.min(tt.size, pt.size);
  if (tm.dob && p.date_of_birth && tm.dob === p.date_of_birth.slice(0, 10)) score += 500;
  if (tm.height != null && p.height_cm != null && Math.abs(tm.height - p.height_cm) <= 3)
    score += 60;
  if (tm.foot && p.preferred_foot === tm.foot) score += 40;
  const ourGroup = posGroup(p.position);
  const tmGroup = tmPosGroup(tm.position ?? '', tm.subPosition ?? '');
  if (ourGroup && tmGroup && ourGroup === tmGroup) score += 30;
  if (tm.citizenship && p.nationality) {
    const a = normalizeName(tm.citizenship).join(' ');
    const b = normalizeName(p.nationality).join(' ');
    if (a === b) score += 20;
  }
  return score;
}

const tmToDbPlayer = new Map<string, number | null>();
const tmToDbTeam = new Map<string, number>();

function matchTmPlayer(tm: TmPlayer): number | null {
  const cached = tmToDbPlayer.get(tm.id);
  if (cached !== undefined) return cached;
  const tokens = new Set(normalizeName(tm.name));
  const pool = new Set<DbPlayer>();
  for (const t of tokens) {
    for (const p of playerByToken.get(t) ?? []) pool.add(p);
  }
  let best: DbPlayer | null = null;
  let bestScore = -1;
  let tie = false;
  for (const p of pool) {
    const s = scorePlayer(tm, p);
    if (s < 0) continue;
    if (s > bestScore) {
      bestScore = s;
      best = p;
      tie = false;
    } else if (s === bestScore) tie = true;
  }
  const id = best && !tie ? best.id : null;
  tmToDbPlayer.set(tm.id, id);
  return id;
}

function matchTmClub(clubId: string): number | null {
  const cached = tmToDbTeam.get(clubId);
  if (cached !== undefined) return cached === -1 ? null : cached;
  const club = tmClubs.get(clubId);
  const id = club ? matchTeam(club.name) : null;
  tmToDbTeam.set(clubId, id ?? -1);
  return id;
}

// ---------- transfers ----------

const existingTransfers = new Set<string>();
for (const r of db
  .prepare(
    `SELECT t.player_id, t.to_team_id, t.from_team_id, t.date
     FROM transfer t`,
  )
  .all() as {
  player_id: number;
  to_team_id: number;
  from_team_id: number | null;
  date: string;
}[]) {
  existingTransfers.add(
    `${r.player_id}|${r.to_team_id}|${r.from_team_id ?? 0}|${r.date.slice(0, 10)}`,
  );
}

const insertTransfer = db.prepare(
  `INSERT INTO transfer (player_id, from_team_id, to_team_id, date, fee, currency, type,
     created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, NULL,
     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
);

let tMatchedPlayers = 0;
let tUnmatchedPlayers = 0;
let tInserted = 0;
let tSkippedDup = 0;
let tSkippedTeam = 0;

const playerUpdates: {
  id: number;
  photo?: string;
  dob?: string;
  height?: number;
  foot?: string;
}[] = [];

if (!dryRun) db.exec('BEGIN');
for (const tr of tmTransfers) {
  const tm = tmPlayers.get(tr.playerId);
  if (!tm || !tr.date) continue;
  const playerId = matchTmPlayer(tm);
  if (playerId == null) {
    tUnmatchedPlayers++;
    continue;
  }
  tMatchedPlayers++;
  const toTeamId = matchTmClub(tr.toClubId);
  if (toTeamId == null) {
    tSkippedTeam++;
    continue;
  }
  const fromTeamId = tr.fromClubId ? matchTmClub(tr.fromClubId) : null;
  const key = `${playerId}|${toTeamId}|${fromTeamId ?? 0}|${tr.date}`;
  if (existingTransfers.has(key)) {
    tSkippedDup++;
    continue;
  }
  existingTransfers.add(key);
  tInserted++;
  if (!dryRun) {
    insertTransfer.run(
      playerId,
      fromTeamId,
      toTeamId,
      tr.date,
      tr.fee,
      tr.fee != null ? 'EUR' : null,
    );
  }
}

// Opportunistic bio/photo backfill for matched players (NULL fields only).
const playerById = new Map(dbPlayers.map((p) => [p.id, p]));
const seenTmPlayers = new Set<string>();
for (const tr of tmTransfers) {
  const tm = tmPlayers.get(tr.playerId);
  if (!tm || seenTmPlayers.has(tm.id)) continue;
  seenTmPlayers.add(tm.id);
  const playerId = tmToDbPlayer.get(tm.id);
  if (playerId == null) continue;
  const p = playerById.get(playerId);
  if (!p) continue;
  const needsPhoto = !p.photo_url && !!tm.photo;
  const needsDob = !p.date_of_birth && !!tm.dob;
  const needsHeight = p.height_cm == null && tm.height != null;
  const needsFoot = !p.preferred_foot && !!tm.foot;
  if (needsPhoto || needsDob || needsHeight || needsFoot) {
    playerUpdates.push({
      id: playerId,
      photo: needsPhoto ? tm.photo : undefined,
      dob: needsDob ? tm.dob : undefined,
      height: needsHeight ? tm.height : undefined,
      foot: needsFoot ? tm.foot : undefined,
    });
  }
}
const updatePlayer = db.prepare(
  `UPDATE player SET photo_url = COALESCE(photo_url, ?),
     date_of_birth = COALESCE(date_of_birth, ?), height_cm = COALESCE(height_cm, ?),
     preferred_foot = COALESCE(preferred_foot, ?),
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = ?`,
);
let playersUpdated = 0;
for (const u of playerUpdates) {
  playersUpdated++;
  if (!dryRun)
    updatePlayer.run(u.photo ?? null, u.dob ?? null, u.height ?? null, u.foot ?? null, u.id);
}

console.log(
  `transfers: ${tInserted} inserted, ${tSkippedDup} dup, ${tSkippedTeam} unmatched to-team, ` +
    `${tUnmatchedPlayers} unmatched players; bio/photo filled for ${playersUpdated} players`,
);

if (!dryRun) db.exec('COMMIT');

// ---------- injuries (live scrape) ----------

interface InjuryRow {
  tmPlayerId: string;
  name: string;
  type: string;
  reason: string;
  since: string | null;
  expectedReturn: string | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

// Player cells contain a nested table, so <tr> boundaries don't line up — scan
// for section headers and player-profile links in document order instead, then
// parse each row's window (link → next event) for reason and date cells.
function parseInjuryPage(html: string): InjuryRow[] {
  const start = html.indexOf('<table class="items"');
  if (start < 0) return [];
  // The items table contains nested per-player tables, so its real end is the
  // closing </main> of the content column — the first </table> is a nested one.
  const mainEnd = html.indexOf('</main>', start);
  const region = html.slice(start, mainEnd < 0 ? undefined : mainEnd);

  const events: { idx: number; section?: string; slug?: string; id?: string }[] = [];
  const tokenRe = /extrarow[^>]*>([^<]+)<|\/([\w-]+)\/profil\/spieler\/(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(region))) {
    if (m[1] !== undefined) events.push({ idx: m.index, section: m[1] });
    else events.push({ idx: m.index, slug: m[2], id: m[3] });
  }

  const rows: InjuryRow[] = [];
  let section = '';
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.section !== undefined) {
      section = decodeEntities(e.section).trim();
      continue;
    }
    const winEnd = i + 1 < events.length ? events[i + 1].idx : region.length;
    const win = region.slice(e.idx, winEnd);
    const reasonM = /<td[^>]*class="[^"]*links[^"]*"[^>]*>([\s\S]*?)<\/td>/.exec(win);
    const zcells = [
      ...win.matchAll(/<td[^>]*class="[^"]*zentriert[^"]*"[^>]*>([\s\S]*?)<\/td>/g),
    ].map((c) =>
      decodeEntities(c[1].replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim(),
    );
    // zcells order: age, since, expected return, missed matches
    const reason = reasonM
      ? decodeEntities(reasonM[1].replace(/<[^>]+>/g, ' '))
          .replace(/\s+/g, ' ')
          .trim()
      : '';
    const since = parseEuDate(zcells[1]);
    const expectedReturn = parseEuDate(zcells[2]);
    // The page also embeds a "risk of suspension" table whose rows carry no
    // reason or dates — skip anything that looks like neither.
    if (!reason && !since && !expectedReturn) continue;
    rows.push({
      tmPlayerId: e.id ?? '',
      name: decodeEntities(e.slug ?? '').replace(/-/g, ' '),
      type: section || 'Injury',
      reason,
      since,
      expectedReturn,
    });
  }
  return rows;
}

// Reverse map: our team id → tm club (for page fetching). Match every TM club,
// not just ones seen in transfers, so injury coverage isn't limited by the
// transfer history window.
const ourTeamToTmClub = new Map<number, TmClub>();
for (const clubId of tmClubs.keys()) {
  const teamId = matchTmClub(clubId);
  if (teamId == null) continue;
  const club = tmClubs.get(clubId);
  if (club) ourTeamToTmClub.set(teamId, club);
}

console.log(`${ourTeamToTmClub.size} of our teams matched to transfermarkt clubs`);

const existingInjuries = new Set<string>();
for (const r of db.prepare('SELECT player_id, reason, start_date FROM injury').all() as {
  player_id: number;
  reason: string | null;
  start_date: string | null;
}[]) {
  existingInjuries.add(`${r.player_id}|${r.reason ?? ''}|${(r.start_date ?? '').slice(0, 10)}`);
}

const insertInjury = db.prepare(
  `INSERT INTO injury (player_id, team_id, type, reason, start_date, end_date, status,
     created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE',
     strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
);

// Players per team for restricted matching.
const playersByTeam = new Map<number, DbPlayer[]>();
for (const p of dbPlayers) {
  if (p.current_team_id == null) continue;
  const list = playersByTeam.get(p.current_team_id) ?? [];
  list.push(p);
  playersByTeam.set(p.current_team_id, list);
}

let iFetched = 0;
let iInserted = 0;
let iSkippedDup = 0;
let iUnmatched = 0;
let iFailed = 0;

if (noInjuries) {
  console.log('injuries: skipped (--no-injuries)');
} else {
  if (!dryRun) db.exec('BEGIN');
  let clubIdx = 0;
  for (const [teamId, club] of ourTeamToTmClub) {
    clubIdx++;
    const cacheFile = resolve(INJURY_DIR, `${club.id}.html`);
    let html: string | null = null;
    if (existsSync(cacheFile)) {
      html = readFileSync(cacheFile, 'utf8');
    } else {
      const url = `https://www.transfermarkt.com/${club.code}/sperrenundverletzungen/verein/${club.id}`;
      for (let attempt = 0; attempt < 3 && html == null; attempt++) {
        try {
          const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          html = await res.text();
        } catch (err) {
          if (attempt === 2) {
            iFailed++;
            console.log(`  ${club.name}: fetch failed — ${(err as Error).message}`);
          } else {
            await sleepBetween(4_000 * (attempt + 1));
          }
        }
      }
      if (html == null) continue;
      writeFileSync(cacheFile, html);
      iFetched++;
      await sleepBetween(1_200);
    }

    const rows = parseInjuryPage(html);
    if (rows.length === 0) continue;

    const squad = playersByTeam.get(teamId) ?? [];
    const squadByToken = new Map<string, DbPlayer[]>();
    for (const p of squad) {
      for (const t of new Set(normalizeName(p.name))) {
        const list = squadByToken.get(t) ?? [];
        list.push(p);
        squadByToken.set(t, list);
      }
    }

    for (const row of rows) {
      // Prefer TM player_id → our player via tmPlayers name + squad restriction.
      const tm = tmPlayers.get(row.tmPlayerId);
      const name = tm?.name ?? row.name;
      const tokens = new Set(normalizeName(name));
      const pool = new Set<DbPlayer>();
      for (const t of tokens) {
        for (const p of squadByToken.get(t) ?? []) pool.add(p);
      }
      let best: DbPlayer | null = null;
      let bestScore = -1;
      let tie = false;
      for (const p of pool) {
        const pt = new Set(normalizeName(p.name));
        let inter = 0;
        for (const t of tokens) if (pt.has(t)) inter++;
        if (inter === 0) continue;
        const contained = inter === tokens.size || inter === pt.size;
        if (!contained) continue;
        if (tokens.size === 1 && pt.size > 1) continue;
        const s = inter * 100 + Math.min(tokens.size, pt.size);
        if (s > bestScore) {
          bestScore = s;
          best = p;
          tie = false;
        } else if (s === bestScore) tie = true;
      }
      if (!best || tie) {
        iUnmatched++;
        continue;
      }
      const key = `${best.id}|${row.reason}|${row.since ?? ''}`;
      if (existingInjuries.has(key)) {
        iSkippedDup++;
        continue;
      }
      existingInjuries.add(key);
      iInserted++;
      if (!dryRun) {
        insertInjury.run(best.id, teamId, row.type, row.reason, row.since, row.expectedReturn);
      }
    }
    if (clubIdx % 50 === 0) console.log(`  injuries: ${clubIdx}/${ourTeamToTmClub.size} clubs`);
  }
  if (!dryRun) db.exec('COMMIT');
  console.log(
    `injuries: ${iInserted} inserted, ${iSkippedDup} dup, ${iUnmatched} unmatched players, ` +
      `${iFailed} failed fetches (${iFetched} pages fetched)`,
  );
}
console.log('done');
db.close();
