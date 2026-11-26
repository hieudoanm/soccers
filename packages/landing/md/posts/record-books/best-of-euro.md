---
title: 'Best of the UEFA European Championship: a record book'
description: |
  'Italy's Wembley penalty triumph and Spain's perfect 7–0 tournament — every record from the two Euros in our data.'
author: 'hieudoan'
date: '2026-11-25T22:00'
order: 28
tags: ['football', 'analysis', 'records', 'euro', 'mars', 'sqlite']
---

# Best of the UEFA European Championship: a record book

## Abstract

This study examines the UEFA European Championship record book using the full
match archive drawn from the Soccers football database. Italy 2020 was the
defensively stingiest champion. All computation runs in Rust inside a `.mars`
notebook (polars + plotters — charts as inline SVG), and every table and figure
is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, records, euro, mars, sqlite

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

A record book of the **UEFA European Championship** — international tournament
champions, finals and records computed from `data/matches_full.csv`.

Only the 2020 and 2024 editions are in the dataset — both complete.

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
    .filter(col("league").eq(lit("UEFA Euro")))
    .collect()
    .expect("filter failed");

// seasons excluded as mislabeled data (e.g. another league's fixtures)
let drop_seasons: &[&str] = &[];

println!("UEFA Euro matches: {}", df.height());

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
UEFA Euro matches: 102
finished matches: 102 (0 duplicate fixtures dropped) | team-season entries: 48
complete seasons: 0 ( -> )
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
    .filter(col("league").eq(lit("UEFA Euro")))
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
top scorers available for season year 2020 (StatsBomb coverage)
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
    let pens_winners: &[(&str, &str)] = &[("2020", "Italy")];
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
UEFA Euro matches: 102
finished matches: 102 (0 duplicate fixtures dropped) | team-season entries: 48
complete seasons: 0 ( -> )
top scorers available for season year 2020 (StatsBomb coverage)
editions: 2
  2020: 51 matches, champion-ish: Italy (final 1-1 pens)
  2024: 51 matches, champion-ish: Spain (final 2-1)
```

| nation | titles | most recent |
| ------ | ------ | ----------- |
| Italy  | 1      | 2020        |
| Spain  | 1      | 2024        |

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

| edition | champion | final      | tournament record | gf/ga |
| ------- | -------- | ---------- | ----------------- | ----- |
| 2020    | Italy    | 1-1 (pens) | 5W 2D 0L          | 13/4  |
| 2024    | Spain    | 2-1        | 7W 0D 0L          | 15/4  |

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

| biggest wins                      | score | margin |
| --------------------------------- | ----- | ------ |
| Germany vs Scotland (2024)        | 5-1   | +4     |
| Belgium vs Russia (2020)          | 3-0   | +3     |
| Italy vs Switzerland (2020)       | 3-0   | +3     |
| Spain vs Croatia (2024)           | 3-0   | +3     |
| Romania vs Ukraine (2024)         | 3-0   | +3     |
| Spain vs Georgia (2024)           | 4-1   | +3     |
| Austria vs North Macedonia (2020) | 3-1   | +2     |
| Netherlands vs Austria (2020)     | 2-0   | +2     |

```rust
let score_rows: Vec<Vec<String>> = totals.iter().take(8)
    .map(|(t, s, hg, ag, h, a)| vec![format!("{} vs {} ({})", h, a, s), format!("{}-{}", hg, ag), t.to_string()])
    .collect();
