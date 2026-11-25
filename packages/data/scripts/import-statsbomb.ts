#!/usr/bin/env node
// Imports StatsBomb open-data (github.com/hudl/open-data) into the Prisma 8 SQLite db.
//
// Downloads the repo tarball once (~1.3 GB compressed), streams it through a tar
// parser and processes matches/events/lineups in memory — no per-file HTTP requests.
// Events JSON totals ~13 GB so raw events are never stored; only compact
// per-match aggregates are kept.
//
// Usage:
//   node --max-old-space-size=8192 scripts/import-statsbomb.ts [--competitions 2,11,43] [--dry-run]
//
// Populates: League, Season, Country, Team, Venue, Referee, Manager, TeamManager,
// Player, Match, MatchLineup, Goal, MatchEvent, MatchTeamStat, PlayerMatchStat,
// Standing.
// Matches that duplicate football-data.co.uk fixtures are linked to the existing
// Match row (events/lineups attach to it) instead of creating a second fixture.

import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { db } from '../src/prisma/db.ts';

const TARBALL = 'https://codeload.github.com/hudl/open-data/tar.gz/refs/heads/master';

// StatsBomb competition names that map onto leagues already imported from
// football-data.co.uk — reuse those league codes so seasons/standings unify.
const LEAGUE_CODE_MAP: Record<string, string> = {
  'Premier League': 'E0',
  'La Liga': 'SP1',
  'Serie A': 'I1',
  '1. Bundesliga': 'D1',
  'Ligue 1': 'F1',
};

const COUNTRY_CODES: Record<string, string> = {
  England: 'ENG',
  Scotland: 'SCO',
  Wales: 'WAL',
  'Northern Ireland': 'NIR',
  Ireland: 'IRL',
  Germany: 'GER',
  Spain: 'ESP',
  Italy: 'ITA',
  France: 'FRA',
  Netherlands: 'NED',
  Belgium: 'BEL',
  Portugal: 'POR',
  Turkey: 'TUR',
  Greece: 'GRE',
  Argentina: 'ARG',
  Austria: 'AUT',
  Brazil: 'BRA',
  China: 'CHN',
  Denmark: 'DNK',
  Finland: 'FIN',
  Japan: 'JPN',
  Mexico: 'MEX',
  Norway: 'NOR',
  Poland: 'POL',
  Romania: 'ROU',
  Russia: 'RUS',
  Sweden: 'SWE',
  Switzerland: 'SUI',
  USA: 'USA',
  'United States': 'USA',
  India: 'IND',
  'Saudi Arabia': 'KSA',
};

// ---------- CLI ----------
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const compFilter = arg('competitions')
  ?.split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n));
const dryRun = has('dry-run');

// ---------- helpers ----------
const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

const TEAM_STOP_TOKENS = new Set([
  'fc',
  'cf',
  'afc',
  'ac',
  'as',
  'sc',
  'ssc',
  'ud',
  'rc',
  'cd',
  'ca',
  'fk',
  'sk',
  'if',
  'ik',
  'bk',
  'vfb',
  'vfl',
  'tsg',
  'rb',
  'sd',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'club',
  'deportivo',
]);

function normTeamName(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !TEAM_STOP_TOKENS.has(t))
    .join(' ');
}

function mapPosition(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('goalkeeper') || n.includes('goal keeper')) return 'GOALKEEPER';
  if (n.includes('second striker')) return 'SECOND_STRIKER';
  if (n.includes('striker') || n.includes('center forward') || n === 'forward') return 'STRIKER';
  if (n.includes('wing')) return 'WINGER';
  if (n.includes('attacking midfield')) return 'ATTACKING_MIDFIELD';
  if (n.includes('defensive midfield')) return 'DEFENSIVE_MIDFIELD';
  if (n.includes('midfield') || n.includes('midfielder')) return 'CENTRAL_MIDFIELD';
  if (n.includes('center back') || n.includes('centre back')) return 'CENTER_BACK';
  if (n.includes('back') || n.includes('defender') || n.includes('full-back')) return 'FULL_BACK';
  if (n.includes('forward')) return 'FORWARD';
  if (n.includes('midfield')) return 'MIDFIELDER';
  if (n.includes('defen')) return 'DEFENDER';
  return null;
}

const toGoalType = (
  shotType: string | undefined,
  body: string | undefined,
  tech: string | undefined,
) => {
  const t = (shotType ?? '').toLowerCase();
  const b = (body ?? '').toLowerCase();
  const c = (tech ?? '').toLowerCase();
  if (t.includes('penalty')) return 'PENALTY';
  if (t.includes('free kick')) return 'FREE_KICK';
  if (b === 'head') return 'HEADER';
  if (c.includes('volley')) return 'VOLLEY';
  return 'OPEN_PLAY';
};

const seasonStartYear = (name: string): number => {
  const m = name.match(/(\d{4})/);
  return m ? Number(m[1]) : new Date().getFullYear();
};

const addedMinute = (period: number, minute: number) =>
  period === 1 && minute > 45 ? minute - 45 : period === 2 && minute > 90 ? minute - 90 : null;

// ---------- tar.gz streaming ----------
interface TarEntry {
  path: string;
  chunks: Buffer[];
}

