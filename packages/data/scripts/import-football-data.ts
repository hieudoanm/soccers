#!/usr/bin/env node
// Imports historical match data from football-data.co.uk into the Prisma 8 SQLite db.
//
// Usage:
//   node scripts/import-football-data.ts [--leagues E0,SP1,...] [--seasons N]
//                                        [--from 1993] [--to 2026] [--dry-run]
//
// --seasons N imports the N most recent seasons (default: all, back to --from).
// Populates: Country, League, Season, Team, Referee, Match, MatchTeamStat, Standing.
// Player-level data (lineups, goals, events) is not available from this source.

import { createHash } from 'node:crypto';
import { db } from '../src/prisma/db.ts';

const BASE = 'https://football-data.co.uk/mmz4281';

interface LeagueInfo {
  name: string;
  country: string;
  countryCode: string;
}

const LEAGUES: Record<string, LeagueInfo> = {
  E0: {
    name: 'English Premier League',
    country: 'England',
    countryCode: 'ENG',
  },
  E1: { name: 'English Championship', country: 'England', countryCode: 'ENG' },
  E2: { name: 'English League One', country: 'England', countryCode: 'ENG' },
  E3: { name: 'English League Two', country: 'England', countryCode: 'ENG' },
  SC0: {
    name: 'Scottish Premiership',
    country: 'Scotland',
    countryCode: 'SCO',
  },
  SC1: {
    name: 'Scottish Championship',
    country: 'Scotland',
    countryCode: 'SCO',
  },
  SC2: { name: 'Scottish League One', country: 'Scotland', countryCode: 'SCO' },
  SC3: { name: 'Scottish League Two', country: 'Scotland', countryCode: 'SCO' },
  D1: { name: 'German Bundesliga', country: 'Germany', countryCode: 'GER' },
  D2: { name: 'German 2. Bundesliga', country: 'Germany', countryCode: 'GER' },
  I1: { name: 'Italian Serie A', country: 'Italy', countryCode: 'ITA' },
  I2: { name: 'Italian Serie B', country: 'Italy', countryCode: 'ITA' },
  SP1: { name: 'Spanish La Liga', country: 'Spain', countryCode: 'ESP' },
  SP2: { name: 'Spanish La Liga 2', country: 'Spain', countryCode: 'ESP' },
  F1: { name: 'French Ligue 1', country: 'France', countryCode: 'FRA' },
  F2: { name: 'French Ligue 2', country: 'France', countryCode: 'FRA' },
  N1: { name: 'Dutch Eredivisie', country: 'Netherlands', countryCode: 'NED' },
  B1: { name: 'Belgian Pro League', country: 'Belgium', countryCode: 'BEL' },
  P1: {
    name: 'Portuguese Liga Portugal',
    country: 'Portugal',
    countryCode: 'POR',
  },
  T1: { name: 'Turkish Süper Lig', country: 'Turkey', countryCode: 'TUR' },
  G1: { name: 'Greek Super League', country: 'Greece', countryCode: 'GRE' },
};

// Additional single-file countries under /new/<CODE>.csv. Format differs from the
// mmz4281 files: Country,League,Season,Date,Time,Home,Away,HG,AG,Res + odds only
// (no match stats, no referee, no HT scores). League names are embedded per row.
const NEW_SOURCES: Record<string, { country: string; countryCode: string }> = {
  ARG: { country: 'Argentina', countryCode: 'ARG' },
  AUT: { country: 'Austria', countryCode: 'AUT' },
  BRA: { country: 'Brazil', countryCode: 'BRA' },
  CHN: { country: 'China', countryCode: 'CHN' },
  DNK: { country: 'Denmark', countryCode: 'DNK' },
  FIN: { country: 'Finland', countryCode: 'FIN' },
  IRL: { country: 'Ireland', countryCode: 'IRL' },
  JPN: { country: 'Japan', countryCode: 'JPN' },
  MEX: { country: 'Mexico', countryCode: 'MEX' },
  NOR: { country: 'Norway', countryCode: 'NOR' },
  POL: { country: 'Poland', countryCode: 'POL' },
  ROU: { country: 'Romania', countryCode: 'ROU' },
  RUS: { country: 'Russia', countryCode: 'RUS' },
  SWE: { country: 'Sweden', countryCode: 'SWE' },
  SWZ: { country: 'Switzerland', countryCode: 'SWZ' },
  USA: { country: 'United States', countryCode: 'USA' },
};

