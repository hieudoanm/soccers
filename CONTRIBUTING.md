# Contributing to soccers

Thanks for contributing to soccers, a football/soccer historical data platform.

## Setup

```bash
git clone https://github.com/hieudoanm/soccers.git
cd soccers
pnpm install
```

Requires Node.js 26 (`.nvmrc`) and pnpm 12; the workspace is driven by
Turborepo.

## Checks

Run before opening a pull request:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Conventions

- Work happens inside `packages/*`; read the package's `AGENTS.md` first.
- Scripts are TypeScript run natively by Node — do not add a transpile step.
- Never edit generated artefacts (`contract.json`, `schema/schema.*`, `csv/`,
  `dev.db`); change the source and regenerate.
- Commit messages must follow conventional commits (commitlint enforced).

## Data imports

Importers live in `packages/data/scripts/` and are idempotent — safe to
re-run:

```bash
pnpm --filter @soccers/data import:football-data   # football-data.co.uk CSVs
pnpm --filter @soccers/data import:statsbomb       # StatsBomb open data (~1.3 GB stream)
pnpm --filter @soccers/data export:csv             # dump tables to csv/
```
