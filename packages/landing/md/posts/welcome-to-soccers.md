---
title: 'Welcome to soccers'
description: |
  'What this project is, where the data comes from, and what kind of football
  analysis to expect here.'
author: 'hieudoan'
date: '2026-11-25'
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

Two open sources feed the database:

- **football-data.co.uk** — results, match stats, and standings for 20+ European
  leagues (1993–present) plus 16 single-file countries.
- **StatsBomb open data** — event-level JSON (passes, shots, cards,
  substitutions, lineups) for World Cups, Euros, the Champions League, and
  domestic leagues back to 1958.

Both are imported by idempotent scripts, so the dataset can be rebuilt from
scratch at any time.

## What lives in the database

| Area        | Tables                                                                                 |
| ----------- | -------------------------------------------------------------------------------------- |
| Geography   | `country`, `venue`                                                                     |
| Competition | `league`, `season`, `standing`                                                         |
| Teams       | `team`, `manager`, `team_manager`, `referee`                                           |
| Players     | `player`, `injury`, `transfer`                                                         |
| Matches     | `match`, `match_lineup`, `goal`, `match_event`, `match_team_stat`, `player_match_stat` |

## What to expect

Planned posts include season reviews, player and team rankings, event-level
analyses (pressing, finishing, card patterns), and reproducible experiments
built as [Mars](https://github.com/hieudoanm/mars) notebooks — CSV in, charts
and models out.