// ---------- CLI args ----------
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const leagueCodes = (arg('leagues') ?? Object.keys(LEAGUES).join(','))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter((c) => LEAGUES[c]);
const unknown = (arg('leagues') ?? '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter((c) => c && !LEAGUES[c]);
if (unknown.length) console.warn(`Unknown league codes skipped: ${unknown.join(', ')}`);

const fromYear = Number(arg('from') ?? 1993);
const toYear = Number(arg('to') ?? new Date().getFullYear());
const seasonsFlag = arg('seasons') ? Number(arg('seasons')) : undefined;
const dryRun = has('dry-run');

// ---------- helpers ----------
const pad = (n: number) => String(n).padStart(2, '0');
const seasonFolder = (startYear: number) => `${pad(startYear % 100)}${pad((startYear + 1) % 100)}`;

function parseDate(dateStr: string, timeStr: string | undefined): Date {
  const [d, m, y] = dateStr.split('/').map(Number);
  const year = y > 100 ? y : y < 50 ? 2000 + y : 1900 + y;
  const [hh = 12, mm = 0] = (timeStr ?? '12:00').split(':').map(Number);
  return new Date(Date.UTC(year, m - 1, d, hh, mm));
}

const toInt = (v: string | undefined): number | null => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

function externalId(parts: string[]): string {
  return 'fdc-' + createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

// ---------- entity caches ----------
const countryIds = new Map<string, number>();
const leagueIds = new Map<string, number>();
const teamIds = new Map<string, number>(); // key: `${countryCode}|${name}`
const refereeIds = new Map<string, number>(); // key: name
const seasonIds = new Map<string, number>(); // key: `${leagueCode}|${startYear}`

async function ensureCountry(code: string, name: string): Promise<number> {
  const hit = countryIds.get(code);
  if (hit) return hit;
  let row = await db.orm.Country.first({ code });
  if (!row) {
    row = dryRun ? ({ id: -1 } as never) : await db.orm.Country.create({ name, code });
  }
  countryIds.set(code, row.id);
  return row.id;
}

async function ensureLeague(code: string): Promise<number> {
  const hit = leagueIds.get(code);
  if (hit) return hit;
  const info = LEAGUES[code];
  const countryId = await ensureCountry(info.countryCode, info.country);
  let row = await db.orm.League.first({ code });
  if (!row) {
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.League.create({
          name: info.name,
          code,
          type: 'LEAGUE',
          countryId,
          externalId: `fdc:${code}`,
        });
  } else if (!dryRun) {
    await db.orm.League.where({ code }).update({ name: info.name, countryId });
  }
  leagueIds.set(code, row.id);
  return row.id;
}

async function ensureLeagueWithInfo(
  code: string,
  name: string,
  type: 'LEAGUE' | 'CUP' | 'INTERNATIONAL' | 'FRIENDLY',
  countryId: number,
): Promise<number> {
  const hit = leagueIds.get(code);
  if (hit) return hit;
  let row = await db.orm.League.first({ code });
  if (!row) {
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.League.create({
          name,
          code,
          type,
          countryId,
          externalId: `fdc:${code}`,
        });
  } else if (!dryRun) {
    await db.orm.League.where({ code }).update({ name, countryId });
  }
  leagueIds.set(code, row.id);
  return row.id;
}

async function ensureSeason(
  leagueId: number,
  cacheKey: string,
  startYear: number,
  seasonName?: string,
): Promise<number> {
  const key = `${cacheKey}|${startYear}`;
  const hit = seasonIds.get(key);
  if (hit) return hit;
  const endYear = startYear + 1;
  let row = await db.orm.Season.first({ leagueId, year: startYear });
  if (!row) {
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.Season.create({
          leagueId,
          year: startYear,
          name: seasonName ?? `${startYear}/${String(endYear % 100).padStart(2, '0')}`,
          startDate: new Date(Date.UTC(startYear, 6, 1)),
          endDate: new Date(Date.UTC(endYear, 5, 30)),
        });
  }
  seasonIds.set(key, row.id);
  return row.id;
}

async function ensureTeam(name: string, countryCode: string, countryId: number): Promise<number> {
  const key = `${countryCode}|${name}`;
  const hit = teamIds.get(key);
  if (hit) return hit;
  let row = await db.orm.Team.first({ name, countryId });
  if (!row) {
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.Team.create({
          name,
          countryId,
          code:
            name
              .replace(/[^A-Za-z0-9]/g, '')
              .slice(0, 3)
              .toUpperCase() || undefined,
          externalId: `fdc:${countryCode}:${name}`,
        });
  }
  teamIds.set(key, row.id);
  return row.id;
}

async function ensureReferee(name: string): Promise<number | null> {
  const hit = refereeIds.get(name);
  if (hit) return hit;
  let row = await db.orm.Referee.first({ name });
  if (!row && !dryRun) row = await db.orm.Referee.create({ name });
  if (!row) return null;
  refereeIds.set(name, row.id);
  return row.id;
}

// ---------- CSV ----------
interface RawMatch {
  date: Date;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeHt: number | null;
  awayHt: number | null;
  referee: string | null;
  stats: {
    home: Record<string, number | null>;
    away: Record<string, number | null>;
  };
  extId: string;
  result: 'H' | 'D' | 'A';
}

const STAT_COLS = [
  'HS',
  'AS',
  'HST',
  'AST',
  'HF',
  'AF',
  'HC',
  'AC',
  'HY',
  'AY',
  'HR',
  'AR',
] as const;

async function fetchSeasonCsv(leagueCode: string, startYear: number): Promise<string | null> {
  const url = `${BASE}/${seasonFolder(startYear)}/${leagueCode}.csv`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const text = await res.text();
    return text.includes('Div,Date') ? text : null;
  } catch {
    return null;
  }
}

function parseCsv(text: string): RawMatch[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const has = (name: string) => idx(name) >= 0;
  const col = (cols: string[], name: string) => cols[idx(name)];

  const matches: RawMatch[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(',').map((s) => s.trim());
    const homeScore = toInt(col(c, 'FTHG'));
    const awayScore = toInt(col(c, 'FTAG'));
    if (homeScore === null || awayScore === null) continue; // not played / abandoned

    const date = parseDate(col(c, 'Date'), has('Time') ? col(c, 'Time') || undefined : undefined);
    const homeTeam = col(c, 'HomeTeam');
    const awayTeam = col(c, 'AwayTeam');
    const ftr = col(c, 'FTR');
    const result: 'H' | 'D' | 'A' =
      ftr === 'H' || ftr === 'D' || ftr === 'A'
        ? ftr
        : homeScore > awayScore
          ? 'H'
          : homeScore < awayScore
            ? 'A'
            : 'D';

    const stat = (prefix: 'H' | 'A') => {
      const out: Record<string, number | null> = {};
      for (const s of STAT_COLS) {
        if (!s.startsWith(prefix)) continue;
        out[s] = has(s) ? toInt(col(c, s)) : null;
      }
      return out;
    };

    matches.push({
      date,
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
      homeHt: has('HTHG') ? toInt(col(c, 'HTHG')) : null,
      awayHt: has('HTAG') ? toInt(col(c, 'HTAG')) : null,
      referee: has('Referee') && col(c, 'Referee') ? col(c, 'Referee') : null,
      stats: { home: stat('H'), away: stat('A') },
      extId: externalId([
        leagueCodeFromFile ?? '',
        String(date.getTime()),
        homeTeam,
        awayTeam,
        String(homeScore),
        String(awayScore),
      ]),
      result,
    });
  }
  return matches;
}

// leagueCode is needed inside parseCsv for externalId; set per file.
let leagueCodeFromFile = '';

// ---------- standings ----------
interface StandingAgg {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: string[];
}

function bumpStandings(
  map: Map<string, StandingAgg>,
  teamKey: string,
  scored: number,
  conceded: number,
  result: 'W' | 'D' | 'L',
) {
  let s = map.get(teamKey);
  if (!s) {
    s = {
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
      form: [],
    };
    map.set(teamKey, s);
  }
  s.played++;
  s.goalsFor += scored;
  s.goalsAgainst += conceded;
  if (result === 'W') {
    s.won++;
    s.points += 3;
    s.form.push('W');
  } else if (result === 'D') {
    s.drawn++;
    s.points += 1;
    s.form.push('D');
  } else {
    s.lost++;
    s.form.push('L');
  }
}

async function persistStandings(
  seasonId: number,
  leagueId: number,
  standings: Map<string, StandingAgg>,
) {
  const entries = [...standings.entries()].map(([key, s]) => {
    const [cc, name] = key.split('|');
    return { name, countryCode: cc, ...s, goalDiff: s.goalsFor - s.goalsAgainst };
  });
  const sorted = [...entries].sort(
    (a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor,
  );
  for (let pos = 0; pos < sorted.length; pos++) {
    const e = sorted[pos];
    const teamId = teamIds.get(`${e.countryCode}|${e.name}`);
    if (!teamId) continue;
    const existingSt = await db.orm.Standing.first({ seasonId, teamId });
    const data = {
      played: e.played,
      won: e.won,
      drawn: e.drawn,
      lost: e.lost,
      goalsFor: e.goalsFor,
      goalsAgainst: e.goalsAgainst,
      goalDiff: e.goalDiff,
      points: e.points,
      position: pos + 1,
      form: e.form.slice(-5).join(''),
    };
    if (existingSt) await db.orm.Standing.where({ id: existingSt.id }).update(data);
    else await db.orm.Standing.create({ seasonId, leagueId, teamId, ...data });
  }
}

// ---------- /new/<CODE>.csv single-file countries ----------
interface NewMatch {
  date: Date;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  extId: string;
  result: 'H' | 'D' | 'A';
}

async function fetchNewCsv(code: string): Promise<string | null> {
  try {
    const res = await fetch(`https://football-data.co.uk/new/${code}.csv`);
    if (!res.ok) return null;
    const text = (await res.text()).replace(/^﻿/, '');
    return text.includes('Country,League,Season') ? text : null;
  } catch {
    return null;
  }
}

function parseNewSeason(label: string): { year: number; name: string } {
  const y = Number(label.slice(0, 4));
  return { year: y, name: label.trim() };
}

function newLeagueCode(countryCode: string, leagueName: string): string {
  const slug = leagueName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `N${countryCode}-${slug || 'league'}`;
}

async function importNewCountry(code: string) {
  const src = NEW_SOURCES[code];
  const csv = await fetchNewCsv(code);
  if (!csv) return { code, files: 0, matches: 0 };

  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0].split(',').map((h) => h.trim());
  const idx = (n: string) => header.indexOf(n);

  // group rows by league + season
  const groups = new Map<string, { leagueName: string; seasonLabel: string; rows: NewMatch[] }>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = line.split(',').map((s) => s.trim());
    const hs = toInt(c[idx('HG')]);
    const as_ = toInt(c[idx('AG')]);
    if (hs === null || as_ === null) continue;
    const leagueName = c[idx('League')].replace(/\s+/g, ' ').trim();
    const seasonLabel = c[idx('Season')].trim();
    const date = parseDate(c[idx('Date')], c[idx('Time')] || undefined);
    const homeTeam = c[idx('Home')];
    const awayTeam = c[idx('Away')];
    const res = c[idx('Res')];
    const result: 'H' | 'D' | 'A' =
      res === 'H' || res === 'D' || res === 'A' ? res : hs > as_ ? 'H' : hs < as_ ? 'A' : 'D';
    const key = `${leagueName}|${seasonLabel}`;
    let g = groups.get(key);
    if (!g) {
      g = { leagueName, seasonLabel, rows: [] };
      groups.set(key, g);
    }
    g.rows.push({
      date,
      homeTeam,
      awayTeam,
      homeScore: hs,
      awayScore: as_,
      extId: externalId([
        `N${code}`,
        leagueName,
        seasonLabel,
        String(date.getTime()),
        homeTeam,
        awayTeam,
        String(hs),
        String(as_),
      ]),
      result,
    });
  }

  const countryId = await ensureCountry(src.countryCode, src.country);
  let total = 0;
  let files = 0;
  for (const g of groups.values()) {
    // dedupe identical fixtures within the group
    const seen = new Set<string>();
    const rows = g.rows.filter((r) => (seen.has(r.extId) ? false : (seen.add(r.extId), true)));
    if (!rows.length) continue;

    const leagueCode = newLeagueCode(src.countryCode, g.leagueName);
    const type = /cup|copa|league cup/i.test(g.leagueName) ? 'CUP' : 'LEAGUE';
    const leagueId = await ensureLeagueWithInfo(leagueCode, g.leagueName, type, countryId);
    const { year, name } = parseNewSeason(g.seasonLabel);
    const seasonId = await ensureSeason(leagueId, leagueCode, year, name);

    const homeIds = new Map<string, number>();
    const awayIds = new Map<string, number>();
    for (const r of rows) {
      if (!homeIds.has(r.homeTeam))
        homeIds.set(r.homeTeam, await ensureTeam(r.homeTeam, src.countryCode, countryId));
      if (!awayIds.has(r.awayTeam))
        awayIds.set(r.awayTeam, await ensureTeam(r.awayTeam, src.countryCode, countryId));
    }

    const existing = await db.orm.Match.where({ seasonId }).select('id', 'externalId').all();
    const existingIds = new Set(existing.map((m) => m.externalId));
    const toInsert = rows.filter((r) => !existingIds.has(r.extId));

    const CHUNK = 200;
    for (let i = 0; i < toInsert.length && !dryRun; i += CHUNK) {
      const slice = toInsert.slice(i, i + CHUNK);
      const plan = db.sql.match
        .insert(
          slice.map((r) => ({
            external_id: r.extId,
            date: r.date,
            status: 'FINISHED' as const,
            season_id: seasonId,
            home_team_id: homeIds.get(r.homeTeam)!,
            away_team_id: awayIds.get(r.awayTeam)!,
            home_score: r.homeScore,
            away_score: r.awayScore,
          })),
        )
        .build();
      await db.execute(plan);
    }
    total += toInsert.length;
    files++;

    const standings = new Map<string, StandingAgg>();
    for (const r of rows) {
      const hk = `${src.countryCode}|${r.homeTeam}`;
      const ak = `${src.countryCode}|${r.awayTeam}`;
      const hr = r.result === 'H' ? 'W' : r.result === 'A' ? 'L' : 'D';
      const ar = r.result === 'A' ? 'W' : r.result === 'H' ? 'L' : 'D';
      bumpStandings(standings, hk, r.homeScore, r.awayScore, hr);
      bumpStandings(standings, ak, r.awayScore, r.homeScore, ar);
    }
    if (!dryRun) await persistStandings(seasonId, leagueId, standings);
  }
  return { code, files, matches: total };
}

