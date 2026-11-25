#!/usr/bin/env node
// Imports UEFA/AFC club competition matches from ESPN's public scoreboard API
// (https://site.api.espn.com — no key required).
//
// Usage:
//   node scripts/import-espn.ts [--leagues uefa.champions,...] [--from 2001]
//                               [--to 2026] [--dry-run]
//
// Populates: League, Season, Team, Match. Player-level data is not available
// from this source. Idempotent via Match.externalId (`espn:<event-id>`), plus a
// same-season/same-teams/same-date fixture check so matches already imported
// from other sources (e.g. StatsBomb finals) are not duplicated.
//
// Notes on coverage:
// - `afc.champions` mixes the old AFC Champions League with the Elite era under
//   one slug; events before MIN_DATE are skipped.
// - ESPN's scoreboard caps at 400 events per `dates=YYYY` query; years that hit
//   the cap are topped up with per-day queries for the remaining dates.

import { db } from '../src/prisma/db.ts';

// ---------- CLI args ----------
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

interface Competition {
  // League to attach matches to. `reuseName` matches an existing League row;
  // otherwise a new league is created with `name`/`code`/`countryCode`.
  reuseName?: string;
  name?: string;
  code?: string;
  countryName?: string;
  countryCode?: string;
  minYear: number;
  minDate?: string; // ISO date; events before this are skipped
}

const COMPETITIONS: Record<string, Competition> = {
  'uefa.champions': {
    reuseName: 'Champions League',
    minYear: 2001,
  },
  'uefa.europa': {
    reuseName: 'UEFA Europa League',
    minYear: 2009,
  },
  'uefa.europa.conf': {
    name: 'UEFA Conference League',
    code: 'UEFA-ECL',
    countryName: 'Europe',
    countryCode: 'EUROPE',
    minYear: 2021,
  },
  'afc.champions': {
    name: 'AFC Champions League Elite',
    code: 'AFC-ACLE',
    countryName: 'Asia',
    countryCode: 'ASIA',
    minYear: 2024,
    minDate: '2024-08-01', // Elite era starts with the 2024/25 league stage
  },
};

const selected = (arg('leagues') ?? Object.keys(COMPETITIONS).join(','))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => COMPETITIONS[s]);
const unknown = (arg('leagues') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s && !COMPETITIONS[s]);
if (unknown.length) console.warn(`Unknown leagues skipped: ${unknown.join(', ')}`);

const fromYear = Number(arg('from') ?? 0) || undefined;
const toYear = Number(arg('to') ?? new Date().getFullYear());
const dryRun = has('dry-run');
const PAGE_LIMIT = 400;
const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// ---------- ESPN types ----------
interface EspnTeam {
  id: string;
  displayName: string;
  name?: string;
  location?: string;
}
interface EspnCompetitor {
  homeAway: 'home' | 'away';
  score?: string;
  shootoutScore?: number;
  winner?: boolean;
  team: EspnTeam;
}
interface EspnEvent {
  id: string;
  date: string;
  name?: string;
  season?: { year?: number; slug?: string; displayName?: string };
  status?: {
    type?: {
      completed?: boolean;
      name?: string;
      detail?: string;
    };
  };
  competitions?: {
    competitors?: EspnCompetitor[];
    notes?: { headline?: string; text?: string }[];
    series?: { title?: string };
  }[];
}