async function* tarEntries(stream: Readable): AsyncGenerator<TarEntry> {
  let buf = Buffer.alloc(0);
  let pending: { path: string; size: number; type: string } | null = null;
  let longName: string | null = null;
  let paxPath: string | null = null;
  let contentLeft = 0;
  let contentChunks: Buffer[] = [];

  const readHeader = (b: Buffer) => ({
    name: b.subarray(0, 100).toString('utf8').replace(/\0.*$/, ''),
    size: parseInt(b.subarray(124, 136).toString('utf8').trim() || '0', 8),
    type: String.fromCharCode(b[156] || 48),
    prefix: b.subarray(345, 500).toString('utf8').replace(/\0.*$/, ''),
  });

  for await (const chunk of stream) {
    buf = Buffer.concat([buf, chunk as Buffer]);
    for (;;) {
      if (pending === null) {
        if (buf.length < 512) break;
        if (buf.subarray(0, 512).every((v) => v === 0)) {
          buf = buf.subarray(512);
          continue;
        }
        const h = readHeader(buf);
        // GNU longname / pax extended header: content applies to the NEXT entry.
        // Wait until the whole record is buffered before consuming anything.
        if (h.type === 'L' || h.type === 'x') {
          const pad = (512 - (h.size % 512)) % 512;
          if (buf.length < 512 + h.size + pad) break;
          const data = buf.subarray(512, 512 + h.size);
          if (h.type === 'L') {
            longName = data.toString('utf8').replace(/\0.*$/, '');
          } else {
            const m = data.toString('utf8').match(/path=([^\n]+)/);
            if (m) paxPath = m[1];
          }
          buf = buf.subarray(512 + h.size + pad);
          continue;
        }
        const full = h.prefix ? `${h.prefix}/${h.name}` : h.name;
        pending = { path: paxPath ?? longName ?? full, size: h.size, type: h.type };
        paxPath = null;
        longName = null;
        contentLeft = h.size;
        contentChunks = [];
        buf = buf.subarray(512);
      } else {
        if (buf.length === 0) break; // need more data from the stream
        const avail = Math.min(contentLeft, buf.length);
        if (avail <= 0) {
          if (contentLeft === 0) {
            const pad = (512 - (pending.size % 512)) % 512;
            if (buf.length < pad) break;
            buf = buf.subarray(pad);
            if (pending.type === '0' || pending.type === '\0' || pending.type === '') {
              yield { path: pending.path, chunks: contentChunks };
            }
            pending = null;
          }
          continue;
        }
        contentChunks.push(buf.subarray(0, avail));
        buf = buf.subarray(avail);
        contentLeft -= avail;
      }
    }
  }
  const last = pending as { path: string; size: number; type: string } | null;
  if (last && contentLeft === 0 && (last.type === '0' || last.type === '\0' || last.type === '')) {
    yield { path: last.path, chunks: contentChunks };
  }
}

// ---------- StatsBomb shapes (loose) ----------
interface SbComp {
  competition_id: number;
  season_id: number;
  country_name: string | null;
  competition_name: string;
  competition_gender: string;
  competition_international: boolean;
  season_name: string;
}
interface SbMatch {
  match_id: number;
  match_date: string;
  kick_off: string | null;
  competition: { competition_id: number; country_name: string | null; competition_name: string };
  season: { season_id: number; season_name: string };
  home_team: SbSide;
  away_team: SbSide;
  home_score: number | null;
  away_score: number | null;
  match_status: string;
  match_week: number | null;
  competition_stage: { id: number; name: string } | null;
  stadium: { id: number; name: string; country: { id: number; name: string } | null } | null;
  referee: { id: number; name: string; country: { id: number; name: string } | null } | null;
}
interface SbSide {
  home_team_id?: number;
  away_team_id?: number;
  home_team_name?: string;
  away_team_name?: string;
  country?: { id: number; name: string } | null;
  managers?: {
    id: number;
    name: string;
    dob: string | null;
    country: { id: number; name: string } | null;
  }[];
}
interface SbEvent {
  id: string;
  period: number;
  minute: number;
  type: { id: number; name: string };
  team: { id: number; name: string } | null;
  player: { id: number; name: string } | null;
  position?: { id: number; name: string };
  shot?: {
    outcome?: { id: number; name: string };
    type?: { id: number; name: string };
    body_part?: { id: number; name: string };
    technique?: { id: number; name: string };
    statsbomb_xg?: number;
    key_pass_id?: string;
  };
  pass?: { outcome?: { id: number; name: string } };
  bad_behaviour?: { card?: { id: number; name: string } };
  substitution?: {
    outcome?: { id: number; name: string };
    replacement?: { id: number; name: string } | null;
  };
  duel?: { outcome?: { id: number; name: string } };
  goalkeeper?: { type?: { id: number; name: string } };
}
interface SbLineupEntry {
  player_id: number;
  player_name: string;
  jersey_number?: number | null;
  country?: { id: number; name: string } | null;
  positions?: {
    position?: string;
    from?: string | null;
    to?: string | null;
    start_reason?: string | null;
  }[];
}
interface SbLineupTeam {
  team_id: number;
  team_name: string;
  lineup: SbLineupEntry[];
}

// ---------- per-match aggregates ----------
interface PlayerAgg {
  id: number;
  name: string;
  teamId: number;
  position?: string;
  goals: number;
  assists: number;
  shots: number;
  sot: number;
  xg: number;
  passes: number;
  passComplete: number;
  keyPasses: number;
  interceptions: number;
  duelsWon: number;
  duelsLost: number;
  foulsCommitted: number;
  foulsDrawn: number;
  yellow: number;
  red: number;
  saves: number;
  goalsConceded: number;
  isGK: boolean;
}
interface TeamAgg {
  shots: number;
  sot: number;
  off: number;
  blocked: number;
  xg: number;
  fouls: number;
  offsides: number;
  yellow: number;
  red: number;
  passes: number;
  passComplete: number;
}
interface GoalRow {
  teamId: number;
  scorerId: number;
  assistId: number | null;
  minute: number;
  added: number | null;
  type: string;
  desc: string | null;
}
interface EventRow {
  teamId: number | null;
  playerId: number | null;
  relatedId: number | null;
  type: 'YELLOW_CARD' | 'SECOND_YELLOW' | 'RED_CARD' | 'SUBSTITUTION' | 'INJURY';
  minute: number;
  added: number | null;
  detail: string | null;
}
interface LineupInfo {
  minutes: number | null;
  starter: boolean;
  shirt: number | null;
  position: string | null;
}
interface MatchBundle {
  goals: GoalRow[];
  events: EventRow[];
  teamAgg: Map<number, TeamAgg>;
  playerAgg: Map<number, PlayerAgg>;
  lineup: { teamId: number; players: SbLineupEntry[] }[] | null;
  minutes: Map<number, LineupInfo>;
}

const newPlayerAgg = (id: number, name: string, teamId: number): PlayerAgg => ({
  id,
  name,
  teamId,
  goals: 0,
  assists: 0,
  shots: 0,
  sot: 0,
  xg: 0,
  passes: 0,
  passComplete: 0,
  keyPasses: 0,
  interceptions: 0,
  duelsWon: 0,
  duelsLost: 0,
  foulsCommitted: 0,
  foulsDrawn: 0,
  yellow: 0,
  red: 0,
  saves: 0,
  goalsConceded: 0,
  isGK: false,
});
const newTeamAgg = (): TeamAgg => ({
  shots: 0,
  sot: 0,
  off: 0,
  blocked: 0,
  xg: 0,
  fouls: 0,
  offsides: 0,
  yellow: 0,
  red: 0,
  passes: 0,
  passComplete: 0,
});

