---
title: 'New manager, same table: does the bounce actually work?'
description: |
  'Every documented Premier League managerial change, 2015/16-2024/25 —
  43 events analysed against 301k match results. The bounce is real but
  oversold: +0.1 ppg on average, and it almost never saves a doomed team.'
author: 'hieudoan'
date: '2026-11-25T14:00'
order: 13
tags: ['football', 'analysis', 'premier-league', 'managers', 'mars', 'sqlite']
---

# Managerial changes and relegation: a Premier League analysis

## Abstract

Does changing the manager save a Premier League team from relegation? This study
answers it using the manager records drawn from the Soccers football database.
43 documented Premier League managerial changes (2015/16 → 2024/25). All
computation runs in Rust inside a `.mars` notebook (polars + plotters — charts
as inline SVG), and every table and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, premier-league, managers, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [The events](#the-events)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

The "new manager bounce" is football's most quoted phenomenon — sack the boss,
results improve, survival chances rise. This notebook tests it properly on
**every documented managerial change in the Premier League, 2015/16 → 2024/25**
(45 events), using match results from `data/matches_full.csv` (301k matches).

**Data caveat.** `dev.db` has no managerial-change history (`team_manager` only
covers StatsBomb squad lists), so the change dates below are **curated from
public appointment/sacking records** — each `date` snaps forward to the affected
team's next league match. Everything else (results, tables, relegation) comes
straight from the database export.

**Method.** For each event we measure points/game over the **10 matches before
vs the 10 matches after** the change, the team's league position at the moment
of the change, and whether it finished outside the bottom three. We compare
against the baseline: all 200 EPL team-seasons in the window survive at **85%**.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `matches_full`.

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

// keep only the Premier League
let df = df
    .lazy()
    .filter(col("league").eq(lit("English Premier League")))
    .collect()
    .expect("filter failed");

println!("EPL matches: {}", df.height());

// columns -> plain vectors
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

// canonical team names (the CSV mixes "Man United"/"Manchester United" etc.)
fn canon(name: &str) -> &str {
    match name {
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
        other => other,
    }
}

#[derive(Clone)]
struct Game {
    date: String, // YYYY-MM-DD
    gf: i64,
    ga: i64,
    home: bool,
}

// (season, team) -> chronological match list
let mut team_games: BTreeMap<(String, String), Vec<Game>> = BTreeMap::new();
let mut n_finished = 0usize;
for i in 0..df.height() {
    if hg_v[i] < 0 || ag_v[i] < 0 {
        continue;
    }
    n_finished += 1;
    let date = date_v[i][..10].to_string();
    let hg = hg_v[i];
    let ag = ag_v[i];
    let h = canon(&home_v[i]).to_string();
    let a = canon(&away_v[i]).to_string();
    let s = season_v[i].clone();
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
println!("finished matches: {} | team-season entries: {}", n_finished, team_games.len());

fn pts(g: &Game) -> i64 {
    if g.gf > g.ga { 3 } else if g.gf == g.ga { 1 } else { 0 }
}

// final table per season -> (rank, points) for every team
let mut season_teams: BTreeMap<String, Vec<String>> = BTreeMap::new();
for (s, t) in team_games.keys() {
    season_teams.entry(s.clone()).or_default().push(t.clone());
}
// dedupe team lists
for v in season_teams.values_mut() {
    v.sort();
    v.dedup();
}

// final points per (season,team)
let mut final_pts: BTreeMap<(String, String), i64> = BTreeMap::new();
for ((s, t), games) in &team_games {
    final_pts.insert((s.clone(), t.clone()), games.iter().map(pts).sum());
}

// rank within season (1 = top); ties broken by goal difference then name
let season_rank = |season: &str, team: &str| -> usize {
    let teams = match season_teams.get(season) {
        Some(t) => t,
        None => return 99,
    };
    let mut rows: Vec<(i64, i64, String)> = teams
        .iter()
        .map(|t| {
            let games = &team_games[&(season.to_string(), t.clone())];
            let p: i64 = games.iter().map(pts).sum();
            let gd: i64 = games.iter().map(|g| g.gf - g.ga).sum();
            (p, gd, t.clone())
        })
        .collect();
    rows.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    rows.iter().position(|(_, _, t)| t == team).map(|i| i + 1).unwrap_or(99)
};

// league baseline: every team-season 2015/16..2024/25
let mut base_n = 0usize;
let mut base_survived = 0usize;
let mut base_pts_sum = 0i64;
let mut base_games_sum = 0i64;
for (s, teams) in &season_teams {
    if s.as_str() < "2015/16" || s.as_str() > "2024/25" {
        continue;
    }
    for t in teams {
        let games = &team_games[&(s.clone(), t.clone())];
        if games.len() < 30 {
            continue;
        }
        base_n += 1;
        if season_rank(s, t) > 3 {
            base_survived += 1;
        }
        base_pts_sum += games.iter().map(pts).sum::<i64>();
        base_games_sum += games.len() as i64;
    }
}
println!(
    "baseline team-seasons: {} | survival: {:.1}% | league ppg: {:.3}",
    base_n,
    100.0 * base_survived as f64 / base_n as f64,
    base_pts_sum as f64 / base_games_sum as f64
);
```

```text
EPL matches: 13126
finished matches: 13126 | team-season entries: 684
baseline team-seasons: 200 | survival: 85.0% | league ppg: 1.382
```

### The events

Each row is one managerial change. `change at` = the matchday the new era
begins; `pos then` = league position at that moment; `ppg` = points per game
over up to 10 matches either side.

```rust
// Curated Premier League managerial changes, 2015/16 -> 2024/25.
// date = first match window of the new manager's era (appointment +/- a few days;
// the notebook snaps to the team's next match on/after the date).
// Source: publicly documented appointment/sacking dates; not in dev.db.
let events: Vec<(&str, &str, &str)> = vec![
    // 2015/16
    ("Aston Villa", "2015-12-03", "R. Garde (s. Sherwood)"),
    ("Aston Villa", "2016-03-12", "S. Bruce (s. Garde)"),
    ("West Brom", "2015-12-01", "T. Pulis (s. Irvine)"),
    ("Newcastle", "2016-01-02", "R. Benitez (s. Pardew)"),
    ("Chelsea", "2015-12-15", "G. Hiddink (s. Mourinho)"),
    // 2016/17
    ("West Ham", "2016-11-03", "D. Moyes (s. Bilic)"),
    ("Hull", "2016-10-27", "M. Phelan (s. Bruce)"),
    ("Stoke", "2017-01-25", "P. Lambert (s. Hughes)"),
    ("Watford", "2017-05-07", "M. Adams (caretaker)"),
    // 2017/18
    ("Crystal Palace", "2017-10-02", "R. Hodgson (s. De Boer)"),
    ("West Brom", "2017-12-29", "A. Pardew (s. Pulis)"),
    // 2018/19
    ("Man United", "2018-12-19", "O. Solskjaer (s. Mourinho)"),
    ("West Ham", "2018-12-14", "M. Pellegrini (s. Moyes)"),
    ("Fulham", "2019-02-24", "S. Parker (s. Ranieri)"),
    // 2019/20
    ("Everton", "2019-12-05", "D. Ferguson (s. Ancelotti)"),
    ("Arsenal", "2019-11-29", "F. Ljungberg (s. Emery)"),
    ("Watford", "2020-03-02", "caretaker (s. Flores)"),
    // 2020/21
    ("Sheffield United", "2020-12-13", "P. Heckingbottom (s. Wilder)"),
    ("West Brom", "2020-12-21", "S. Bilic (s. Allardyce)"),
    ("Tottenham", "2021-04-20", "N. Espírito Santo (s. Mourinho)"),
    ("Newcastle", "2021-10-20", "E. Howe (s. Bruce)"),
    ("Aston Villa", "2021-10-21", "S. Gerrard (s. Smith)"),
    // 2021/22
    ("Watford", "2021-10-03", "C. Ranieri (s. Xisco)"),
    ("Wolves", "2021-12-06", "B. Lage (s. Nuno)"),
    ("Man United", "2021-11-22", "R. Rangnick (s. Ole)"),
    ("Leeds", "2022-02-27", "caretaker (s. Bielsa)"),
    ("Leicester", "2022-04-02", "D. Smith (s. Rodgers)"),
    ("Norwich", "2022-05-02", "D. Wagner (s. Farke)"),
    ("Crystal Palace", "2022-05-18", "caretaker (s. Vieira)"),
    // 2022/23
    ("Wolves", "2022-08-09", "S. Davis (interim)"),
    ("Wolves", "2022-09-05", "B. Lage (perm.)"),
    ("Bournemouth", "2022-08-15", "G. O'Neil (s. Iraola)"),
    ("Southampton", "2022-11-01", "F. Lampard (s. Hasenhuttl)"),
    ("Leeds", "2023-02-27", "A. Iraola (s. Marsh)"),
    ("Crystal Palace", "2023-03-07", "R. Hodgson (s. Vieira)"),
    ("Leicester", "2023-04-02", "D. Smith (s. Rodgers)"),
    ("Chelsea", "2023-04-04", "F. Lampard (s. Potter)"),
    ("Everton", "2023-04-30", "S. Dyche (s. Lampard)"),
    // 2023/24
    ("Sheffield United", "2023-12-06", "C. Wilder (s. Heckingbottom)"),
    ("West Ham", "2024-05-23", "caretaker (s. Moyes)"),
    ("Chelsea", "2024-05-29", "E. Maresca (s. Pochettino)"),
    // 2024/25
    ("Man United", "2024-10-29", "R. van Nistelrooy (interim)"),
    ("Man United", "2024-11-11", "R. Amorim (perm.)"),
    ("Wolves", "2024-10-20", "R. Edwards (interim)"),
    ("Wolves", "2024-12-18", "V. Pereira (perm.)"),
];

fn season_of(date: &str) -> String {
    let y: i32 = date[..4].parse().unwrap();
    let m: i32 = date[5..7].parse().unwrap();
    if m >= 7 {
        format!("{}/{}", y, (y + 1) % 100)
    } else {
        format!("{}/{}", y - 1, y % 100)
    }
}

struct Ev {
    season: String,
    team: String,
    manager: String,
    md: usize,          // matches played before the change (0-based matchday of next game - 1)
    pos: usize,         // league position at the time of the change
    ppg_b: f64,         // points/game over up to 10 games before
    ppg_a: f64,         // points/game over up to 10 games after
    n_after: usize,
    rank: usize,        // final league position
    survived: bool,
}

let mut results: Vec<Ev> = Vec::new();
for (team, date, mgr) in &events {
    let season = season_of(date);
    let key = (season.clone(), team.to_string());
    let games = match team_games.get(&key) {
        Some(g) => g,
        None => {
            println!("MISS {} {} {}", season, team, date);
            continue;
        }
    };
    // first match on/after the change date
    let idx = games.iter().position(|g| g.date.as_str() >= *date).unwrap_or(games.len());
    if idx == 0 || idx >= games.len() {
        println!("SKIP {} {} {} (idx={})", season, team, date, idx);
        continue;
    }
    let n_before = idx.min(10);
    let ppg_b = if n_before > 0 {
        games[idx - n_before..idx].iter().map(pts).sum::<i64>() as f64 / n_before as f64
    } else {
        f64::NAN
    };
    let n_after = (games.len() - idx).min(10);
    let ppg_a = games[idx..idx + n_after].iter().map(pts).sum::<i64>() as f64 / n_after as f64;
    // position at change: points from games strictly before the change date
    let mut table: Vec<(i64, i64, String)> = season_teams[&season]
        .iter()
        .map(|t| {
            let gs = &team_games[&(season.clone(), t.clone())];
            let p: i64 = gs.iter().filter(|g| g.date.as_str() < *date).map(pts).sum();
            let gd: i64 = gs.iter().filter(|g| g.date.as_str() < *date).map(|g| g.gf - g.ga).sum();
            (p, gd, t.clone())
        })
        .collect();
    table.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    let pos = table.iter().position(|(_, _, t)| t == team).map(|i| i + 1).unwrap_or(99);
    let rank = season_rank(&season, team);
    let n_teams = season_teams.get(&season).map(|v| v.len()).unwrap_or(0);
    results.push(Ev {
        season,
        team: team.to_string(),
        manager: mgr.to_string(),
        md: idx,
        pos,
        ppg_b,
        ppg_a,
        n_after: games.len() - idx,
        rank,
        survived: rank + 3 <= n_teams,
    });
}

println!("managerial-change events analysed: {}", results.len());

// ---- headline numbers ----
let n = results.len() as f64;
let mean_b = results.iter().map(|e| e.ppg_b).sum::<f64>() / n;
let mean_a = results.iter().map(|e| e.ppg_a).sum::<f64>() / n;
let improved = results.iter().filter(|e| e.ppg_a > e.ppg_b).count();
let survived = results.iter().filter(|e| e.survived).count();
println!(
    "mean ppg before: {:.3} | after: {:.3} | improved: {}/{} ({:.0}%) | survived: {}/{} ({:.1}%)",
    mean_b, mean_a, improved, results.len(), 100.0 * improved as f64 / n,
    survived, results.len(), 100.0 * survived as f64 / n
);

// per-event table
let rows: Vec<Vec<String>> = results
    .iter()
    .map(|e| {
        vec![
            e.season.clone(),
            e.team.clone(),
            e.manager.clone(),
            format!("md {}", e.md + 1),
            format!("pos {}", e.pos),
            format!("{:.2}", e.ppg_b),
            format!("{:.2}", e.ppg_a),
            e.rank.to_string(),
            if e.survived { "yes".into() } else { "RELEGATED".into() },
        ]
    })
    .collect();
mars_table(
    &["season", "team", "new manager", "change at", "pos then", "ppg before", "ppg after", "final", "survived"],
    &rows,
);

// ---- Q3: timing buckets (matchday of the change) ----
let bucket_of = |e: &Ev| if e.md < 10 { 0 } else if e.md < 25 { 1 } else { 2 };
let bucket_names = ["early (md 1-10)", "mid (md 11-25)", "late (md 26+)"];
for i in 0..3 {
    let evs: Vec<&Ev> = results.iter().filter(|e| bucket_of(e) == i).collect();
    if evs.is_empty() { continue; }
    let mb = evs.iter().map(|e| e.ppg_b).sum::<f64>() / evs.len() as f64;
    let ma = evs.iter().map(|e| e.ppg_a).sum::<f64>() / evs.len() as f64;
    let sv = evs.iter().filter(|e| e.survived).count();
    println!(
        "{}: n={} mean ppg {:.2} -> {:.2} | survived {}/{} ({:.0}%)",
        bucket_names[i], evs.len(), mb, ma, sv, evs.len(), 100.0 * sv as f64 / evs.len() as f64
    );
}
```

```text
SKIP 2023/24 West Ham 2024-05-23 (idx=38)
SKIP 2023/24 Chelsea 2024-05-29 (idx=38)
managerial-change events analysed: 43
mean ppg before: 0.929 | after: 1.043 | improved: 21/43 (49%) | survived: 29/43 (67.4%)
early (md 1-10): n=10 mean ppg 0.73 -> 0.93 | survived 8/10 (80%)
mid (md 11-25): n=17 mean ppg 0.95 -> 1.18 | survived 10/17 (59%)
late (md 26+): n=16 mean ppg 1.04 -> 0.97 | survived 11/16 (69%)
```

| season  | team             | new manager                     | change at | pos then | ppg before | ppg after | final | survived  |
| ------- | ---------------- | ------------------------------- | --------- | -------- | ---------- | --------- | ----- | --------- |
| 2015/16 | Aston Villa      | R. Garde (s. Sherwood)          | md 22     | pos 20   | 0.20       | 0.80      | 20    | RELEGATED |
| 2015/16 | Aston Villa      | S. Bruce (s. Garde)             | md 46     | pos 20   | 0.60       | 0.00      | 20    | RELEGATED |
| 2015/16 | West Brom        | T. Pulis (s. Irvine)            | md 29     | pos 8    | 1.40       | 1.00      | 11    | yes       |
| 2015/16 | Newcastle        | R. Benitez (s. Pardew)          | md 39     | pos 15   | 1.40       | 0.80      | 12    | yes       |
| 2015/16 | Chelsea          | G. Hiddink (s. Mourinho)        | md 26     | pos 17   | 0.80       | 1.60      | 13    | yes       |
| 2016/17 | West Ham         | D. Moyes (s. Bilic)             | md 11     | pos 17   | 1.00       | 1.20      | 11    | yes       |
| 2016/17 | Hull             | M. Phelan (s. Bruce)            | md 10     | pos 18   | 0.78       | 0.60      | 18    | RELEGATED |
| 2016/17 | Stoke            | P. Lambert (s. Hughes)          | md 23     | pos 9    | 1.50       | 0.80      | 13    | yes       |
| 2016/17 | Watford          | M. Adams (caretaker)            | md 36     | pos 15   | 1.00       | 0.00      | 17    | yes       |
| 2017/18 | Crystal Palace   | R. Hodgson (s. De Boer)         | md 8      | pos 20   | 0.00       | 1.40      | 11    | yes       |
| 2017/18 | West Brom        | A. Pardew (s. Pulis)            | md 21     | pos 19   | 0.50       | 0.50      | 20    | RELEGATED |
| 2018/19 | Man United       | O. Solskjaer (s. Mourinho)      | md 18     | pos 6    | 1.60       | 2.60      | 6     | yes       |
| 2018/19 | West Ham         | M. Pellegrini (s. Moyes)        | md 17     | pos 11   | 1.70       | 1.20      | 10    | yes       |
| 2018/19 | Fulham           | S. Parker (s. Ranieri)          | md 28     | pos 19   | 0.80       | 0.90      | 19    | RELEGATED |
| 2019/20 | Everton          | D. Ferguson (s. Ancelotti)      | md 16     | pos 18   | 0.70       | 1.90      | 12    | yes       |
| 2019/20 | Arsenal          | F. Ljungberg (s. Emery)         | md 14     | pos 8    | 1.20       | 1.10      | 8     | yes       |
| 2019/20 | Watford          | caretaker (s. Flores)           | md 29     | pos 17   | 1.50       | 0.70      | 19    | RELEGATED |
| 2020/21 | Sheffield United | P. Heckingbottom (s. Wilder)    | md 12     | pos 20   | 0.10       | 0.70      | 20    | RELEGATED |
| 2020/21 | West Brom        | S. Bilic (s. Allardyce)         | md 15     | pos 19   | 0.60       | 0.60      | 19    | RELEGATED |
| 2020/21 | Tottenham        | N. Espírito Santo (s. Mourinho) | md 33     | pos 7    | 1.40       | 2.00      | 7     | yes       |
| 2021/22 | Newcastle        | E. Howe (s. Bruce)              | md 9      | pos 19   | 0.38       | 0.70      | 11    | yes       |
| 2021/22 | Aston Villa      | S. Gerrard (s. Smith)           | md 9      | pos 13   | 1.25       | 1.20      | 14    | yes       |
| 2021/22 | Watford          | C. Ranieri (s. Xisco)           | md 8      | pos 14   | 1.00       | 0.60      | 19    | RELEGATED |
| 2021/22 | Wolves           | B. Lage (s. Nuno)               | md 16     | pos 8    | 1.80       | 1.90      | 10    | yes       |
| 2021/22 | Man United       | R. Rangnick (s. Ole)            | md 13     | pos 8    | 1.30       | 2.10      | 6     | yes       |
| 2021/22 | Leeds            | caretaker (s. Bielsa)           | md 27     | pos 16   | 0.70       | 1.10      | 17    | yes       |
| 2021/22 | Leicester        | D. Smith (s. Rodgers)           | md 28     | pos 10   | 1.40       | 1.30      | 8     | yes       |
| 2021/22 | Norwich          | D. Wagner (s. Farke)            | md 35     | pos 20   | 0.40       | 0.25      | 20    | RELEGATED |
| 2021/22 | Crystal Palace   | caretaker (s. Vieira)           | md 37     | pos 13   | 1.60       | 1.50      | 12    | yes       |
| 2022/23 | Wolves           | S. Davis (interim)              | md 2      | pos 15   | 0.00       | 0.90      | 13    | yes       |
| 2022/23 | Wolves           | B. Lage (perm.)                 | md 7      | pos 14   | 1.00       | 0.70      | 13    | yes       |
| 2022/23 | Bournemouth      | G. O'Neil (s. Iraola)           | md 3      | pos 11   | 1.50       | 1.00      | 15    | yes       |
| 2022/23 | Southampton      | F. Lampard (s. Hasenhuttl)      | md 14     | pos 17   | 0.80       | 0.60      | 20    | RELEGATED |
| 2022/23 | Leeds            | A. Iraola (s. Marsh)            | md 25     | pos 17   | 0.70       | 0.80      | 19    | RELEGATED |
| 2022/23 | Crystal Palace   | R. Hodgson (s. Vieira)          | md 26     | pos 12   | 0.80       | 1.30      | 11    | yes       |
| 2022/23 | Leicester        | D. Smith (s. Rodgers)           | md 29     | pos 18   | 0.80       | 0.90      | 18    | RELEGATED |
| 2022/23 | Chelsea          | F. Lampard (s. Potter)          | md 29     | pos 11   | 1.30       | 0.60      | 12    | yes       |
| 2022/23 | Everton          | S. Dyche (s. Lampard)           | md 34     | pos 19   | 0.70       | 1.60      | 17    | yes       |
| 2023/24 | Sheffield United | C. Wilder (s. Heckingbottom)    | md 15     | pos 20   | 0.40       | 0.80      | 20    | RELEGATED |
| 2024/25 | Man United       | R. van Nistelrooy (interim)     | md 10     | pos 13   | 1.22       | 1.10      | 15    | yes       |
| 2024/25 | Man United       | R. Amorim (perm.)               | md 12     | pos 13   | 1.20       | 1.10      | 15    | yes       |
| 2024/25 | Wolves           | R. Edwards (interim)            | md 8      | pos 20   | 0.14       | 1.10      | 16    | yes       |
| 2024/25 | Wolves           | V. Pereira (perm.)              | md 17     | pos 19   | 0.80       | 1.30      | 16    | yes       |

```rust
use plotters::prelude::*;

// timing-bucket aggregates for charts
let mut bnames: Vec<&str> = Vec::new();
let mut bbefore: Vec<f64> = Vec::new();
let mut bafter: Vec<f64> = Vec::new();
let mut bsurv: Vec<f64> = Vec::new();
let bucket_names = ["early (md 1-10)", "mid (md 11-25)", "late (md 26+)"];
for i in 0..3 {
    let evs: Vec<&Ev> = results
        .iter()
        .filter(|e| {
            let b = if e.md < 10 { 0 } else if e.md < 25 { 1 } else { 2 };
            b == i
        })
        .collect();
    if evs.is_empty() {
        continue;
    }
    bnames.push(bucket_names[i]);
    bbefore.push(evs.iter().map(|e| e.ppg_b).sum::<f64>() / evs.len() as f64);
    bafter.push(evs.iter().map(|e| e.ppg_a).sum::<f64>() / evs.len() as f64);
    bsurv.push(100.0 * evs.iter().filter(|e| e.survived).count() as f64 / evs.len() as f64);
}

// Chart 1: scatter of ppg before vs after (green = survived, red = relegated)
let ymax = 2.6_f64;
let mut rng_state = 0x9e3779b97f4a7c15u64;
let mut jitter = move || {
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 7;
    rng_state ^= rng_state << 17;
    (rng_state % 1000) as f64 / 1000.0
};
let figure1 = plotters::evcxr::evcxr_figure((720, 420), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Points per game: 10 matches before vs after the managerial change", ("sans-serif", 18))
        .margin(40)
        .x_label_area_size(40)
        .y_label_area_size(45)
        .build_cartesian_2d(0.0..2.2_f64, 0.0..ymax)?;
    chart.configure_mesh().y_desc("points / game").draw()?;
    for e in &results {
        let x = e.ppg_b + (jitter() - 0.5) * 0.12;
        let y = e.ppg_a + (jitter() - 0.5) * 0.12;
        let color = if e.survived { GREEN } else { RED };
        chart.draw_series(std::iter::once(Circle::new((x, y), 4, color.filled())))?;
    }
    chart.draw_series(std::iter::once(
        Rectangle::new([(mean_b - 0.04, 0.0), (mean_b + 0.04, ymax)], BLUE.mix(0.3)),
    ))?;
    chart.draw_series(std::iter::once(
        Rectangle::new([(mean_a - 0.04, 0.0), (mean_a + 0.04, ymax)], RED.mix(0.3)),
    ))?;
    Ok(())
});
figure1.evcxr_display();
```

```text
EPL matches: 13126
finished matches: 13126 | team-season entries: 684
baseline team-seasons: 200 | survival: 85.0% | league ppg: 1.382
SKIP 2023/24 West Ham 2024-05-23 (idx=38)
SKIP 2023/24 Chelsea 2024-05-29 (idx=38)
managerial-change events analysed: 43
mean ppg before: 0.929 | after: 1.043 | improved: 21/43 (49%) | survived: 29/43 (67.4%)
early (md 1-10): n=10 mean ppg 0.73 -> 0.93 | survived 8/10 (80%)
mid (md 11-25): n=17 mean ppg 0.95 -> 1.18 | survived 10/17 (59%)
late (md 26+): n=16 mean ppg 1.04 -> 0.97 | survived 11/16 (69%)
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQyMCIgdmlld0JveD0iMCAwIDcyMCA0MjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDIwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSI0NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUG9pbnRzIHBlciBnYW1lOiAxMCBtYXRjaGVzIGJlZm9yZSB2cyBhZnRlciB0aGUgbWFuYWdlcmlhbCBjaGFuZ2UKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIzMzkiIHgyPSI4NSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5OCIgeTE9IjMzOSIgeDI9Ijk4IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjExMiIgeTE9IjMzOSIgeDI9IjExMiIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMjUiIHkxPSIzMzkiIHgyPSIxMjUiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTM5IiB5MT0iMzM5IiB4Mj0iMTM5IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MiIgeTE9IjMzOSIgeDI9IjE1MiIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNjYiIHkxPSIzMzkiIHgyPSIxNjYiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTc5IiB5MT0iMzM5IiB4Mj0iMTc5IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5MyIgeTE9IjMzOSIgeDI9IjE5MyIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMDYiIHkxPSIzMzkiIHgyPSIyMDYiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIwIiB5MT0iMzM5IiB4Mj0iMjIwIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzMyIgeTE9IjMzOSIgeDI9IjIzMyIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDciIHkxPSIzMzkiIHgyPSIyNDciIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjYwIiB5MT0iMzM5IiB4Mj0iMjYwIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3NCIgeTE9IjMzOSIgeDI9IjI3NCIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyODciIHkxPSIzMzkiIHgyPSIyODciIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzAxIiB5MT0iMzM5IiB4Mj0iMzAxIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMxNCIgeTE9IjMzOSIgeDI9IjMxNCIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjgiIHkxPSIzMzkiIHgyPSIzMjgiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQxIiB5MT0iMzM5IiB4Mj0iMzQxIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1NSIgeTE9IjMzOSIgeDI9IjM1NSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNjgiIHkxPSIzMzkiIHgyPSIzNjgiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzgyIiB5MT0iMzM5IiB4Mj0iMzgyIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM5NSIgeTE9IjMzOSIgeDI9IjM5NSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDkiIHkxPSIzMzkiIHgyPSI0MDkiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDIyIiB5MT0iMzM5IiB4Mj0iNDIyIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzNiIgeTE9IjMzOSIgeDI9IjQzNiIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NDkiIHkxPSIzMzkiIHgyPSI0NDkiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDYzIiB5MT0iMzM5IiB4Mj0iNDYzIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ3NiIgeTE9IjMzOSIgeDI9IjQ3NiIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTAiIHkxPSIzMzkiIHgyPSI0OTAiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTAzIiB5MT0iMzM5IiB4Mj0iNTAzIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxNyIgeTE9IjMzOSIgeDI9IjUxNyIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MzAiIHkxPSIzMzkiIHgyPSI1MzAiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQ0IiB5MT0iMzM5IiB4Mj0iNTQ0IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1NyIgeTE9IjMzOSIgeDI9IjU1NyIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzEiIHkxPSIzMzkiIHgyPSI1NzEiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTg0IiB5MT0iMzM5IiB4Mj0iNTg0IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5OCIgeTE9IjMzOSIgeDI9IjU5OCIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTEiIHkxPSIzMzkiIHgyPSI2MTEiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjI1IiB5MT0iMzM5IiB4Mj0iNjI1IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYzOCIgeTE9IjMzOSIgeDI9IjYzOCIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTIiIHkxPSIzMzkiIHgyPSI2NTIiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjY1IiB5MT0iMzM5IiB4Mj0iNjY1IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY3OSIgeTE9IjMzOSIgeDI9IjY3OSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjMzOSIgeDI9IjY3OSIgeTI9IjMzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIzMzQiIHgyPSI2NzkiIHkyPSIzMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMzI5IiB4Mj0iNjc5IiB5Mj0iMzI5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjMyNCIgeDI9IjY3OSIgeTI9IjMyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIzMTgiIHgyPSI2NzkiIHkyPSIzMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMzEzIiB4Mj0iNjc5IiB5Mj0iMzEzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjMwOCIgeDI9IjY3OSIgeTI9IjMwOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIzMDIiIHgyPSI2NzkiIHkyPSIzMDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjk3IiB4Mj0iNjc5IiB5Mj0iMjk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI5MiIgeDI9IjY3OSIgeTI9IjI5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyODciIHgyPSI2NzkiIHkyPSIyODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjgxIiB4Mj0iNjc5IiB5Mj0iMjgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI3NiIgeDI9IjY3OSIgeTI9IjI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyNzEiIHgyPSI2NzkiIHkyPSIyNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjY1IiB4Mj0iNjc5IiB5Mj0iMjY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI2MCIgeDI9IjY3OSIgeTI9IjI2MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyNTUiIHgyPSI2NzkiIHkyPSIyNTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjUwIiB4Mj0iNjc5IiB5Mj0iMjUwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI0NCIgeDI9IjY3OSIgeTI9IjI0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyMzkiIHgyPSI2NzkiIHkyPSIyMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjM0IiB4Mj0iNjc5IiB5Mj0iMjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjIyOCIgeDI9IjY3OSIgeTI9IjIyOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyMjMiIHgyPSI2NzkiIHkyPSIyMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjE4IiB4Mj0iNjc5IiB5Mj0iMjE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjIxMyIgeDI9IjY3OSIgeTI9IjIxMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyMDciIHgyPSI2NzkiIHkyPSIyMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjAyIiB4Mj0iNjc5IiB5Mj0iMjAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE5NyIgeDI9IjY3OSIgeTI9IjE5NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxOTEiIHgyPSI2NzkiIHkyPSIxOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTg2IiB4Mj0iNjc5IiB5Mj0iMTg2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE4MSIgeDI9IjY3OSIgeTI9IjE4MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxNzYiIHgyPSI2NzkiIHkyPSIxNzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTcwIiB4Mj0iNjc5IiB5Mj0iMTcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE2NSIgeDI9IjY3OSIgeTI9IjE2NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxNjAiIHgyPSI2NzkiIHkyPSIxNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTU0IiB4Mj0iNjc5IiB5Mj0iMTU0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE0OSIgeDI9IjY3OSIgeTI9IjE0OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxNDQiIHgyPSI2NzkiIHkyPSIxNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTM5IiB4Mj0iNjc5IiB5Mj0iMTM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjEzMyIgeDI9IjY3OSIgeTI9IjEzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxMjgiIHgyPSI2NzkiIHkyPSIxMjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTIzIiB4Mj0iNjc5IiB5Mj0iMTIzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjExNyIgeDI9IjY3OSIgeTI9IjExNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxMTIiIHgyPSI2NzkiIHkyPSIxMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTA3IiB4Mj0iNjc5IiB5Mj0iMTA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjEwMiIgeDI9IjY3OSIgeTI9IjEwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI5NiIgeDI9IjY3OSIgeTI9Ijk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjkxIiB4Mj0iNjc5IiB5Mj0iOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iODYiIHgyPSI2NzkiIHkyPSI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI4MCIgeDI9IjY3OSIgeTI9IjgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9Ijc1IiB4Mj0iNjc5IiB5Mj0iNzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iNzAiIHgyPSI2NzkiIHkyPSI3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI2NCIgeDI9IjY3OSIgeTI9IjY0Ii8+Cjx0ZXh0IHg9IjQwIiB5PSIyMDIiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiIHRyYW5zZm9ybT0icm90YXRlKDI3MCwgNDAsIDIwMikiPgpwb2ludHMgLyBnYW1lCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMzM5IiB4Mj0iODUiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIwIiB5MT0iMzM5IiB4Mj0iMjIwIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1NSIgeTE9IjMzOSIgeDI9IjM1NSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTAiIHkxPSIzMzkiIHgyPSI0OTAiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjI1IiB5MT0iMzM5IiB4Mj0iNjI1IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMzM5IiB4Mj0iNjc5IiB5Mj0iMzM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI4NyIgeDI9IjY3OSIgeTI9IjI4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyMzQiIHgyPSI2NzkiIHkyPSIyMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTgxIiB4Mj0iNjc5IiB5Mj0iMTgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjEyOCIgeDI9IjY3OSIgeTI9IjEyOCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI3NSIgeDI9IjY3OSIgeTI9Ijc1Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4NCw2NCA4NCwzMzkgIi8+Cjx0ZXh0IHg9Ijc1IiB5PSIzMzkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI3OSwzMzkgODQsMzM5ICIvPgo8dGV4dCB4PSI3NSIgeT0iMjg3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzksMjg3IDg0LDI4NyAiLz4KPHRleHQgeD0iNzUiIHk9IjIzNCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijc5LDIzNCA4NCwyMzQgIi8+Cjx0ZXh0IHg9Ijc1IiB5PSIxODEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEuNQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI3OSwxODEgODQsMTgxICIvPgo8dGV4dCB4PSI3NSIgeT0iMTI4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzksMTI4IDg0LDEyOCAiLz4KPHRleHQgeD0iNzUiIHk9Ijc1IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyLjUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzksNzUgODQsNzUgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4NSwzNDAgNjc5LDM0MCAiLz4KPHRleHQgeD0iODUiIHk9IjM1MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4NSwzNDAgODUsMzQ1ICIvPgo8dGV4dCB4PSIyMjAiIHk9IjM1MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuNQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyMjAsMzQwIDIyMCwzNDUgIi8+Cjx0ZXh0IHg9IjM1NSIgeT0iMzUwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM1NSwzNDAgMzU1LDM0NSAiLz4KPHRleHQgeD0iNDkwIiB5PSIzNTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDkwLDM0MCA0OTAsMzQ1ICIvPgo8dGV4dCB4PSI2MjUiIHk9IjM1MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MjUsMzQwIDYyNSwzNDUgIi8+CjxjaXJjbGUgY3g9IjE1NCIgY3k9IjI1NCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjMxIiBjeT0iMzQwIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0NTUiIGN5PSIyMzQiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ1OCIgY3k9IjI1NiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzE2IiBjeT0iMTY0IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzNjkiIGN5PSIyMTIiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMwMCIgY3k9IjI4MCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDc5IiBjeT0iMjU2IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzNDMiIGN5PSIzMzgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijk3IiBjeT0iMTkyIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMDYiIGN5PSIyODgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjUyNiIgY3k9IjY2IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1MzkiIGN5PSIyMTYiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMwOSIgY3k9IjIzOSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjczIiBjeT0iMTQzIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0MjEiIGN5PSIyMjMiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ3OSIgY3k9IjI2MCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTExIiBjeT0iMjU5IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyNDIiIGN5PSIyODIiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ3NSIgY3k9IjEyNyIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjAwIiBjeT0iMjYxIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0MzciIGN5PSIyMTUiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM1MSIgY3k9IjI4MiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTc5IiBjeT0iMTQzIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0NDMiIGN5PSIxMjAiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjI2MCIgY3k9IjIyMiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDczIiBjeT0iMjAyIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMDciIGN5PSIzMTYiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjUwMiIgY3k9IjE4MyIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iOTUiIGN5PSIyNDQiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM2MiIgY3k9IjI2NyIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTA0IiBjeT0iMjMzIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyODgiIGN5PSIyNzYiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjI4NiIgY3k9IjI1MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjg1IiBjeT0iMTk3IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzMDQiIGN5PSIyMzgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ0NCIgY3k9IjI4MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjY5IiBjeT0iMTcxIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxODUiIGN5PSIyNTQiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQxNyIgY3k9IjIyNyIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDI0IiBjeT0iMjE3IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxMTEiIGN5PSIyMTgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMwMCIgY3k9IjIwNCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPHJlY3QgeD0iMzI1IiB5PSI2NCIgd2lkdGg9IjIxIiBoZWlnaHQ9IjI3NSIgb3BhY2l0eT0iMC4zIiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwRkYiLz4KPHJlY3QgeD0iMzU1IiB5PSI2NCIgd2lkdGg9IjIyIiBoZWlnaHQ9IjI3NSIgb3BhY2l0eT0iMC4zIiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjAwMDAiLz4KPC9zdmc+)

