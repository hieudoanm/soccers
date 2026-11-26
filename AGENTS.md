# AGENTS.md

- Technical reference for working in the Soccers repository.
- The [README](./README.md) explains what the project is; this file explains how
  to change it.
- Package-level guidance lives in [`packages/data/AGENTS.md`](./packages/data/AGENTS.md).

## Read this first

- **pnpm workspace + Turborepo monorepo.** Packages live in `packages/*`;
  `packages/data` holds the football data platform (Prisma 8 + SQLite).
- **`pnpm typecheck`, `pnpm lint`, and `pnpm test` must pass before a change is
  done.**
- **Keep diffs minimal.** Do not reformat files you did not change.

## Stack

| Area       | Choice                                              |
| ---------- | --------------------------------------------------- |
| Runtime    | Node 26.13.1 (`.nvmrc`), pnpm 12.23.0               |
| Monorepo   | pnpm workspaces + Turborepo                         |
| Data layer | Prisma 8 (`@prisma/orm-sqlite`), SQLite             |
| Scripts    | TypeScript run natively by Node (no transpile step) |
| Formatting | Prettier + `prisma contract format`                 |
| Git hooks  | Husky + lint-staged + commitlint                    |

## Commands

Run from the repository root unless noted.

```bash
pnpm install          # install workspace dependencies
pnpm typecheck        # turbo run typecheck (tsc --noEmit per package)
pnpm lint             # turbo run lint (prettier --check)
pnpm test             # turbo run test
pnpm build            # turbo run build (contract emit + dbml/svg/png in data)
pnpm format           # turbo run format (writes)

# packages/data specifics (see packages/data/AGENTS.md)
pnpm --filter @soccers/data contract:emit
pnpm --filter @soccers/data dbml
pnpm --filter @soccers/data import:football-data
pnpm --filter @soccers/data import:statsbomb
pnpm --filter @soccers/data export:csv
pnpm --filter @soccers/data sizes
```

## Workspace layout

| Path                | Contents                                                              |
| ------------------- | --------------------------------------------------------------------- |
| `packages/data`     | Prisma 8 contract, SQLite db, importers, schema diagrams, CSV exports |
| `packages/landing`  | Reserved for a future frontend                                        |
| `assets/`           | Static assets (images, branding)                                      |
| `.github/workflows` | CI (install → typecheck → lint → test → build)                        |

## Conventions

- Scripts in `packages/*/scripts/` are TypeScript (`.ts`) executed directly by
  Node — never add a transpile step.
- Generated artefacts (`contract.json`, `contract.d.ts`, `schema/schema.*`,
  `export/`, `dev.db`) are produced by scripts; edit sources, not outputs.
- Commit messages follow conventional commits (enforced by commitlint).

## Definition of done

- [ ] Change is scoped; no unrelated formatting churn
- [ ] Types are explicit; no `any` introduced
- [ ] `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass
- [ ] `pnpm build` succeeds when contracts, scripts, or data shapes change
- [ ] Docs updated when commands, structure, or data change
