---
title: 'Best of the Premier League: every record worth knowing'
description: |
  '31 seasons of records — United's 12 titles, City's 100-point machine, the Invincibles and the 9–0 club.'
author: 'hieudoan'
date: '2026-11-25T15:30'
order: 15
tags: ['football', 'analysis', 'records', 'premier-league', 'mars', 'sqlite']
---

# Best of the Premier League: a record book

## Abstract

This study examines the Premier League record book using 13,126 matches drawn
from the Soccers football database. Most championships: Manchester United 12,
Manchester City 8, Chelsea 5, Arsenal 4, Liverpool 2 — and one title each for
Blackburn (1994/95) and Leicester (2015/16). All computation runs in Rust inside
a `.mars` notebook (polars + plotters — charts as inline SVG), and every table
and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, records, premier-league, mars, sqlite

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

A complete record-book of the **Premier League** — every statistic worth
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
    .filter(col("league").eq(lit("English Premier League")))
    .collect()
    .expect("filter failed");

// seasons excluded as mislabeled data (e.g. another league's fixtures)
let drop_seasons: &[&str] = &[];

println!("English Premier League matches: {}", df.height());

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
English Premier League matches: 13126
finished matches: 12814 (312 duplicate fixtures dropped) | team-season entries: 684
complete seasons: 33 (1993/94 -> 2025/26)
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
    .filter(col("league").eq(lit("English Premier League")))
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
top scorers available for season year 2015 (StatsBomb coverage)
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
English Premier League matches: 13126
finished matches: 12814 (312 duplicate fixtures dropped) | team-season entries: 684
complete seasons: 33 (1993/94 -> 2025/26)
top scorers available for season year 2015 (StatsBomb coverage)
seasons analysed: 33
```

| club       | titles | most recent               |
| ---------- | ------ | ------------------------- |
| Man United | 12     | 2012/13, 2010/11, 2008/09 |
| Man City   | 8      | 2023/24, 2022/23, 2021/22 |
| Chelsea    | 5      | 2016/17, 2014/15, 2009/10 |
| Arsenal    | 4      | 2025/26, 2003/04, 2001/02 |
| Liverpool  | 2      | 2024/25, 2019/20          |
| Blackburn  | 1      | 1994/95                   |
| Leicester  | 1      | 2015/16                   |

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

| record                | champion season   | pts | gf/ga  | gd  |
| --------------------- | ----------------- | --- | ------ | --- |
| most points           | Man City 2017/18  | 100 | 106/27 | 79  |
| most goals scored     | Man City 2017/18  | 100 | 106/27 | 79  |
| fewest goals conceded | Chelsea 2004/05   | 95  | 72/15  | 57  |
| best goal difference  | Man City 2017/18  | 100 | 106/27 | 79  |
| biggest title margin  | Man City 2017/18  | 100 | 106/27 | 79  |
| most wins             | Liverpool 2019/20 | 99  | 85/33  | 52  |

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

| team season        | played | pts | ppg  | gf/ga  | gd  |
| ------------------ | ------ | --- | ---- | ------ | --- |
| Man City 2017/18   | 38     | 100 | 2.63 | 106/27 | 79  |
| Liverpool 2019/20  | 38     | 99  | 2.61 | 85/33  | 52  |
| Man City 2018/19   | 38     | 98  | 2.58 | 95/23  | 72  |
| Liverpool 2018/19  | 38     | 97  | 2.55 | 89/22  | 67  |
| Chelsea 2004/05    | 38     | 95  | 2.50 | 72/15  | 57  |
| Man City 2021/22   | 38     | 93  | 2.45 | 99/26  | 73  |
| Chelsea 2016/17    | 38     | 93  | 2.45 | 85/33  | 52  |
| Liverpool 2021/22  | 38     | 92  | 2.42 | 94/26  | 68  |
| Man United 1993/94 | 42     | 92  | 2.19 | 80/38  | 42  |
| Man City 2023/24   | 38     | 91  | 2.39 | 96/34  | 62  |

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

| team season     | record  | gf  | ga  |
| --------------- | ------- | --- | --- |
| Arsenal 2003/04 | 26W 12D | 73  | 26  |

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
unbeaten seasons (>=20 games): 1
```

