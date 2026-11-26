---
title: 'Best of the Scottish Premiership: every record worth knowing'
description: |
  'Celtic 21, Rangers 11 — the Old Firm have won every title since 1994/95.'
author: 'hieudoan'
date: '2026-11-25T20:00'
order: 24
tags:
  ['football', 'analysis', 'records', 'scottish-premiership', 'mars', 'sqlite']
---

# Best of the Scottish Premiership: a record book

## Abstract

This study examines the Scottish Premiership record book using 7,040 matches
drawn from the Soccers football database. Across 32 complete seasons (1994/95 →
2025/26) and 7,040 matches, the Scottish Premiership record book — the most
one-sided league in world football. Most championships: Celtic 21 and Rangers 11
— the Old Firm have won all 32 titles between them. All computation runs in Rust
inside a `.mars` notebook (polars + plotters — charts as inline SVG), and every
table and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, records, scottish-premiership, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [Assemble per-season standings for all complete seasons](#assemble-per-season-standings-for-all-complete-seasons)
  - [Champion hall of fame — six records](#champion-hall-of-fame--six-records)
  - [Best team-seasons ever by points (any team)](#best-team-seasons-ever-by-points-any-team)
  - [Unbeaten seasons](#unbeaten-seasons)
  - [Title races — closest and biggest margins](#title-races--closest-and-biggest-margins)
  - [Biggest wins & highest scoring matches](#biggest-wins--highest-scoring-matches)
  - [Top scorers](#top-scorers)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

A complete record-book of the **Scottish Premiership** — every statistic worth
knowing, computed from all matches in `data/matches_full.csv`.

**Records covered:** most championships, the champion hall of fame (most points,
most goals, fewest conceded, best goal difference, biggest title margin, most
wins), the best team-seasons ever, unbeaten invincibles, closest and biggest
title races, biggest wins and highest-scoring matches, and the season's top
scorers where player-level data exists.

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
    .filter(col("league").eq(lit("Scottish Premiership")))
    .collect()
    .expect("filter failed");

// seasons excluded as mislabeled data (e.g. another league's fixtures)
let drop_seasons: &[&str] = &[];

println!("Scottish Premiership matches: {}", df.height());

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
let mut all_matches: Vec<(String, String, String, i64, i64)> = Vec::new();
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
    all_matches.push((s.clone(), h.clone(), a.clone(), hg, ag));
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
for (s, _, _, _, _) in &all_matches {
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
Scottish Premiership matches: 7040
finished matches: 7040 (0 duplicate fixtures dropped) | team-season entries: 384
complete seasons: 32 (1994/95 -> 2025/26)
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
    .filter(col("league").eq(lit("Scottish Premiership")))
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
no player-level scorer data for this competition
```

### Assemble per-season standings for all complete seasons

```rust
// ---- assemble per-season standings for all complete seasons ----
struct SeasonRow {
    season: String,
    champ: String,
    pts: i64,
    w: i64,
    gf: i64,
    ga: i64,
    gd: i64,
    runner_pts: i64,
    runner_up: String,
    standings: Vec<Rec>,
}

let mut seasons: Vec<SeasonRow> = Vec::new();
for sname in &complete_seasons {
    let st = standings(sname);
    if st.len() < 2 {
        continue;
    }
    seasons.push(SeasonRow {
        season: sname.clone(),
        champ: st[0].team.clone(),
        pts: st[0].pts,
        w: st[0].w,
        gf: st[0].gf,
        ga: st[0].ga,
        gd: st[0].gd,
        runner_pts: st[1].pts,
        runner_up: st[1].team.clone(),
        standings: st,
    });
}
println!("seasons analysed: {}", seasons.len());

// T1: most championships
let mut title_count: BTreeMap<String, Vec<String>> = BTreeMap::new();
for srow in &seasons {
    title_count.entry(srow.champ.clone()).or_default().push(srow.season.clone());
}
let mut tc: Vec<(String, Vec<String>)> = title_count.into_iter().collect();
tc.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)));
let title_rows: Vec<Vec<String>> = tc
    .iter()
    .take(8)
    .map(|(t, ss)| vec![t.clone(), ss.len().to_string(), ss.iter().rev().take(3).cloned().collect::<Vec<_>>().join(", ")])
    .collect();
mars_table(&["club", "titles", "most recent"], &title_rows);
```

```text
Scottish Premiership matches: 7040
finished matches: 7040 (0 duplicate fixtures dropped) | team-season entries: 384
complete seasons: 32 (1994/95 -> 2025/26)
no player-level scorer data for this competition
seasons analysed: 32
```

| club    | titles | most recent               |
| ------- | ------ | ------------------------- |
| Celtic  | 21     | 2025/26, 2024/25, 2023/24 |
| Rangers | 11     | 2020/21, 2010/11, 2009/10 |

### Champion hall of fame — six records

```rust
// T2: champion hall of fame — six records
let champ_rec = |f: &dyn Fn(&SeasonRow) -> i64| -> Option<SeasonRow> {
    seasons.iter().max_by_key(|s| f(*s)).map(|s| SeasonRow {
        season: s.season.clone(), champ: s.champ.clone(), pts: s.pts, w: s.w,
        gf: s.gf, ga: s.ga, gd: s.gd, runner_pts: s.runner_pts,
        runner_up: s.runner_up.clone(), standings: Vec::new(),
    })
};
let records: Vec<(&str, SeasonRow)> = vec![
    ("most points", champ_rec(&|s| s.pts).unwrap()),
    ("most goals scored", champ_rec(&|s| s.gf).unwrap()),
    ("fewest goals conceded", seasons.iter().min_by_key(|s| s.ga).map(|s| SeasonRow {
        season: s.season.clone(), champ: s.champ.clone(), pts: s.pts, w: s.w,
        gf: s.gf, ga: s.ga, gd: s.gd, runner_pts: s.runner_pts,
        runner_up: s.runner_up.clone(), standings: Vec::new(),
    }).unwrap()),
    ("best goal difference", champ_rec(&|s| s.gd).unwrap()),
    ("biggest title margin", champ_rec(&|s| s.pts - s.runner_pts).unwrap()),
    ("most wins", champ_rec(&|s| s.w).unwrap()),
];
let rec_rows: Vec<Vec<String>> = records
    .iter()
    .map(|(label, s)| {
        vec![
            label.to_string(),
            format!("{} {}", s.champ, s.season),
            s.pts.to_string(),
            format!("{}/{}", s.gf, s.ga),
            s.gd.to_string(),
        ]
    })
    .collect();
mars_table(&["record", "champion season", "pts", "gf/ga", "gd"], &rec_rows);
```

| record                | champion season | pts | gf/ga  | gd  |
| --------------------- | --------------- | --- | ------ | --- |
| most points           | Celtic 2016/17  | 106 | 106/25 | 81  |
| most goals scored     | Celtic 2022/23  | 99  | 114/34 | 80  |
| fewest goals conceded | Rangers 2020/21 | 102 | 92/13  | 79  |
| best goal difference  | Celtic 2024/25  | 92  | 112/26 | 86  |
| biggest title margin  | Celtic 2016/17  | 106 | 106/25 | 81  |
| most wins             | Celtic 2016/17  | 106 | 106/25 | 81  |

### Best team-seasons ever by points (any team)

```rust
// T3: best team-seasons ever by points (any team)
let mut all_recs: Vec<Rec> = Vec::new();
for srow in &seasons {
    for r in &srow.standings {
        all_recs.push(r.clone());
    }
}
all_recs.sort_by(|a, b| b.pts.cmp(&a.pts).then(b.gd.cmp(&a.gd)));
let best_rows: Vec<Vec<String>> = all_recs
    .iter()
    .take(10)
    .map(|r| {
        vec![
            format!("{} {}", r.team, r.season),
            r.played.to_string(),
            r.pts.to_string(),
            format!("{:.2}", r.pts as f64 / r.played as f64),
            format!("{}/{}", r.gf, r.ga),
            r.gd.to_string(),
        ]
    })
    .collect();
mars_table(&["team season", "played", "pts", "ppg", "gf/ga", "gd"], &best_rows);
```

| team season     | played | pts | ppg  | gf/ga  | gd  |
| --------------- | ------ | --- | ---- | ------ | --- |
| Celtic 2016/17  | 38     | 106 | 2.79 | 106/25 | 81  |
| Celtic 2001/02  | 38     | 103 | 2.71 | 94/18  | 76  |
| Rangers 2020/21 | 38     | 102 | 2.68 | 92/13  | 79  |
| Celtic 2022/23  | 38     | 99  | 2.61 | 114/34 | 80  |
| Celtic 2013/14  | 38     | 99  | 2.61 | 102/25 | 77  |
| Celtic 2003/04  | 38     | 98  | 2.58 | 105/25 | 80  |
| Rangers 2002/03 | 38     | 97  | 2.55 | 101/28 | 73  |
| Celtic 2002/03  | 38     | 97  | 2.55 | 98/26  | 72  |
| Celtic 2000/01  | 38     | 97  | 2.55 | 90/29  | 61  |
| Celtic 2021/22  | 38     | 93  | 2.45 | 92/22  | 70  |

### Unbeaten seasons

```rust
// T4: unbeaten seasons
let unbeaten: Vec<&Rec> = all_recs.iter().filter(|r| r.l == 0 && r.played >= 20).collect();
let unbeaten_rows: Vec<Vec<String>> = unbeaten
    .iter()
    .take(10)
    .map(|r| vec![format!("{} {}", r.team, r.season), format!("{}W {}D", r.w, r.d), r.gf.to_string(), r.ga.to_string()])
    .collect();
mars_table(&["team season", "record", "gf", "ga"], &unbeaten_rows);
```

| team season     | record | gf  | ga  |
| --------------- | ------ | --- | --- |
| Celtic 2016/17  | 34W 4D | 106 | 25  |
| Rangers 2020/21 | 32W 6D | 92  | 13  |

### Title races — closest and biggest margins

```rust
println!("unbeaten seasons (>=20 games): {}", unbeaten.len());

// T5: title races — closest and biggest margins
let mut by_margin: Vec<&SeasonRow> = seasons.iter().collect();
by_margin.sort_by_key(|s| s.pts - s.runner_pts);
let race_rows: Vec<Vec<String>> = by_margin
    .iter()
    .take(5)
    .map(|s| vec![format!("{} {}", s.champ, s.season), format!("{} ({})", s.runner_up, s.runner_pts), (s.pts - s.runner_pts).to_string() + " pts"])
    .collect();
mars_table(&["closest races", "runner-up", "margin"], &race_rows);
```

```text
unbeaten seasons (>=20 games): 2
```

| closest races   | runner-up    | margin |
| --------------- | ------------ | ------ |
| Rangers 2002/03 | Celtic (97)  | 0 pts  |
| Rangers 2004/05 | Celtic (92)  | 1 pts  |
| Rangers 2010/11 | Celtic (92)  | 1 pts  |
| Celtic 1997/98  | Rangers (72) | 2 pts  |
| Celtic 2025/26  | Hearts (80)  | 2 pts  |

```rust
let mut by_margin_desc = by_margin.clone();
by_margin_desc.reverse();
let blow_rows: Vec<Vec<String>> = by_margin_desc
    .iter()
    .take(5)
    .map(|s| vec![format!("{} {}", s.champ, s.season), format!("{} ({})", s.runner_up, s.runner_pts), (s.pts - s.runner_pts).to_string() + " pts"])
    .collect();
mars_table(&["biggest blowouts", "runner-up", "margin"], &blow_rows);
```

| biggest blowouts | runner-up       | margin |
| ---------------- | --------------- | ------ |
| Celtic 2016/17   | Aberdeen (76)   | 30 pts |
| Celtic 2013/14   | Motherwell (70) | 29 pts |
| Rangers 2020/21  | Celtic (77)     | 25 pts |
| Rangers 1999/00  | Celtic (69)     | 21 pts |
| Celtic 2001/02   | Rangers (85)    | 18 pts |

### Biggest wins & highest scoring matches

```rust
// T6: biggest wins & highest scoring matches
let mut margins: Vec<(i64, String, String, i64, i64, String)> = Vec::new();
let mut totals: Vec<(i64, String, String, i64, i64, String)> = Vec::new();
for (s, h, a, hg, ag) in &all_matches {
    margins.push((hg - ag, s.clone(), h.clone(), *hg, *ag, a.clone()));
    totals.push((hg + ag, s.clone(), h.clone(), *hg, *ag, a.clone()));
}
margins.sort_by(|a, b| b.0.cmp(&a.0));
totals.sort_by(|a, b| b.0.cmp(&a.0));
let win_rows: Vec<Vec<String>> = margins
    .iter()
    .take(5)
    .map(|(m, s, h, hg, ag, a)| vec![format!("{} vs {} ({})", h, a, s), format!("{}-{}", hg, ag), format!("+{}", m)])
    .collect();
mars_table(&["biggest wins", "score", "margin"], &win_rows);
```

| biggest wins                     | score | margin |
| -------------------------------- | ----- | ------ |
| Celtic vs Aberdeen (2010/11)     | 9-0   | +9     |
| Rangers vs Hamilton (2020/21)    | 8-0   | +8     |
| Rangers vs Hibernian (1995/96)   | 7-0   | +7     |
| Rangers vs Dunfermline (1997/98) | 7-0   | +7     |
| Celtic vs Aberdeen (1999/00)     | 7-0   | +7     |

```rust
let score_rows: Vec<Vec<String>> = totals
    .iter()
    .take(5)
    .map(|(t, s, h, hg, ag, a)| vec![format!("{} vs {} ({})", h, a, s), format!("{}-{}", hg, ag), t.to_string()])
    .collect();
mars_table(&["highest-scoring", "score", "total goals"], &score_rows);
```

| highest-scoring                       | score | total goals |
| ------------------------------------- | ----- | ----------- |
| Motherwell vs Hibernian (2009/10)     | 6-6   | 12          |
| Motherwell vs Aberdeen (1999/00)      | 5-6   | 11          |
| Hibernian vs Rangers (2017/18)        | 5-5   | 10          |
| Motherwell vs Dundee United (2005/06) | 4-5   | 9           |
| Dunfermline vs Celtic (2005/06)       | 1-8   | 9           |

### Top scorers

```rust
// T7: top scorers
if !scorer_table.is_empty() {
    mars_table(&["player", "goals"], &scorer_table);
}
```

```text

```

```rust
use plotters::prelude::*;

let labels_t: Vec<String> = tc.iter().take(8).map(|(t, _)| t.chars().take(12).collect()).collect();
let counts_t: Vec<f64> = tc.iter().take(8).map(|(_, ss)| ss.len() as f64).collect();
let ymax_t = counts_t.iter().cloned().fold(1.0_f64, f64::max) * 1.2;
let n_t = counts_t.len();
let figure1 = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Most championships", ("sans-serif", 18))
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
Scottish Premiership matches: 7040
finished matches: 7040 (0 duplicate fixtures dropped) | team-season entries: 384
complete seasons: 32 (1994/95 -> 2025/26)
no player-level scorer data for this competition
seasons analysed: 32
unbeaten seasons (>=20 games): 2
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTW9zdCBjaGFtcGlvbnNoaXBzCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg3IiB5MT0iMzA5IiB4Mj0iODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzA5IiB4Mj0iMTUzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxOCIgeTE9IjMwOSIgeDI9IjIxOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyODMiIHkxPSIzMDkiIHgyPSIyODMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQ5IiB5MT0iMzA5IiB4Mj0iMzQ5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQxNCIgeTE9IjMwOSIgeDI9IjQxNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0ODAiIHkxPSIzMDkiIHgyPSI0ODAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQ1IiB5MT0iMzA5IiB4Mj0iNTQ1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYxMCIgeTE9IjMwOSIgeDI9IjYxMCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NzYiIHkxPSIzMDkiIHgyPSI2NzYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDkiIHgyPSI3MDkiIHkyPSIzMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA0IiB4Mj0iNzA5IiB5Mj0iMzA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5OSIgeDI9IjcwOSIgeTI9IjI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTMiIHgyPSI3MDkiIHkyPSIyOTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg4IiB4Mj0iNzA5IiB5Mj0iMjg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4MiIgeDI9IjcwOSIgeTI9IjI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzciIHgyPSI3MDkiIHkyPSIyNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjcxIiB4Mj0iNzA5IiB5Mj0iMjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2NiIgeDI9IjcwOSIgeTI9IjI2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjAiIHgyPSI3MDkiIHkyPSIyNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU1IiB4Mj0iNzA5IiB5Mj0iMjU1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0OSIgeDI9IjcwOSIgeTI9IjI0OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDQiIHgyPSI3MDkiIHkyPSIyNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM5IiB4Mj0iNzA5IiB5Mj0iMjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMyIgeDI9IjcwOSIgeTI9IjIzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjgiIHgyPSI3MDkiIHkyPSIyMjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjIyIiB4Mj0iNzA5IiB5Mj0iMjIyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNyIgeDI9IjcwOSIgeTI9IjIxNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTEiIHgyPSI3MDkiIHkyPSIyMTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA2IiB4Mj0iNzA5IiB5Mj0iMjA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMCIgeDI9IjcwOSIgeTI9IjIwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTUiIHgyPSI3MDkiIHkyPSIxOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg5IiB4Mj0iNzA5IiB5Mj0iMTg5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4NCIgeDI9IjcwOSIgeTI9IjE4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzkiIHgyPSI3MDkiIHkyPSIxNzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTczIiB4Mj0iNzA5IiB5Mj0iMTczIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2OCIgeDI9IjcwOSIgeTI9IjE2OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjIiIHgyPSI3MDkiIHkyPSIxNjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTU3IiB4Mj0iNzA5IiB5Mj0iMTU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1MSIgeDI9IjcwOSIgeTI9IjE1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDYiIHgyPSI3MDkiIHkyPSIxNDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQwIiB4Mj0iNzA5IiB5Mj0iMTQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzNSIgeDI9IjcwOSIgeTI9IjEzNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjkiIHgyPSI3MDkiIHkyPSIxMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI0IiB4Mj0iNzA5IiB5Mj0iMTI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExOSIgeDI9IjcwOSIgeTI9IjExOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTMiIHgyPSI3MDkiIHkyPSIxMTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA4IiB4Mj0iNzA5IiB5Mj0iMTA4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwMiIgeDI9IjcwOSIgeTI9IjEwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NyIgeDI9IjcwOSIgeTI9Ijk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjkxIiB4Mj0iNzA5IiB5Mj0iOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODYiIHgyPSI3MDkiIHkyPSI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MCIgeDI9IjcwOSIgeTI9IjgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc1IiB4Mj0iNzA5IiB5Mj0iNzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjkiIHgyPSI3MDkiIHkyPSI2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2NCIgeDI9IjcwOSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU5IiB4Mj0iNzA5IiB5Mj0iNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTMiIHgyPSI3MDkiIHkyPSI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0OCIgeDI9IjcwOSIgeTI9IjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQyIiB4Mj0iNzA5IiB5Mj0iNDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzciIHgyPSI3MDkiIHkyPSIzNyIvPgo8dGV4dCB4PSIxMCIgeT0iMTcyIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIiB0cmFuc2Zvcm09InJvdGF0ZSgyNzAsIDEwLCAxNzIpIj4KdGl0bGVzCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxOCIgeTE9IjMwOSIgeDI9IjIxOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDUiIHkxPSIzMDkiIHgyPSI1NDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDkiIHgyPSI3MDkiIHkyPSIzMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU1IiB4Mj0iNzA5IiB5Mj0iMjU1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMCIgeDI9IjcwOSIgeTI9IjIwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDYiIHgyPSI3MDkiIHkyPSIxNDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTEiIHgyPSI3MDkiIHkyPSI5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNyIgeDI9IjcwOSIgeTI9IjM3Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNCA1NCwzMDkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzMDkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMDkgNTQsMzA5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjU1IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjU1IDU0LDI1NSAiLz4KPHRleHQgeD0iNDUiIHk9IjIwMCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyMDAgNTQsMjAwICIvPgo8dGV4dCB4PSI0NSIgeT0iMTQ2IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE0NiA1NCwxNDYgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI5MSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw5MSA1NCw5MSAiLz4KPHRleHQgeD0iNDUiIHk9IjM3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDM3IDU0LDM3ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzEwIDcwOSwzMTAgIi8+Cjx0ZXh0IHg9IjIxOCIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2VsdGljCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjIxOCwzMTAgMjE4LDMxNSAiLz4KPHRleHQgeD0iNTQ1IiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpSYW5nZXJzCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0NSwzMTAgNTQ1LDMxNSAiLz4KPHJlY3QgeD0iMTA0IiB5PSI4MCIgd2lkdGg9IjIyOCIgaGVpZ2h0PSIyMjkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0MzEiIHk9IjE4OSIgd2lkdGg9IjIyOCIgaGVpZ2h0PSIxMjAiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

```rust
let n_s = seasons.len();
let pts_max_s = seasons.iter().map(|s| s.pts).fold(1i64, |a, b| a.max(b)) as f64 * 1.1;
let figure2 = plotters::evcxr::evcxr_figure((760, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Champion's points, season by season", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(30)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n_s as f64 - 0.5), 0.0..pts_max_s)?;
    chart.configure_mesh().y_desc("points").x_labels(0).draw()?;
    chart.draw_series(seasons.iter().enumerate().map(|(i, s)| {
        Circle::new((i as f64, s.pts as f64), 3, BLUE.filled())
    }))?;
    chart.draw_series(LineSeries::new(
        seasons.iter().enumerate().map(|(i, s)| (i as f64, s.pts as f64)),
        BLUE.stroke_width(1),
    ))?;
    Ok(())
});
figure2.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzYwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc2MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzgwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2hhbXBpb24mYXBvcztzIHBvaW50cywgc2Vhc29uIGJ5IHNlYXNvbgo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9Ijc0OSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNTQiIHgyPSI3NDkiIHkyPSIzNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQ4IiB4Mj0iNzQ5IiB5Mj0iMzQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0MyIgeDI9Ijc0OSIgeTI9IjM0MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzciIHgyPSI3NDkiIHkyPSIzMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzMyIiB4Mj0iNzQ5IiB5Mj0iMzMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyNiIgeDI9Ijc0OSIgeTI9IjMyNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMjAiIHgyPSI3NDkiIHkyPSIzMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzE1IiB4Mj0iNzQ5IiB5Mj0iMzE1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwOSIgeDI9Ijc0OSIgeTI9IjMwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDQiIHgyPSI3NDkiIHkyPSIzMDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjk4IiB4Mj0iNzQ5IiB5Mj0iMjk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5MyIgeDI9Ijc0OSIgeTI9IjI5MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODciIHgyPSI3NDkiIHkyPSIyODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjgxIiB4Mj0iNzQ5IiB5Mj0iMjgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3NiIgeDI9Ijc0OSIgeTI9IjI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzAiIHgyPSI3NDkiIHkyPSIyNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY1IiB4Mj0iNzQ5IiB5Mj0iMjY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1OSIgeDI9Ijc0OSIgeTI9IjI1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTQiIHgyPSI3NDkiIHkyPSIyNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ4IiB4Mj0iNzQ5IiB5Mj0iMjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0MiIgeDI9Ijc0OSIgeTI9IjI0MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzciIHgyPSI3NDkiIHkyPSIyMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjMxIiB4Mj0iNzQ5IiB5Mj0iMjMxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyNiIgeDI9Ijc0OSIgeTI9IjIyNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjAiIHgyPSI3NDkiIHkyPSIyMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE1IiB4Mj0iNzQ5IiB5Mj0iMjE1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwOSIgeDI9Ijc0OSIgeTI9IjIwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDMiIHgyPSI3NDkiIHkyPSIyMDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTk4IiB4Mj0iNzQ5IiB5Mj0iMTk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5MiIgeDI9Ijc0OSIgeTI9IjE5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODciIHgyPSI3NDkiIHkyPSIxODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTgxIiB4Mj0iNzQ5IiB5Mj0iMTgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NiIgeDI9Ijc0OSIgeTI9IjE3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzAiIHgyPSI3NDkiIHkyPSIxNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY0IiB4Mj0iNzQ5IiB5Mj0iMTY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1OSIgeDI9Ijc0OSIgeTI9IjE1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTMiIHgyPSI3NDkiIHkyPSIxNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ4IiB4Mj0iNzQ5IiB5Mj0iMTQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0MiIgeDI9Ijc0OSIgeTI9IjE0MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzciIHgyPSI3NDkiIHkyPSIxMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTMxIiB4Mj0iNzQ5IiB5Mj0iMTMxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyNSIgeDI9Ijc0OSIgeTI9IjEyNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjAiIHgyPSI3NDkiIHkyPSIxMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTE0IiB4Mj0iNzQ5IiB5Mj0iMTE0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwOSIgeDI9Ijc0OSIgeTI9IjEwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDMiIHgyPSI3NDkiIHkyPSIxMDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTciIHgyPSI3NDkiIHkyPSI5NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MiIgeDI9Ijc0OSIgeTI9IjkyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg2IiB4Mj0iNzQ5IiB5Mj0iODYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODEiIHgyPSI3NDkiIHkyPSI4MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3NSIgeDI9Ijc0OSIgeTI9Ijc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjcwIiB4Mj0iNzQ5IiB5Mj0iNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjQiIHgyPSI3NDkiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1OCIgeDI9Ijc0OSIgeTI9IjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjUzIiB4Mj0iNzQ5IiB5Mj0iNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDciIHgyPSI3NDkiIHkyPSI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MiIgeDI9Ijc0OSIgeTI9IjQyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM2IiB4Mj0iNzQ5IiB5Mj0iMzYiLz4KPHRleHQgeD0iMTAiIHk9IjE5NyIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCIgdHJhbnNmb3JtPSJyb3RhdGUoMjcwLCAxMCwgMTk3KSI+CnBvaW50cwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9Ijc0OSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDQiIHgyPSI3NDkiIHkyPSIzMDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ4IiB4Mj0iNzQ5IiB5Mj0iMjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5MiIgeDI9Ijc0OSIgeTI9IjE5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzciIHgyPSI3NDkiIHkyPSIxMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODEiIHgyPSI3NDkiIHkyPSI4MSIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzQgNTQsMzU5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMzU5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzU5IDU0LDM1OSAiLz4KPHRleHQgeD0iNDUiIHk9IjMwNCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMDQgNTQsMzA0ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjQ4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI0OCA1NCwyNDggIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxOTIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTkyIDU0LDE5MiAiLz4KPHRleHQgeD0iNDUiIHk9IjEzNyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KODAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxMzcgNTQsMTM3ICIvPgo8dGV4dCB4PSI0NSIgeT0iODEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDgxIDU0LDgxICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzYwIDc0OSwzNjAgIi8+CjxjaXJjbGUgY3g9IjY1IiBjeT0iMTY3IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI4NyIgY3k9IjExNyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTA5IiBjeT0iMTM3IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxMzAiIGN5PSIxNTMiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE1MiIgY3k9IjE0NSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTc0IiBjeT0iMTA5IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxOTUiIGN5PSI4OSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjE3IiBjeT0iNzIiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjIzOSIgY3k9Ijg5IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyNjEiIGN5PSI4NiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjgyIiBjeT0iMTAwIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzMDQiIGN5PSIxMDYiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMyNiIgY3k9IjEyNSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzQ3IiBjeT0iMTExIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzNjkiIGN5PSIxMjAiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM5MSIgY3k9IjExNyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDEyIiBjeT0iMTAwIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0MzQiIGN5PSIxMDAiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ1NiIgY3k9IjEzOSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDc3IiBjeT0iODQiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ5OSIgY3k9IjEwMyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTIxIiBjeT0iMTIwIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1NDIiIGN5PSI2NCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTY0IiBjeT0iMTMxIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1ODYiIGN5PSIxMTciIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjYwOCIgY3k9IjEzNyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjI5IiBjeT0iNzUiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjY1MSIgY3k9IjEwMCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjczIiBjeT0iODQiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjY5NCIgY3k9IjEwMCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNzE2IiBjeT0iMTAzIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI3MzgiIGN5PSIxMzEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwRkYiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NSwxNjcgODcsMTE3IDEwOSwxMzcgMTMwLDE1MyAxNTIsMTQ1IDE3NCwxMDkgMTk1LDg5IDIxNyw3MiAyMzksODkgMjYxLDg2IDI4MiwxMDAgMzA0LDEwNiAzMjYsMTI1IDM0NywxMTEgMzY5LDEyMCAzOTEsMTE3IDQxMiwxMDAgNDM0LDEwMCA0NTYsMTM5IDQ3Nyw4NCA0OTksMTAzIDUyMSwxMjAgNTQyLDY0IDU2NCwxMzEgNTg2LDExNyA2MDgsMTM3IDYyOSw3NSA2NTEsMTAwIDY3Myw4NCA2OTQsMTAwIDcxNiwxMDMgNzM4LDEzMSAiLz4KPC9zdmc+)

## Discussion

Across **32 complete seasons** (1994/95 → 2025/26) and 7,040 matches, the
Scottish Premiership record book — the most one-sided league in world football:

- **Most championships**: Celtic **21** and Rangers **11** — the Old Firm have
  won **all 32 titles** between them. No other club has lifted the Scottish
  championship in this entire era.
- **Champion hall of fame**: Celtic 2016/17 owns most points (106), most wins
  and biggest margin (+30 over Aberdeen); Celtic 2022/23 scored the most goals
  (114); Rangers 2020/21 conceded the fewest (13); Celtic 2024/25 posted the
  best goal difference (+86).
- **Best season ever**: Celtic 2016/17 — 106 points, 2.79 ppg, the highest
  champion ppg of any league in this series.
- **Invincibles**: **two** unbeaten seasons — Celtic 2016/17 (34W 4D) and
  Rangers 2020/21 (32W 6D), both in the modern era.
- **Closest finishes**: Rangers 2002/03 and 2004/05 both went to a final-round
  decider at level points; three more one-point margins — even in a two-team
  league the margins are razor-thin.
- **Biggest blowouts**: Celtic 2016/17 (+30) and Celtic 2013/14 (+29) — when the
  Old Firm don't win it, they win it big.
- **Records on the pitch**: Celtic 9–0 Aberdeen (2010/11) is the biggest win;
  Motherwell 6–6 Hibernian (2009/10) the highest-scoring match.
- No player-level scoring data for the Scottish Premiership in the StatsBomb
  subset.

_Method notes: canonical names merged; note "Dundee" and "Dundee United" are
correctly kept as separate clubs._

**Limitations.** Records reflect only the matches present in the database;
coverage varies by competition and era, so 'records' are archive records, not
all-time official marks.

## Conclusion

1994/95 → 2025/26) and 7,040 matches, the Scottish Premiership record book — the
most one-sided league in world football. Most championships: Celtic 21 and
Rangers 11 — the Old Firm have won all 32 titles between them. Together these
results answer the research question posed in the Introduction and quantify the
pattern across 7,040 matches. The notebook provides a fully reproducible
pipeline from raw CSV extracts to published figures.