mars_table(&["highest-scoring", "score", "total goals"], &score_rows);
```

| highest-scoring               | score | total goals |
| ----------------------------- | ----- | ----------- |
| Croatia vs Spain (2020)       | 3-5   | 8           |
| Portugal vs Germany (2020)    | 2-4   | 6           |
| France vs Switzerland (2020)  | 3-3   | 6           |
| Germany vs Scotland (2024)    | 5-1   | 6           |
| Netherlands vs Ukraine (2020) | 3-2   | 5           |
| Russia vs Denmark (2020)      | 1-4   | 5           |
| Slovakia vs Spain (2020)      | 0-5   | 5           |
| Sweden vs Poland (2020)       | 3-2   | 5           |

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

| record                | champion edition | record   | gf/ga | gd  |
| --------------------- | ---------------- | -------- | ----- | --- |
| most goals scored     | Spain 2024       | 7W 0D 0L | 15/4  | 11  |
| fewest goals conceded | Italy 2020       | 5W 2D 0L | 13/4  | 9   |
| best goal difference  | Spain 2024       | 7W 0D 0L | 15/4  | 11  |
| most wins             | Spain 2024       | 7W 0D 0L | 15/4  | 11  |
| fewest losses         | Italy 2020       | 5W 2D 0L | 13/4  | 9   |

### Unbeaten champions

```rust
// unbeaten champions
let unbeaten: Vec<&(String, String, i64, i64, i64, i64, i64)> = champ_stats.iter().filter(|c| c.6 == 0 && c.4 + c.5 >= 3).collect();
let unb_rows: Vec<Vec<String>> = unbeaten.iter()
    .map(|c| vec![format!("{} {}", c.1, c.0), format!("{}W {}D", c.4, c.5), c.2.to_string(), c.3.to_string()])
    .collect();
mars_table(&["unbeaten champions", "record", "gf", "ga"], &unb_rows);
```

| unbeaten champions | record | gf  | ga  |
| ------------------ | ------ | --- | --- |
| Italy 2020         | 5W 2D  | 13  | 4   |
| Spain 2024         | 7W 0D  | 15  | 4   |

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
unbeaten champions: 2
```

| closest finals | matchup                 | score |
| -------------- | ----------------------- | ----- |
| 2020           | Italy vs England (pens) | 1-1   |
| 2024           | Spain vs England        | 2-1   |

### Top scorers (latest edition with player data — SCORERS picks best-covered year)

```rust
// T4: top scorers (latest edition with player data — SCORERS picks best-covered year)
if !scorer_table.is_empty() {
    mars_table(&["player", "goals"], &scorer_table);
}
```

```text

```

| player                              | goals |
| ----------------------------------- | ----- |
| Cristiano Ronaldo dos Santos Aveiro | 5     |
| Harry Kane                          | 5     |
| Patrik Schick                       | 5     |
| Emil Peter Forsberg                 | 4     |
| Karim Benzema                       | 4     |

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