| closest races      | runner-up       | margin |
| ------------------ | --------------- | ------ |
| Man City 2011/12   | Man United (89) | 0 pts  |
| Blackburn 1994/95  | Man United (88) | 1 pts  |
| Arsenal 1997/98    | Man United (77) | 1 pts  |
| Man United 1998/99 | Arsenal (78)    | 1 pts  |
| Chelsea 2009/10    | Man United (85) | 1 pts  |

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

| biggest blowouts   | runner-up       | margin |
| ------------------ | --------------- | ------ |
| Man City 2017/18   | Man United (81) | 19 pts |
| Liverpool 2019/20  | Man City (81)   | 18 pts |
| Man United 1999/00 | Arsenal (73)    | 18 pts |
| Man City 2020/21   | Man United (74) | 12 pts |
| Chelsea 2004/05    | Arsenal (83)    | 12 pts |

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

| biggest wins                          | score | margin |
| ------------------------------------- | ----- | ------ |
| Man United vs Ipswich (1994/95)       | 9-0   | +9     |
| Man United vs Southampton (2020/21)   | 9-0   | +9     |
| Liverpool vs Bournemouth (2022/23)    | 9-0   | +9     |
| Newcastle vs Sheffield Weds (1999/00) | 8-0   | +8     |
| Tottenham vs Wigan (2009/10)          | 9-1   | +8     |

```rust
let score_rows: Vec<Vec<String>> = totals
    .iter()
    .take(5)
    .map(|(t, s, h, hg, ag, a)| vec![format!("{} vs {} ({})", h, a, s), format!("{}-{}", hg, ag), t.to_string()])
    .collect();
mars_table(&["highest-scoring", "score", "total goals"], &score_rows);
```

| highest-scoring                 | score | total goals |
| ------------------------------- | ----- | ----------- |
| Portsmouth vs Reading (2007/08) | 7-4   | 11          |
| Tottenham vs Reading (2007/08)  | 6-4   | 10          |
| Tottenham vs Wigan (2009/10)    | 9-1   | 10          |
| Man United vs Arsenal (2011/12) | 8-2   | 10          |
| Arsenal vs Newcastle (2012/13)  | 7-3   | 10          |

### Top scorers

```rust
// T7: top scorers
if !scorer_table.is_empty() {
    mars_table(&["player", "goals"], &scorer_table);
}
```

```text

```