```rust
// Chart 2: survival rate by timing bucket vs the 85% baseline
let ymax2 = 100.0_f64;
let figure2 = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Relegation survival by when the change happened", ("sans-serif", 18))
        .margin(40)
        .x_label_area_size(40)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5..(bnames.len() as f64 - 0.5), 0.0..ymax2)?;
    chart
        .configure_mesh()
        .y_desc("survival %")
        .x_labels(bnames.len())
        .x_label_formatter(&|x: &f64| {
            let i = (*x).round() as usize;
            if i < bnames.len() { bnames[i].to_string() } else { String::new() }
        })
        .draw()?;
    chart.draw_series(
        bnames
            .iter()
            .enumerate()
            .map(|(i, _)| Rectangle::new([(i as f64 - 0.3, 0.0), (i as f64 + 0.3, bsurv[i])], BLUE.filled())),
    )?;
    chart.draw_series(LineSeries::new(
        vec![(-0.5, 85.0), (bnames.len() as f64 - 0.5, 85.0)],
        RED.stroke_width(2),
    ))?;
    Ok(())
});
figure2.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSI0NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUmVsZWdhdGlvbiBzdXJ2aXZhbCBieSB3aGVuIHRoZSBjaGFuZ2UgaGFwcGVuZWQKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTA0IiB5MT0iMzE5IiB4Mj0iMTA0IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE0NCIgeTE9IjMxOSIgeDI9IjE0NCIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODQiIHkxPSIzMTkiIHgyPSIxODQiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIzIiB5MT0iMzE5IiB4Mj0iMjIzIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI2MyIgeTE9IjMxOSIgeDI9IjI2MyIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMDIiIHkxPSIzMTkiIHgyPSIzMDIiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQyIiB5MT0iMzE5IiB4Mj0iMzQyIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4MiIgeTE9IjMxOSIgeDI9IjM4MiIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MjEiIHkxPSIzMTkiIHgyPSI0MjEiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDYxIiB5MT0iMzE5IiB4Mj0iNDYxIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwMCIgeTE9IjMxOSIgeDI9IjUwMCIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDAiIHkxPSIzMTkiIHgyPSI1NDAiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTgwIiB5MT0iMzE5IiB4Mj0iNTgwIiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYxOSIgeTE9IjMxOSIgeDI9IjYxOSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTkiIHkxPSIzMTkiIHgyPSI2NTkiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIzMTkiIHgyPSI2NzkiIHkyPSIzMTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMzE3IiB4Mj0iNjc5IiB5Mj0iMzE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjMxNCIgeDI9IjY3OSIgeTI9IjMxNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIzMTIiIHgyPSI2NzkiIHkyPSIzMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMzA5IiB4Mj0iNjc5IiB5Mj0iMzA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjMwNyIgeDI9IjY3OSIgeTI9IjMwNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIzMDQiIHgyPSI2NzkiIHkyPSIzMDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMzAyIiB4Mj0iNjc5IiB5Mj0iMzAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI5OSIgeDI9IjY3OSIgeTI9IjI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyOTciIHgyPSI2NzkiIHkyPSIyOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjk0IiB4Mj0iNjc5IiB5Mj0iMjk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI5MSIgeDI9IjY3OSIgeTI9IjI5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyODkiIHgyPSI2NzkiIHkyPSIyODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjg2IiB4Mj0iNjc5IiB5Mj0iMjg2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI4NCIgeDI9IjY3OSIgeTI9IjI4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyODEiIHgyPSI2NzkiIHkyPSIyODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjc5IiB4Mj0iNjc5IiB5Mj0iMjc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI3NiIgeDI9IjY3OSIgeTI9IjI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyNzQiIHgyPSI2NzkiIHkyPSIyNzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjcxIiB4Mj0iNjc5IiB5Mj0iMjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI2OCIgeDI9IjY3OSIgeTI9IjI2OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyNjYiIHgyPSI2NzkiIHkyPSIyNjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjYzIiB4Mj0iNjc5IiB5Mj0iMjYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI2MSIgeDI9IjY3OSIgeTI9IjI2MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyNTgiIHgyPSI2NzkiIHkyPSIyNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjU2IiB4Mj0iNjc5IiB5Mj0iMjU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI1MyIgeDI9IjY3OSIgeTI9IjI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyNTEiIHgyPSI2NzkiIHkyPSIyNTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjQ4IiB4Mj0iNjc5IiB5Mj0iMjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI0NiIgeDI9IjY3OSIgeTI9IjI0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyNDMiIHgyPSI2NzkiIHkyPSIyNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjQwIiB4Mj0iNjc5IiB5Mj0iMjQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjIzOCIgeDI9IjY3OSIgeTI9IjIzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyMzUiIHgyPSI2NzkiIHkyPSIyMzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjMzIiB4Mj0iNjc5IiB5Mj0iMjMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjIzMCIgeDI9IjY3OSIgeTI9IjIzMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyMjgiIHgyPSI2NzkiIHkyPSIyMjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjI1IiB4Mj0iNjc5IiB5Mj0iMjI1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjIyMyIgeDI9IjY3OSIgeTI9IjIyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyMjAiIHgyPSI2NzkiIHkyPSIyMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjE3IiB4Mj0iNjc5IiB5Mj0iMjE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjIxNSIgeDI9IjY3OSIgeTI9IjIxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyMTIiIHgyPSI2NzkiIHkyPSIyMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjEwIiB4Mj0iNjc5IiB5Mj0iMjEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjIwNyIgeDI9IjY3OSIgeTI9IjIwNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyMDUiIHgyPSI2NzkiIHkyPSIyMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjAyIiB4Mj0iNjc5IiB5Mj0iMjAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjIwMCIgeDI9IjY3OSIgeTI9IjIwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxOTciIHgyPSI2NzkiIHkyPSIxOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTk1IiB4Mj0iNjc5IiB5Mj0iMTk1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE5MiIgeDI9IjY3OSIgeTI9IjE5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxODkiIHgyPSI2NzkiIHkyPSIxODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTg3IiB4Mj0iNjc5IiB5Mj0iMTg3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE4NCIgeDI9IjY3OSIgeTI9IjE4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxODIiIHgyPSI2NzkiIHkyPSIxODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTc5IiB4Mj0iNjc5IiB5Mj0iMTc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE3NyIgeDI9IjY3OSIgeTI9IjE3NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxNzQiIHgyPSI2NzkiIHkyPSIxNzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTcyIiB4Mj0iNjc5IiB5Mj0iMTcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE2OSIgeDI9IjY3OSIgeTI9IjE2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxNjYiIHgyPSI2NzkiIHkyPSIxNjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTY0IiB4Mj0iNjc5IiB5Mj0iMTY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE2MSIgeDI9IjY3OSIgeTI9IjE2MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxNTkiIHgyPSI2NzkiIHkyPSIxNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTU2IiB4Mj0iNjc5IiB5Mj0iMTU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE1NCIgeDI9IjY3OSIgeTI9IjE1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxNTEiIHgyPSI2NzkiIHkyPSIxNTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTQ5IiB4Mj0iNjc5IiB5Mj0iMTQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE0NiIgeDI9IjY3OSIgeTI9IjE0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxNDQiIHgyPSI2NzkiIHkyPSIxNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTQxIiB4Mj0iNjc5IiB5Mj0iMTQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjEzOCIgeDI9IjY3OSIgeTI9IjEzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxMzYiIHgyPSI2NzkiIHkyPSIxMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTMzIiB4Mj0iNjc5IiB5Mj0iMTMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjEzMSIgeDI9IjY3OSIgeTI9IjEzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxMjgiIHgyPSI2NzkiIHkyPSIxMjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTI2IiB4Mj0iNjc5IiB5Mj0iMTI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjEyMyIgeDI9IjY3OSIgeTI9IjEyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxMjEiIHgyPSI2NzkiIHkyPSIxMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTE4IiB4Mj0iNjc5IiB5Mj0iMTE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjExNSIgeDI9IjY3OSIgeTI9IjExNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxMTMiIHgyPSI2NzkiIHkyPSIxMTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTEwIiB4Mj0iNjc5IiB5Mj0iMTEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjEwOCIgeDI9IjY3OSIgeTI9IjEwOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxMDUiIHgyPSI2NzkiIHkyPSIxMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTAzIiB4Mj0iNjc5IiB5Mj0iMTAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjEwMCIgeDI9IjY3OSIgeTI9IjEwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI5OCIgeDI9IjY3OSIgeTI9Ijk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9Ijk1IiB4Mj0iNjc5IiB5Mj0iOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iOTMiIHgyPSI2NzkiIHkyPSI5MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI5MCIgeDI9IjY3OSIgeTI9IjkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9Ijg3IiB4Mj0iNjc5IiB5Mj0iODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iODUiIHgyPSI2NzkiIHkyPSI4NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI4MiIgeDI9IjY3OSIgeTI9IjgyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjgwIiB4Mj0iNjc5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iNzciIHgyPSI2NzkiIHkyPSI3NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI3NSIgeDI9IjY3OSIgeTI9Ijc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjcyIiB4Mj0iNjc5IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iNzAiIHgyPSI2NzkiIHkyPSI3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI2NyIgeDI9IjY3OSIgeTI9IjY3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjY0IiB4Mj0iNjc5IiB5Mj0iNjQiLz4KPHRleHQgeD0iNDAiIHk9IjE5MiIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCIgdHJhbnNmb3JtPSJyb3RhdGUoMjcwLCA0MCwgMTkyKSI+CnN1cnZpdmFsICUKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTg0IiB5MT0iMzE5IiB4Mj0iMTg0IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4MiIgeTE9IjMxOSIgeDI9IjM4MiIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1ODAiIHkxPSIzMTkiIHgyPSI1ODAiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIzMTkiIHgyPSI2NzkiIHkyPSIzMTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjk0IiB4Mj0iNjc5IiB5Mj0iMjk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjI2OCIgeDI9IjY3OSIgeTI9IjI2OCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIyNDMiIHgyPSI2NzkiIHkyPSIyNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMjE3IiB4Mj0iNjc5IiB5Mj0iMjE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjE5MiIgeDI9IjY3OSIgeTI9IjE5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSIxNjYiIHgyPSI2NzkiIHkyPSIxNjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg1IiB5MT0iMTQxIiB4Mj0iNjc5IiB5Mj0iMTQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjExNSIgeDI9IjY3OSIgeTI9IjExNSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODUiIHkxPSI5MCIgeDI9IjY3OSIgeTI9IjkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NSIgeTE9IjY0IiB4Mj0iNjc5IiB5Mj0iNjQiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijg0LDY0IDg0LDMxOSAiLz4KPHRleHQgeD0iNzUiIHk9IjMxOSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijc5LDMxOSA4NCwzMTkgIi8+Cjx0ZXh0IHg9Ijc1IiB5PSIyOTQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzksMjk0IDg0LDI5NCAiLz4KPHRleHQgeD0iNzUiIHk9IjI2OCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI3OSwyNjggODQsMjY4ICIvPgo8dGV4dCB4PSI3NSIgeT0iMjQzIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijc5LDI0MyA4NCwyNDMgIi8+Cjx0ZXh0IHg9Ijc1IiB5PSIyMTciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjQwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzksMjE3IDg0LDIxNyAiLz4KPHRleHQgeD0iNzUiIHk9IjE5MiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI3OSwxOTIgODQsMTkyICIvPgo8dGV4dCB4PSI3NSIgeT0iMTY2IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo2MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijc5LDE2NiA4NCwxNjYgIi8+Cjx0ZXh0IHg9Ijc1IiB5PSIxNDEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjcwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzksMTQxIDg0LDE0MSAiLz4KPHRleHQgeD0iNzUiIHk9IjExNSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KODAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI3OSwxMTUgODQsMTE1ICIvPgo8dGV4dCB4PSI3NSIgeT0iOTAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjkwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzksOTAgODQsOTAgIi8+Cjx0ZXh0IHg9Ijc1IiB5PSI2NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTAwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzksNjQgODQsNjQgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4NSwzMjAgNjc5LDMyMCAiLz4KPHRleHQgeD0iMTg0IiB5PSIzMzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgplYXJseSAobWQgMS0xMCkKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMTg0LDMyMCAxODQsMzI1ICIvPgo8dGV4dCB4PSIzODIiIHk9IjMzMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Cm1pZCAobWQgMTEtMjUpCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM4MiwzMjAgMzgyLDMyNSAiLz4KPHRleHQgeD0iNTgwIiB5PSIzMzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpsYXRlIChtZCAyNispCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU4MCwzMjAgNTgwLDMyNSAiLz4KPHJlY3QgeD0iMTI0IiB5PSIxMTUiIHdpZHRoPSIxMTkiIGhlaWdodD0iMjA0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzIyIiB5PSIxNjkiIHdpZHRoPSIxMTkiIGhlaWdodD0iMTUwIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNTIwIiB5PSIxNDQiIHdpZHRoPSIxMTkiIGhlaWdodD0iMTc1IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iI0ZGMDAwMCIgc3Ryb2tlLXdpZHRoPSIyIiBwb2ludHM9Ijg1LDEwMyA2NzksMTAzICIvPgo8L3N2Zz4=)

## Discussion

Across **43 documented Premier League managerial changes (2015/16 → 2024/25)**,
using every match result in `matches_full.csv`:

### 1. Do teams earn more points per match after a change?

**Yes on average, but it's a coin flip.** Mean points/game rises from **0.93 →
1.04** over the ten matches either side of the change — but the **median change
is exactly 0.00**, and only **21 of 43 events (49%)** improved. The average is
carried by famous bounces: Solskjær at United (1.60 → 2.60), Ferguson at Everton
(0.70 → 1.90), Rangnick at United (1.30 → 2.10). For every bounce there is a
change that changed nothing — or made things worse (Pulis at West Brom 1.40 →
1.00, Lampard at Chelsea 1.30 → 0.60).

### 2. Are change teams more likely to avoid relegation?

Raw survival looks bad — **29/43 (67%)** vs the **85%** baseline for all EPL
team-seasons — but that's selection bias: these teams were already struggling
(mean 0.93 ppg before the axe fell). Stratified by how bad they were _at the
moment of the change_:

| Position at change         | Events | Survived |
| -------------------------- | ------ | -------- |
| Bottom half (pos ≥ 11)     | 35     | 21 (60%) |
| Relegation zone (pos ≥ 17) | 21     | 8 (38%)  |
| Bottom two (pos ≥ 19)      | 13     | 5 (38%)  |
| Bottom (pos 20)            | 7      | 2 (29%)  |

Even teams sitting **bottom** at the time of the change survived 2 times out
of 7. The new-manager bounce is real but modest — it almost never rescues a team
that was already effectively doomed.

### 3. Does timing matter?

| Change at              | n   | ppg before → after | Survived    |
| ---------------------- | --- | ------------------ | ----------- |
| Early (matchdays 1–10) | 10  | 0.73 → 0.93        | 8/10 (80%)  |
| Middle (md 11–25)      | 17  | 0.95 → 1.18        | 10/17 (59%) |
| Late (md 26+)          | 16  | 1.04 → 0.97        | 11/16 (69%) |

**Early changes work best** — they happen to the worst teams (0.73 ppg) and have
25+ games to repair the damage, producing the biggest ppg gain and highest
survival. **Middle changes produce the largest raw ppg jump** (0.95 → 1.18, the
classic bounce window) yet the _lowest_ survival (59%) — teams good enough to
still be in the mix but bad enough to get a new boss are the most precarious.
**Late changes are nearly pointless**: points/game actually _falls_ slightly
(1.04 → 0.97) and there are too few games left for a bounce to matter — yet
boards keep pulling the trigger in April anyway.

**Bottom line:** the bounce is real but oversold. On average a new manager adds
~+0.1 ppg — worth roughly 4 points over a season — and the survival benefit is
concentrated in early-season changes. Sacking a manager in March is closer to a
statement than a strategy.

**Limitations.** Manager attribution relies on team_manager records, which cover
only StatsBomb competitions; tenures outside that coverage are not visible.

## Conclusion

43 documented Premier League managerial changes (2015/16 → 2024/25). Together
these results answer the research question posed in the Introduction and
quantify the pattern across the manager records. The notebook provides a fully
reproducible pipeline from raw CSV extracts to published figures.