// ---------- fetch ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchScoreboard(slug: string, dates: string): Promise<EspnEvent[]> {
  const url = `${API}/${slug}/scoreboard?dates=${dates}&limit=${PAGE_LIMIT}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'soccers-import/1.0' },
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        console.warn(`  ! ${res.status} for ${slug}?dates=${dates}`);
        return [];
      }
      const data = (await res.json()) as { events?: EspnEvent[] };
      return data.events ?? [];
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return [];
}

// Fetch a full calendar year, topping up with per-day queries when the 400
// event cap truncates the tail.
async function fetchYear(slug: string, year: number): Promise<EspnEvent[]> {
  const events = await fetchScoreboard(slug, String(year));
  await sleep(150);
  if (events.length < PAGE_LIMIT) return events;

  const seen = new Set(events.map((e) => e.id));
  const lastDate = events
    .map((e) => e.date.slice(0, 10))
    .sort()
    .at(-1)!;
  console.log(
    `  ${slug} ${year}: hit ${PAGE_LIMIT}-event cap (last ${lastDate}), fetching tail by day`,
  );
  const cursor = new Date(`${lastDate}T00:00:00Z`);
  const end = new Date(Date.UTC(year, 11, 31));
  while (cursor <= end) {
    const ymd = cursor.toISOString().slice(0, 10).replaceAll('-', '');
    const dayEvents = await fetchScoreboard(slug, ymd);
    await sleep(120);
    let added = 0;
    for (const e of dayEvents) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        events.push(e);
        added++;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    // Stop after a week of empty days — nothing left in the year
    if (added === 0 && cursor.getTime() - new Date(`${lastDate}T00:00:00Z`).getTime() > 7 * 864e5)
      break;
  }
  return events;
}

// ---------- entity caches ----------
const countryIds = new Map<string, number>();
const leagueIds = new Map<string, number>();
const teamIds = new Map<string, number>(); // key: espn team id, then name
const teamNameById = new Map<number, string>();
const seasonIds = new Map<string, number>(); // key: `${slug}|${seasonYear}`

const normTeamName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

async function loadTeamNames(): Promise<void> {
  if (teamNameById.size) return;
  const rows = await db.orm.Team.all();
  for (const t of rows) teamNameById.set(t.id, t.name);
}

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

async function ensureLeague(slug: string, comp: Competition): Promise<number> {
  const hit = leagueIds.get(slug);
  if (hit) return hit;
  let row = comp.reuseName
    ? await db.orm.League.first({ name: comp.reuseName })
    : await db.orm.League.first({ code: comp.code! });
  if (!row) {
    const countryId = await ensureCountry(comp.countryCode!, comp.countryName!);
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.League.create({
          name: comp.name!,
          code: comp.code!,
          type: 'CUP',
          countryId,
          externalId: `espn:${slug}`,
        });
  }
  leagueIds.set(slug, row.id);
  return row.id;
}

async function ensureSeason(slug: string, leagueId: number, year: number): Promise<number> {
  const key = `${slug}|${year}`;
  const hit = seasonIds.get(key);
  if (hit) return hit;
  // Match the StatsBomb UEFA convention: "2018/2019" with year = start year.
  const name = `${year}/${year + 1}`;
  let row = await db.orm.Season.first({ leagueId, year });
  if (!row) {
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.Season.create({
          leagueId,
          year,
          name,
          startDate: new Date(Date.UTC(year, 6, 1)),
          endDate: new Date(Date.UTC(year + 1, 5, 30)),
        });
  }
  seasonIds.set(key, row.id);
  return row.id;
}

// Resolve an ESPN team to a Team row: prefer an existing team with the same
// name (links European fixtures to domestic-league teams), else create one
// keyed by the ESPN team id.
async function ensureTeam(espnId: string, name: string): Promise<number> {
  const byId = teamIds.get(`id:${espnId}`);
  if (byId) return byId;
  const byName = teamIds.get(`name:${name}`);
  if (byName) {
    teamIds.set(`id:${espnId}`, byName);
    return byName;
  }

  let row = await db.orm.Team.first({ name });
  if (!row) {
    const byExt = await db.orm.Team.first({ externalId: `espn:${espnId}` });
    row = byExt ?? null;
  }
  if (!row) {
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.Team.create({
          name,
          externalId: `espn:${espnId}`,
          code:
            name
              .replace(/[^A-Za-z0-9]/g, '')
              .slice(0, 3)
              .toUpperCase() || undefined,
        });
  }
  teamIds.set(`id:${espnId}`, row.id);
  // Also cache by name so repeat lookups with a different ESPN id for the same
  // club name resolve to the same row.
  teamIds.set(`name:${name}`, row.id);
  return row.id;
}

// ---------- main ----------
interface RawMatch {
  extId: string;
  date: Date;
  seasonYear: number;
  round: string | null;
  status: 'FINISHED' | 'SCHEDULED';
  homeEspnId: string;
  homeName: string;
  awayEspnId: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  homePen: number | null;
  awayPen: number | null;
}

function parseEvent(e: EspnEvent, comp: Competition): RawMatch | null {
  const competition = e.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  const date = new Date(e.date);
  if (comp.minDate && e.date.slice(0, 10) < comp.minDate) return null;

  const toScore = (v?: string) => {
    if (v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    extId: `espn:${e.id}`,
    date,
    seasonYear: e.season?.year ?? date.getUTCFullYear(),
    round:
      e.season?.slug ?? competition?.series?.title ?? competition?.notes?.[0]?.headline ?? null,
    status: e.status?.type?.completed ? 'FINISHED' : 'SCHEDULED',
    homeEspnId: home.team.id,
    homeName: home.team.displayName,
    awayEspnId: away.team.id,
    awayName: away.team.displayName,
    homeScore: toScore(home.score),
    awayScore: toScore(away.score),
    homePen: home.shootoutScore ?? null,
    awayPen: away.shootoutScore ?? null,
  };
}

async function importCompetition(slug: string, comp: Competition) {
  const leagueId = await ensureLeague(slug, comp);
  const start = fromYear ?? comp.minYear;
  let total = 0;
  let skippedExisting = 0;

  for (let year = start; year <= toYear; year++) {
    const events = await fetchYear(slug, year);
    const rows = events.map((e) => parseEvent(e, comp)).filter((r): r is RawMatch => r !== null);
    if (!rows.length) continue;

    // Group by ESPN season year (start year of the European season).
    const bySeason = new Map<number, RawMatch[]>();
    for (const r of rows) {
      const list = bySeason.get(r.seasonYear) ?? [];
      list.push(r);
      bySeason.set(r.seasonYear, list);
    }

    for (const [seasonYear, seasonRows] of bySeason) {
      const seasonId = await ensureSeason(slug, leagueId, seasonYear);

      // Resolve teams once per season batch.
      const homeIds = new Map<string, number>();
      const awayIds = new Map<string, number>();
      for (const r of seasonRows) {
        if (!homeIds.has(r.homeEspnId))
          homeIds.set(r.homeEspnId, await ensureTeam(r.homeEspnId, r.homeName));
        if (!awayIds.has(r.awayEspnId))
          awayIds.set(r.awayEspnId, await ensureTeam(r.awayEspnId, r.awayName));
      }

      // Idempotency: external ids + fixture-level dedupe (same season, same
      // teams, same UTC date) so matches from other sources aren't duplicated.
      // Teams are compared by normalised name, not id — the same club can have
      // multiple Team rows (e.g. StatsBomb vs football-data imports).
      await loadTeamNames();
      const existing = await db.orm.Match.where({ seasonId })
        .select('id', 'externalId', 'date', 'homeTeamId', 'awayTeamId')
        .all();
      const existingExt = new Set(existing.map((m) => m.externalId));
      const existingFixtures = new Set(
        existing
          .filter((m) => teamNameById.has(m.homeTeamId) && teamNameById.has(m.awayTeamId))
          .map(
            (m) =>
              `${normTeamName(teamNameById.get(m.homeTeamId)!)}|${normTeamName(teamNameById.get(m.awayTeamId)!)}|${new Date(m.date).toISOString().slice(0, 10)}`,
          ),
      );

      const toInsert = seasonRows.filter((r) => {
        if (existingExt.has(r.extId)) {
          skippedExisting++;
          return false;
        }
        const fixtureKey = `${normTeamName(r.homeName)}|${normTeamName(r.awayName)}|${r.date.toISOString().slice(0, 10)}`;
        if (existingFixtures.has(fixtureKey)) {
          skippedExisting++;
          return false;
        }
        return true;
      });

      const CHUNK = 200;
      for (let i = 0; i < toInsert.length && !dryRun; i += CHUNK) {
        const slice = toInsert.slice(i, i + CHUNK);
        const plan = db.sql.match
          .insert(
            slice.map((r) => ({
              external_id: r.extId,
              round: r.round,
              date: r.date,
              status: r.status,
              season_id: seasonId,
              home_team_id: homeIds.get(r.homeEspnId)!,
              away_team_id: awayIds.get(r.awayEspnId)!,
              home_score: r.homeScore,
              away_score: r.awayScore,
              home_pen_score: r.homePen,
              away_pen_score: r.awayPen,
            })),
          )
          .build();
        await db.execute(plan);
      }
      total += toInsert.length;
      console.log(
        `  ${slug} ${seasonYear}: ${seasonRows.length} events, ${toInsert.length} new (${skippedExisting} already present)`,
      );
    }
  }
  return { slug, matches: total, skippedExisting };
}

// ---------- run ----------
const results = [];
for (const slug of selected) {
  const comp = COMPETITIONS[slug];
  console.log(`Importing ${slug} (${comp.minYear}→${toYear})${dryRun ? ' [dry-run]' : ''}`);
  results.push(await importCompetition(slug, comp));
}

for (const r of results) {
  console.log(`${r.slug}: ${r.matches} matches imported, ${r.skippedExisting} skipped as existing`);
}
