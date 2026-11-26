#!/usr/bin/env node
// Fills player bio fields (date_of_birth, height_cm, weight_kg, preferred_foot)
// from Wikidata. Queries WDQS per citizenship country, matches players by
// normalized name tokens, and only writes NULL fields.
//
// Usage:
//   node scripts/import-player-bios.ts [--dry-run] [--country "Spain"]

import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dryRun = process.argv.includes('--dry-run');
const countryArg = process.argv.includes('--country')
  ? process.argv[process.argv.indexOf('--country') + 1]
  : undefined;

const dbPath = resolve(process.env['DATABASE_URL'] ?? './dev.db');
const db = new DatabaseSync(dbPath);

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'import');
mkdirSync(CACHE_DIR, { recursive: true });
const COUNTRY_CACHE = resolve(CACHE_DIR, 'country-qids.json');
const SEARCH_CACHE = resolve(CACHE_DIR, 'player-searches.jsonl');

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

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(90_000),
    headers: { 'User-Agent': 'soccers-player-bios/1.0', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

interface WbSearchItem {
  id: string;
  label?: string;
  description?: string;
}
interface WbSearch {
  search: WbSearchItem[];
}

async function countryToQid(countryName: string): Promise<string | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(countryName)}&language=en&format=json&limit=5&type=item`;
  const data = await fetchJson<WbSearch>(url);
  const exact = data.search.find((r) => r.label?.toLowerCase() === countryName.toLowerCase());
  if (exact) return exact.id;
  // Prefer sovereign-state descriptions over e.g. U.S. states or cities.
  const sovereign = data.search.find((r) =>
    /country|sovereign state|nation/.test(r.description ?? ''),
  );
  return (sovereign ?? data.search[0])?.id ?? null;
}

interface WbEntities {
  entities: Record<
    string,
    {
      labels?: Record<string, { value: string }>;
      claims?: Record<
        string,
        {
          mainsnak?: {
            datavalue?: { value: unknown };
          };
          qualifiers?: Record<string, { datavalue?: { value: { id?: string } } }[]>;
        }[]
      >;
    }
  >;
}

async function resolveLabels(qids: string[]): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  for (let i = 0; i < qids.length; i += 50) {
    const chunk = qids.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join('|')}&props=labels&languages=en&format=json`;
    const data = await fetchJson<WbEntities>(url);
    for (const [qid, entity] of Object.entries(data.entities ?? {})) {
      const label = entity.labels?.en?.value;
      if (label) labels.set(qid, label);
    }
  }
  return labels;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await sleep(5_000 * (i + 1));
    }
  }
  throw new Error('unreachable');
}

// ---------- Wikidata entity API (fallback when WDQS is unavailable) ----------

interface WbSearchResult {
  id: string;
  label: string;
}

async function searchEntities(name: string): Promise<WbSearchResult[]> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=8&type=item`;
  const data = await withRetry(() => fetchJson<WbSearch>(url));
  return data.search.filter((r) => r.id && r.label).map((r) => ({ id: r.id, label: r.label! }));
}

async function fetchEntityClaims(
  qids: string[],
): Promise<Map<string, NonNullable<WbEntities['entities'][string]>>> {
  const out = new Map<string, NonNullable<WbEntities['entities'][string]>>();
  for (let i = 0; i < qids.length; i += 50) {
    const chunk = qids.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join('|')}&props=claims|labels&languages=en&format=json`;
    const data = await withRetry(() => fetchJson<WbEntities>(url));
    for (const [qid, entity] of Object.entries(data.entities ?? {})) {
      if (entity.claims) out.set(qid, entity);
    }
    await sleep(120);
  }
  return out;
}

interface ApiBio {
  dob?: string;
  height?: number;
  mass?: number;
  foot?: string;
  citizenships: Set<string>;
  fields: number;
}

function claimTime(entity: WbEntities['entities'][string], prop: string): string | undefined {
  const v = entity.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
  return typeof v === 'object' && v !== null && 'time' in v
    ? String((v as { time: string }).time)
        .replace(/^\+/, '')
        .slice(0, 10)
    : undefined;
}