| player                            | goals |
| --------------------------------- | ----- |
| Harry Kane                        | 25    |
| Jamie Vardy                       | 24    |
| Sergio Leonel Agüero del Castillo | 24    |
| Romelu Lukaku Menama              | 18    |
| Riyad Mahrez                      | 17    |

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
English Premier League matches: 13126
finished matches: 12814 (312 duplicate fixtures dropped) | team-season entries: 684
complete seasons: 33 (1993/94 -> 2025/26)
top scorers available for season year 2015 (StatsBomb coverage)
seasons analysed: 33
unbeaten seasons (>=20 games): 1
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTW9zdCBjaGFtcGlvbnNoaXBzCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY0IiB5MT0iMzA5IiB4Mj0iNjQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODMiIHkxPSIzMDkiIHgyPSI4MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDEiIHkxPSIzMDkiIHgyPSIxMDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTIwIiB5MT0iMzA5IiB4Mj0iMTIwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEzOSIgeTE9IjMwOSIgeDI9IjEzOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTciIHkxPSIzMDkiIHgyPSIxNTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTc2IiB5MT0iMzA5IiB4Mj0iMTc2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5NSIgeTE9IjMwOSIgeDI9IjE5NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTMiIHkxPSIzMDkiIHgyPSIyMTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjMyIiB5MT0iMzA5IiB4Mj0iMjMyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI1MSIgeTE9IjMwOSIgeDI9IjI1MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNjkiIHkxPSIzMDkiIHgyPSIyNjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjg4IiB5MT0iMzA5IiB4Mj0iMjg4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwNyIgeTE9IjMwOSIgeDI9IjMwNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjUiIHkxPSIzMDkiIHgyPSIzMjUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQ0IiB5MT0iMzA5IiB4Mj0iMzQ0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2MyIgeTE9IjMwOSIgeDI9IjM2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODIiIHkxPSIzMDkiIHgyPSIzODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDAwIiB5MT0iMzA5IiB4Mj0iNDAwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQxOSIgeTE9IjMwOSIgeDI9IjQxOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzgiIHkxPSIzMDkiIHgyPSI0MzgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDU2IiB5MT0iMzA5IiB4Mj0iNDU2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ3NSIgeTE9IjMwOSIgeDI9IjQ3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTQiIHkxPSIzMDkiIHgyPSI0OTQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTEyIiB5MT0iMzA5IiB4Mj0iNTEyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUzMSIgeTE9IjMwOSIgeDI9IjUzMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NTAiIHkxPSIzMDkiIHgyPSI1NTAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTY4IiB5MT0iMzA5IiB4Mj0iNTY4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU4NyIgeTE9IjMwOSIgeDI9IjU4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MDYiIHkxPSIzMDkiIHgyPSI2MDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjI0IiB5MT0iMzA5IiB4Mj0iNjI0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY0MyIgeTE9IjMwOSIgeDI9IjY0MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NjIiIHkxPSIzMDkiIHgyPSI2NjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgwIiB5MT0iMzA5IiB4Mj0iNjgwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA5IiB4Mj0iNzA5IiB5Mj0iMzA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwNiIgeDI9IjcwOSIgeTI9IjMwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDIiIHgyPSI3MDkiIHkyPSIzMDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjk4IiB4Mj0iNzA5IiB5Mj0iMjk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5NCIgeDI9IjcwOSIgeTI9IjI5NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTAiIHgyPSI3MDkiIHkyPSIyOTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg3IiB4Mj0iNzA5IiB5Mj0iMjg3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4MyIgeDI9IjcwOSIgeTI9IjI4MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzkiIHgyPSI3MDkiIHkyPSIyNzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc1IiB4Mj0iNzA5IiB5Mj0iMjc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MSIgeDI9IjcwOSIgeTI9IjI3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjciIHgyPSI3MDkiIHkyPSIyNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY0IiB4Mj0iNzA5IiB5Mj0iMjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2MCIgeDI9IjcwOSIgeTI9IjI2MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTYiIHgyPSI3MDkiIHkyPSIyNTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjUyIiB4Mj0iNzA5IiB5Mj0iMjUyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0OCIgeDI9IjcwOSIgeTI9IjI0OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDUiIHgyPSI3MDkiIHkyPSIyNDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQxIiB4Mj0iNzA5IiB5Mj0iMjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzNyIgeDI9IjcwOSIgeTI9IjIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzMiIHgyPSI3MDkiIHkyPSIyMzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI5IiB4Mj0iNzA5IiB5Mj0iMjI5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyNSIgeDI9IjcwOSIgeTI9IjIyNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjIiIHgyPSI3MDkiIHkyPSIyMjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE4IiB4Mj0iNzA5IiB5Mj0iMjE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNCIgeDI9IjcwOSIgeTI9IjIxNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTAiIHgyPSI3MDkiIHkyPSIyMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA2IiB4Mj0iNzA5IiB5Mj0iMjA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMyIgeDI9IjcwOSIgeTI9IjIwMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTkiIHgyPSI3MDkiIHkyPSIxOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTk1IiB4Mj0iNzA5IiB5Mj0iMTk1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5MSIgeDI9IjcwOSIgeTI9IjE5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODciIHgyPSI3MDkiIHkyPSIxODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTgzIiB4Mj0iNzA5IiB5Mj0iMTgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4MCIgeDI9IjcwOSIgeTI9IjE4MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzYiIHgyPSI3MDkiIHkyPSIxNzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTcyIiB4Mj0iNzA5IiB5Mj0iMTcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2OCIgeDI9IjcwOSIgeTI9IjE2OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjQiIHgyPSI3MDkiIHkyPSIxNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTYxIiB4Mj0iNzA5IiB5Mj0iMTYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1NyIgeDI9IjcwOSIgeTI9IjE1NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTMiIHgyPSI3MDkiIHkyPSIxNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ5IiB4Mj0iNzA5IiB5Mj0iMTQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NSIgeDI9IjcwOSIgeTI9IjE0NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDEiIHgyPSI3MDkiIHkyPSIxNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM4IiB4Mj0iNzA5IiB5Mj0iMTM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzNCIgeDI9IjcwOSIgeTI9IjEzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzAiIHgyPSI3MDkiIHkyPSIxMzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI2IiB4Mj0iNzA5IiB5Mj0iMTI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyMiIgeDI9IjcwOSIgeTI9IjEyMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTkiIHgyPSI3MDkiIHkyPSIxMTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTE1IiB4Mj0iNzA5IiB5Mj0iMTE1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExMSIgeDI9IjcwOSIgeTI9IjExMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDciIHgyPSI3MDkiIHkyPSIxMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTAzIiB4Mj0iNzA5IiB5Mj0iMTAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijk5IiB4Mj0iNzA5IiB5Mj0iOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTYiIHgyPSI3MDkiIHkyPSI5NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MiIgeDI9IjcwOSIgeTI9IjkyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg4IiB4Mj0iNzA5IiB5Mj0iODgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODQiIHgyPSI3MDkiIHkyPSI4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MCIgeDI9IjcwOSIgeTI9IjgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc3IiB4Mj0iNzA5IiB5Mj0iNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzMiIHgyPSI3MDkiIHkyPSI3MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2OSIgeDI9IjcwOSIgeTI9IjY5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY1IiB4Mj0iNzA5IiB5Mj0iNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjEiIHgyPSI3MDkiIHkyPSI2MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1NyIgeDI9IjcwOSIgeTI9IjU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU0IiB4Mj0iNzA5IiB5Mj0iNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTAiIHgyPSI3MDkiIHkyPSI1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0NiIgeDI9IjcwOSIgeTI9IjQ2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQyIiB4Mj0iNzA5IiB5Mj0iNDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzgiIHgyPSI3MDkiIHkyPSIzOCIvPgo8dGV4dCB4PSIxMCIgeT0iMTcyIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIiB0cmFuc2Zvcm09InJvdGF0ZSgyNzAsIDEwLCAxNzIpIj4KdGl0bGVzCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwMSIgeTE9IjMwOSIgeDI9IjEwMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTUiIHkxPSIzMDkiIHgyPSIxOTUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjg4IiB5MT0iMzA5IiB4Mj0iMjg4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4MiIgeTE9IjMwOSIgeDI9IjM4MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NzUiIHkxPSIzMDkiIHgyPSI0NzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTY4IiB5MT0iMzA5IiB4Mj0iNTY4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY2MiIgeTE9IjMwOSIgeDI9IjY2MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwOSIgeDI9IjcwOSIgeTI9IjMwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzEiIHgyPSI3MDkiIHkyPSIyNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjMzIiB4Mj0iNzA5IiB5Mj0iMjMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5NSIgeDI9IjcwOSIgeTI9IjE5NSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTciIHgyPSI3MDkiIHkyPSIxNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTE5IiB4Mj0iNzA5IiB5Mj0iMTE5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjgwIiB4Mj0iNzA5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDIiIHgyPSI3MDkiIHkyPSI0MiIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzQgNTQsMzA5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMzA5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzA5IDU0LDMwOSAiLz4KPHRleHQgeD0iNDUiIHk9IjI3MSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMi4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI3MSA1NCwyNzEgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyMzMiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjQuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyMzMgNTQsMjMzICIvPgo8dGV4dCB4PSI0NSIgeT0iMTk1IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo2LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTk1IDU0LDE5NSAiLz4KPHRleHQgeD0iNDUiIHk9IjE1NyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KOC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE1NyA1NCwxNTcgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxMTkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTE5IDU0LDExOSAiLz4KPHRleHQgeD0iNDUiIHk9IjgwIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMi4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDgwIDU0LDgwICIvPgo8dGV4dCB4PSI0NSIgeT0iNDIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjE0LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksNDIgNTQsNDIgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NSwzMTAgNzA5LDMxMCAiLz4KPHRleHQgeD0iMTAxIiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpNYW4gVW5pdGVkCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjEwMSwzMTAgMTAxLDMxNSAiLz4KPHRleHQgeD0iMTk1IiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpNYW4gQ2l0eQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxOTUsMzEwIDE5NSwzMTUgIi8+Cjx0ZXh0IHg9IjI4OCIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2hlbHNlYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyODgsMzEwIDI4OCwzMTUgIi8+Cjx0ZXh0IHg9IjM4MiIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQXJzZW5hbAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIzODIsMzEwIDM4MiwzMTUgIi8+Cjx0ZXh0IHg9IjQ3NSIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTGl2ZXJwb29sCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ3NSwzMTAgNDc1LDMxNSAiLz4KPHRleHQgeD0iNTY4IiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpCbGFja2J1cm4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTY4LDMxMCA1NjgsMzE1ICIvPgo8dGV4dCB4PSI2NjIiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkxlaWNlc3Rlcgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NjIsMzEwIDY2MiwzMTUgIi8+CjxyZWN0IHg9IjY5IiB5PSI4MCIgd2lkdGg9IjY1IiBoZWlnaHQ9IjIyOSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjE2MiIgeT0iMTU3IiB3aWR0aD0iNjUiIGhlaWdodD0iMTUyIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjU1IiB5PSIyMTQiIHdpZHRoPSI2NiIgaGVpZ2h0PSI5NSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjM0OSIgeT0iMjMzIiB3aWR0aD0iNjUiIGhlaWdodD0iNzYiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0NDIiIHk9IjI3MSIgd2lkdGg9IjY2IiBoZWlnaHQ9IjM4IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNTM2IiB5PSIyOTAiIHdpZHRoPSI2NSIgaGVpZ2h0PSIxOSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYyOSIgeT0iMjkwIiB3aWR0aD0iNjUiIGhlaWdodD0iMTkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

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

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzYwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc2MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzgwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2hhbXBpb24mYXBvcztzIHBvaW50cywgc2Vhc29uIGJ5IHNlYXNvbgo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9Ijc0OSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNTQiIHgyPSI3NDkiIHkyPSIzNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQ4IiB4Mj0iNzQ5IiB5Mj0iMzQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0MiIgeDI9Ijc0OSIgeTI9IjM0MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzYiIHgyPSI3NDkiIHkyPSIzMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzMwIiB4Mj0iNzQ5IiB5Mj0iMzMwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyNCIgeDI9Ijc0OSIgeTI9IjMyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMTgiIHgyPSI3NDkiIHkyPSIzMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzEyIiB4Mj0iNzQ5IiB5Mj0iMzEyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwNiIgeDI9Ijc0OSIgeTI9IjMwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDAiIHgyPSI3NDkiIHkyPSIzMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjk0IiB4Mj0iNzQ5IiB5Mj0iMjk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4OSIgeDI9Ijc0OSIgeTI9IjI4OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODMiIHgyPSI3NDkiIHkyPSIyODMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc3IiB4Mj0iNzQ5IiB5Mj0iMjc3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MSIgeDI9Ijc0OSIgeTI9IjI3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjUiIHgyPSI3NDkiIHkyPSIyNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU5IiB4Mj0iNzQ5IiB5Mj0iMjU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1MyIgeDI9Ijc0OSIgeTI9IjI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDciIHgyPSI3NDkiIHkyPSIyNDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQxIiB4Mj0iNzQ5IiB5Mj0iMjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzNSIgeDI9Ijc0OSIgeTI9IjIzNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjkiIHgyPSI3NDkiIHkyPSIyMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI0IiB4Mj0iNzQ5IiB5Mj0iMjI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxOCIgeDI9Ijc0OSIgeTI9IjIxOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTIiIHgyPSI3NDkiIHkyPSIyMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA2IiB4Mj0iNzQ5IiB5Mj0iMjA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMCIgeDI9Ijc0OSIgeTI9IjIwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTQiIHgyPSI3NDkiIHkyPSIxOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg4IiB4Mj0iNzQ5IiB5Mj0iMTg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4MiIgeDI9Ijc0OSIgeTI9IjE4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzYiIHgyPSI3NDkiIHkyPSIxNzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTcwIiB4Mj0iNzQ5IiB5Mj0iMTcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2NCIgeDI9Ijc0OSIgeTI9IjE2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTkiIHgyPSI3NDkiIHkyPSIxNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTUzIiB4Mj0iNzQ5IiB5Mj0iMTUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NyIgeDI9Ijc0OSIgeTI9IjE0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDEiIHgyPSI3NDkiIHkyPSIxNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM1IiB4Mj0iNzQ5IiB5Mj0iMTM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyOSIgeDI9Ijc0OSIgeTI9IjEyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjMiIHgyPSI3NDkiIHkyPSIxMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTE3IiB4Mj0iNzQ5IiB5Mj0iMTE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExMSIgeDI9Ijc0OSIgeTI9IjExMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDUiIHgyPSI3NDkiIHkyPSIxMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTkiIHgyPSI3NDkiIHkyPSI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NCIgeDI9Ijc0OSIgeTI9Ijk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg4IiB4Mj0iNzQ5IiB5Mj0iODgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODIiIHgyPSI3NDkiIHkyPSI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3NiIgeDI9Ijc0OSIgeTI9Ijc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjcwIiB4Mj0iNzQ5IiB5Mj0iNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjQiIHgyPSI3NDkiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1OCIgeDI9Ijc0OSIgeTI9IjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjUyIiB4Mj0iNzQ5IiB5Mj0iNTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDYiIHgyPSI3NDkiIHkyPSI0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MCIgeDI9Ijc0OSIgeTI9IjQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0IiB4Mj0iNzQ5IiB5Mj0iMzQiLz4KPHRleHQgeD0iMTAiIHk9IjE5NyIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCIgdHJhbnNmb3JtPSJyb3RhdGUoMjcwLCAxMCwgMTk3KSI+CnBvaW50cwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9Ijc0OSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDAiIHgyPSI3NDkiIHkyPSIzMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQxIiB4Mj0iNzQ5IiB5Mj0iMjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4MiIgeDI9Ijc0OSIgeTI9IjE4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjMiIHgyPSI3NDkiIHkyPSIxMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjQiIHgyPSI3NDkiIHkyPSI2NCIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzQgNTQsMzU5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMzU5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzU5IDU0LDM1OSAiLz4KPHRleHQgeD0iNDUiIHk9IjMwMCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMDAgNTQsMzAwICIvPgo8dGV4dCB4PSI0NSIgeT0iMjQxIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI0MSA1NCwyNDEgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxODIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTgyIDU0LDE4MiAiLz4KPHRleHQgeD0iNDUiIHk9IjEyMyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KODAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxMjMgNTQsMTIzICIvPgo8dGV4dCB4PSI0NSIgeT0iNjQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDY0IDU0LDY0ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzYwIDc0OSwzNjAgIi8+CjxjaXJjbGUgY3g9IjY1IiBjeT0iODgiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg2IiBjeT0iOTciIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjEwNyIgY3k9IjExNyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTI4IiBjeT0iMTM4IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxNDkiIGN5PSIxMjkiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE3MCIgY3k9IjEyNiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTkxIiBjeT0iOTEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjIxMiIgY3k9IjEyMyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjMzIiBjeT0iMTAyIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyNTQiIGN5PSIxMTQiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjI3NSIgY3k9Ijk0IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyOTYiIGN5PSI3OSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzE3IiBjeT0iOTEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMzOCIgY3k9Ijk3IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzNTkiIGN5PSIxMDIiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM4MCIgY3k9Ijk0IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0MDIiIGN5PSIxMDUiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQyMyIgY3k9IjEyMyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDQ0IiBjeT0iOTciIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ2NSIgY3k9Ijk3IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0ODYiIGN5PSIxMDUiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjUwNyIgY3k9IjEwMiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTI4IiBjeT0iMTIwIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1NDkiIGN5PSI4NSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTcwIiBjeT0iNjQiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjU5MSIgY3k9IjcwIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTIiIGN5PSI2NyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjMzIiBjeT0iMTA1IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2NTQiIGN5PSI4NSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjc1IiBjeT0iOTciIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjY5NiIgY3k9IjkxIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI3MTciIGN5PSIxMTEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjczOCIgY3k9IjEwOCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDBGRiIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY1LDg4IDg2LDk3IDEwNywxMTcgMTI4LDEzOCAxNDksMTI5IDE3MCwxMjYgMTkxLDkxIDIxMiwxMjMgMjMzLDEwMiAyNTQsMTE0IDI3NSw5NCAyOTYsNzkgMzE3LDkxIDMzOCw5NyAzNTksMTAyIDM4MCw5NCA0MDIsMTA1IDQyMywxMjMgNDQ0LDk3IDQ2NSw5NyA0ODYsMTA1IDUwNywxMDIgNTI4LDEyMCA1NDksODUgNTcwLDY0IDU5MSw3MCA2MTIsNjcgNjMzLDEwNSA2NTQsODUgNjc1LDk3IDY5Niw5MSA3MTcsMTExIDczOCwxMDggIi8+Cjwvc3ZnPg==)

