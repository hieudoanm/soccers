---
title: 'Welcome to soccers'
description: |
  'What this project is, where the data comes from, a tour of the
  database, and an index of every football report published here.'
author: 'hieudoan'
date: '2026-11-25T08:00'
order: 1
tags: ['intro', 'football', 'data', 'sqlite', 'prisma']
---

# Welcome to soccers

**soccers** is a historical football/soccer data platform: one SQLite database
holding roughly 300,000 matches, 11,000+ players, and event-level stats across
60+ leagues and tournaments — from the 1958 World Cup to the current season.

This site is where the analysis happens. The data lives in
[`packages/data`](https://github.com/hieudoanm/soccers/tree/master/packages/data);
this landing page is the publication layer for the findings.

## Where the data comes from

Four open sources feed the database:

- **football-data.co.uk** — results, match stats, and standings for 20+ European
  leagues (1993–present) plus 16 single-file countries.
- **StatsBomb open data** — event-level JSON (passes, shots, cards,
  substitutions, lineups) for World Cups, Euros, the Champions League, and
  domestic leagues back to 1958.
- **Transfermarkt** — transfer history with fees, player photos and bios.
- **Wikipedia/Wikidata awards data** — Ballon d'Or, FIFA awards, Golden Shoe and
  other individual honours.

All are imported by idempotent scripts, so the dataset can be rebuilt from
scratch at any time.

## Inside the database

The data contract is a single Prisma 8 contract (`contract.prisma`) mapped to
SQLite with snake_case storage names. Here is how the pieces fit together.

### The spine: competition → season → match

Everything hangs off the fixture list:

- `league` belongs to a `country` and has a `competition_type` (league, cup,
  international).
- `season` belongs to a `league` and carries the year label (`2024`, `2024/25`).
- `match` belongs to a `season` and references `home_team` / `away_team`, an
  optional `venue` and `referee`, plus full scorelines — regulation, half-time,
  extra time, and penalties.

`match.external_id` is the deduplication key: football-data rows hash their CSV
identity, StatsBomb rows keep their `sbm-` ids, so re-running an import never
duplicates a fixture.

### The detail layer

- `match_team_stat` — team-level aggregates per match (shots, possession,
  corners, fouls, cards, xG where available).
- `match_lineup` + `player_match_stat` — who played, and what they did: minutes,
  goals, assists, shots, passes, duels, saves.
- `goal` and `match_event` — the atomic events: finishes (with `goal_type` for
  penalties, headers, own goals), cards, substitutions, injuries.
- `transfer` — 19,000+ moves with fees, powers the Transfers series.
- `award` + `award_winner` — individual honours, powers the Awards series.

### The slow-moving tables

`team`, `player`, `manager`, `venue`, `referee`, and `country` are the entities
everything else references. `standing` snapshots the league table per season —
position and form string included. `injury` exists in the contract but coverage
is still thin.

## The reports

Every analysis on this site is a [Mars](https://github.com/hieudoanm/mars)
notebook — CSV in, reproducible Rust out — exported to markdown. **52 reports**
across five series:

### Match Analysis

Questions about how matches and seasons actually behave.

- [Attack vs Defence: does defence win titles?](/blog/attack-vs-defence)
- [The Away-Day Nightmare](/blog/away-day)
- [Biggest blown leads: does an 8-point lead actually choke teams?](/blog/blown-leads)
- [Clean sheets: the defensive record book](/blog/clean-sheets)
- [Comebacks: turning losing positions into victories](/blog/comebacks)
- [Do more corners actually help you win?](/blog/corners)
- [The discipline report: who collects cards and who concedes fouls](/blog/discipline-report)
- [The Draw Specialists](/blog/draw-specialists)
- [Finishing efficiency: who converts chances and who wastes them](/blog/finishing-efficiency)
- [Does the first half of the season predict the final table?](/blog/first-half-table)
- [The Fixture Congestion Effect](/blog/fixture-congestion)
- [Greatest escapes: can a bottom-three team survive with ten games left?](/blog/greatest-escapes)
- [Home Advantage: a classic football analysis](/blog/home-advantage)
- [Death by a thousand cuts: the dying minutes](/blog/late-goals)
- [The Opening Goal Advantage](/blog/opening-goal)
- [Does possession actually help you win?](/blog/possession)
- [Substitution patterns: when do managers pull the trigger?](/blog/substitutions)
- [Super-subs: what happens when the bench comes on](/blog/super-subs)
- [Title defences and dynasties: how often do champions retain?](/blog/title-defences)
- [Two-goal lead: is 2–0 the most dangerous lead?](/blog/two-goal-lead)
- [Are unbeaten seasons really that impressive?](/blog/unbeaten-seasons)
- [Giant-killing: teams that beat stronger opponents](/blog/underdogs)
- [Five in a row: how common are winning streaks?](/blog/win-streaks)
- [The xG luck index: who is fortunate and who is fooling themselves](/blog/xg-luck)

### Management

- [New manager, same table: does the bounce actually work?](/blog/manager-change)
- [The Best Debut Season: ranking managerial arrivals in the Premier League](/blog/manager-debut)

### Record Books

Best-of record books for leagues and tournaments.

- [Best of the AFC Champions League Elite: a record book](/blog/best-of-afc-champions-league-elite)
- [Best of the Africa Cup of Nations: a record book](/blog/best-of-afcon)
- [Best of the Belgian Pro League: every record worth knowing](/blog/best-of-belgian-pro-league)
- [Best of the Brazilian Série A: every record worth knowing](/blog/best-of-brazilian-serie-a)
- [Best of the Bundesliga: every record worth knowing](/blog/best-of-bundesliga)
- [Best of the Copa América: a record book](/blog/best-of-copa-america)
- [Best of the Eredivisie: every record worth knowing](/blog/best-of-eredivisie)
- [Best of the UEFA European Championship: a record book](/blog/best-of-euro)
- [Best of La Liga: every record worth knowing](/blog/best-of-la-liga)
- [Best of Ligue 1: every record worth knowing](/blog/best-of-ligue-1)
- [Best of MLS: every record worth knowing](/blog/best-of-mls)
- [Best of the Premier League: every record worth knowing](/blog/best-of-premier-league)
- [Best of the Primeira Liga: every record worth knowing](/blog/best-of-primeira-liga)
- [Best of the Scottish Premiership: every record worth knowing](/blog/best-of-scottish-premiership)
- [Best of Serie A: every record worth knowing](/blog/best-of-serie-a)
- [Best of the Süper Lig: every record worth knowing](/blog/best-of-super-lig)
- [Best of the UEFA Champions League: a record book](/blog/best-of-uefa-champions-league)
- [Best of the UEFA Conference League: a record book](/blog/best-of-uefa-conference-league)
- [Best of the UEFA Europa League: a record book](/blog/best-of-uefa-europa-league)
- [Best of the FIFA World Cup: a record book](/blog/best-of-world-cup)

### Transfers

The transfer market in data.

- [Deadline day: football's most expensive 24 hours](/blog/deadline-day)
- [Does big money buy goals? Fee vs. output](/blog/big-money)
- [Selling vs buying clubs: the transfer market's hunters and farms](/blog/club-flows)
- [The price of a player: a history of football's transfer market](/blog/transfer-fees)
- [Transfer flows: who sells footballers and who buys them](/blog/transfer-flows)

### Awards

Football's individual honours in data.

- [The award cabinet: who owns football's trophies](/blog/award-cabinet)

New reports land here as the notebooks run — check the [blog index](/blog) for
the latest.