// ---------- main ----------
async function importFile(leagueCode: string, startYear: number) {
  leagueCodeFromFile = leagueCode;
  const csv = await fetchSeasonCsv(leagueCode, startYear);
  if (!csv) return { leagueCode, startYear, imported: 0, skipped: true };

  const parsed = parseCsv(csv);
  // Some season files list fixtures twice; drop exact duplicates (same date, teams, score).
  const seen = new Set<string>();
  const rows = parsed.filter((r) => (seen.has(r.extId) ? false : (seen.add(r.extId), true)));
  if (!rows.length) return { leagueCode, startYear, imported: 0, skipped: true };

  const info = LEAGUES[leagueCode];
  const countryId = await ensureCountry(info.countryCode, info.country);
  const leagueId = await ensureLeague(leagueCode);
  const seasonId = await ensureSeason(leagueId, leagueCode, startYear);

  // Resolve teams & referees
  const homeIds = new Map<string, number>();
  const awayIds = new Map<string, number>();
  const refIds = new Map<string, number | null>();
  for (const r of rows) {
    if (!homeIds.has(r.homeTeam))
      homeIds.set(r.homeTeam, await ensureTeam(r.homeTeam, info.countryCode, countryId));
    if (!awayIds.has(r.awayTeam))
      awayIds.set(r.awayTeam, await ensureTeam(r.awayTeam, info.countryCode, countryId));
    if (r.referee && !refIds.has(r.referee)) refIds.set(r.referee, await ensureReferee(r.referee));
  }

  // Existing matches for this season (idempotent re-runs)
  const existing = await db.orm.Match.where({ seasonId }).select('id', 'externalId').all();
  const existingIds = new Map(existing.map((m) => [m.externalId, m.id]));
  const toInsert = rows.filter((r) => !existingIds.has(r.extId));

  const standings = new Map<string, StandingAgg>();

  const CHUNK = 200;
  if (!dryRun && toInsert.length) {
    // Bulk insert matches in chunks
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const slice = toInsert.slice(i, i + CHUNK);
      const plan = db.sql.match
        .insert(
          slice.map((r) => ({
            external_id: r.extId,
            date: r.date,
            status: 'FINISHED' as const,
            season_id: seasonId,
            home_team_id: homeIds.get(r.homeTeam)!,
            away_team_id: awayIds.get(r.awayTeam)!,
            home_score: r.homeScore,
            away_score: r.awayScore,
            home_ht_score: r.homeHt,
            away_ht_score: r.awayHt,
            referee_id: r.referee ? (refIds.get(r.referee) ?? null) : null,
          })),
        )
        .returning('id', 'external_id')
        .build();
      const inserted = await db.query(plan);
      for (const m of inserted) existingIds.set(m.external_id!, m.id);
    }
  }

  if (!dryRun) {
    // Refresh team stats for every match in this file (idempotent re-runs)
    const allIds = [...existingIds.values()];
    for (let i = 0; i < allIds.length; i += 500) {
      const delPlan = db.sql.match_team_stat
        .delete()
        .where((f, fns) => fns.in(f.match_id, allIds.slice(i, i + 500)))
        .build();
      await db.execute(delPlan);
    }

    // Bulk insert team stats
    const statRows: {
      match_id: number;
      team_id: number;
      shots: number | null;
      shots_on_target: number | null;
      shots_off_target: number | null;
      corners: number | null;
      fouls: number | null;
      yellow_cards: number | null;
      red_cards: number | null;
    }[] = [];
    for (const r of rows) {
      const matchId = existingIds.get(r.extId);
      if (!matchId) continue;
      const homeId = homeIds.get(r.homeTeam)!;
      const awayId = awayIds.get(r.awayTeam)!;
      const hs = r.stats.home;
      const as_ = r.stats.away;
      const hasStats = [...Object.values(hs), ...Object.values(as_)].some((v) => v !== null);
      if (!hasStats) continue;
      statRows.push({
        match_id: matchId,
        team_id: homeId,
        shots: hs['HS'] ?? null,
        shots_on_target: hs['HST'] ?? null,
        shots_off_target: hs['HS'] != null && hs['HST'] != null ? hs['HS'] - hs['HST'] : null,
        corners: hs['HC'] ?? null,
        fouls: hs['HF'] ?? null,
        yellow_cards: hs['HY'] ?? null,
        red_cards: hs['HR'] ?? null,
      });
      statRows.push({
        match_id: matchId,
        team_id: awayId,
        shots: as_['AS'] ?? null,
        shots_on_target: as_['AST'] ?? null,
        shots_off_target: as_['AS'] != null && as_['AST'] != null ? as_['AS'] - as_['AST'] : null,
        corners: as_['AC'] ?? null,
        fouls: as_['AF'] ?? null,
        yellow_cards: as_['AY'] ?? null,
        red_cards: as_['AR'] ?? null,
      });
    }
    for (let i = 0; i < statRows.length; i += CHUNK) {
      const plan = db.sql.match_team_stat.insert(statRows.slice(i, i + CHUNK)).build();
      await db.execute(plan);
    }
  }

  // Accumulate standings
  for (const r of rows) {
    const homeKey = `${info.countryCode}|${r.homeTeam}`;
    const awayKey = `${info.countryCode}|${r.awayTeam}`;
    const hr = r.result === 'H' ? 'W' : r.result === 'A' ? 'L' : 'D';
    const ar = r.result === 'A' ? 'W' : r.result === 'H' ? 'L' : 'D';
    bumpStandings(standings, homeKey, r.homeScore, r.awayScore, hr);
    bumpStandings(standings, awayKey, r.awayScore, r.homeScore, ar);
  }

  if (!dryRun) await persistStandings(seasonId, leagueId, standings);

  return {
    leagueCode,
    startYear,
    imported: toInsert.length,
    total: rows.length,
    skipped: false,
  };
}