## Discussion

Across **33 complete seasons** (1993/94 → 2025/26) and 13,126 matches — after
dropping the duplicate fixtures that the merged data sources produce — the
record book reads:

- **Most championships**: Manchester United 12, Manchester City 8, Chelsea 5,
  Arsenal 4, Liverpool 2 — and one title each for Blackburn (1994/95) and
  Leicester (2015/16). Only **seven different clubs** have ever won the Premier
  League.
- **Champion hall of fame**: Manchester City's 2017/18 side owns almost every
  record — 100 points, 106 goals, +79 goal difference and a 19-point title
  margin, all in a single season. The exceptions: Chelsea's 2004/05 side
  conceded just **15 goals**, and Liverpool's 2019/20 team won a club-record
  **28 matches**.
- **Best season ever**: City 2017/18 again — 2.63 points per game, the highest
  ppg ever recorded by a Premier League champion.
- **Invincibles**: Arsenal's 2003/04 side is the **only** unbeaten Premier
  League season in the dataset (26W 12D, 73–26).
- **Closest finish**: 2011/12 — City and United both finished on **89 points**
  and the title was decided by goal difference, the only dead-heat in Premier
  League history. Four other seasons were decided by a single point.
- **Biggest blowout**: again City 2017/18, 19 clear of United.
- **Records on the pitch**: three separate 9–0 wins (United 9–0 Ipswich 1994/95,
  United 9–0 Southampton 2020/21, Liverpool 9–0 Bournemouth 2022/23); the
  highest-scoring match was Portsmouth 7–4 Reading (2007/08).
- **Top scorers** (StatsBomb coverage, 2015/16): Kane 25, Vardy 24, Agüero 24,
  Lukaku 18, Mahrez 17.

_Method notes: standings are recomputed from raw results with standard 3/1/0
points; the 2026/27 season is still in progress and excluded. Team names are
normalised across the two merged data sources and duplicate fixtures removed.
Player scoring data covers only the StatsBomb match subset._

**Limitations.** Records reflect only the matches present in the database;
coverage varies by competition and era, so 'records' are archive records, not
all-time official marks.

## Conclusion

Most championships: Manchester United 12, Manchester City 8, Chelsea 5, Arsenal
4, Liverpool 2 — and one title each for Blackburn (1994/95) and Leicester
(2015/16). Together these results answer the research question posed in the
Introduction and quantify the pattern across 13,126 matches. The notebook
provides a fully reproducible pipeline from raw CSV extracts to published
figures.
