# packages/data — Football data platform

Prisma 8 + SQLite (`dev.db`) holding football match, player, and event-level
data. Imports are idempotent scripts in `scripts/`; see
[`AGENTS.md`](../../AGENTS.md) for the workflow.

## Data sources in use

| Source                                                                                  | Access                             | Importer                                 | Tables / fields filled                                                                       |
| --------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| [football-data.co.uk](https://www.football-data.co.uk)                                  | Static CSVs, no key                | `import-football-data.ts`                | Match, Season, League, Team, standings                                                       |
| [StatsBomb Open Data](https://github.com/statsbomb/open-data)                           | GitHub repo, CC-BY-NC 4.0          | `import-statsbomb.ts`                    | Match, MatchLineup, Goal, MatchEvent, PlayerMatchStat, MatchTeamStat, Player, Manager, Venue |
| [ESPN scoreboard API](https://site.api.espn.com)                                        | Public JSON API, no key            | `import-espn.ts`, `import-espn-stats.ts` | League, Season, Team, Match, player/team stats                                               |
| [Wikidata](https://www.wikidata.org)                                                    | SPARQL + wb API; rate limits apply | `import-player-bios.ts`                  | `player.date_of_birth`, `height_cm`, `weight_kg`, `preferred_foot`                           |
| [Kaggle — European Soccer Database](https://www.kaggle.com/datasets/hugomathien/soccer) | Kaggle download / HF mirror        | `import-player-bios-kaggle.ts`           | same bio fields (fallback, ~3.3k players)                                                    |
| internal (`match_lineup`)                                                               | —                                  | `backfill-player-teams.ts`               | `player.current_team_id`                                                                     |
| [Transfermarkt](https://www.transfermarkt.com) (HF mirror + live scrape)                | CSV mirror / HTML scraping         | `import-transfermarkt.ts`                | `transfer`, `injury`, `player.photo_url` + bio backfill                                      |

## Additional free sources

Everything below is free to access (open data, CC0/CC-BY, free API tiers, or
public pages) — scraping-only sources carry no SLA and may rate-limit or
change markup.

### Match results & fixtures

| Source                                                                                       | Coverage                                                                     | Access                                                    |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| [TheSportsDB](https://www.thesportsdb.com)                                                   | Leagues, fixtures, livescores, some player data                              | Free API key (`3` for testing); Patreon for higher volume |
| [OpenLigaDB](https://www.openligadb.de)                                                      | German leagues (Bundesliga, 2. Bundesliga, 3. Liga, Regionalliga, DFB-Pokal) | Free JSON API, no key                                     |
| [API-Football](https://www.api-football.com)                                                 | 1,200+ leagues worldwide, fixtures, standings, players, odds                 | Free tier ~100 req/day, key required                      |
| [football-data.org](https://www.football-data.org)                                           | Major European leagues, fixtures, standings                                  | Free tier, key required                                   |
| [worldfootball.net](https://www.worldfootball.net)                                           | Broad historical results incl. lower leagues & internationals                | Web scraping only                                         |
| [11v11](https://www.11v11.com)                                                               | Historical match results & lineups, incl. amateur-era football               | Web scraping only                                         |
| [RSSSF](https://www.rsssf.com)                                                               | Deepest historical archive (results back to 1800s, world cups, qualifiers)   | Web scraping only                                         |
| [eu-football.info](https://www.eu-football.info)                                             | International (A) matches database                                           | Web scraping only                                         |
| [national-football-teams.com](https://www.national-football-teams.com)                       | National team fixtures, squads, player bios                                  | Web scraping only                                         |
| [soccerway / flashscore](https://www.soccerway.com)                                          | Broad live + historical coverage                                             | Web scraping only, aggressive bot protection              |
| [SofaScore unofficial API](https://www.sofascore.com/api/v1)                                 | Fixtures, standings, player stats, xG for top leagues                        | Undocumented JSON endpoints, no key; rate limits apply    |
| [FotMob unofficial API](https://www.fotmob.com/api)                                          | Fixtures, stats, lineups, xG                                                 | Undocumented endpoints, no key                            |
| [clubelo.com](https://clubelo.com)                                                           | Club ELO ratings over time                                                   | Ratings downloadable / light scraping                     |
| [FiveThirtyEight soccer SPI](https://github.com/fivethirtyeight/data/tree/master/soccer-spi) | Club SPI ratings & match predictions (2016–)                                 | GitHub CSVs                                               |

### Player statistics & ratings

| Source                                                                                 | Coverage                                                             | Access                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- |
| [Understat](https://understat.com)                                                     | Season-level xG, shots, deep stats for top-5 leagues                 | Site JSON endpoints, no key; scraping etiquette applies   |
| [FBref](https://fbref.com)                                                             | Season + match player stats, extensive tables, referee data          | Web scraping only (rate-limited; `fbref` py pkg wraps it) |
| [WhoScored](https://www.whoscored.com)                                                 | Match ratings, lineups, heatmaps                                     | Web scraping only                                         |
| [footystats.org](https://footystats.org)                                               | xG, form, referee tendencies across many leagues                     | Free API tier, key required                               |
| [Sportmonks](https://www.sportmonks.com)                                               | Fixtures, lineups, player stats                                      | Free tier, key required                                   |
| [Kaggle — FIFA datasets](https://www.kaggle.com/search?q=fifa+player)                  | Sofifa player dumps (FIFA 18–23): attributes, bio fields             | Kaggle download                                           |
| [Kaggle — Football Manager datasets](https://www.kaggle.com/search?q=football+manager) | FM-touch player databases: deep attributes, positions, nationalities | Kaggle download                                           |
| [Football-Manager-Scraper](https://github.com/roniemartinez/football-manager-scraper)  | Scriptable FM data extraction                                        | Self-hosted scraper                                       |

### Player bios, squads & transfers

| Source                                                                                                                        | Coverage                                                                | Access                                                          |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| [footballsquads.cc](https://www.footballsquads.cc) / [CC0 GitHub mirror](https://github.com/footballcsv/cache.footballsquads) | Current national-team & club squads: height, weight, DOB, previous club | CC0; site pages or repo files                                   |
| [Transfermarkt](https://www.transfermarkt.com)                                                                                | Player bios, transfer history, market values, injuries/suspensions      | Web scraping only (no official API); CSV mirror on Hugging Face |
| [DBpedia](https://dbpedia.org)                                                                                                | Structured bio fields extracted from Wikipedia infoboxes                | SPARQL; coverage too sparse for footballers in practice         |

### Events, xG & match analysis

| Source                                 | Coverage                                                     | Access                                |
| -------------------------------------- | ------------------------------------------------------------ | ------------------------------------- |
| [Understat](https://understat.com)     | xG, xA, shot locations per match/player                      | JSON endpoints                        |
| [FBref](https://fbref.com)             | Expected goals tables, keeper stats, standard "stats" tables | Web scraping                          |
| [TheOddsAPI](https://the-odds-api.com) | Live odds across bookmakers                                  | Free tier 500 req/month, key required |

### Reference data

| Source                                                                                        | Coverage                               | Access                             |
| --------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| [FIFA world ranking](https://www.fifa.com/fifa-world-ranking)                                 | Men's & women's national-team rankings | CSV download from FIFA Digital Hub |
| [UEFA coefficients](https://www.uefa.com/nationalassociations/clubcompetitions/coefficients/) | Club & association coefficients        | Published tables on uefa.com       |

### Bulk mirrors & archives

- **Hugging Face** — `julien-c/kaggle-hugomathien-soccer` mirrors the Kaggle
  European Soccer Database `database.sqlite` (used for the bio importer).
  Search HF datasets for `soccer`, `football`, `fifa` for more mirrors.
- **Kaggle** — the canonical host for most community football datasets; a
  Kaggle API key is required for programmatic download.
- **GitHub** — `openfootball` org publishes national-team data (world cups,
  euros) as plain text/JSON; `fivethirtyeight/data` for historical SPI.
- **awesome-football** lists on GitHub aggregate additional niche sources.

## Adding a new source

1. Confirm licence/terms allow the intended use.
2. Write an idempotent `scripts/import-<name>.ts` (Node-native TS, no build
   step) keyed on a stable external ID (`Match.externalId`, `Player.externalId`).
3. Prefer filling NULL fields only; never overwrite imported data silently.
4. Document the source, coverage, and access method in the tables above.
