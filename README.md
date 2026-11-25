# soccers

[![CI](https://github.com/hieudoanm/soccers/actions/workflows/ci.yaml/badge.svg?branch=master)](https://github.com/hieudoanm/soccers/actions/workflows/ci.yaml?branch=master) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Topics: `football`, `soccer`, `sqlite`, `prisma`, `open-data`

**soccers** — a historical football/soccer data platform: ~300k matches,
11k+ players with event-level stats, standings, and competition data across
60+ leagues and tournaments, stored in SQLite via Prisma 8.

![soccers — Every match. Every stat. One database.](assets/branding/png/og.png)

## Packages

| Package            | Description                                                                |
| ------------------ | -------------------------------------------------------------------------- |
| `packages/data`    | Data platform — Prisma 8 contract, importers, schema diagrams, CSV exports |
| `packages/landing` | Reserved for a future frontend                                             |

## Data sources

- **football-data.co.uk** — results, stats, and standings for 20+ European
  leagues (1993–present) plus 16 single-file countries.
- **StatsBomb open data** — event-level JSON (passes, shots, cards,
  substitutions, lineups) for World Cups, Euros, Champions League, and domestic
  leagues back to 1958.

See [`packages/data/AGENTS.md`](./packages/data/AGENTS.md) for the full import
and schema workflow.

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Requires Node.js 26 (`.nvmrc`) and pnpm 12.

[Technical docs](./AGENTS.md)