function processEvents(events: SbEvent[]): MatchBundle {
  const bundle: MatchBundle = {
    goals: [],
    events: [],
    teamAgg: new Map(),
    playerAgg: new Map(),
    lineup: null,
    minutes: new Map(),
  };
  const byId = new Map(events.map((e) => [e.id, e]));
  const keyPassIds = new Set<string>();
  for (const e of events) {
    if (e.type.name === 'Shot' && e.shot?.key_pass_id) keyPassIds.add(e.shot.key_pass_id);
  }
  const tag = (teamId: number) => {
    let t = bundle.teamAgg.get(teamId);
    if (!t) {
      t = newTeamAgg();
      bundle.teamAgg.set(teamId, t);
    }
    return t;
  };
  const player = (e: SbEvent): PlayerAgg | null => {
    if (!e.player) return null;
    const tid = e.team?.id ?? 0;
    let p = bundle.playerAgg.get(e.player.id);
    if (!p) {
      p = newPlayerAgg(e.player.id, e.player.name, tid);
      bundle.playerAgg.set(e.player.id, p);
    }
    if (e.position?.name && !p.position) p.position = e.position.name;
    return p;
  };
  const goal = (
    e: SbEvent,
    s: NonNullable<SbEvent['shot']>,
    tid: number,
    assistEvent: SbEvent | undefined,
  ) => {
    bundle.goals.push({
      teamId: tid,
      scorerId: e.player!.id,
      assistId: assistEvent?.player?.id ?? null,
      minute: e.minute,
      added: addedMinute(e.period, e.minute),
      type: toGoalType(s.type?.name, s.body_part?.name, s.technique?.name),
      desc: s.type?.name ?? null,
    });
    if (assistEvent?.player) {
      const ap = player(assistEvent);
      if (ap) ap.assists++;
    }
  };

  for (const e of events) {
    const tid = e.team?.id ?? null;
    const tn = e.type.name;
    const p = player(e);

    if (tn === 'Shot' && e.shot) {
      const s = e.shot;
      const outcome = s.outcome?.name ?? '';
      const isGoal = outcome === 'Goal';
      // StatsBomb outcomes: Goal, Saved, Post (on target); Off T, Wayward (off);
      // Blocked; anything else unclassified.
      const onTarget = outcome === 'Goal' || outcome === 'Saved' || outcome === 'Post';
      const offTarget = outcome === 'Off T' || outcome === 'Wayward';
      if (tid != null) {
        const t = tag(tid);
        t.shots++;
        t.xg += s.statsbomb_xg ?? 0;
        if (onTarget) t.sot++;
        else if (offTarget) t.off++;
        else if (outcome === 'Blocked') t.blocked++;
      }
      if (p) {
        p.shots++;
        p.xg += s.statsbomb_xg ?? 0;
        if (onTarget) p.sot++;
        if (isGoal && tid != null && e.player) {
          p.goals++;
          const kp = s.key_pass_id ? byId.get(s.key_pass_id) : undefined;
          const assistEvent =
            kp?.player && kp.team?.id === tid && kp.type.name === 'Pass' ? kp : undefined;
          goal(e, s, tid, assistEvent);
        }
      }
    } else if (tn === 'Pass' && e.pass) {
      // StatsBomb only records an outcome for unsuccessful passes —
      // no outcome means the pass was completed.
      const outcome = e.pass.outcome?.name;
      const complete =
        outcome == null || outcome === 'Complete' || outcome === 'Assist' || outcome === 'Goal';
      if (tid != null) {
        const t = tag(tid);
        t.passes++;
        if (complete) t.passComplete++;
      }
      if (p) {
        p.passes++;
        if (complete) p.passComplete++;
        if (keyPassIds.has(e.id)) p.keyPasses++;
      }
    } else if (tn === 'Bad Behaviour' && e.bad_behaviour?.card) {
      const card = e.bad_behaviour.card.name;
      const type = card.includes('Second')
        ? ('SECOND_YELLOW' as const)
        : card.includes('Red')
          ? ('RED_CARD' as const)
          : ('YELLOW_CARD' as const);
      if (p) {
        if (type === 'YELLOW_CARD') p.yellow++;
        else if (type === 'SECOND_YELLOW') {
          p.yellow++;
          p.red++;
        } else p.red++;
      }
      if (tid != null) {
        const t = tag(tid);
        if (type === 'YELLOW_CARD') t.yellow++;
        else if (type === 'SECOND_YELLOW') {
          t.yellow++;
          t.red++;
        } else t.red++;
      }
      bundle.events.push({
        teamId: tid,
        playerId: e.player?.id ?? null,
        relatedId: null,
        type,
        minute: e.minute,
        added: addedMinute(e.period, e.minute),
        detail: card,
      });
    } else if (tn === 'Substitution' && e.substitution) {
      const inPlayer = e.substitution.replacement ?? null;
      if (inPlayer && tid != null) {
        let ip = bundle.playerAgg.get(inPlayer.id);
        if (!ip) {
          ip = newPlayerAgg(inPlayer.id, inPlayer.name, tid);
          bundle.playerAgg.set(inPlayer.id, ip);
        }
      }
      bundle.events.push({
        teamId: tid,
        playerId: e.player?.id ?? null,
        relatedId: inPlayer?.id ?? null,
        type: e.substitution.outcome?.name?.toLowerCase().includes('injur')
          ? 'INJURY'
          : 'SUBSTITUTION',
        minute: e.minute,
        added: addedMinute(e.period, e.minute),
        detail: e.substitution.outcome?.name ?? null,
      });
    } else if (tn === 'Interception') {
      if (p) p.interceptions++;
    } else if (tn === 'Duel' && e.duel?.outcome) {
      if (p) {
        const o = e.duel.outcome.name;
        if (o === 'Won' || o === 'Success In Play') p.duelsWon++;
        else if (o.startsWith('Lost')) p.duelsLost++;
      }
    } else if (tn === 'Foul Committed') {
      if (p) p.foulsCommitted++;
      if (tid != null) tag(tid).fouls++;
    } else if (tn === 'Foul Won') {
      if (p) p.foulsDrawn++;
    } else if (tn === 'Offside') {
      if (tid != null) tag(tid).offsides++;
    } else if (tn === 'Goal Keeper') {
      if (p) {
        p.isGK = true;
        const gkType = e.goalkeeper?.type?.name;
        if (gkType === 'Shot Saved') p.saves++;
        else if (gkType === 'Goal Conceded') p.goalsConceded++;
      }
    }
  }
  return bundle;
}

