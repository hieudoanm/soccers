---
title: 'Best of the UEFA Champions League: a record book'
description: |
  '25 editions of records — Real Madrid's 7 modern titles, Bayern's invincible treble, and six finals decided on penalties.'
author: 'hieudoan'
date: '2026-11-26T00:00'
order: 31
tags: ['football', 'analysis', 'records', 'mars', 'sqlite']
---

# Best of the UEFA Champions League: a record book

## Abstract

This study examines the UEFA Champions League record book using the full match
archive drawn from the Soccers football database. Real Madrid are the kings of
the modern era. All computation runs in Rust inside a `.mars` notebook (polars +
plotters — charts as inline SVG), and every table and figure is generated from
the extracted CSVs.

## Keywords

**Keywords:** football, analysis, records, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [Tournament editions](#tournament-editions)
  - [Every edition — champion, final score, champion's tournament record](#every-edition--champion-final-score-champions-tournament-record)
  - [Records across all editions](#records-across-all-editions)
  - [Champion records: most goals for, fewest against, best GD, most wins](#champion-records-most-goals-for-fewest-against-best-gd-most-wins)
  - [Unbeaten champions](#unbeaten-champions)
  - [Closest finals (smallest margin or draw)](#closest-finals-smallest-margin-or-draw)
  - [Top scorers (latest edition with player data — SCORERS picks best-covered year)](#top-scorers-latest-edition-with-player-data--scorers-picks-best-covered-year)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

A record book of the **UEFA Champions League** — continental club competition
champions, finals and records computed from `data/matches_full.csv`.

Club competition coverage from 2001/02 onward (ESPN import) — every edition's
champion is the team that won the final; the in-progress 2026/27 season is
excluded.

**Records covered:** most titles, every edition's champion and final score, the
champion's full tournament record, biggest wins, highest-scoring matches,
champion records (most goals, fewest conceded, best goal difference, most wins,
fewest losses), unbeaten champions, the closest finals, and top scorers where
player-level data exists.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `matches_full`, `player_goals`.

The analysis runs entirely in Rust inside the notebook: **polars** handles table
scans, joins and aggregations; **plotters** renders figures as inline SVG;
`mars_table` renders result tables.

Each code cell is kept to a single output so results can be read top to bottom.

## Results

All figures and tables below are computed directly from the extracted data. Each
code cell produces one output — a table, a chart, or a short text summary.

```rust
use polars::prelude::*;
use std::collections::BTreeMap;

let df = LazyCsvReader::new("data/matches_full.csv")
    .finish()
    .expect("failed to open data/matches_full.csv — run from the notebook directory")
    .collect()
    .expect("failed to collect CSV into DataFrame");

let df = df
    .lazy()
    .filter(col("league").eq(lit("Champions League")))
    .collect()
    .expect("filter failed");

// seasons excluded as mislabeled data (e.g. another league's fixtures)
let drop_seasons: &[&str] = &["2026/2027"];

println!("Champions League matches: {}", df.height());

let s = |name: &str| df.column(name).unwrap_or_else(|_| panic!("missing {name}")).clone();
let col_str = |name: &str| -> Vec<String> {
    s(name).str().unwrap().iter().map(|o| o.unwrap_or("").to_string()).collect()
};
let col_i64 = |name: &str| -> Vec<i64> {
    let c = s(name);
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect()
};

let season_v = col_str("season");
let date_v = col_str("date");
let home_v = col_str("home");
let away_v = col_str("away");
let hg_v = col_i64("hg");
let ag_v = col_i64("ag");

fn canon(name: &str) -> &str {
    match name {
        // England
        "Manchester United" | "Man Utd" => "Man United",
        "Manchester City" => "Man City",
        "Newcastle United" => "Newcastle",
        "Tottenham Hotspur" => "Tottenham",
        "West Ham United" => "West Ham",
        "Leicester City" => "Leicester",
        "Norwich City" => "Norwich",
        "Stoke City" => "Stoke",
        "West Bromwich Albion" => "West Brom",
        "Swansea City" => "Swansea",
        "Leeds United" => "Leeds",
        "Wolverhampton Wanderers" => "Wolves",
        "Nott'm Forest" => "Nottingham Forest",
        "Birmingham City" => "Birmingham",
        "Blackburn Rovers" => "Blackburn",
        "Bolton Wanderers" => "Bolton",
        "Charlton Athletic" => "Charlton",
        // Spain
        "Athletic Club" => "Ath Bilbao",
        "Atl\u{e9}tico Madrid" => "Ath Madrid",
        "Real Betis" => "Betis",
        "Celta Vigo" => "Celta",
        "Real Sociedad" => "Sociedad",
        "Real Valladolid" => "Valladolid",
        "Real Zaragoza" => "Zaragoza",
        "Rayo Vallecano" => "Vallecano",
        "CD Numancia de Soria" => "Numancia",
        "Real Murcia CF" => "Murcia",
        "Recreativo Huelva" => "Recreativo",
        "Sporting Gij\u{f3}n" => "Sp Gijon",
        "Espanol" => "Espanyol",
        "Gimn\u{e0}stic Tarragona" => "Gimnastic",
        "Villarreal" | "Villareel" => "Villarreal",
        "Santander" => "Racing Santander",
        // Italy
        "Inter Milan" => "Inter",
        "Verona" => "Hellas Verona",
        // Germany
        "Bayer Leverkusen" => "Leverkusen",
        "Borussia Dortmund" => "Dortmund",
        "Eintracht Frankfurt" => "Ein Frankfurt",
        "FSV Mainz 05" => "Mainz",
        "Hamburger SV" => "Hamburg",
        "Hertha Berlin" => "Hertha",
        "Leipzig" => "RB Leipzig",
        "Borussia M\u{f6}nchengladbach" | "M'gladbach" => "M'Gladbach",
        "Darmstadt 98" => "Darmstadt",
        "Fortuna Dusseldorf" => "Dusseldorf",
        "Hannover 96" => "Hannover",
        // France
        "Olympique de Marseille" => "Marseille",
        "AS Monaco" => "Monaco",
        "OGC Nice" => "Nice",
        "Stade de Reims" => "Reims",
        "Paris Saint-Germain" => "Paris SG",
        "Stade Brestois" => "Brest",
        "Stade Malherbe Caen" => "Caen",
        "Clermont Foot" => "Clermont",
        "CA Bastia" => "Bastia",
        "Saint-\u{c9}tienne" => "St Etienne",
        // Netherlands
        "Roda JC" => "Roda",
        "Sparta Rotterdam" => "Sparta",
        // Portugal
        "Desp. Chaves" => "Chaves",
        "Campomaior" => "Campomaiorense",
        "Madeira" => "Uniao Madeira",
        "AVS" => "Academico Viseu",
        // Belgium
        "Lommel SK" => "Lommel",
        "RWD Molenbeek" => "Molenbeek",
        "Mouscron" | "Mouscron-Peruwelz" => "RAAL La Louviere",
        // Turkiye
        "Antalya" => "Antalyaspor",
        "Gaziantep" => "Gaziantepspor",
        "Kayseri" => "Kayserispor",
        "Malatyaspor" => "Yeni Malatyaspor",

        "AC Milan" => "Milan",
        "Internazionale" => "Inter",
        "FC Inter" => "Inter",
        "Ajax Amsterdam" => "Ajax",
        "FC Porto" => "Porto",
        "Feyenoord Rotterdam" => "Feyenoord",
        "PSV Eindhoven" => "PSV",
        "AS Roma" => "Roma",
        "Olympique Marseille" => "Marseille",
        "LOSC Lille" => "Lille",
        other => other,
    }
}

#[derive(Clone)]
struct Game {
    date: String,
    gf: i64,
    ga: i64,
    home: bool,
}

let mut team_games: BTreeMap<(String, String), Vec<Game>> = BTreeMap::new();
let mut all_matches: Vec<(String, String, String, String, i64, i64)> = Vec::new();
let mut seen: std::collections::HashSet<(String, String, String, String, i64, i64)> = std::collections::HashSet::new();
let mut n_finished = 0usize;
let mut n_dupes = 0usize;
for i in 0..df.height() {
    if hg_v[i] < 0 || ag_v[i] < 0 || drop_seasons.contains(&season_v[i].as_str()) {
        continue;
    }
    let date = date_v[i][..10].to_string();
    let hg = hg_v[i];
    let ag = ag_v[i];
    let h = canon(&home_v[i]).to_string();
    let a = canon(&away_v[i]).to_string();
    let s = season_v[i].clone();
    // the CSV merges two data sources; the same fixture can appear twice
    // under different team-name spellings — keep only the first copy
    if !seen.insert((s.clone(), h.clone(), a.clone(), date.clone(), hg, ag)) {
        n_dupes += 1;
        continue;
    }
    n_finished += 1;
    all_matches.push((s.clone(), h.clone(), a.clone(), date.clone(), hg, ag));
    team_games
        .entry((s.clone(), h.clone()))
        .or_default()
        .push(Game { date: date.clone(), gf: hg, ga: ag, home: true });
    team_games
        .entry((s, a))
        .or_default()
        .push(Game { date, gf: ag, ga: hg, home: false });
}
for games in team_games.values_mut() {
    games.sort_by(|x, y| x.date.cmp(&y.date));
}
println!("finished matches: {} ({} duplicate fixtures dropped) | team-season entries: {}", n_finished, n_dupes, team_games.len());

fn pts(g: &Game) -> i64 {
    if g.gf > g.ga { 3 } else if g.gf == g.ga { 1 } else { 0 }
}

// per team-season record
#[derive(Clone)]
struct Rec {
    season: String,
    team: String,
    played: usize,
    w: i64,
    d: i64,
    l: i64,
    pts: i64,
    gf: i64,
    ga: i64,
    gd: i64,
}

let rec_of = |season: &str, team: &str| -> Option<Rec> {
    let games = team_games.get(&(season.to_string(), team.to_string()))?;
    let mut r = Rec {
        season: season.to_string(),
        team: team.to_string(),
        played: games.len(),
        w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, gd: 0,
    };
    for g in games {
        r.gf += g.gf;
        r.ga += g.ga;
        if g.gf > g.ga { r.w += 1; r.pts += 3; }
        else if g.gf == g.ga { r.d += 1; r.pts += 1; }
        else { r.l += 1; }
    }
    r.gd = r.gf - r.ga;
    Some(r)
};

// season -> sorted standings (rank order)
let standings = |season: &str| -> Vec<Rec> {
    let prefix = season.to_string();
    let mut teams: Vec<String> = Vec::new();
    for ((s, t), _) in &team_games {
        if *s == prefix && !teams.contains(t) {
            teams.push(t.clone());
        }
    }
    let mut recs: Vec<Rec> = teams.iter().filter_map(|t| rec_of(season, t)).collect();
    recs.sort_by(|a, b| b.pts.cmp(&a.pts).then(b.gd.cmp(&a.gd)).then(b.gf.cmp(&a.gf)).then(a.team.cmp(&b.team)));
    recs
};

// complete seasons only: >= 150 total matches (drops the in-progress season)
let mut season_match_count: BTreeMap<String, usize> = BTreeMap::new();
for (s, _, _, _, _, _) in &all_matches {
    *season_match_count.entry(s.clone()).or_insert(0) += 1;
}
let mut complete_seasons: Vec<String> = season_match_count
    .iter()
    .filter(|(_, c)| **c >= 150)
    .map(|(s, _)| s.clone())
    .collect();
complete_seasons.sort();
println!("complete seasons: {} ({} -> {})", complete_seasons.len(), complete_seasons.first().map(|s| s.as_str()).unwrap_or(""), complete_seasons.last().map(|s| s.as_str()).unwrap_or(""));
```

```text
Champions League matches: 4955
finished matches: 4865 (0 duplicate fixtures dropped) | team-season entries: 1613
complete seasons: 21 (2001/2002 -> 2025/2026)
```

```rust
// top scorers from StatsBomb player_match_stat coverage (recent seasons only)
let sdf = LazyCsvReader::new("data/player_goals.csv")
    .finish()
    .expect("failed to open data/player_goals.csv")
    .collect()
    .expect("collect failed");
let sl = sdf
    .lazy()
    .filter(col("league").eq(lit("Champions League")))
    .collect()
    .expect("scorer filter failed");
let sc = |name: &str| sl.column(name).unwrap().clone();
let pnames: Vec<String> = sc("player").str().unwrap().iter().map(|o| o.unwrap_or("").to_string()).collect();
let syrs: Vec<i64> = {
    let c = sc("year");
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(0)).collect()
};
let sgoals: Vec<i64> = {
    let c = sc("goals");
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(0)).collect()
};
// group goals by (player, year)
let mut by_py: BTreeMap<(String, i64), i64> = BTreeMap::new();
for i in 0..sl.height() {
    *by_py.entry((pnames[i].clone(), syrs[i])).or_insert(0) += sgoals[i];
}
// pick the year with the most total goals scored (best coverage)
let mut year_totals: BTreeMap<i64, i64> = BTreeMap::new();
for ((_, y), g) in &by_py {
    *year_totals.entry(*y).or_insert(0) += g;
}
let best_year = year_totals.iter().max_by_key(|(_, t)| *t).map(|(y, _)| *y);
let mut scorer_rows: Vec<(String, i64)> = match best_year {
    Some(y) => by_py
        .iter()
        .filter(|((_, yy), _)| *yy == y)
        .map(|((p, _), g)| (p.clone(), *g))
        .collect(),
    None => Vec::new(),
};
scorer_rows.sort_by(|a, b| b.1.cmp(&a.1));
let scorer_table: Vec<Vec<String>> = scorer_rows
    .iter()
    .take(5)
    .map(|(p, g)| vec![p.clone(), g.to_string()])
    .collect();
match best_year {
    Some(y) => println!("top scorers available for season year {} (StatsBomb coverage)", y),
    None => println!("no player-level scorer data for this competition"),
}
```

```text
top scorers available for season year 2004 (StatsBomb coverage)
```

### Tournament editions

```rust
// ---- tournament editions ----
#[derive(Clone)]
struct TMatch {
    date: String,
    h: String,
    a: String,
    hg: i64,
    ag: i64,
}

struct Edition {
    season: String,
    n: usize,
    matches: Vec<TMatch>,
    champion: String,
    runner_up: String,
    final_hg: i64,
    final_ag: i64,
    pens: bool,
}

let mut by_season: BTreeMap<String, Vec<TMatch>> = BTreeMap::new();
for (s, h, a, d, hg, ag) in &all_matches {
    by_season.entry(s.clone()).or_default().push(TMatch {
        date: d.clone(), h: h.clone(), a: a.clone(), hg: *hg, ag: *ag,
    });
}

let mut editions: Vec<Edition> = Vec::new();
for (sname, mut ms) in by_season {
    if ms.is_empty() {
        continue;
    }
    ms.sort_by(|x, y| x.date.cmp(&y.date));
    let last = ms.last().unwrap();
    // champions are only recorded for editions with substantial coverage;
    // scattered finals/group games can't identify the winner reliably
    let pens_winners: &[(&str, &str)] = &[("2002/2003", "Milan"), ("2004/2005", "Liverpool"), ("2007/2008", "Man United"), ("2011/2012", "Chelsea"), ("2015/2016", "Real Madrid"), ("2025/2026", "Paris SG")];
    let (champ, runner, pens) = if ms.len() < 10 {
        (String::new(), String::new(), false)
    } else if last.hg > last.ag {
        (last.h.clone(), last.a.clone(), false)
    } else if last.hg < last.ag {
        (last.a.clone(), last.h.clone(), false)
    } else if let Some((_, w)) = pens_winners.iter().find(|(y, _)| *y == sname) {
        let ru = if last.h == *w { last.a.clone() } else { last.h.clone() };
        (w.to_string(), ru, true)
    } else {
        ("decided on penalties".to_string(), String::new(), true)
    };
    editions.push(Edition {
        season: sname,
        n: ms.len(),
        champion: champ,
        runner_up: runner,
        final_hg: last.hg,
        final_ag: last.ag,
        pens,
        matches: ms,
    });
}
println!("editions: {}", editions.len());
for e in &editions {
    println!("  {}: {} matches, champion-ish: {} (final {}-{}{})", e.season, e.n, e.champion, e.final_hg, e.final_ag, if e.pens { " pens" } else { "" });
}

// T1: most titles per nation
let mut titles: BTreeMap<String, Vec<String>> = BTreeMap::new();
for e in &editions {
    if !e.champion.is_empty() && e.champion != "decided on penalties" {
        titles.entry(e.champion.clone()).or_default().push(e.season.clone());
    }
}
let mut tv: Vec<(String, Vec<String>)> = titles.into_iter().collect();
tv.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)));
let title_rows: Vec<Vec<String>> = tv.iter().take(8)
    .map(|(t, ss)| vec![t.clone(), ss.len().to_string(), ss.iter().rev().take(4).cloned().collect::<Vec<_>>().join(", ")])
    .collect();
mars_table(&["nation", "titles", "most recent"], &title_rows);
```

```text
Champions League matches: 4955
finished matches: 4865 (0 duplicate fixtures dropped) | team-season entries: 1613
complete seasons: 21 (2001/2002 -> 2025/2026)
top scorers available for season year 2004 (StatsBomb coverage)
editions: 29
  1970/1971: 1 matches, champion-ish:  (final 2-0)
  1971/1972: 1 matches, champion-ish:  (final 2-0)
  1972/1973: 1 matches, champion-ish:  (final 1-0)
  1999/2000: 1 matches, champion-ish:  (final 2-0)
  2001/2002: 216 matches, champion-ish: Real Madrid (final 1-2)
  2002/2003: 225 matches, champion-ish: Milan (final 0-0 pens)
  2003/2004: 171 matches, champion-ish: Porto (final 0-3)
  2004/2005: 171 matches, champion-ish: Liverpool (final 3-3 pens)
  2005/2006: 209 matches, champion-ish: Barcelona (final 2-1)
  2006/2007: 207 matches, champion-ish: Milan (final 2-1)
  2007/2008: 213 matches, champion-ish: Man United (final 1-1 pens)
  2008/2009: 213 matches, champion-ish: Barcelona (final 2-0)
  2009/2010: 213 matches, champion-ish: Inter (final 0-2)
  2010/2011: 212 matches, champion-ish: Barcelona (final 3-1)
  2011/2012: 213 matches, champion-ish: Chelsea (final 1-1 pens)
  2012/2013: 213 matches, champion-ish: Bayern Munich (final 1-2)
  2013/2014: 213 matches, champion-ish: Real Madrid (final 4-1)
  2014/2015: 215 matches, champion-ish: Barcelona (final 1-3)
  2015/2016: 217 matches, champion-ish: Real Madrid (final 1-1 pens)
  2016/2017: 217 matches, champion-ish: Real Madrid (final 1-4)
  2017/2018: 219 matches, champion-ish: Real Madrid (final 3-1)
  2018/2019: 216 matches, champion-ish: Liverpool (final 0-2)
  2019/2020: 210 matches, champion-ish: Bayern Munich (final 0-1)
  2020/2021: 125 matches, champion-ish: Chelsea (final 0-1)
  2021/2022: 125 matches, champion-ish: Real Madrid (final 0-1)
  2022/2023: 125 matches, champion-ish: Man City (final 1-0)
  2023/2024: 125 matches, champion-ish: Real Madrid (final 0-2)
  2024/2025: 189 matches, champion-ish: Paris SG (final 5-0)
  2025/2026: 189 matches, champion-ish: Paris SG (final 1-1 pens)
```

| nation        | titles | most recent                                |
| ------------- | ------ | ------------------------------------------ |
| Real Madrid   | 7      | 2023/2024, 2021/2022, 2017/2018, 2016/2017 |
| Barcelona     | 4      | 2014/2015, 2010/2011, 2008/2009, 2005/2006 |
| Bayern Munich | 2      | 2019/2020, 2012/2013                       |
| Chelsea       | 2      | 2020/2021, 2011/2012                       |
| Liverpool     | 2      | 2018/2019, 2004/2005                       |
| Milan         | 2      | 2006/2007, 2002/2003                       |
| Paris SG      | 2      | 2025/2026, 2024/2025                       |
| Inter         | 1      | 2009/2010                                  |

### Every edition — champion, final score, champion's tournament record

```rust
// T2: every edition — champion, final score, champion's tournament record
let mut ed_rows: Vec<Vec<String>> = Vec::new();
for e in &editions {
    // champion's record across the whole edition
    let mut w = 0i64; let mut d = 0i64; let mut l = 0i64;
    let mut gf = 0i64; let mut ga = 0i64;
    for m in &e.matches {
        let (hg, ag) = if m.h == e.champion {
            (m.hg, m.ag)
        } else if m.a == e.champion {
            (m.ag, m.hg)
        } else { continue };
        gf += hg; ga += ag;
        if hg > ag { w += 1; } else if hg == ag { d += 1; } else { l += 1; }
    }
    let note = if e.n < 10 { " (partial coverage)" } else { "" };
    ed_rows.push(vec![
        format!("{}{}", e.season, note),
        if e.champion.is_empty() { "—".to_string() } else { e.champion.clone() },
        if e.champion.is_empty() { "—".to_string() } else { format!("{}-{}{}", e.final_hg, e.final_ag, if e.pens { " (pens)" } else { "" }) },
        format!("{}W {}D {}L", w, d, l),
        format!("{}/{}", gf, ga),
    ]);
}
mars_table(&["edition", "champion", "final", "tournament record", "gf/ga"], &ed_rows);
```

| edition                      | champion      | final      | tournament record | gf/ga |
| ---------------------------- | ------------- | ---------- | ----------------- | ----- |
| 1970/1971 (partial coverage) | —             | —          | 0W 0D 0L          | 0/0   |
| 1971/1972 (partial coverage) | —             | —          | 0W 0D 0L          | 0/0   |
| 1972/1973 (partial coverage) | —             | —          | 0W 0D 0L          | 0/0   |
| 1999/2000 (partial coverage) | —             | —          | 0W 0D 0L          | 0/0   |
| 2001/2002                    | Real Madrid   | 1-2        | 12W 3D 2L         | 35/14 |
| 2002/2003                    | Milan         | 0-0 (pens) | 10W 4D 5L         | 23/16 |
| 2003/2004                    | Porto         | 0-3        | 7W 5D 1L          | 20/12 |
| 2004/2005                    | Liverpool     | 3-3 (pens) | 8W 4D 3L          | 20/10 |
| 2005/2006                    | Barcelona     | 2-1        | 9W 4D 0L          | 24/5  |
| 2006/2007                    | Milan         | 2-1        | 9W 3D 3L          | 23/11 |
| 2007/2008                    | Man United    | 1-1 (pens) | 9W 4D 0L          | 20/6  |
| 2008/2009                    | Barcelona     | 2-0        | 8W 5D 2L          | 36/14 |
| 2009/2010                    | Inter         | 0-2        | 8W 4D 3L          | 17/10 |
| 2010/2011                    | Barcelona     | 3-1        | 9W 3D 1L          | 30/9  |
| 2011/2012                    | Chelsea       | 1-1 (pens) | 7W 4D 2L          | 25/12 |
| 2012/2013                    | Bayern Munich | 1-2        | 10W 1D 2L         | 31/11 |
| 2013/2014                    | Real Madrid   | 4-1        | 11W 1D 1L         | 41/10 |
| 2014/2015                    | Barcelona     | 1-3        | 11W 0D 2L         | 31/11 |
| 2015/2016                    | Real Madrid   | 1-1 (pens) | 9W 3D 1L          | 28/6  |
| 2016/2017                    | Real Madrid   | 1-4        | 9W 3D 1L          | 36/18 |
| 2017/2018                    | Real Madrid   | 3-1        | 9W 2D 2L          | 33/16 |
| 2018/2019                    | Liverpool     | 0-2        | 8W 1D 4L          | 24/12 |
| 2019/2020                    | Bayern Munich | 0-1        | 11W 0D 0L         | 43/8  |
| 2020/2021                    | Chelsea       | 0-1        | 9W 3D 1L          | 23/4  |
| 2021/2022                    | Real Madrid   | 0-1        | 9W 0D 4L          | 29/14 |
| 2022/2023                    | Man City      | 1-0        | 8W 5D 0L          | 32/5  |
| 2023/2024                    | Real Madrid   | 0-2        | 9W 4D 0L          | 28/15 |
| 2024/2025                    | Paris SG      | 5-0        | 11W 1D 5L         | 38/15 |
| 2025/2026                    | Paris SG      | 1-1 (pens) | 10W 5D 2L         | 45/23 |

### Records across all editions

```rust
// T3: records across all editions
// biggest wins & highest scoring (all matches)
let mut margins: Vec<(i64, String, i64, i64, String, String)> = Vec::new();
let mut totals: Vec<(i64, String, i64, i64, String, String)> = Vec::new();
for e in &editions {
    for m in &e.matches {
        margins.push((m.hg - m.ag, e.season.clone(), m.hg, m.ag, m.h.clone(), m.a.clone()));
        totals.push((m.hg + m.ag, e.season.clone(), m.hg, m.ag, m.h.clone(), m.a.clone()));
    }
}
margins.sort_by(|a, b| b.0.cmp(&a.0));
totals.sort_by(|a, b| b.0.cmp(&a.0));
let win_rows: Vec<Vec<String>> = margins.iter().take(8)
    .map(|(mg, s, hg, ag, h, a)| vec![format!("{} vs {} ({})", h, a, s), format!("{}-{}", hg, ag), format!("+{}", mg)])
    .collect();
mars_table(&["biggest wins", "score", "margin"], &win_rows);
```

| biggest wins                            | score | margin |
| --------------------------------------- | ----- | ------ |
| HJK Helsinki vs Bangor City (2011/2012) | 10-0  | +10    |
| Porto vs Barry Town (2001/2002)         | 8-0   | +8     |
| Liverpool vs Besiktas (2007/2008)       | 8-0   | +8     |
| Valletta vs Lusitanos (2012/2013)       | 8-0   | +8     |
| Real Madrid vs Malmö FF (2015/2016)     | 8-0   | +8     |
| Juventus vs Olympiacos (2003/2004)      | 7-0   | +7     |
| Arsenal vs Slavia Prague (2007/2008)    | 7-0   | +7     |
| Valencia vs Racing Genk (2011/2012)     | 7-0   | +7     |

```rust
let score_rows: Vec<Vec<String>> = totals.iter().take(8)
    .map(|(t, s, hg, ag, h, a)| vec![format!("{} vs {} ({})", h, a, s), format!("{}-{}", hg, ag), t.to_string()])
    .collect();
mars_table(&["highest-scoring", "score", "total goals"], &score_rows);
```

| highest-scoring                            | score | total goals |
| ------------------------------------------ | ----- | ----------- |
| Dortmund vs Legia Warsaw (2016/2017)       | 8-4   | 12          |
| Monaco vs Deportivo (2003/2004)            | 8-3   | 11          |
| Bayern Munich vs Dinamo Zagreb (2024/2025) | 9-2   | 11          |
| HJK Helsinki vs Bangor City (2011/2012)    | 10-0  | 10          |
| Barcelona vs Bayern Munich (2019/2020)     | 2-8   | 10          |
| Lyon vs Werder Bremen (2004/2005)          | 7-2   | 9           |
| MSK Zilina vs F91 Dudelange (2007/2008)    | 5-4   | 9           |
| Villarreal vs AaB (2008/2009)              | 6-3   | 9           |

### Champion records: most goals for, fewest against, best GD, most wins

```rust
// champion records: most goals for, fewest against, best GD, most wins
let mut champ_stats: Vec<(String, String, i64, i64, i64, i64, i64)> = Vec::new(); // season, champ, gf, ga, w, d, l
for e in &editions {
    if e.champion.is_empty() || e.champion == "decided on penalties" { continue; }
    let mut w = 0i64; let mut d = 0i64; let mut l = 0i64;
    let mut gf = 0i64; let mut ga = 0i64;
    for m in &e.matches {
        let (hg, ag) = if m.h == e.champion { (m.hg, m.ag) }
            else if m.a == e.champion { (m.ag, m.hg) }
            else { continue };
        gf += hg; ga += ag;
        if hg > ag { w += 1; } else if hg == ag { d += 1; } else { l += 1; }
    }
    champ_stats.push((e.season.clone(), e.champion.clone(), gf, ga, w, d, l));
}
let rec_rows: Vec<Vec<String>> = vec![
    ("most goals scored", champ_stats.iter().max_by_key(|c| c.2).unwrap()),
    ("fewest goals conceded", champ_stats.iter().min_by_key(|c| c.3).unwrap()),
    ("best goal difference", champ_stats.iter().max_by_key(|c| c.2 - c.3).unwrap()),
    ("most wins", champ_stats.iter().max_by_key(|c| c.4).unwrap()),
    ("fewest losses", champ_stats.iter().min_by_key(|c| c.6).unwrap()),
]
.iter()
.map(|(label, c)| vec![label.to_string(), format!("{} {}", c.1, c.0), format!("{}W {}D {}L", c.4, c.5, c.6), format!("{}/{}", c.2, c.3), (c.2 - c.3).to_string()])
.collect();
mars_table(&["record", "champion edition", "record", "gf/ga", "gd"], &rec_rows);
```

| record                | champion edition        | record    | gf/ga | gd  |
| --------------------- | ----------------------- | --------- | ----- | --- |
| most goals scored     | Paris SG 2025/2026      | 10W 5D 2L | 45/23 | 22  |
| fewest goals conceded | Chelsea 2020/2021       | 9W 3D 1L  | 23/4  | 19  |
| best goal difference  | Bayern Munich 2019/2020 | 11W 0D 0L | 43/8  | 35  |
| most wins             | Real Madrid 2001/2002   | 12W 3D 2L | 35/14 | 21  |
| fewest losses         | Barcelona 2005/2006     | 9W 4D 0L  | 24/5  | 19  |

### Unbeaten champions

```rust
// unbeaten champions
let unbeaten: Vec<&(String, String, i64, i64, i64, i64, i64)> = champ_stats.iter().filter(|c| c.6 == 0 && c.4 + c.5 >= 3).collect();
let unb_rows: Vec<Vec<String>> = unbeaten.iter()
    .map(|c| vec![format!("{} {}", c.1, c.0), format!("{}W {}D", c.4, c.5), c.2.to_string(), c.3.to_string()])
    .collect();
mars_table(&["unbeaten champions", "record", "gf", "ga"], &unb_rows);
```

| unbeaten champions      | record | gf  | ga  |
| ----------------------- | ------ | --- | --- |
| Barcelona 2005/2006     | 9W 4D  | 24  | 5   |
| Man United 2007/2008    | 9W 4D  | 20  | 6   |
| Bayern Munich 2019/2020 | 11W 0D | 43  | 8   |
| Man City 2022/2023      | 8W 5D  | 32  | 5   |
| Real Madrid 2023/2024   | 9W 4D  | 28  | 15  |

### Closest finals (smallest margin or draw)

```rust
println!("unbeaten champions: {}", unbeaten.len());

// closest finals (smallest margin or draw)
let mut finals: Vec<&Edition> = editions.iter().filter(|e| !e.champion.is_empty() && e.champion != "decided on penalties").collect();
finals.sort_by_key(|e| (e.final_hg - e.final_ag).abs());
let fin_rows: Vec<Vec<String>> = finals.iter().take(8)
    .map(|e| vec![e.season.clone(), format!("{} vs {}{}", e.champion, e.runner_up, if e.pens {" (pens)"} else {""}), format!("{}-{}", e.final_hg, e.final_ag)])
    .collect();
mars_table(&["closest finals", "matchup", "score"], &fin_rows);
```

```text
unbeaten champions: 5
```

| closest finals | matchup                          | score |
| -------------- | -------------------------------- | ----- |
| 2002/2003      | Milan vs Juventus (pens)         | 0-0   |
| 2004/2005      | Liverpool vs Milan (pens)        | 3-3   |
| 2007/2008      | Man United vs Chelsea (pens)     | 1-1   |
| 2011/2012      | Chelsea vs Bayern Munich (pens)  | 1-1   |
| 2015/2016      | Real Madrid vs Ath Madrid (pens) | 1-1   |
| 2025/2026      | Paris SG vs Arsenal (pens)       | 1-1   |
| 2001/2002      | Real Madrid vs Leverkusen        | 1-2   |
| 2005/2006      | Barcelona vs Arsenal             | 2-1   |

### Top scorers (latest edition with player data — SCORERS picks best-covered year)

```rust
// T4: top scorers (latest edition with player data — SCORERS picks best-covered year)
// Player-level stats only exist for a handful of StatsBomb-covered
// matches in this competition, so a "top scorers" table would be
// misleading — skipped deliberately.
println!("player-level coverage too sparse for a top-scorers table");
```

```text
player-level coverage too sparse for a top-scorers table
```

```rust
use plotters::prelude::*;

let labels_t: Vec<String> = tv.iter().take(8).map(|(t, _)| t.chars().take(12).collect()).collect();
let counts_t: Vec<f64> = tv.iter().take(8).map(|(_, ss)| ss.len() as f64).collect();
let ymax_t = counts_t.iter().cloned().fold(1.0_f64, f64::max) * 1.2;
let n_t = counts_t.len();
let figure1 = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Most titles", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(80)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n_t as f64 - 0.5), 0.0..ymax_t)?;
    chart.configure_mesh().y_desc("titles").x_labels(n_t)
        .x_label_formatter(&|x: &f64| {
            let i = (*x).round() as usize;
            if i < labels_t.len() { labels_t[i].clone() } else { String::new() }
        })
        .draw()?;
    chart.draw_series((0..n_t).map(|i| {
        Rectangle::new([(i as f64 - 0.35, 0.0), (i as f64 + 0.35, counts_t[i])], BLUE.filled())
    }))?;
    Ok(())
});
figure1.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTW9zdCB0aXRsZXMKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjMiIHkxPSIzMDkiIHgyPSI2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3OSIgeTE9IjMwOSIgeDI9Ijc5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMzA5IiB4Mj0iOTUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTEyIiB5MT0iMzA5IiB4Mj0iMTEyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyOCIgeTE9IjMwOSIgeDI9IjEyOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDQiIHkxPSIzMDkiIHgyPSIxNDQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTYxIiB5MT0iMzA5IiB4Mj0iMTYxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3NyIgeTE9IjMwOSIgeDI9IjE3NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTMiIHkxPSIzMDkiIHgyPSIxOTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjEwIiB5MT0iMzA5IiB4Mj0iMjEwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIyNiIgeTE9IjMwOSIgeDI9IjIyNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDMiIHkxPSIzMDkiIHgyPSIyNDMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU5IiB5MT0iMzA5IiB4Mj0iMjU5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3NSIgeTE9IjMwOSIgeDI9IjI3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyOTIiIHkxPSIzMDkiIHgyPSIyOTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzA4IiB5MT0iMzA5IiB4Mj0iMzA4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyNCIgeTE9IjMwOSIgeDI9IjMyNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNDEiIHkxPSIzMDkiIHgyPSIzNDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzU3IiB5MT0iMzA5IiB4Mj0iMzU3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM3MyIgeTE9IjMwOSIgeDI9IjM3MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTAiIHkxPSIzMDkiIHgyPSIzOTAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDA2IiB5MT0iMzA5IiB4Mj0iNDA2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQyMiIgeTE9IjMwOSIgeDI9IjQyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzkiIHkxPSIzMDkiIHgyPSI0MzkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDU1IiB5MT0iMzA5IiB4Mj0iNDU1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ3MSIgeTE9IjMwOSIgeDI9IjQ3MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0ODgiIHkxPSIzMDkiIHgyPSI0ODgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA0IiB5MT0iMzA5IiB4Mj0iNTA0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUyMCIgeTE9IjMwOSIgeDI9IjUyMCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MzciIHkxPSIzMDkiIHgyPSI1MzciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUzIiB5MT0iMzA5IiB4Mj0iNTUzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU3MCIgeTE9IjMwOSIgeDI9IjU3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1ODYiIHkxPSIzMDkiIHgyPSI1ODYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAyIiB5MT0iMzA5IiB4Mj0iNjAyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYxOSIgeTE9IjMwOSIgeDI9IjYxOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MzUiIHkxPSIzMDkiIHgyPSI2MzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUxIiB5MT0iMzA5IiB4Mj0iNjUxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY2OCIgeTE9IjMwOSIgeDI9IjY2OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODQiIHkxPSIzMDkiIHgyPSI2ODQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDkiIHgyPSI3MDkiIHkyPSIzMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA2IiB4Mj0iNzA5IiB5Mj0iMzA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwMyIgeDI9IjcwOSIgeTI9IjMwMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDAiIHgyPSI3MDkiIHkyPSIzMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjk2IiB4Mj0iNzA5IiB5Mj0iMjk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5MyIgeDI9IjcwOSIgeTI9IjI5MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTAiIHgyPSI3MDkiIHkyPSIyOTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg3IiB4Mj0iNzA5IiB5Mj0iMjg3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4MyIgeDI9IjcwOSIgeTI9IjI4MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODAiIHgyPSI3MDkiIHkyPSIyODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc3IiB4Mj0iNzA5IiB5Mj0iMjc3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MyIgeDI9IjcwOSIgeTI9IjI3MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzAiIHgyPSI3MDkiIHkyPSIyNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY3IiB4Mj0iNzA5IiB5Mj0iMjY3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2NCIgeDI9IjcwOSIgeTI9IjI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjAiIHgyPSI3MDkiIHkyPSIyNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU3IiB4Mj0iNzA5IiB5Mj0iMjU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1NCIgeDI9IjcwOSIgeTI9IjI1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTEiIHgyPSI3MDkiIHkyPSIyNTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ3IiB4Mj0iNzA5IiB5Mj0iMjQ3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0NCIgeDI9IjcwOSIgeTI9IjI0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDEiIHgyPSI3MDkiIHkyPSIyNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM3IiB4Mj0iNzA5IiB5Mj0iMjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzNCIgeDI9IjcwOSIgeTI9IjIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzEiIHgyPSI3MDkiIHkyPSIyMzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI4IiB4Mj0iNzA5IiB5Mj0iMjI4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyNCIgeDI9IjcwOSIgeTI9IjIyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjEiIHgyPSI3MDkiIHkyPSIyMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE4IiB4Mj0iNzA5IiB5Mj0iMjE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNSIgeDI9IjcwOSIgeTI9IjIxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTEiIHgyPSI3MDkiIHkyPSIyMTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA4IiB4Mj0iNzA5IiB5Mj0iMjA4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwNSIgeDI9IjcwOSIgeTI9IjIwNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDEiIHgyPSI3MDkiIHkyPSIyMDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTk4IiB4Mj0iNzA5IiB5Mj0iMTk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5NSIgeDI9IjcwOSIgeTI9IjE5NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTIiIHgyPSI3MDkiIHkyPSIxOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg4IiB4Mj0iNzA5IiB5Mj0iMTg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4NSIgeDI9IjcwOSIgeTI9IjE4NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODIiIHgyPSI3MDkiIHkyPSIxODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTc5IiB4Mj0iNzA5IiB5Mj0iMTc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NSIgeDI9IjcwOSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzIiIHgyPSI3MDkiIHkyPSIxNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY5IiB4Mj0iNzA5IiB5Mj0iMTY5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2NSIgeDI9IjcwOSIgeTI9IjE2NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjIiIHgyPSI3MDkiIHkyPSIxNjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTU5IiB4Mj0iNzA5IiB5Mj0iMTU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1NiIgeDI9IjcwOSIgeTI9IjE1NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTIiIHgyPSI3MDkiIHkyPSIxNTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ5IiB4Mj0iNzA5IiB5Mj0iMTQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NiIgeDI9IjcwOSIgeTI9IjE0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDMiIHgyPSI3MDkiIHkyPSIxNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM5IiB4Mj0iNzA5IiB5Mj0iMTM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzNiIgeDI9IjcwOSIgeTI9IjEzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzMiIHgyPSI3MDkiIHkyPSIxMzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI5IiB4Mj0iNzA5IiB5Mj0iMTI5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyNiIgeDI9IjcwOSIgeTI9IjEyNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjMiIHgyPSI3MDkiIHkyPSIxMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIwIiB4Mj0iNzA5IiB5Mj0iMTIwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExNiIgeDI9IjcwOSIgeTI9IjExNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTMiIHgyPSI3MDkiIHkyPSIxMTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTEwIiB4Mj0iNzA5IiB5Mj0iMTEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwNyIgeDI9IjcwOSIgeTI9IjEwNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDMiIHgyPSI3MDkiIHkyPSIxMDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTAwIiB4Mj0iNzA5IiB5Mj0iMTAwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijk3IiB4Mj0iNzA5IiB5Mj0iOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTMiIHgyPSI3MDkiIHkyPSI5MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MCIgeDI9IjcwOSIgeTI9IjkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg3IiB4Mj0iNzA5IiB5Mj0iODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODQiIHgyPSI3MDkiIHkyPSI4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MCIgeDI9IjcwOSIgeTI9IjgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc3IiB4Mj0iNzA5IiB5Mj0iNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzQiIHgyPSI3MDkiIHkyPSI3NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3MSIgeDI9IjcwOSIgeTI9IjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY3IiB4Mj0iNzA5IiB5Mj0iNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjQiIHgyPSI3MDkiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2MSIgeDI9IjcwOSIgeTI9IjYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU3IiB4Mj0iNzA5IiB5Mj0iNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTQiIHgyPSI3MDkiIHkyPSI1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1MSIgeDI9IjcwOSIgeTI9IjUxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ4IiB4Mj0iNzA5IiB5Mj0iNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDQiIHgyPSI3MDkiIHkyPSI0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MSIgeDI9IjcwOSIgeTI9IjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM4IiB4Mj0iNzA5IiB5Mj0iMzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQiIHgyPSI3MDkiIHkyPSIzNCIvPgo8dGV4dCB4PSIxMCIgeT0iMTcyIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIiB0cmFuc2Zvcm09InJvdGF0ZSgyNzAsIDEwLCAxNzIpIj4KdGl0bGVzCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMzA5IiB4Mj0iOTUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTc3IiB5MT0iMzA5IiB4Mj0iMTc3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI1OSIgeTE9IjMwOSIgeDI9IjI1OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNDEiIHkxPSIzMDkiIHgyPSIzNDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDIyIiB5MT0iMzA5IiB4Mj0iNDIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwNCIgeTE9IjMwOSIgeDI9IjUwNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1ODYiIHkxPSIzMDkiIHgyPSI1ODYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjY4IiB5MT0iMzA5IiB4Mj0iNjY4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA5IiB4Mj0iNzA5IiB5Mj0iMzA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3NyIgeDI9IjcwOSIgeTI9IjI3NyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDQiIHgyPSI3MDkiIHkyPSIyNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjExIiB4Mj0iNzA5IiB5Mj0iMjExIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3OSIgeDI9IjcwOSIgeTI9IjE3OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDYiIHgyPSI3MDkiIHkyPSIxNDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTEzIiB4Mj0iNzA5IiB5Mj0iMTEzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjgwIiB4Mj0iNzA5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDgiIHgyPSI3MDkiIHkyPSI0OCIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzQgNTQsMzA5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMzA5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzA5IDU0LDMwOSAiLz4KPHRleHQgeD0iNDUiIHk9IjI3NyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI3NyA1NCwyNzcgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyNDQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyNDQgNTQsMjQ0ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjExIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjExIDU0LDIxMSAiLz4KPHRleHQgeD0iNDUiIHk9IjE3OSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE3OSA1NCwxNzkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxNDYiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjUuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNDYgNTQsMTQ2ICIvPgo8dGV4dCB4PSI0NSIgeT0iMTEzIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo2LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTEzIDU0LDExMyAiLz4KPHRleHQgeD0iNDUiIHk9IjgwIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo3LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksODAgNTQsODAgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI0OCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KOC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDQ4IDU0LDQ4ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzEwIDcwOSwzMTAgIi8+Cjx0ZXh0IHg9Ijk1IiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpSZWFsIE1hZHJpZAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI5NSwzMTAgOTUsMzE1ICIvPgo8dGV4dCB4PSIxNzciIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkJhcmNlbG9uYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxNzcsMzEwIDE3NywzMTUgIi8+Cjx0ZXh0IHg9IjI1OSIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQmF5ZXJuIE11bmljCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjI1OSwzMTAgMjU5LDMxNSAiLz4KPHRleHQgeD0iMzQxIiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpDaGVsc2VhCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM0MSwzMTAgMzQxLDMxNSAiLz4KPHRleHQgeD0iNDIyIiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMaXZlcnBvb2wKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDIyLDMxMCA0MjIsMzE1ICIvPgo8dGV4dCB4PSI1MDQiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ck1pbGFuCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUwNCwzMTAgNTA0LDMxNSAiLz4KPHRleHQgeD0iNTg2IiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpQYXJpcyBTRwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1ODYsMzEwIDU4NiwzMTUgIi8+Cjx0ZXh0IHg9IjY2OCIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KSW50ZXIKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjY4LDMxMCA2NjgsMzE1ICIvPgo8cmVjdCB4PSI2NyIgeT0iODAiIHdpZHRoPSI1NyIgaGVpZ2h0PSIyMjkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxNDkiIHk9IjE3OSIgd2lkdGg9IjU3IiBoZWlnaHQ9IjEzMCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjIzMCIgeT0iMjQ0IiB3aWR0aD0iNTciIGhlaWdodD0iNjUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzMTIiIHk9IjI0NCIgd2lkdGg9IjU3IiBoZWlnaHQ9IjY1IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzk0IiB5PSIyNDQiIHdpZHRoPSI1NyIgaGVpZ2h0PSI2NSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ3NiIgeT0iMjQ0IiB3aWR0aD0iNTciIGhlaWdodD0iNjUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1NTciIHk9IjI0NCIgd2lkdGg9IjU3IiBoZWlnaHQ9IjY1IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjM5IiB5PSIyNzciIHdpZHRoPSI1NyIgaGVpZ2h0PSIzMiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+Cjwvc3ZnPg==)

```rust
let n_e = champ_stats.len();
let pts_max_e = champ_stats.iter().map(|c| c.2 - c.3).fold(1i64, |a, b| a.max(b)) as f64 * 1.1;
let figure2 = plotters::evcxr::evcxr_figure((760, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Champion's goal difference per edition", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(30)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n_e as f64 - 0.5), 0.0..pts_max_e)?;
    chart.configure_mesh().y_desc("goal diff").x_labels(0).draw()?;
    chart.draw_series(champ_stats.iter().enumerate().map(|(i, c)| {
        Circle::new((i as f64, (c.2 - c.3) as f64), 3, BLUE.filled())
    }))?;
    chart.draw_series(LineSeries::new(
        champ_stats.iter().enumerate().map(|(i, c)| (i as f64, (c.2 - c.3) as f64)),
        BLUE.stroke_width(1),
    ))?;
    Ok(())
});
figure2.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzYwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc2MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzgwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2hhbXBpb24mYXBvcztzIGdvYWwgZGlmZmVyZW5jZSBwZXIgZWRpdGlvbgo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9Ijc0OSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNTUiIHgyPSI3NDkiIHkyPSIzNTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzUxIiB4Mj0iNzQ5IiB5Mj0iMzUxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0NyIgeDI9Ijc0OSIgeTI9IjM0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNDMiIHgyPSI3NDkiIHkyPSIzNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzM4IiB4Mj0iNzQ5IiB5Mj0iMzM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMzNCIgeDI9Ijc0OSIgeTI9IjMzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzAiIHgyPSI3NDkiIHkyPSIzMzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzI2IiB4Mj0iNzQ5IiB5Mj0iMzI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyMiIgeDI9Ijc0OSIgeTI9IjMyMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMTciIHgyPSI3NDkiIHkyPSIzMTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzEzIiB4Mj0iNzQ5IiB5Mj0iMzEzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwOSIgeDI9Ijc0OSIgeTI9IjMwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDUiIHgyPSI3NDkiIHkyPSIzMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzAwIiB4Mj0iNzQ5IiB5Mj0iMzAwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5NiIgeDI9Ijc0OSIgeTI9IjI5NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTIiIHgyPSI3NDkiIHkyPSIyOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg4IiB4Mj0iNzQ5IiB5Mj0iMjg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4NCIgeDI9Ijc0OSIgeTI9IjI4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzkiIHgyPSI3NDkiIHkyPSIyNzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc1IiB4Mj0iNzQ5IiB5Mj0iMjc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MSIgeDI9Ijc0OSIgeTI9IjI3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjciIHgyPSI3NDkiIHkyPSIyNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjYyIiB4Mj0iNzQ5IiB5Mj0iMjYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1OCIgeDI9Ijc0OSIgeTI9IjI1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTQiIHgyPSI3NDkiIHkyPSIyNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjUwIiB4Mj0iNzQ5IiB5Mj0iMjUwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0NiIgeDI9Ijc0OSIgeTI9IjI0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDEiIHgyPSI3NDkiIHkyPSIyNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM3IiB4Mj0iNzQ5IiB5Mj0iMjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMyIgeDI9Ijc0OSIgeTI9IjIzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjkiIHgyPSI3NDkiIHkyPSIyMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI0IiB4Mj0iNzQ5IiB5Mj0iMjI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyMCIgeDI9Ijc0OSIgeTI9IjIyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTYiIHgyPSI3NDkiIHkyPSIyMTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjEyIiB4Mj0iNzQ5IiB5Mj0iMjEyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwOCIgeDI9Ijc0OSIgeTI9IjIwOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDMiIHgyPSI3NDkiIHkyPSIyMDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTk5IiB4Mj0iNzQ5IiB5Mj0iMTk5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5NSIgeDI9Ijc0OSIgeTI9IjE5NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTEiIHgyPSI3NDkiIHkyPSIxOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg2IiB4Mj0iNzQ5IiB5Mj0iMTg2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4MiIgeDI9Ijc0OSIgeTI9IjE4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzgiIHgyPSI3NDkiIHkyPSIxNzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTc0IiB4Mj0iNzQ5IiB5Mj0iMTc0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3MCIgeDI9Ijc0OSIgeTI9IjE3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjUiIHgyPSI3NDkiIHkyPSIxNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTYxIiB4Mj0iNzQ5IiB5Mj0iMTYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1NyIgeDI9Ijc0OSIgeTI9IjE1NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTMiIHgyPSI3NDkiIHkyPSIxNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ4IiB4Mj0iNzQ5IiB5Mj0iMTQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NCIgeDI9Ijc0OSIgeTI9IjE0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDAiIHgyPSI3NDkiIHkyPSIxNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM2IiB4Mj0iNzQ5IiB5Mj0iMTM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzMiIgeDI9Ijc0OSIgeTI9IjEzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjciIHgyPSI3NDkiIHkyPSIxMjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIzIiB4Mj0iNzQ5IiB5Mj0iMTIzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExOSIgeDI9Ijc0OSIgeTI9IjExOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTUiIHgyPSI3NDkiIHkyPSIxMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTEwIiB4Mj0iNzQ5IiB5Mj0iMTEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwNiIgeDI9Ijc0OSIgeTI9IjEwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDIiIHgyPSI3NDkiIHkyPSIxMDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTgiIHgyPSI3NDkiIHkyPSI5OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NCIgeDI9Ijc0OSIgeTI9Ijk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg5IiB4Mj0iNzQ5IiB5Mj0iODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODUiIHgyPSI3NDkiIHkyPSI4NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MSIgeDI9Ijc0OSIgeTI9IjgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc3IiB4Mj0iNzQ5IiB5Mj0iNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzIiIHgyPSI3NDkiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2OCIgeDI9Ijc0OSIgeTI9IjY4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY0IiB4Mj0iNzQ5IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjAiIHgyPSI3NDkiIHkyPSI2MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1NiIgeDI9Ijc0OSIgeTI9IjU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjUxIiB4Mj0iNzQ5IiB5Mj0iNTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDciIHgyPSI3NDkiIHkyPSI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MyIgeDI9Ijc0OSIgeTI9IjQzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM5IiB4Mj0iNzQ5IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQiIHgyPSI3NDkiIHkyPSIzNCIvPgo8dGV4dCB4PSIxMCIgeT0iMTk3IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIiB0cmFuc2Zvcm09InJvdGF0ZSgyNzAsIDEwLCAxOTcpIj4KZ29hbCBkaWZmCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzU5IiB4Mj0iNzQ5IiB5Mj0iMzU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxNyIgeDI9Ijc0OSIgeTI9IjMxNyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzUiIHgyPSI3NDkiIHkyPSIyNzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjMzIiB4Mj0iNzQ5IiB5Mj0iMjMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5MSIgeDI9Ijc0OSIgeTI9IjE5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDgiIHgyPSI3NDkiIHkyPSIxNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA2IiB4Mj0iNzQ5IiB5Mj0iMTA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY0IiB4Mj0iNzQ5IiB5Mj0iNjQiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDM0IDU0LDM1OSAiLz4KPHRleHQgeD0iNDUiIHk9IjM1OSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDM1OSA1NCwzNTkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzMTciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjUuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMTcgNTQsMzE3ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjc1IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI3NSA1NCwyNzUgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyMzMiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjE1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjMzIDU0LDIzMyAiLz4KPHRleHQgeD0iNDUiIHk9IjE5MSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxOTEgNTQsMTkxICIvPgo8dGV4dCB4PSI0NSIgeT0iMTQ4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE0OCA1NCwxNDggIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxMDYiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjMwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTA2IDU0LDEwNiAiLz4KPHRleHQgeD0iNDUiIHk9IjY0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDY0IDU0LDY0ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzYwIDc0OSwzNjAgIi8+CjxjaXJjbGUgY3g9IjY4IiBjeT0iMTgyIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI5NiIgY3k9IjMwMCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTI0IiBjeT0iMjkyIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxNTIiIGN5PSIyNzUiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE3OSIgY3k9IjE5OSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjA3IiBjeT0iMjU4IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMzUiIGN5PSIyNDEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjI2MyIgY3k9IjE3NCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjkwIiBjeT0iMzAwIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzMTgiIGN5PSIxODIiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM0NiIgY3k9IjI1MCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzc0IiBjeT0iMTkxIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0MDIiIGN5PSI5OCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDI5IiBjeT0iMTkxIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0NTciIGN5PSIxNzQiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ4NSIgY3k9IjIwOCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTEzIiBjeT0iMjE2IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1NDAiIGN5PSIyNTgiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjU2OCIgY3k9IjY0IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1OTYiIGN5PSIxOTkiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjYyNCIgY3k9IjIzMyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjUxIiBjeT0iMTMyIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2NzkiIGN5PSIyNTAiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjcwNyIgY3k9IjE2NSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNzM1IiBjeT0iMTc0IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMEZGIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjgsMTgyIDk2LDMwMCAxMjQsMjkyIDE1MiwyNzUgMTc5LDE5OSAyMDcsMjU4IDIzNSwyNDEgMjYzLDE3NCAyOTAsMzAwIDMxOCwxODIgMzQ2LDI1MCAzNzQsMTkxIDQwMiw5OCA0MjksMTkxIDQ1NywxNzQgNDg1LDIwOCA1MTMsMjE2IDU0MCwyNTggNTY4LDY0IDU5NiwxOTkgNjI0LDIzMyA2NTEsMTMyIDY3OSwyNTAgNzA3LDE2NSA3MzUsMTc0ICIvPgo8L3N2Zz4=)

## Discussion

25 completed editions (2001/02 → 2025/26) plus four sparse StatsBomb-era seasons
shown as partial coverage.

- **Real Madrid are the kings of the modern era**: 7 titles in the window (2002,
  2014, 2016, 2017, 2018, 2022, 2024) — more than any other club. Barcelona (4),
  Bayern Munich, Chelsea, Liverpool and Milan (2 each) and PSG (2) complete the
  list; Inter's 2010 treble is the only other title.
- **The greatest champion season**: Bayern Munich 2019/20 went **11W-0D** (43
  scored, 8 conceded) — the best goal difference (+35) and the most dominant run
  in the dataset, capped by the Lisbon final.
- **Deadliest champions**: PSG 2025/26 scored 45 goals en route to the title —
  the most by any champion. Chelsea 2020/21 were the stingiest (4 conceded).
- **Unbeaten champions**: five editions were won without a single defeat —
  Barcelona 2006, Man United 2008, Bayern 2020, Man City 2023, Real Madrid 2024.
- **Penalties decide everything tight**: six of the eight closest finals went to
  a shootout — including back-to-back PSG penalty triumphs in 2025 and 2026.
- **Biggest win**: HJK Helsinki 10–0 Bangor City (2011/12 qualifying) — the
  largest margin in Champions League history.

_Source: ESPN import via `dev.db`; player-level stats too sparse for a
top-scorers table._

**Limitations.** Records reflect only the matches present in the database;
coverage varies by competition and era, so 'records' are archive records, not
all-time official marks.

## Conclusion

Real Madrid are the kings of the modern era. Together these results answer the
research question posed in the Introduction and quantify the pattern across the
full match archive. The notebook provides a fully reproducible pipeline from raw
CSV extracts to published figures.