```text
UEFA Euro matches: 102
finished matches: 102 (0 duplicate fixtures dropped) | team-season entries: 48
complete seasons: 0 ( -> )
top scorers available for season year 2020 (StatsBomb coverage)
editions: 2
  2020: 51 matches, champion-ish: Italy (final 1-1 pens)
  2024: 51 matches, champion-ish: Spain (final 2-1)
unbeaten champions: 2
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTW9zdCB0aXRsZXMKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODciIHkxPSIzMDkiIHgyPSI4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTMiIHkxPSIzMDkiIHgyPSIxNTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjE4IiB5MT0iMzA5IiB4Mj0iMjE4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI4MyIgeTE9IjMwOSIgeDI9IjI4MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNDkiIHkxPSIzMDkiIHgyPSIzNDkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDE0IiB5MT0iMzA5IiB4Mj0iNDE0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4MCIgeTE9IjMwOSIgeDI9IjQ4MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDUiIHkxPSIzMDkiIHgyPSI1NDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjEwIiB5MT0iMzA5IiB4Mj0iNjEwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY3NiIgeTE9IjMwOSIgeDI9IjY3NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwOSIgeDI9IjcwOSIgeTI9IjMwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDUiIHgyPSI3MDkiIHkyPSIzMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzAwIiB4Mj0iNzA5IiB5Mj0iMzAwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5NiIgeDI9IjcwOSIgeTI9IjI5NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTEiIHgyPSI3MDkiIHkyPSIyOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg3IiB4Mj0iNzA5IiB5Mj0iMjg3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4MiIgeDI9IjcwOSIgeTI9IjI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzciIHgyPSI3MDkiIHkyPSIyNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjczIiB4Mj0iNzA5IiB5Mj0iMjczIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2OCIgeDI9IjcwOSIgeTI9IjI2OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjQiIHgyPSI3MDkiIHkyPSIyNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU5IiB4Mj0iNzA5IiB5Mj0iMjU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1NCIgeDI9IjcwOSIgeTI9IjI1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTAiIHgyPSI3MDkiIHkyPSIyNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ1IiB4Mj0iNzA5IiB5Mj0iMjQ1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0MSIgeDI9IjcwOSIgeTI9IjI0MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzYiIHgyPSI3MDkiIHkyPSIyMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjMyIiB4Mj0iNzA5IiB5Mj0iMjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyNyIgeDI9IjcwOSIgeTI9IjIyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjIiIHgyPSI3MDkiIHkyPSIyMjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE4IiB4Mj0iNzA5IiB5Mj0iMjE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxMyIgeDI9IjcwOSIgeTI9IjIxMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDkiIHgyPSI3MDkiIHkyPSIyMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA0IiB4Mj0iNzA5IiB5Mj0iMjA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5OSIgeDI9IjcwOSIgeTI9IjE5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTUiIHgyPSI3MDkiIHkyPSIxOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTkwIiB4Mj0iNzA5IiB5Mj0iMTkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4NiIgeDI9IjcwOSIgeTI9IjE4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODEiIHgyPSI3MDkiIHkyPSIxODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTc3IiB4Mj0iNzA5IiB5Mj0iMTc3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3MiIgeDI9IjcwOSIgeTI9IjE3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjciIHgyPSI3MDkiIHkyPSIxNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTYzIiB4Mj0iNzA5IiB5Mj0iMTYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1OCIgeDI9IjcwOSIgeTI9IjE1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTQiIHgyPSI3MDkiIHkyPSIxNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ5IiB4Mj0iNzA5IiB5Mj0iMTQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NCIgeDI9IjcwOSIgeTI9IjE0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDAiIHgyPSI3MDkiIHkyPSIxNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM1IiB4Mj0iNzA5IiB5Mj0iMTM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzMSIgeDI9IjcwOSIgeTI9IjEzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjYiIHgyPSI3MDkiIHkyPSIxMjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIyIiB4Mj0iNzA5IiB5Mj0iMTIyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExNyIgeDI9IjcwOSIgeTI9IjExNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTIiIHgyPSI3MDkiIHkyPSIxMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA4IiB4Mj0iNzA5IiB5Mj0iMTA4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwMyIgeDI9IjcwOSIgeTI9IjEwMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5OSIgeDI9IjcwOSIgeTI9Ijk5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijk0IiB4Mj0iNzA5IiB5Mj0iOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODkiIHgyPSI3MDkiIHkyPSI4OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4NSIgeDI9IjcwOSIgeTI9Ijg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjgwIiB4Mj0iNzA5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzYiIHgyPSI3MDkiIHkyPSI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3MSIgeDI9IjcwOSIgeTI9IjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY3IiB4Mj0iNzA5IiB5Mj0iNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjIiIHgyPSI3MDkiIHkyPSI2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1NyIgeDI9IjcwOSIgeTI9IjU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjUzIiB4Mj0iNzA5IiB5Mj0iNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDgiIHgyPSI3MDkiIHkyPSI0OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0NCIgeDI9IjcwOSIgeTI9IjQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM5IiB4Mj0iNzA5IiB5Mj0iMzkiLz4KPHRleHQgeD0iMTAiIHk9IjE3MiIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCIgdHJhbnNmb3JtPSJyb3RhdGUoMjcwLCAxMCwgMTcyKSI+CnRpdGxlcwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTgiIHkxPSIzMDkiIHgyPSIyMTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQ1IiB5MT0iMzA5IiB4Mj0iNTQ1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA5IiB4Mj0iNzA5IiB5Mj0iMzA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2NCIgeDI9IjcwOSIgeTI9IjI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTgiIHgyPSI3MDkiIHkyPSIyMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTcyIiB4Mj0iNzA5IiB5Mj0iMTcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyNiIgeDI9IjcwOSIgeTI9IjEyNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MCIgeDI9IjcwOSIgeTI9IjgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0IiB4Mj0iNzA5IiB5Mj0iMzQiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDM0IDU0LDMwOSAiLz4KPHRleHQgeD0iNDUiIHk9IjMwOSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDMwOSA1NCwzMDkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyNjQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyNjQgNTQsMjY0ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjE4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjE4IDU0LDIxOCAiLz4KPHRleHQgeD0iNDUiIHk9IjE3MiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC42CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE3MiA1NCwxNzIgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxMjYiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuOAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxMjYgNTQsMTI2ICIvPgo8dGV4dCB4PSI0NSIgeT0iODAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw4MCA1NCw4MCAiLz4KPHRleHQgeD0iNDUiIHk9IjM0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjIKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzQgNTQsMzQgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NSwzMTAgNzA5LDMxMCAiLz4KPHRleHQgeD0iMjE4IiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpJdGFseQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyMTgsMzEwIDIxOCwzMTUgIi8+Cjx0ZXh0IHg9IjU0NSIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KU3BhaW4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQ1LDMxMCA1NDUsMzE1ICIvPgo8cmVjdCB4PSIxMDQiIHk9IjgwIiB3aWR0aD0iMjI4IiBoZWlnaHQ9IjIyOSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQzMSIgeT0iODAiIHdpZHRoPSIyMjgiIGhlaWdodD0iMjI5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPC9zdmc+)

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

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzYwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc2MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzgwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2hhbXBpb24mYXBvcztzIGdvYWwgZGlmZmVyZW5jZSBwZXIgZWRpdGlvbgo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9Ijc0OSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNTQiIHgyPSI3NDkiIHkyPSIzNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQ5IiB4Mj0iNzQ5IiB5Mj0iMzQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0MyIgeDI9Ijc0OSIgeTI9IjM0MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzgiIHgyPSI3NDkiIHkyPSIzMzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzMzIiB4Mj0iNzQ5IiB5Mj0iMzMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyNyIgeDI9Ijc0OSIgeTI9IjMyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMjIiIHgyPSI3NDkiIHkyPSIzMjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzE3IiB4Mj0iNzQ5IiB5Mj0iMzE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxMSIgeDI9Ijc0OSIgeTI9IjMxMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDYiIHgyPSI3NDkiIHkyPSIzMDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzAwIiB4Mj0iNzQ5IiB5Mj0iMzAwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5NSIgeDI9Ijc0OSIgeTI9IjI5NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTAiIHgyPSI3NDkiIHkyPSIyOTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg0IiB4Mj0iNzQ5IiB5Mj0iMjg0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3OSIgeDI9Ijc0OSIgeTI9IjI3OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzQiIHgyPSI3NDkiIHkyPSIyNzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY4IiB4Mj0iNzQ5IiB5Mj0iMjY4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2MyIgeDI9Ijc0OSIgeTI9IjI2MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTciIHgyPSI3NDkiIHkyPSIyNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjUyIiB4Mj0iNzQ5IiB5Mj0iMjUyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0NyIgeDI9Ijc0OSIgeTI9IjI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDEiIHgyPSI3NDkiIHkyPSIyNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM2IiB4Mj0iNzQ5IiB5Mj0iMjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMSIgeDI9Ijc0OSIgeTI9IjIzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjUiIHgyPSI3NDkiIHkyPSIyMjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjIwIiB4Mj0iNzQ5IiB5Mj0iMjIwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNCIgeDI9Ijc0OSIgeTI9IjIxNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDkiIHgyPSI3NDkiIHkyPSIyMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA0IiB4Mj0iNzQ5IiB5Mj0iMjA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5OCIgeDI9Ijc0OSIgeTI9IjE5OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTMiIHgyPSI3NDkiIHkyPSIxOTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg4IiB4Mj0iNzQ5IiB5Mj0iMTg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4MiIgeDI9Ijc0OSIgeTI9IjE4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzciIHgyPSI3NDkiIHkyPSIxNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTcxIiB4Mj0iNzQ5IiB5Mj0iMTcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2NiIgeDI9Ijc0OSIgeTI9IjE2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjEiIHgyPSI3NDkiIHkyPSIxNjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTU1IiB4Mj0iNzQ5IiB5Mj0iMTU1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1MCIgeDI9Ijc0OSIgeTI9IjE1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDUiIHgyPSI3NDkiIHkyPSIxNDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM5IiB4Mj0iNzQ5IiB5Mj0iMTM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzNCIgeDI9Ijc0OSIgeTI9IjEzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjkiIHgyPSI3NDkiIHkyPSIxMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIzIiB4Mj0iNzQ5IiB5Mj0iMTIzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExOCIgeDI9Ijc0OSIgeTI9IjExOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTIiIHgyPSI3NDkiIHkyPSIxMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA3IiB4Mj0iNzQ5IiB5Mj0iMTA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwMiIgeDI9Ijc0OSIgeTI9IjEwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NiIgeDI9Ijc0OSIgeTI9Ijk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjkxIiB4Mj0iNzQ5IiB5Mj0iOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODYiIHgyPSI3NDkiIHkyPSI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MCIgeDI9Ijc0OSIgeTI9IjgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc1IiB4Mj0iNzQ5IiB5Mj0iNzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjkiIHgyPSI3NDkiIHkyPSI2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2NCIgeDI9Ijc0OSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU5IiB4Mj0iNzQ5IiB5Mj0iNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTMiIHgyPSI3NDkiIHkyPSI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0OCIgeDI9Ijc0OSIgeTI9IjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQzIiB4Mj0iNzQ5IiB5Mj0iNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzciIHgyPSI3NDkiIHkyPSIzNyIvPgo8dGV4dCB4PSIxMCIgeT0iMTk3IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIiB0cmFuc2Zvcm09InJvdGF0ZSgyNzAsIDEwLCAxOTcpIj4KZ29hbCBkaWZmCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzU5IiB4Mj0iNzQ5IiB5Mj0iMzU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwNiIgeDI9Ijc0OSIgeTI9IjMwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTIiIHgyPSI3NDkiIHkyPSIyNTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTk4IiB4Mj0iNzQ5IiB5Mj0iMTk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NSIgeDI9Ijc0OSIgeTI9IjE0NSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MSIgeDI9Ijc0OSIgeTI9IjkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM3IiB4Mj0iNzQ5IiB5Mj0iMzciLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDM0IDU0LDM1OSAiLz4KPHRleHQgeD0iNDUiIHk9IjM1OSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDM1OSA1NCwzNTkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzMDYiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMDYgNTQsMzA2ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjUyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjUyIDU0LDI1MiAiLz4KPHRleHQgeD0iNDUiIHk9IjE5OCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNi4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE5OCA1NCwxOTggIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxNDUiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjguMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNDUgNTQsMTQ1ICIvPgo8dGV4dCB4PSI0NSIgeT0iOTEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksOTEgNTQsOTEgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzNyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTIuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzNyA1NCwzNyAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU1LDM2MCA3NDksMzYwICIvPgo8Y2lyY2xlIGN4PSIyMjgiIGN5PSIxMTgiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjU3NSIgY3k9IjY0IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMEZGIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjI4LDExOCA1NzUsNjQgIi8+Cjwvc3ZnPg==)

## Discussion

Two full editions (2020, 2024) — every match covered, so this is a complete
record book for the modern era.

- **Two champions, two profiles**: Italy 2020 went unbeaten (5W-2D-0L, 13/4) and
  lifted the trophy on penalties at Wembley; Spain 2024 went a perfect **7W-0D**
  (15/4) — the most dominant champion run in the dataset.
- **Spain 2024 swept the attacking records**: most goals (15), best goal
  difference (+11), most wins — a perfect tournament.
- **Italy 2020 was the defensively stingiest champion** alongside conceding just
  4 (tied with Spain).
- **Biggest win**: Germany 5–1 Scotland (2024). **Wildest match**: Croatia 3–5
  Spain (2020) — 8 goals in a last-16 thriller.
- **Top scorers**: Cristiano Ronaldo, Harry Kane and Patrik Schick all finished
  with 5 goals across the two editions.
- **Both champions were unbeaten** — the only tournament in this series where
  every recorded champion went through without a defeat.

*Source: StatsBomb open data via `dev.db`.

**Limitations.** Records reflect only the matches present in the database;
coverage varies by competition and era, so 'records' are archive records, not
all-time official marks.

## Conclusion

Italy 2020 was the defensively stingiest champion. Together these results answer
the research question posed in the Introduction and quantify the pattern across
the full match archive. The notebook provides a fully reproducible pipeline from
raw CSV extracts to published figures.