function processLineups(raw: SbLineupTeam[]): {
  lineup: { teamId: number; players: SbLineupEntry[] }[];
  minutes: Map<number, LineupInfo>;
} {
  const minutes = new Map<number, LineupInfo>();
  const lineup = raw.map((t) => ({ teamId: t.team_id, players: t.lineup ?? [] }));
  for (const t of raw) {
    for (const pl of t.lineup ?? []) {
      const positions = pl.positions ?? [];
      const starter = positions.some((ps) => ps.start_reason === 'Starting XI');
      let end: number | null = null;
      for (const ps of positions) {
        if (ps.to) {
          const mm = parseInt(ps.to.split(':')[0], 10);
          if (Number.isFinite(mm)) end = Math.max(end ?? 0, mm);
        }
      }
      let minutesPlayed: number | null;
      if (positions.length === 0) minutesPlayed = starter ? 90 : 0;
      else if (end === null) minutesPlayed = starter ? 90 : null;
      else minutesPlayed = Math.max(0, end);
      const firstPos = positions.find((ps) => ps.start_reason === 'Starting XI') ?? positions[0];
      minutes.set(pl.player_id, {
        minutes: minutesPlayed,
        starter,
        shirt: pl.jersey_number ?? null,
        position: firstPos?.position ?? null,
      });
    }
  }
  return { lineup, minutes };
}

// ---------- DB helpers ----------
const countryIds = new Map<string, number>();
const leagueIds = new Map<string, number>();
const teamIdsBySbId = new Map<number, number>();
const seasonIds = new Map<string, number>();
const playerIds = new Map<number, number>();
const managerIds = new Map<string, number>();
const venueIds = new Map<string, number>();
const refereeIds = new Map<string, number>();
const normTeamIndex = new Map<string, number>();
const playerTeamLatest = new Map<number, { date: number; teamId: number }>();

async function ensureCountry(name: string | null | undefined): Promise<number | null> {
  if (!name) return null;
  const code =
    COUNTRY_CODES[name] ??
    name
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 12);
  const hit = countryIds.get(code) ?? countryIds.get(`name:${name}`);
  if (hit) return hit;
  // code first, then name — a country may already exist under a different code
  let row = await db.orm.Country.first({ code });
  if (!row) row = await db.orm.Country.first({ name });
  if (!row) row = dryRun ? ({ id: -1 } as never) : await db.orm.Country.create({ name, code });
  countryIds.set(code, row.id);
  countryIds.set(`name:${name}`, row.id);
  return row.id;
}

async function ensureLeague(
  comp: {
    competition_id: number;
    competition_name: string;
    competition_international: boolean;
  },
  countryName: string | null,
): Promise<{ id: number; code: string; isMapped: boolean }> {
  const mapped = LEAGUE_CODE_MAP[comp.competition_name];
  const code = mapped ?? `SB${comp.competition_id}`;
  const hit = leagueIds.get(code);
  if (hit) return { id: hit, code, isMapped: !!mapped };
  let row = await db.orm.League.first({ code });
  if (!row) {
    const countryId = await ensureCountry(countryName);
    const type = comp.competition_international
      ? 'INTERNATIONAL'
      : /cup|copa|champions league|europa league|world cup|euro|afcon/i.test(comp.competition_name)
        ? 'CUP'
        : 'LEAGUE';
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.League.create({
          name: comp.competition_name,
          code,
          type: type as never,
          countryId: countryId ?? undefined,
          externalId: `sb:${comp.competition_id}`,
        });
  }
  leagueIds.set(code, row.id);
  return { id: row.id, code, isMapped: !!mapped };
}

