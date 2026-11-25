---
title: 'Inside the database: a tour of the schema'
description: |
  'A guided tour of the 17 tables in the soccers SQLite database — what each one
  stores and how they connect.'
author: 'hieudoan'
date: '2026-11-25T08:30'
order: 2
tags: ['schema', 'sqlite', 'prisma', 'data-model']
---

# Inside the database: a tour of the schema

The data contract is a single Prisma 8 contract (`contract.prisma`) mapped to
SQLite with snake_case storage names. Here is how the pieces fit together.

## The spine: competition → season → match

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

## The detail layer

- `match_team_stat` — team-level aggregates per match (shots, possession,
  corners, fouls, cards, xG where available).
- `match_lineup` + `player_match_stat` — who played, and what they did: minutes,
  goals, assists, shots, passes, duels, saves.
- `goal` and `match_event` — the atomic events: finishes (with `goal_type` for
  penalties, headers, own goals), cards, substitutions, injuries.

## The slow-moving tables

`team`, `player`, `manager`, `venue`, `referee`, and `country` are the entities
everything else references. `standing` snapshots the league table per season —
position and form string included.

## Still empty

`transfer` and `injury` exist in the contract but have no free historical source
yet — a good candidate for a future enrichment pass.