function claimQty(
  entity: WbEntities['entities'][string],
  prop: string,
): { amount: number; unit?: string } | undefined {
  const c = entity.claims?.[prop]?.[0];
  const v = c?.mainsnak?.datavalue?.value;
  if (typeof v !== 'object' || v === null || !('amount' in v)) return undefined;
  const amount = parseFloat(String((v as { amount: string }).amount));
  if (Number.isNaN(amount)) return undefined;
  const unitQid = c?.qualifiers?.P227?.[0]?.datavalue?.value?.id;
  return { amount, unit: unitQid };
}

function claimItem(entity: WbEntities['entities'][string], prop: string): string | undefined {
  const v = entity.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
  return typeof v === 'object' && v !== null && 'id' in v
    ? String((v as { id: string }).id)
    : undefined;
}

function entityBio(
  entity: WbEntities['entities'][string],
  unitLabels: Map<string, string>,
  footLabels: Map<string, string>,
): ApiBio {
  const heightQ = claimQty(entity, 'P2048');
  const massQ = claimQty(entity, 'P2067');
  const footQid = claimItem(entity, 'P8006');
  const bio: ApiBio = {
    dob: claimTime(entity, 'P569'),
    height: heightQ
      ? (convertHeight(heightQ.amount, heightQ.unit ? unitLabels.get(heightQ.unit) : undefined) ??
        undefined)
      : undefined,
    mass: massQ
      ? (convertMass(massQ.amount, massQ.unit ? unitLabels.get(massQ.unit) : undefined) ??
        undefined)
      : undefined,
    foot: footQid ? (mapFoot(footLabels.get(footQid)) ?? undefined) : undefined,
    citizenships: new Set(
      (entity.claims?.P27 ?? [])
        .map((c) => {
          const v = c.mainsnak?.datavalue?.value;
          return typeof v === 'object' && v !== null && 'id' in v
            ? String((v as { id: string }).id)
            : undefined;
        })
        .filter((x): x is string => !!x),
    ),
    fields: 0,
  };
  bio.fields =
    (bio.dob ? 1 : 0) +
    (bio.height != null ? 1 : 0) +
    (bio.mass != null ? 1 : 0) +
    (bio.foot ? 1 : 0);
  return bio;
}

// ---------- Wikidata SPARQL ----------

interface SparqlBinding {
  player: { value: string };
  playerLabel: { value: string };
  citizenship: { value: string };
  dob?: { value: string };
  height?: { value: string };
  heightUnit?: { value: string };
  mass?: { value: string };
  massUnit?: { value: string };
  foot?: { value: string };
  pos?: { value: string };
  posLabel?: { value: string };
}

interface SparqlResponse {
  results: { bindings: SparqlBinding[] };
}