async function main() {
  const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
  const requested = seasonsFlag ? years.slice(-seasonsFlag) : years;

  console.log(
    `Importing ${leagueCodes.length} leagues, ${requested.length} seasons (${requested[0]}–${requested[requested.length - 1]})${dryRun ? ' [dry-run]' : ''}`,
  );

  let filesOk = 0;
  let matches = 0;
  for (const code of leagueCodes) {
    let leagueFiles = 0;
    for (const y of requested) {
      const res = await importFile(code, y);
      if (!res.skipped) {
        filesOk++;
        leagueFiles++;
        matches += res.imported;
        if (res.imported || res.total) {
          console.log(
            `${code} ${y}/${String((y + 1) % 100).padStart(2, '0')}: ${res.imported} new / ${res.total ?? 0} matches`,
          );
        }
      }
    }
    if (!leagueFiles) console.log(`${code}: no data found`);
  }

  // /new/<CODE>.csv countries (different format, league names embedded per row)
  for (const code of Object.keys(NEW_SOURCES)) {
    const res = await importNewCountry(code);
    if (res.files) {
      filesOk += res.files;
      matches += res.matches;
      console.log(`${code}: ${res.files} league-season files, ${res.matches} new matches`);
    } else {
      console.log(`${code}: no data found`);
    }
  }

  // Mark current season per league
  if (!dryRun) {
    for (const leagueId of leagueIds.values()) {
      const seasons = await db.orm.Season.where({ leagueId }).all();
      const latest = seasons.reduce((a, b) => (a.year > b.year ? a : b));
      for (const s of seasons) {
        if (s.current !== (s.id === latest.id)) {
          await db.orm.Season.where({ id: s.id }).update({
            current: s.id === latest.id,
          });
        }
      }
    }
  }

  console.log(`Done. ${filesOk} season files processed, ${matches} matches inserted.`);
  await db.close();
}

main().catch(async (e) => {
  console.error(e);
  await db.close();
  process.exit(1);
});