async function ensureSeason(leagueId: number, leagueCode: string, year: number, name: string) {
  const key = `${leagueCode}|${year}`;
  const hit = seasonIds.get(key);
  if (hit) return hit;
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

async function loadNormTeamIndex() {
  for (const t of await db.orm.Team.all()) {
    if (t.countryId == null) continue;
    const n = normTeamName(t.name);
    if (n) normTeamIndex.set(`${t.countryId}|${n}`, t.id);
  }
}

async function ensureTeam(
  sbTeamId: number,
  name: string,
  countryName: string | null | undefined,
): Promise<number> {
  const hit = teamIdsBySbId.get(sbTeamId);
  if (hit) return hit;
  const countryId = await ensureCountry(countryName);
  if (countryId != null) {
    const existing = normTeamIndex.get(`${countryId}|${normTeamName(name)}`);
    if (existing != null) {
      teamIdsBySbId.set(sbTeamId, existing);
      return existing;
    }
  }
  let row =
    countryId == null
      ? await db.orm.Team.first({ name })
      : await db.orm.Team.first({ name, countryId });
  if (!row) {
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.Team.create({
          name,
          countryId: countryId ?? undefined,
          code:
            name
              .replace(/[^A-Za-z0-9]/g, '')
              .slice(0, 3)
              .toUpperCase() || undefined,
          externalId: `sb:${sbTeamId}`,
        });
    if (countryId != null) {
      const n = normTeamName(name);
      if (n) normTeamIndex.set(`${countryId}|${n}`, row.id);
    }
  }
  teamIdsBySbId.set(sbTeamId, row.id);
  return row.id;
}

interface PlayerInfo {
  name: string;
  position: string | null;
  nationality: string | null;
}
const pendingPlayerInfo = new Map<number, PlayerInfo>();

function notePlayer(
  sbId: number,
  name: string,
  position: string | null,
  nationality: string | null,
) {
  const cur = pendingPlayerInfo.get(sbId);
  if (!cur) {
    pendingPlayerInfo.set(sbId, { name, position, nationality });
  } else {
    if (!cur.position && position) cur.position = position;
    if (!cur.nationality && nationality) cur.nationality = nationality;
  }
}

async function ensurePlayer(sbPlayerId: number): Promise<number> {
  const hit = playerIds.get(sbPlayerId);
  if (hit) return hit;
  const info = pendingPlayerInfo.get(sbPlayerId) ?? {
    name: `Player ${sbPlayerId}`,
    position: null,
    nationality: null,
  };
  const nationalityId = await ensureCountry(info.nationality);
  const position = mapPosition(info.position);
  let row = await db.orm.Player.first({ externalId: `sb:${sbPlayerId}` });
  if (!row) {
    row = dryRun
      ? ({ id: -1 } as never)
      : await db.orm.Player.create({
          name: info.name,
          externalId: `sb:${sbPlayerId}`,
          nationalityId: nationalityId ?? undefined,
          position: (position ?? undefined) as never,
        });
  } else if (!dryRun && position && !row.position) {
    await db.orm.Player.where({ id: row.id }).update({ position: position as never });
  }
  playerIds.set(sbPlayerId, row.id);
  return row.id;
}

async function ensureVenue(name: string, countryName?: string | null): Promise<number | null> {
  const hit = venueIds.get(name);
  if (hit) return hit;
  const countryId = await ensureCountry(countryName);
  let row = await db.orm.Venue.first({ name });
  if (!row && !dryRun) row = await db.orm.Venue.create({ name, countryId: countryId ?? undefined });
  if (!row) return null;
  venueIds.set(name, row.id);
  return row.id;
}

async function ensureReferee(name: string, countryName?: string | null): Promise<number | null> {
  const hit = refereeIds.get(name);
  if (hit) return hit;
  const countryId = await ensureCountry(countryName);
  let row = await db.orm.Referee.first({ name });
  if (!row && !dryRun)
    row = await db.orm.Referee.create({ name, countryId: countryId ?? undefined });
  if (!row) return null;
  refereeIds.set(name, row.id);
  return row.id;
}

async function ensureManager(name: string, dob: string | null, countryName?: string | null) {
  const hit = managerIds.get(name);
  if (hit) return hit;
  const nationalityId = await ensureCountry(countryName);
  let row = await db.orm.Manager.first({ name });
  if (!row && !dryRun)
    row = await db.orm.Manager.create({
      name,
      nationalityId: nationalityId ?? undefined,
      dateOfBirth: dob ? new Date(dob) : undefined,
    });
  if (!row) return null;
  managerIds.set(name, row.id);
  return row.id;
}

// ---------- main ----------
interface SbSeasonFile {
  compId: number;
  seasonId: number;
  matches: SbMatch[];
}

async function main() {
  console.log(dryRun ? 'StatsBomb import [dry-run]' : 'StatsBomb import');
  const res = await fetch(TARBALL, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`tarball fetch failed: ${res.status}`);
  console.log('Streaming tarball (this downloads ~1.3 GB once)…');

  const comps = new Map<string, SbComp>();
  const seasonFiles: SbSeasonFile[] = [];
  const bundles = new Map<number, MatchBundle>(); // sb match_id -> bundle
  const lineupData = new Map<
    number,
    { lineup: { teamId: number; players: SbLineupEntry[] }[]; minutes: Map<number, LineupInfo> }
  >();
  let seen = 0;

  const gunzip = createGunzip();
  Readable.fromWeb(res.body as never).pipe(gunzip);

  for await (const entry of tarEntries(gunzip)) {
    seen++;
    const di = entry.path.indexOf('/data/');
    if (di < 0) continue;
    const rel = entry.path.slice(di + 6);
    const buf = Buffer.concat(entry.chunks);

    if (rel === 'competitions.json') {
      // season_id is NOT globally unique — it is shared across competitions
      // (e.g. "2015/2016" has the same season_id for La Liga and the Champions
      // League). Key by the (competition_id, season_id) pair.
      for (const c of JSON.parse(buf.toString()) as SbComp[])
        comps.set(`${c.competition_id}:${c.season_id}`, c);
      continue;
    }
    const evMatch = rel.match(/^events\/(\d+)\.json$/);
    if (evMatch) {
      const id = Number(evMatch[1]);
      if (compFilter) {
        // can't know comp yet; parse anyway (bundles unused if comp filtered out)
      }
      bundles.set(id, processEvents(JSON.parse(buf.toString()) as SbEvent[]));
      continue;
    }
    const luMatch = rel.match(/^lineups\/(\d+)\.json$/);
    if (luMatch) {
      lineupData.set(
        Number(luMatch[1]),
        processLineups(JSON.parse(buf.toString()) as SbLineupTeam[]),
      );
      continue;
    }
    const maMatch = rel.match(/^matches\/(\d+)\/(\d+)\.json$/);
    if (maMatch) {
      const compId = Number(maMatch[1]);
      if (compFilter && !compFilter.includes(compId)) continue;
      seasonFiles.push({
        compId,
        seasonId: Number(maMatch[2]),
        matches: JSON.parse(buf.toString()) as SbMatch[],
      });
      continue;
    }
    // three-sixty etc: discarded
  }
  console.log(
    `Tar done: ${seen} entries, ${comps.size} seasons meta, ${seasonFiles.length} match files, ${bundles.size} event bundles, ${lineupData.size} lineup files`,
  );

  // merge lineups into bundles
  for (const [matchId, lu] of lineupData) {
    const b = bundles.get(matchId);
    if (b) {
      b.lineup = lu.lineup;
      b.minutes = lu.minutes;
    } else {
      bundles.set(matchId, {
        goals: [],
        events: [],
        teamAgg: new Map(),
        playerAgg: new Map(),
        lineup: lu.lineup,
        minutes: lu.minutes,
      });
    }
    for (const t of lu.lineup) {
      for (const pl of t.players) {
        const info = lu.minutes.get(pl.player_id);
        notePlayer(pl.player_id, pl.player_name, info?.position ?? null, pl.country?.name ?? null);
      }
    }
  }
  // note players seen in events
  for (const b of bundles.values()) {
    for (const agg of b.playerAgg.values()) {
      notePlayer(agg.id, agg.name, agg.position ?? null, null);
    }
    for (const g of b.goals) {
      // scorer/assist already in playerAgg via player()
      void g;
    }
  }

  if (!dryRun) await loadNormTeamIndex();

  // ---------- pass 2: resolve matches ----------
  const goalRows: Record<string, unknown>[] = [];
  const eventRows: Record<string, unknown>[] = [];
  const lineupRows: Record<string, unknown>[] = [];
  const pmsRows: Record<string, unknown>[] = [];
  const mtsNewRows: Record<string, unknown>[] = [];
  const mtsXgUpdates: { matchId: number; teamId: number; xg: number }[] = [];
  const matchRows: Record<string, unknown>[] = [];
  const matchLinkUpdates: {
    id: number;
    venueId?: number;
    refereeId?: number;
    matchday?: number;
  }[] = [];
  const teamManagerRows: Record<string, unknown>[] = [];
  const pendingByExt = new Map<
    string,
    { sbMatchId: number; linkedDbId: number | null; ownDbId: number | null; date: Date }
  >();
  const seasonInfo = new Map<number, { leagueId: number; isMapped: boolean }>();
  const tmSeen = new Set<string>();

  let matchesSeen = 0,
    matchesLinked = 0,
    matchesCreated = 0,
    matchesSkipped = 0;

  for (const sf of seasonFiles) {
    const comp = comps.get(`${sf.compId}:${sf.seasonId}`);
    if (!comp) continue;
    const league = await ensureLeague(
      {
        competition_id: comp.competition_id,
        competition_name: comp.competition_name,
        competition_international: comp.competition_international,
      },
      comp.country_name,
    );
    const year = seasonStartYear(comp.season_name);
    const seasonId = await ensureSeason(league.id, league.code, year, comp.season_name);
    seasonInfo.set(seasonId, { leagueId: league.id, isMapped: league.isMapped });

    const existing = await db.orm.Match.where({ seasonId })
      .select(
        'id',
        'externalId',
        'date',
        'homeTeamId',
        'awayTeamId',
        'venueId',
        'refereeId',
        'matchday',
      )
      .all();
    const byKey = new Map<string, (typeof existing)[number]>();
    const byExt = new Map<string, number>();
    const ownExt = new Map<string, number>(); // our own sbm-* matches from previous runs
    for (const m of existing) {
      if (m.externalId?.startsWith('sbm-')) {
        ownExt.set(m.externalId, m.id);
        continue;
      }
      if (m.externalId) byExt.set(m.externalId, m.id);
      const d =
        m.date instanceof Date ? m.date.toISOString().slice(0, 10) : String(m.date).slice(0, 10);
      byKey.set(`${m.homeTeamId}|${m.awayTeamId}|${d}`, m);
    }

    for (const m of sf.matches) {
      matchesSeen++;
      const hs = m.home_score;
      const as_ = m.away_score;
      if (hs == null || as_ == null) {
        matchesSkipped++;
        continue;
      }

      const homeTeamId = await ensureTeam(
        m.home_team.home_team_id!,
        m.home_team.home_team_name ?? '',
        m.home_team.country?.name ?? comp.country_name,
      );
      const awayTeamId = await ensureTeam(
        m.away_team.away_team_id!,
        m.away_team.away_team_name ?? '',
        m.away_team.country?.name ?? comp.country_name,
      );

      const [y, mo, d] = m.match_date.split('-').map(Number);
      const [hh = 12, mm = 0] = (m.kick_off ?? '12:00').split(':').map(Number);
      const date = new Date(Date.UTC(y, mo - 1, d, hh, mm));
      const venueId = m.stadium?.name
        ? await ensureVenue(m.stadium.name, m.stadium.country?.name ?? comp.country_name)
        : null;
      const refereeId = m.referee?.name
        ? await ensureReferee(m.referee.name, m.referee.country?.name ?? comp.country_name)
        : null;

      for (const side of [m.home_team, m.away_team]) {
        for (const mg of side.managers ?? []) {
          const mid = await ensureManager(
            mg.name,
            mg.dob ?? null,
            mg.country?.name ?? comp.country_name,
          );
          if (!mid) continue;
          const tId = side === m.home_team ? homeTeamId : awayTeamId;
          const key = `${tId}|${mid}`;
          if (tmSeen.has(key)) continue;
          tmSeen.add(key);
          const ex = dryRun
            ? null
            : await db.orm.TeamManager.first({ teamId: tId, managerId: mid });
          if (!ex) teamManagerRows.push({ team_id: tId, manager_id: mid, start_date: date });
        }
      }

      const extId = `sbm-${m.match_id}`;
      const linkedObj = byKey.get(`${homeTeamId}|${awayTeamId}|${m.match_date}`);
      const linkedId = linkedObj?.id ?? byExt.get(extId);
      const ownId = linkedId == null ? ownExt.get(extId) : undefined;
      if (linkedId != null) {
        matchLinkUpdates.push({
          id: linkedId,
          venueId: venueId != null && linkedObj?.venueId == null ? venueId : undefined,
          refereeId: refereeId != null && linkedObj?.refereeId == null ? refereeId : undefined,
          matchday:
            m.match_week != null && linkedObj != null && linkedObj.matchday == null
              ? m.match_week
              : undefined,
        });
        pendingByExt.set(extId, {
          sbMatchId: m.match_id,
          linkedDbId: linkedId,
          ownDbId: null,
          date,
        });
        matchesLinked++;
      } else {
        if (ownId == null) {
          matchRows.push({
            external_id: extId,
            date,
            status: 'FINISHED',
            season_id: seasonId,
            home_team_id: homeTeamId,
            away_team_id: awayTeamId,
            home_score: hs,
            away_score: as_,
            matchday: m.match_week ?? null,
            round: m.competition_stage?.name ?? null,
            venue_id: venueId ?? null,
            referee_id: refereeId ?? null,
          });
          matchesCreated++;
        } else {
          matchesLinked++;
        }
        pendingByExt.set(extId, {
          sbMatchId: m.match_id,
          linkedDbId: null,
          ownDbId: ownId ?? null,
          date,
        });
      }
    }
  }
  console.log(
    `Matches: ${matchesSeen} seen, ${matchesCreated} new, ${matchesLinked} linked, ${matchesSkipped} scoreless`,
  );

  // ---------- resolve players (only those appearing in processed matches) ----------
  const neededPlayers = new Set<number>();
  for (const { sbMatchId } of pendingByExt.values()) {
    const b = bundles.get(sbMatchId);
    if (!b) continue;
    for (const id of b.playerAgg.keys()) neededPlayers.add(id);
    if (b.lineup)
      for (const t of b.lineup) for (const pl of t.players) neededPlayers.add(pl.player_id);
    for (const g of b.goals) {
      neededPlayers.add(g.scorerId);
      if (g.assistId != null) neededPlayers.add(g.assistId);
    }
    for (const ev of b.events) {
      if (ev.playerId != null) neededPlayers.add(ev.playerId);
      if (ev.relatedId != null) neededPlayers.add(ev.relatedId);
    }
  }
  for (const sbId of neededPlayers) await ensurePlayer(sbId);
  console.log(`Players: ${playerIds.size} (of ${neededPlayers.size} needed)`);

  // ---------- bulk insert matches, resolve ids ----------
  const CHUNK = 400;
  const extToMatchId = new Map<string, number>();
  if (!dryRun && matchRows.length) {
    for (let i = 0; i < matchRows.length; i += CHUNK) {
      const slice = matchRows.slice(i, i + CHUNK);
      const plan = (
        db.sql.match as unknown as {
          insert: (r: never[]) => { returning: (...c: string[]) => { build: () => unknown } };
        }
      )
        .insert(slice as never)
        .returning('id', 'external_id')
        .build();
      const inserted = (await db.query(plan as never)) as { id: number; external_id: string }[];
      for (const r of inserted) extToMatchId.set(r.external_id, r.id);
    }
  }

  // all processed db match ids -> bulk delete derived rows once.
  // match_team_stat is only refreshed for sb-owned matches (own sbm-* or new);
  // fdc-linked matches keep their football-data stats and only get xG updates.
  const allMatchIds: number[] = [];
  const sbOwnedMatchIds: number[] = [];
  for (const { sbMatchId, linkedDbId, ownDbId } of pendingByExt.values()) {
    const id = linkedDbId ?? ownDbId ?? extToMatchId.get(`sbm-${sbMatchId}`);
    if (id != null && id > 0) {
      allMatchIds.push(id);
      if (linkedDbId == null) sbOwnedMatchIds.push(id);
    }
  }
  if (!dryRun) {
    const sqlAny = db.sql as unknown as Record<
      string,
      {
        delete: () => {
          where: (
            cb: (
              f: Record<string, unknown>,
              fns: { in: (a: unknown, b: unknown[]) => unknown },
            ) => unknown,
          ) => {
            build: () => unknown;
          };
        };
      }
    >;
    for (const tbl of ['goal', 'match_event', 'match_lineup', 'player_match_stat']) {
      for (let i = 0; i < allMatchIds.length; i += 500) {
        const ids = allMatchIds.slice(i, i + 500);
        const plan = sqlAny[tbl]
          .delete()
          .where((f, fns) => fns.in(f['match_id'], ids))
          .build();
        await db.execute(plan as never);
      }
    }
    for (let i = 0; i < sbOwnedMatchIds.length; i += 500) {
      const ids = sbOwnedMatchIds.slice(i, i + 500);
      const plan = sqlAny['match_team_stat']
        .delete()
        .where((f, fns) => fns.in(f['match_id'], ids))
        .build();
      await db.execute(plan as never);
    }
    for (const u of matchLinkUpdates) {
      const data: Record<string, unknown> = {};
      if (u.venueId != null) data.venueId = u.venueId;
      if (u.refereeId != null) data.refereeId = u.refereeId;
      if (u.matchday != null) data.matchday = u.matchday;
      if (Object.keys(data).length) await db.orm.Match.where({ id: u.id }).update(data as never);
    }
  }

  // ---------- pass 3: bundles -> rows ----------
  const pmsSeen = new Set<string>();
  for (const [, { sbMatchId, linkedDbId, ownDbId, date }] of pendingByExt) {
    const matchId = linkedDbId ?? ownDbId ?? extToMatchId.get(`sbm-${sbMatchId}`);
    if (matchId == null || matchId <= 0) continue;
    const bundle = bundles.get(sbMatchId);
    if (!bundle) continue;
    const isLinked = linkedDbId != null;

    for (const g of bundle.goals) {
      const scorerId = playerIds.get(g.scorerId);
      const teamId = teamIdsBySbId.get(g.teamId);
      if (scorerId == null || teamId == null) continue;
      goalRows.push({
        match_id: matchId,
        team_id: teamId,
        scorer_id: scorerId,
        assist_id: g.assistId != null ? (playerIds.get(g.assistId) ?? null) : null,
        minute: g.minute,
        added_minute: g.added,
        type: g.type,
        description: g.desc,
      });
    }
    for (const ev of bundle.events) {
      eventRows.push({
        match_id: matchId,
        team_id: ev.teamId != null ? (teamIdsBySbId.get(ev.teamId) ?? null) : null,
        player_id: ev.playerId != null ? (playerIds.get(ev.playerId) ?? null) : null,
        related_player_id: ev.relatedId != null ? (playerIds.get(ev.relatedId) ?? null) : null,
        type: ev.type,
        minute: ev.minute,
        added_minute: ev.added,
        detail: ev.detail,
      });
    }

    const pushPms = (
      playerId: number,
      teamId: number,
      lu: LineupInfo | undefined,
      agg: PlayerAgg | undefined,
    ) => {
      const key = `${matchId}|${playerId}`;
      if (pmsSeen.has(key)) return;
      pmsSeen.add(key);
      pmsRows.push({
        match_id: matchId,
        player_id: playerId,
        team_id: teamId,
        minutes_played: lu?.minutes ?? null,
        goals: agg?.goals ?? 0,
        assists: agg?.assists ?? 0,
        shots: agg?.shots ?? 0,
        shots_on_target: agg?.sot ?? 0,
        passes: agg?.passes ?? 0,
        pass_accuracy:
          agg && agg.passes ? Math.round((agg.passComplete / agg.passes) * 1000) / 10 : null,
        key_passes: agg?.keyPasses ?? 0,
        interceptions: agg?.interceptions ?? 0,
        duels_won: agg?.duelsWon ?? 0,
        duels_lost: agg?.duelsLost ?? 0,
        fouls_committed: agg?.foulsCommitted ?? 0,
        fouls_drawn: agg?.foulsDrawn ?? 0,
        yellow_cards: agg?.yellow ?? 0,
        red_cards: agg?.red ?? 0,
        saves: agg?.saves ?? 0,
        goals_conceded: agg?.isGK ? agg.goalsConceded || null : null,
      });
    };

    if (bundle.lineup) {
      for (const t of bundle.lineup) {
        const teamId = teamIdsBySbId.get(t.teamId);
        if (teamId == null) continue;
        for (const pl of t.players) {
          const playerId = playerIds.get(pl.player_id);
          if (playerId == null) continue;
          const lu = bundle.minutes.get(pl.player_id);
          lineupRows.push({
            match_id: matchId,
            team_id: teamId,
            player_id: playerId,
            shirt_number: lu?.shirt ?? pl.jersey_number ?? null,
            position: (mapPosition(lu?.position ?? null) ?? undefined) as never,
            status: lu?.starter ? 'STARTER' : 'BENCH',
            minutes_played: lu?.minutes ?? null,
          });
          pushPms(playerId, teamId, lu, bundle.playerAgg.get(pl.player_id));
          const cur = playerTeamLatest.get(pl.player_id);
          if (!cur || date.getTime() > cur.date)
            playerTeamLatest.set(pl.player_id, { date: date.getTime(), teamId });
        }
      }
    }
    for (const agg of bundle.playerAgg.values()) {
      const playerId = playerIds.get(agg.id);
      const teamId = teamIdsBySbId.get(agg.teamId);
      if (playerId == null || teamId == null) continue;
      pushPms(playerId, teamId, bundle.minutes.get(agg.id), agg);
      const cur = playerTeamLatest.get(agg.id);
      if (!cur || date.getTime() > cur.date)
        playerTeamLatest.set(agg.id, { date: date.getTime(), teamId });
    }

    if (!isLinked) {
      for (const [sbTid, agg] of bundle.teamAgg) {
        const teamId = teamIdsBySbId.get(sbTid);
        if (teamId == null) continue;
        mtsNewRows.push({
          match_id: matchId,
          team_id: teamId,
          shots: agg.shots,
          shots_on_target: agg.sot,
          shots_off_target: agg.off,
          shots_blocked: agg.blocked,
          fouls: agg.fouls,
          offsides: agg.offsides,
          yellow_cards: agg.yellow,
          red_cards: agg.red,
          passes: agg.passes,
          pass_accuracy: agg.passes
            ? Math.round((agg.passComplete / agg.passes) * 1000) / 10
            : null,
          expected_goals: Math.round(agg.xg * 1000) / 1000,
        });
      }
    } else {
      for (const [sbTid, agg] of bundle.teamAgg) {
        const teamId = teamIdsBySbId.get(sbTid);
        if (teamId == null) continue;
        mtsXgUpdates.push({ matchId, teamId, xg: Math.round(agg.xg * 1000) / 1000 });
      }
    }
  }

  console.log(
    `Rows: ${matchRows.length} matches, ${goalRows.length} goals, ${eventRows.length} events, ${lineupRows.length} lineup, ${pmsRows.length} player stats, ${mtsNewRows.length} team stats, ${mtsXgUpdates.length} xg updates, ${teamManagerRows.length} team_managers`,
  );

  // ---------- bulk writes ----------
  const exec = async (tbl: string, rows: Record<string, unknown>[]) => {
    if (dryRun || !rows.length) return;
    const sqlAny = db.sql as unknown as Record<
      string,
      { insert: (r: never[]) => { build: () => unknown } }
    >;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const plan = sqlAny[tbl].insert(rows.slice(i, i + CHUNK) as never).build();
      await db.execute(plan as never);
    }
  };

  if (!dryRun) {
    await exec('team_manager', teamManagerRows);
    await exec('match_lineup', lineupRows);
    await exec('goal', goalRows);
    await exec('match_event', eventRows);
    await exec('player_match_stat', pmsRows);
    await exec('match_team_stat', mtsNewRows);
    for (const u of mtsXgUpdates) {
      const ex = await db.orm.MatchTeamStat.first({ matchId: u.matchId, teamId: u.teamId });
      if (ex && ex.expectedGoals == null) {
        await db.orm.MatchTeamStat.where({ id: ex.id }).update({ expectedGoals: u.xg });
      }
    }
  }

  // ---------- standings ----------
  const computeFor = new Set<number>();
  for (const [sid, info] of seasonInfo) {
    if (!info.isMapped) {
      computeFor.add(sid);
      continue;
    }
    const ex = await db.orm.Standing.first({ seasonId: sid });
    if (!ex) computeFor.add(sid);
  }
  console.log(`Standings for ${computeFor.size} seasons`);

  interface St {
    played: number;
    won: number;
    drawn: number;
    lost: number;
    gf: number;
    ga: number;
    pts: number;
    form: string[];
  }
  for (const sid of computeFor) {
    if (dryRun) continue;
    const info = seasonInfo.get(sid);
    if (!info) continue;
    const dbMatches = await db.orm.Match.where({ seasonId: sid })
      .select('homeTeamId', 'awayTeamId', 'homeScore', 'awayScore')
      .all();
    const played = dbMatches.filter((m) => m.homeScore != null && m.awayScore != null);
    if (!played.length) continue;
    const map = new Map<number, St>();
    for (const r of played) {
      const hs = r.homeScore!,
        as_ = r.awayScore!;
      for (const [tid, sf, sa, res] of [
        [r.homeTeamId, hs, as_, hs > as_ ? 'W' : hs < as_ ? 'L' : 'D'],
        [r.awayTeamId, as_, hs, as_ > hs ? 'W' : as_ < hs ? 'L' : 'D'],
      ] as const) {
        let s = map.get(tid);
        if (!s) {
          s = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0, form: [] };
          map.set(tid, s);
        }
        s.played++;
        s.gf += sf;
        s.ga += sa;
        if (res === 'W') {
          s.won++;
          s.pts += 3;
          s.form.push('W');
        } else if (res === 'D') {
          s.drawn++;
          s.pts += 1;
          s.form.push('D');
        } else {
          s.lost++;
          s.form.push('L');
        }
      }
    }
    const sorted = [...map.entries()].sort(
      (a, b) => b[1].pts - a[1].pts || b[1].gf - b[1].ga - (a[1].gf - a[1].ga) || b[1].gf - a[1].gf,
    );
    for (let i = 0; i < sorted.length; i++) {
      const [teamId, s] = sorted[i];
      const data = {
        played: s.played,
        won: s.won,
        drawn: s.drawn,
        lost: s.lost,
        goalsFor: s.gf,
        goalsAgainst: s.ga,
        goalDiff: s.gf - s.ga,
        points: s.pts,
        position: i + 1,
        form: s.form.slice(-5).join(''),
      };
      const ex = await db.orm.Standing.first({ seasonId: sid, teamId });
      if (ex) await db.orm.Standing.where({ id: ex.id }).update(data);
      else
        await db.orm.Standing.create({ seasonId: sid, leagueId: info.leagueId, teamId, ...data });
    }
  }

  // ---------- player currentTeam ----------
  if (!dryRun) {
    for (const [sbPid, latest] of playerTeamLatest) {
      const pid = playerIds.get(sbPid);
      const tid = teamIdsBySbId.get(latest.teamId);
      if (pid == null || tid == null) continue;
      const p = await db.orm.Player.first({ id: pid });
      if (p && p.currentTeamId !== tid) {
        await db.orm.Player.where({ id: pid }).update({ currentTeamId: tid });
      }
    }
  }

  console.log('Done.');
  await db.close();
}

main().catch(async (e) => {
  console.error(e);
  await db.close();
  process.exit(1);
});