const PAGE_SIZE = 5_000;
const PAGE_DELAY_MS = 3_000;
const BATCH_SIZE = 8;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchFootballers(qids: string[]): Promise<SparqlBinding[]> {
  const values = qids.map((q) => `wd:${q}`).join(' ');
  const all: SparqlBinding[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (offset > 0) await sleep(PAGE_DELAY_MS);
    const query = `
      SELECT ?player ?playerLabel ?citizenship ?dob ?height ?heightUnit ?mass ?massUnit ?foot ?pos ?posLabel
      WHERE {
        VALUES ?citizenship { ${values} }
        ?player wdt:P27 ?citizenship .
        { ?player wdt:P106 wd:Q937857 } UNION { ?player wdt:P413 ?posAny }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        OPTIONAL { ?player wdt:P569 ?dob }
        OPTIONAL {
          ?player p:P2048 ?hs . ?hs ps:P2048 ?height .
          OPTIONAL { ?hs pq:P227 ?heightUnit }
        }
        OPTIONAL {
          ?player p:P2067 ?ws . ?ws ps:P2067 ?mass .
          OPTIONAL { ?ws pq:P227 ?massUnit }
        }
        OPTIONAL { ?player wdt:P8006 ?foot }
        OPTIONAL { ?player wdt:P413 ?pos }
      }
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `;
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    let page: SparqlBinding[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const data = await fetchJson<SparqlResponse>(url, {
          headers: { Accept: 'application/sparql-results+json' },
        });
        page = data.results.bindings;
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        // WDQS rate-limits bursts; back off harder each attempt.
        await sleep(10_000 * (attempt + 1));
      }
    }
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

// ---------- unit normalization ----------

// Order matters: check milli/centi before plain metre ("centimetre" contains
// "metre"), and kilogram before gram.
const HEIGHT_FACTORS: [RegExp, number][] = [
  [/^milli/i, 0.1],
  [/^centi/i, 1],
  [/^met/i, 100],
  [/foot|feet/i, 30.48],
  [/inch/i, 2.54],
];
const MASS_FACTORS: [RegExp, number][] = [
  [/^kilo/i, 1],
  [/^gram/i, 0.001],
  [/^pound/i, 0.45359237],
  [/^stone/i, 6.35029318],
  [/^ounce/i, 0.028349523125],
];

function convertHeight(value: number, unitLabel: string | undefined): number | null {
  if (!unitLabel) return value >= 120 && value <= 230 ? Math.round(value) : null;
  for (const [re, factor] of HEIGHT_FACTORS) {
    if (re.test(unitLabel)) return Math.round(value * factor);
  }
  return null;
}

function convertMass(value: number, unitLabel: string | undefined): number | null {
  if (!unitLabel) return value >= 30 && value <= 150 ? Math.round(value) : null;
  for (const [re, factor] of MASS_FACTORS) {
    if (re.test(unitLabel)) return Math.round(value * factor);
  }
  return null;
}

function mapFoot(label: string | undefined): 'LEFT' | 'RIGHT' | 'BOTH' | null {
  if (!label) return null;
  const l = label.toLowerCase();
  if (/left/.test(l)) return 'LEFT';
  if (/right/.test(l)) return 'RIGHT';
  if (/both|two|either|ambidextr/.test(l)) return 'BOTH';
  return null;
}

// ---------- name matching ----------

interface Candidate {
  qid: string;
  label: string;
  tokens: Set<string>;
  fields: number;
}

function posGroup(pos: string | null): 'GK' | 'DEF' | 'MID' | 'FWD' | null {
  switch (pos) {
    case 'GOALKEEPER':
      return 'GK';
    case 'CENTER_BACK':
    case 'FULL_BACK':
      return 'DEF';
    case 'CENTRAL_MIDFIELD':
    case 'DEFENSIVE_MIDFIELD':
    case 'ATTACKING_MIDFIELD':
      return 'MID';
    case 'STRIKER':
    case 'WINGER':
      return 'FWD';
    default:
      return null;
  }
}

function posCompatible(wdPositions: Set<string>, ourPos: string | null): boolean {
  const group = posGroup(ourPos);
  if (!group || wdPositions.size === 0) return true;
  const re =
    group === 'GK'
      ? /goalkeeper/i
      : group === 'DEF'
        ? /defender/i
        : group === 'MID'
          ? /midfielder/i
          : /forward|striker|winger/i;
  for (const label of wdPositions) {
    if (re.test(label)) return true;
  }
  return false;
}

function bestMatch(
  playerTokens: Set<string>,
  candidates: (Candidate & { positions?: Set<string> })[],
  playerPos: string | null,
): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    if (c.tokens.size === 1 && playerTokens.size > 1) continue;
    let inter = 0;
    for (const t of c.tokens) if (playerTokens.has(t)) inter++;
    const contained = inter === c.tokens.size || inter === playerTokens.size;
    if (!contained || inter === 0) continue;
    const compat = posCompatible(c.positions ?? new Set(), playerPos) ? 1 : 0;
    const score = inter * 100 + Math.min(c.tokens.size, playerTokens.size) + compat;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// ---------- main ----------

interface PlayerRow {
  id: number;
  name: string;
  nationality: string | null;
  position: string | null;
  date_of_birth: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  preferred_foot: string | null;
}

function tokenScore(a: Set<string>, b: Set<string>): number {
  // A single-token candidate ("Ronaldo", "Guerrero") is too ambiguous to match
  // a full name — too many distinct players share mononyms.
  if (b.size === 1 && a.size > 1) return -1;
  let inter = 0;
  for (const t of b) if (a.has(t)) inter++;
  if (inter === 0) return -1;
  const contained = inter === b.size || inter === a.size;
  return contained ? inter * 100 + Math.min(a.size, b.size) : -1;
}

// Fallback path: per-player wbsearchentities + wbgetentities. Slower (~40 min
// for the full DB) but uses www.wikidata.org, which has separate rate limits
// from query.wikidata.org.
async function runApiMode(
  targets: PlayerRow[],
  countryQids: Map<string, string>,
): Promise<{ matched: number; updated: number }> {
  console.log(`api mode: searching ${targets.length} players`);

  // Pass 1: search each player name, keep up to 3 token-compatible candidates.
  // Results are cached to JSONL so interrupted runs resume where they left off.
  const searchCache = new Map<number, WbSearchResult[]>();
  if (existsSync(SEARCH_CACHE)) {
    for (const line of readFileSync(SEARCH_CACHE, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { id: number; results: WbSearchResult[] };
        searchCache.set(row.id, row.results);
      } catch {
        // skip malformed line
      }
    }
  }
  console.log(`api search cache: ${searchCache.size} players`);

  const pending = new Map<number, { player: PlayerRow; qids: string[] }>();
  for (const [i, player] of targets.entries()) {
    const tokens = new Set(normalizeName(player.name));
    let results = searchCache.get(player.id);
    if (!results) {
      try {
        results = await searchEntities(player.name);
        searchCache.set(player.id, results);
        appendFileSync(SEARCH_CACHE, JSON.stringify({ id: player.id, results }) + '\n');
      } catch {
        // skip player on persistent API failure; retried on next run
        continue;
      }
      await sleep(300);
    }
    const scored = results
      .map((r) => ({ qid: r.id, score: tokenScore(tokens, new Set(normalizeName(r.label))) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (scored.length > 0) {
      pending.set(player.id, { player, qids: scored.map((s) => s.qid) });
    }
    if (i % 250 === 0) console.log(`api search ${i}/${targets.length}`);
  }
  console.log(`api search done: ${pending.size} players have candidates`);

  // Pass 2: fetch claims for all candidate QIDs.
  const allQids = [...new Set([...pending.values()].flatMap((p) => p.qids))];
  const entities = await fetchEntityClaims(allQids);

  const unitQids = new Set<string>();
  const footQids = new Set<string>();
  for (const e of entities.values()) {
    const h = claimQty(e, 'P2048');
    const m = claimQty(e, 'P2067');
    if (h?.unit) unitQids.add(h.unit);
    if (m?.unit) unitQids.add(m.unit);
    const f = claimItem(e, 'P8006');
    if (f) footQids.add(f);
  }
  const [unitLabels, footLabels] = await Promise.all([
    resolveLabels([...unitQids]),
    resolveLabels([...footQids]),
  ]);

  // Pass 3: pick the best candidate per player and update NULL fields.
  let matched = 0;
  let updated = 0;
  for (const { player, qids } of pending.values()) {
    const countryQid = player.nationality ? countryQids.get(player.nationality) : undefined;
    let best: { bio: ApiBio; cit: boolean } | null = null;
    let bestScore = -1;
    for (const qid of qids) {
      const entity = entities.get(qid);
      if (!entity) continue;
      const bio = entityBio(entity, unitLabels, footLabels);
      if (bio.fields === 0) continue;
      const cit = !!countryQid && bio.citizenships.has(countryQid);
      const score = (cit ? 1000 : 0) + bio.fields;
      if (score > bestScore) {
        bestScore = score;
        best = { bio, cit };
      }
    }
    if (!best) continue;
    // Require a citizenship match, or a strong bio match when citizenship is
    // unknown on Wikidata.
    if (!best.cit && best.bio.fields < 3) continue;
    matched++;
    const { bio } = best;
    const dob = player.date_of_birth == null ? (bio.dob ?? null) : player.date_of_birth;
    const height = player.height_cm == null ? (bio.height ?? null) : player.height_cm;
    const weight = player.weight_kg == null ? (bio.mass ?? null) : player.weight_kg;
    const foot = player.preferred_foot == null ? (bio.foot ?? null) : player.preferred_foot;
    if (dob == null && height == null && weight == null && foot == null) continue;
    updated++;
    if (!dryRun) {
      db.exec('BEGIN');
      update.run(dob, height, weight, foot, player.id);
      db.exec('COMMIT');
    }
  }
  return { matched, updated };
}

const players = db
  .prepare(
    `SELECT p.id, p.name, c.name AS nationality,
            p.date_of_birth, p.height_cm, p.weight_kg, p.preferred_foot,
            p.position
     FROM player p LEFT JOIN country c ON c.id = p.nationality_id
     WHERE p.date_of_birth IS NULL OR p.height_cm IS NULL
        OR p.weight_kg IS NULL OR p.preferred_foot IS NULL`,
  )
  .all() as unknown as PlayerRow[];

console.log(`${players.length} players missing bio fields`);

const byCountry = new Map<string, PlayerRow[]>();
for (const p of players) {
  const key = p.nationality ?? '(none)';
  const list = byCountry.get(key) ?? [];
  list.push(p);
  byCountry.set(key, list);
}

const countries = [...byCountry.keys()].filter(
  (c) => c !== '(none)' && (!countryArg || c === countryArg),
);
console.log(`${countries.length} countries to query`);

const update = db.prepare(
  `UPDATE player SET date_of_birth = ?, height_cm = ?, weight_kg = ?,
     preferred_foot = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id = ?`,
);

let totalMatched = 0;
let totalRows = 0;
let totalUpdated = 0;

// Resolve country names to Wikidata QIDs first (cheap wb API calls,
// cached on disk so reruns don't repeat them).
const countryQids = new Map<string, string>(
  existsSync(COUNTRY_CACHE)
    ? Object.entries(JSON.parse(readFileSync(COUNTRY_CACHE, 'utf8')) as Record<string, string>)
    : [],
);
let qidCacheDirty = false;
for (const country of countries) {
  if (countryQids.has(country)) continue;
  try {
    const qid = await countryToQid(country);
    if (qid) {
      countryQids.set(country, qid);
      qidCacheDirty = true;
    } else console.log(`${country}: no QID, skipped`);
  } catch (err) {
    console.log(`${country}: QID lookup failed — ${(err as Error).message}`);
  }
  await sleep(400);
}
if (qidCacheDirty) {
  writeFileSync(COUNTRY_CACHE, JSON.stringify(Object.fromEntries(countryQids)));
}
console.log(`${countryQids.size}/${countries.length} countries resolved to QIDs`);

const batches: [string, string][][] = [];
const resolved = [...countryQids.entries()];
for (let i = 0; i < resolved.length; i += BATCH_SIZE) {
  batches.push(resolved.slice(i, i + BATCH_SIZE));
}

let apiMode = false;

for (const [batchIdx, batch] of batches.entries()) {
  const names = batch.map(([n]) => n);
  const qids = batch.map(([, q]) => q);

  let bindings: SparqlBinding[];
  try {
    bindings = await fetchFootballers(qids);
  } catch (err) {
    if (batchIdx === 0) {
      console.log(
        `SPARQL unavailable (${(err as Error).message}) — falling back to Wikidata entity API`,
      );
      apiMode = true;
      break;
    }
    console.log(
      `batch ${batchIdx + 1}/${batches.length} (${names.join(', ')}): query failed — ${(err as Error).message}`,
    );
    continue;
  }
  totalRows += bindings.length;

  // Collect unit + foot QIDs for label resolution.
  const unitQids = new Set<string>();
  const footQids = new Set<string>();
  for (const b of bindings) {
    if (b.heightUnit) unitQids.add(b.heightUnit.value.split('/').pop()!);
    if (b.massUnit) unitQids.add(b.massUnit.value.split('/').pop()!);
    if (b.foot) footQids.add(b.foot.value.split('/').pop()!);
  }
  const unitLabels = await resolveLabels([...unitQids]);
  const footLabels = await resolveLabels([...footQids]);

  // Merge duplicate rows per player, tracking filled-field count and
  // citizenships (a player may appear under several country queries).
  interface WdPlayer {
    label: string;
    citizenships: Set<string>;
    positions: Set<string>;
    dob?: string;
    height?: number;
    mass?: number;
    foot?: string;
  }
  const byPlayer = new Map<string, WdPlayer>();
  for (const b of bindings) {
    const qid2 = b.player.value.split('/').pop()!;
    const entry = byPlayer.get(qid2) ?? {
      label: b.playerLabel.value,
      citizenships: new Set<string>(),
      positions: new Set<string>(),
    };
    entry.citizenships.add(b.citizenship.value.split('/').pop()!);
    if (b.posLabel) entry.positions.add(b.posLabel.value);
    if (!entry.dob && b.dob) entry.dob = b.dob.value.slice(0, 10);
    if (entry.height == null && b.height) {
      const h = convertHeight(
        parseFloat(b.height.value),
        b.heightUnit ? unitLabels.get(b.heightUnit.value.split('/').pop()!) : undefined,
      );
      if (h != null) entry.height = h;
    }
    if (entry.mass == null && b.mass) {
      const m = convertMass(
        parseFloat(b.mass.value),
        b.massUnit ? unitLabels.get(b.massUnit.value.split('/').pop()!) : undefined,
      );
      if (m != null) entry.mass = m;
    }
    if (!entry.foot && b.foot) {
      const f = mapFoot(footLabels.get(b.foot.value.split('/').pop()!));
      if (f) entry.foot = f;
    }
    byPlayer.set(qid2, entry);
  }

  const candidates: (Candidate & { citizenships: Set<string>; positions: Set<string> })[] = [
    ...byPlayer.entries(),
  ].map(([qid2, e]) => ({
    qid: qid2,
    label: e.label,
    tokens: new Set(normalizeName(e.label)),
    citizenships: e.citizenships,
    positions: e.positions,
    fields:
      (e.dob ? 1 : 0) + (e.height != null ? 1 : 0) + (e.mass != null ? 1 : 0) + (e.foot ? 1 : 0),
  }));

  for (const [country, countryQid] of batch) {
    const eligible = candidates.filter((c) => c.citizenships.has(countryQid));
    const byFirstToken = new Map<string, typeof eligible>();
    for (const c of eligible) {
      for (const t of c.tokens) {
        const list = byFirstToken.get(t) ?? [];
        list.push(c);
        byFirstToken.set(t, list);
      }
    }

    let matched = 0;
    let updated = 0;
    const countryPlayers = byCountry.get(country) ?? [];
    if (!dryRun) db.exec('BEGIN');
    for (const player of countryPlayers) {
      const tokens = new Set(normalizeName(player.name));
      const pool = new Set<(typeof eligible)[number]>();
      for (const t of tokens) {
        for (const c of byFirstToken.get(t) ?? []) pool.add(c);
      }
      const match = bestMatch(tokens, [...pool], player.position);
      if (!match) continue;
      matched++;
      const data = byPlayer.get(match.qid)!;
      const dob = player.date_of_birth == null ? (data.dob ?? null) : player.date_of_birth;
      const height = player.height_cm == null ? (data.height ?? null) : player.height_cm;
      const weight = player.weight_kg == null ? (data.mass ?? null) : player.weight_kg;
      const foot = player.preferred_foot == null ? (data.foot ?? null) : player.preferred_foot;
      if (dob == null && height == null && weight == null && foot == null) continue;
      updated++;
      if (!dryRun) {
        update.run(dob, height, weight, foot, player.id);
      }
    }
    if (!dryRun) db.exec('COMMIT');

    totalMatched += matched;
    totalUpdated += updated;
    console.log(
      `batch ${batchIdx + 1}/${batches.length} ${country}: ${eligible.length} wd players, matched ${matched}/${countryPlayers.length}, ${updated} updates`,
    );
  }
  await sleep(2_000);
}

if (apiMode) {
  const targets = players.filter(
    (p) => p.nationality != null && (!countryArg || p.nationality === countryArg),
  );
  const res = await runApiMode(targets, countryQids);
  totalMatched += res.matched;
  totalUpdated += res.updated;
}

console.log(
  `done: ${totalRows} wd rows, ${totalMatched} name matches, ${totalUpdated} players updated${dryRun ? ' (dry-run)' : ''}`,
);
db.close();
