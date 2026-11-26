---
title: 'Comebacks: turning losing positions into victories'
description: |
  '57% of team-matches see a side trail — but only 10.5% end in a comeback win,
  and almost none from three down.'
author: 'hieudoan'
date: '2026-11-25T10:30'
order: 6
tags: ['football', 'analysis', 'comebacks', 'mars', 'sqlite']
---

# Comebacks: turning losing positions into victories

## Abstract

How often do teams overturn big deficits — and does it happen more than the
legends suggest? This study answers it using the full match archive drawn from
the Soccers football database. The choke is rarer than the legend suggests — and
almost never happens from a truly big lead. All computation runs in Rust inside
a `.mars` notebook (polars + plotters — charts as inline SVG), and every table
and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, comebacks, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [Replay timelines: who trailed, who recovered?](#replay-timelines-who-trailed-who-recovered)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

Every fan lives for the comeback — trailing at half-time, even 2–0 down, then
winning. This notebook replays every goal-by-goal timeline in the StatsBomb
subset (~4,200 matches with timing data) and asks: **which teams are
historically best at erasing deficits?**

A _comeback win_ = a team trailed by at least one goal at some point and still
won. We rank teams by comeback-win rate (comebacks ÷ matches where they
trailed), with a minimum-sample guard, and break comebacks down by the size of
the deficit erased.

**Coverage caveat:** goal timing exists only for StatsBomb matches (World Cups,
Euros, Champions League, top domestic leagues) — a smaller but high-quality
subset.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `goal_events`.

The analysis runs entirely in Rust inside the notebook: **polars** handles table
scans, joins and aggregations; **plotters** renders figures as inline SVG;
`mars_table` renders result tables.

Each code cell is kept to a single output so results can be read top to bottom.

## Results

All figures and tables below are computed directly from the extracted data. Each
code cell produces one output — a table, a chart, or a short text summary.

```rust
use polars::prelude::*;

let df = LazyCsvReader::new("data/goal_events.csv")
    .finish()
    .expect("failed to open data/goal_events.csv — run from the notebook directory")
    .collect()
    .expect("failed to collect CSV into DataFrame");

println!(
    "loaded {} goal rows | schema: {:?}",
    df.height(),
    df.get_column_names()
);
```

```text
loaded 11328 goal rows | schema: ["mid", "minute", "added_minute", "player", "gtid", "gteam", "hid", "aid", "home", "away", "hg", "ag", "league", "date", "season"]
```

```rust

let s = |name: &str| df.column(name).unwrap_or_else(|_| panic!("missing {name}")).clone();
let col_str = |name: &str| -> Vec<String> {
    s(name).str().unwrap().iter().map(|o| o.unwrap_or("").to_string()).collect()
};
let col_i64 = |name: &str| -> Vec<i64> {
    let c = s(name);
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(0)).collect()
};
let mid_v = col_i64("mid");
let league_v = col_str("league");
let hid_v = col_i64("hid");
let aid_v = col_i64("aid");
let home_v = col_str("home");
let away_v = col_str("away");
let hg_v = col_i64("hg");
let ag_v = col_i64("ag");
let minute_v = col_i64("minute");
let added_v = col_i64("added_minute");
let gtid_v = col_i64("gtid");
let gteam_v = col_str("gteam");
let ng = df.height();
println!("extracted {ng} goal rows");
// index goals by match, sorted by (minute, added)
use std::collections::BTreeMap;
let mut order: Vec<usize> = (0..ng).collect();
order.sort_by_key(|&i| (mid_v[i], minute_v[i], added_v[i]));

// per-match goal lists
let mut match_goals: BTreeMap<i64, Vec<usize>> = BTreeMap::new();
for &i in &order {
    match_goals.entry(mid_v[i]).or_default().push(i);
}

// team display names
let mut names: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
for i in 0..ng {
    names.entry(hid_v[i]).or_insert_with(|| home_v[i].clone());
    names.entry(aid_v[i]).or_insert_with(|| away_v[i].clone());
}
println!("matches with goal data: {}", match_goals.len());
```

```text
extracted 11328 goal rows
matches with goal data: 3703
```

### Replay timelines: who trailed, who recovered?

For each team-match we track the worst deficit suffered (min of my_goals −
opp_goals after every goal) and the final result.

```rust
use std::collections::HashMap;

#[derive(Default, Clone)]
struct Acc {
    played: u64,      // matches with goal data the team appears in
    trailed: u64,     // matches where they were behind at some point
    comebacks: u64,   // trailed AND won
    cb1: u64, cb2: u64, cb3: u64, // comebacks by max deficit erased
}

let mut acc: HashMap<i64, Acc> = HashMap::new();
let mut big_comebacks: Vec<(i64, String, String, String)> = Vec::new(); // deficit, desc, team, mid

for (_mid, idxs) in match_goals.iter() {
    let i0 = idxs[0];
    let (hid, aid) = (hid_v[i0], aid_v[i0]);
    let (hg, ag) = (hg_v[i0], ag_v[i0]);
    let mut hs = 0i64;
    let mut as_ = 0i64;
    // per side: worst deficit (most negative my-opp) and final my goals
    let mut h_min = 0i64;
    let mut a_min = 0i64;

    for &gi in idxs {
        if gtid_v[gi] == hid { hs += 1; } else { as_ += 1; }
        let d = hs - as_;
        if -d > h_min { h_min = -d; }
        if d > a_min { a_min = d; }
    }
    // h_min/a_min now hold the largest deficit each side suffered
    let h_won = hg > ag;
    let a_won = ag > hg;

    {
        let e = acc.entry(hid).or_default();
        e.played += 1;
        if h_min > 0 {
            e.trailed += 1;
            if h_won {
                e.comebacks += 1;
                if h_min == 1 { e.cb1 += 1; } else if h_min == 2 { e.cb2 += 1; } else { e.cb3 += 1; }
                if h_min >= 3 && big_comebacks.len() < 10 {
                    big_comebacks.push((h_min, format!("{} {}–{} {} ({})", home_v[i0], hg, ag, away_v[i0], league_v[i0]), home_v[i0].clone(), mid_v[i0].to_string()));
                }
            }
        }
    }
    {
        let e = acc.entry(aid).or_default();
        e.played += 1;
        if a_min > 0 {
            e.trailed += 1;
            if a_won {
                e.comebacks += 1;
                if a_min == 1 { e.cb1 += 1; } else if a_min == 2 { e.cb2 += 1; } else { e.cb3 += 1; }
                if a_min >= 3 && big_comebacks.len() < 10 {
                    big_comebacks.push((a_min, format!("{} {}–{} {} ({})", away_v[i0], ag, hg, home_v[i0], league_v[i0]), away_v[i0].clone(), mid_v[i0].to_string()));
                }
            }
        }
    }
}

// overall comeback profile
let (mut p, mut t, mut c, mut c1, mut c2, mut c3) = (0u64, 0u64, 0u64, 0u64, 0u64, 0u64);
for a in acc.values() {
    p += a.played; t += a.trailed; c += a.comebacks; c1 += a.cb1; c2 += a.cb2; c3 += a.cb3;
}
println!("team-matches in dataset: {p} | trailed at some point: {t} ({:.1}%)", t as f64 / p as f64 * 100.0);
println!("comeback wins: {c} — {:.1}% of matches trailed ended in victory", c as f64 / t as f64 * 100.0);
println!("by deficit erased: 1 goal {c1} | 2 goals {c2} | 3+ goals {c3}");

// deficit distribution table
let dist_rows = vec![
    vec!["1 goal".to_string(), c1.to_string()],
    vec!["2 goals".to_string(), c2.to_string()],
    vec!["3+ goals".to_string(), c3.to_string()],
];
mars_table(&["deficit erased", "comeback wins"], &dist_rows);
```

```text
team-matches in dataset: 7406 | trailed at some point: 4219 (57.0%)
comeback wins: 443 — 10.5% of matches trailed ended in victory
by deficit erased: 1 goal 414 | 2 goals 29 | 3+ goals 0
```

| deficit erased | comeback wins |
| -------------- | ------------- |
| 1 goal         | 414           |
| 2 goals        | 29            |
| 3+ goals       | 0             |

```rust
// team rankings: rate = comebacks / trailed, min 15 trailed matches
let mut ranked: Vec<(&i64, &Acc)> = acc.iter().filter(|(_, a)| a.trailed >= 15).collect();
ranked.sort_by(|a, b| {
    let ra = a.1.comebacks as f64 / a.1.trailed as f64;
    let rb = b.1.comebacks as f64 / b.1.trailed as f64;
    rb.partial_cmp(&ra).unwrap()
});
let rate_rows: Vec<Vec<String>> = ranked
    .iter()
    .take(15)
    .map(|(tid, a)| {
        vec![
            names.get(*tid).cloned().unwrap_or_else(|| tid.to_string()),
            a.trailed.to_string(),
            a.comebacks.to_string(),
            format!("{:.1}%", a.comebacks as f64 / a.trailed as f64 * 100.0),
        ]
    })
    .collect();
mars_table(&["team", "times trailed", "comebacks", "comeback rate"], &rate_rows);
```

| team                | times trailed | comebacks | comeback rate |
| ------------------- | ------------- | --------- | ------------- |
| Manchester City WFC | 20            | 9         | 45.0%         |
| Paris Saint-Germain | 25            | 10        | 40.0%         |
| Barcelona           | 148           | 58        | 39.2%         |
| Arsenal WFC         | 24            | 9         | 37.5%         |
| Chelsea FCW         | 18            | 6         | 33.3%         |
| Juventus            | 15            | 5         | 33.3%         |
| Arsenal             | 21            | 7         | 33.3%         |
| Madrid CFF          | 17            | 5         | 29.4%         |
| Bayer Leverkusen    | 25            | 7         | 28.0%         |
| Tottenham Hotspur   | 17            | 4         | 23.5%         |
| Orlando Pride       | 19            | 4         | 21.1%         |
| OGC Nice            | 21            | 4         | 19.0%         |
| West Ham United     | 17            | 3         | 17.6%         |
| Real Madrid         | 29            | 5         | 17.2%         |
| Atlético Madrid     | 31            | 5         | 16.1%         |

```rust
// raw volume: most comeback wins
let mut vol: Vec<(&i64, &Acc)> = acc.iter().filter(|(_, a)| a.comebacks > 0).collect();
vol.sort_by(|a, b| b.1.comebacks.cmp(&a.1.comebacks));
let vol_rows: Vec<Vec<String>> = vol
    .iter()
    .take(15)
    .map(|(tid, a)| {
        vec![
            names.get(*tid).cloned().unwrap_or_else(|| tid.to_string()),
            a.comebacks.to_string(),
            a.trailed.to_string(),
            format!("{:.1}%", a.comebacks as f64 / a.trailed as f64 * 100.0),
        ]
    })
    .collect();
mars_table(&["team", "comeback wins", "times trailed", "rate"], &vol_rows);
```

| team                | comeback wins | times trailed | rate  |
| ------------------- | ------------- | ------------- | ----- |
| Barcelona           | 58            | 148           | 39.2% |
| Paris Saint-Germain | 10            | 25            | 40.0% |
| Arsenal WFC         | 9             | 24            | 37.5% |
| Manchester City WFC | 9             | 20            | 45.0% |
| Bayer Leverkusen    | 7             | 25            | 28.0% |
| Arsenal             | 7             | 21            | 33.3% |
| Chelsea FCW         | 6             | 18            | 33.3% |
| Napoli              | 6             | 14            | 42.9% |
| West Ham United LFC | 5             | 56            | 8.9%  |
| Sevilla             | 5             | 59            | 8.5%  |
| Real Madrid         | 5             | 29            | 17.2% |
| Juventus            | 5             | 15            | 33.3% |
| Madrid CFF          | 5             | 17            | 29.4% |
| Atlético Madrid     | 5             | 31            | 16.1% |
| Orlando Pride       | 4             | 19            | 21.1% |

```rust
big_comebacks.sort_by(|a, b| b.0.cmp(&a.0));
println!("--- biggest deficits erased (3+) ---");
for (d, desc, team, _mid) in big_comebacks.iter().take(10) {
    println!("  {team}: came back from {d} down — {desc}");
}
```

```text
--- biggest deficits erased (3+) ---
```

```rust
use plotters::prelude::*;

// comeback rate for top 12 teams by volume (min 15 trailed)
let mut chart_rows: Vec<(&i64, &Acc)> = acc
    .iter()
    .filter(|(_, a)| a.trailed >= 15 && a.comebacks >= 3)
    .collect();
chart_rows.sort_by(|a, b| b.1.comebacks.cmp(&a.1.comebacks));
chart_rows.truncate(12);

let mut clabels: Vec<String> = Vec::new();
let mut crate_: Vec<f64> = Vec::new();
for (tid, a) in &chart_rows {
    clabels.push(names.get(*tid).cloned().unwrap_or_default().chars().take(14).collect());
    crate_.push(a.comebacks as f64 / a.trailed as f64 * 100.0);
}
let ymax3 = crate_.iter().cloned().fold(1.0_f64, f64::max) * 1.2;
let n3 = crate_.len();

let figure = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Comeback win rate — most prolific comeback teams", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(80)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n3 as f64 - 0.5), 0.0_f64..ymax3)?;
    chart.configure_mesh().x_labels(n3).x_label_formatter(&|x: &f64| {
        clabels.get(*x as usize).cloned().unwrap_or_default()
    }).draw()?;
    chart.draw_series((0..n3).map(|i| {
        Rectangle::new([(i as f64 - 0.35, 0.0), (i as f64 + 0.35, crate_[i])], GREEN.filled())
    }))?;
    Ok(())
});
figure.evcxr_display();
```

```text
loaded 11328 goal rows | schema: ["mid", "minute", "added_minute", "player", "gtid", "gteam", "hid", "aid", "home", "away", "hg", "ag", "league", "date", "season"]
extracted 11328 goal rows
matches with goal data: 3703
team-matches in dataset: 7406 | trailed at some point: 4219 (57.0%)
comeback wins: 443 — 10.5% of matches trailed ended in victory
by deficit erased: 1 goal 414 | 2 goals 29 | 3+ goals 0
--- biggest deficits erased (3+) ---
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ29tZWJhY2sgd2luIHJhdGUg4oCUIG1vc3QgcHJvbGlmaWMgY29tZWJhY2sgdGVhbXMKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMDkiIHgyPSI2MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MSIgeTE9IjMwOSIgeDI9IjcxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iMzA5IiB4Mj0iODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTMiIHkxPSIzMDkiIHgyPSI5MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDQiIHkxPSIzMDkiIHgyPSIxMDQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTE0IiB5MT0iMzA5IiB4Mj0iMTE0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyNSIgeTE9IjMwOSIgeDI9IjEyNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMzYiIHkxPSIzMDkiIHgyPSIxMzYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTQ3IiB5MT0iMzA5IiB4Mj0iMTQ3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1OCIgeTE9IjMwOSIgeDI9IjE1OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNjkiIHkxPSIzMDkiIHgyPSIxNjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTgwIiB5MT0iMzA5IiB4Mj0iMTgwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5MSIgeTE9IjMwOSIgeDI9IjE5MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMDIiIHkxPSIzMDkiIHgyPSIyMDIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjEzIiB5MT0iMzA5IiB4Mj0iMjEzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIyMyIgeTE9IjMwOSIgeDI9IjIyMyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMzQiIHkxPSIzMDkiIHgyPSIyMzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjQ1IiB5MT0iMzA5IiB4Mj0iMjQ1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI1NiIgeTE9IjMwOSIgeDI9IjI1NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNjciIHkxPSIzMDkiIHgyPSIyNjciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjc4IiB5MT0iMzA5IiB4Mj0iMjc4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI4OSIgeTE9IjMwOSIgeDI9IjI4OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMDAiIHkxPSIzMDkiIHgyPSIzMDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzExIiB5MT0iMzA5IiB4Mj0iMzExIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyMiIgeTE9IjMwOSIgeDI9IjMyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMzIiIHkxPSIzMDkiIHgyPSIzMzIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQzIiB5MT0iMzA5IiB4Mj0iMzQzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1NCIgeTE9IjMwOSIgeDI9IjM1NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNjUiIHkxPSIzMDkiIHgyPSIzNjUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzc2IiB5MT0iMzA5IiB4Mj0iMzc2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4NyIgeTE9IjMwOSIgeDI9IjM4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTgiIHkxPSIzMDkiIHgyPSIzOTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDA5IiB5MT0iMzA5IiB4Mj0iNDA5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQyMCIgeTE9IjMwOSIgeDI9IjQyMCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzEiIHkxPSIzMDkiIHgyPSI0MzEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDQxIiB5MT0iMzA5IiB4Mj0iNDQxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ1MiIgeTE9IjMwOSIgeDI9IjQ1MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NjMiIHkxPSIzMDkiIHgyPSI0NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDc0IiB5MT0iMzA5IiB4Mj0iNDc0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4NSIgeTE9IjMwOSIgeDI9IjQ4NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTYiIHkxPSIzMDkiIHgyPSI0OTYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA3IiB5MT0iMzA5IiB4Mj0iNTA3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxOCIgeTE9IjMwOSIgeDI9IjUxOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjkiIHkxPSIzMDkiIHgyPSI1MjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQwIiB5MT0iMzA5IiB4Mj0iNTQwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1MCIgeTE9IjMwOSIgeDI9IjU1MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjEiIHkxPSIzMDkiIHgyPSI1NjEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTcyIiB5MT0iMzA5IiB4Mj0iNTcyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU4MyIgeTE9IjMwOSIgeDI9IjU4MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1OTQiIHkxPSIzMDkiIHgyPSI1OTQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjA1IiB5MT0iMzA5IiB4Mj0iNjA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYxNiIgeTE9IjMwOSIgeDI9IjYxNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MjciIHkxPSIzMDkiIHgyPSI2MjciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjM4IiB5MT0iMzA5IiB4Mj0iNjM4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY0OSIgeTE9IjMwOSIgeDI9IjY0OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTkiIHkxPSIzMDkiIHgyPSI2NTkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjcwIiB5MT0iMzA5IiB4Mj0iNjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjMwOSIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2OTIiIHkxPSIzMDkiIHgyPSI2OTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzAzIiB5MT0iMzA5IiB4Mj0iNzAzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA5IiB4Mj0iNzA5IiB5Mj0iMzA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwNyIgeDI9IjcwOSIgeTI9IjMwNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDQiIHgyPSI3MDkiIHkyPSIzMDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzAyIiB4Mj0iNzA5IiB5Mj0iMzAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5OSIgeDI9IjcwOSIgeTI9IjI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTciIHgyPSI3MDkiIHkyPSIyOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjk0IiB4Mj0iNzA5IiB5Mj0iMjk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5MiIgeDI9IjcwOSIgeTI9IjI5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODkiIHgyPSI3MDkiIHkyPSIyODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg3IiB4Mj0iNzA5IiB5Mj0iMjg3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4NCIgeDI9IjcwOSIgeTI9IjI4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODEiIHgyPSI3MDkiIHkyPSIyODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc5IiB4Mj0iNzA5IiB5Mj0iMjc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3NiIgeDI9IjcwOSIgeTI9IjI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzQiIHgyPSI3MDkiIHkyPSIyNzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjcxIiB4Mj0iNzA5IiB5Mj0iMjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2OSIgeDI9IjcwOSIgeTI9IjI2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjYiIHgyPSI3MDkiIHkyPSIyNjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY0IiB4Mj0iNzA5IiB5Mj0iMjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2MSIgeDI9IjcwOSIgeTI9IjI2MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTkiIHgyPSI3MDkiIHkyPSIyNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU2IiB4Mj0iNzA5IiB5Mj0iMjU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1MyIgeDI9IjcwOSIgeTI9IjI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTEiIHgyPSI3MDkiIHkyPSIyNTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ4IiB4Mj0iNzA5IiB5Mj0iMjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0NiIgeDI9IjcwOSIgeTI9IjI0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDMiIHgyPSI3MDkiIHkyPSIyNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQxIiB4Mj0iNzA5IiB5Mj0iMjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzOCIgeDI9IjcwOSIgeTI9IjIzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzYiIHgyPSI3MDkiIHkyPSIyMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjMzIiB4Mj0iNzA5IiB5Mj0iMjMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMSIgeDI9IjcwOSIgeTI9IjIzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjgiIHgyPSI3MDkiIHkyPSIyMjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI1IiB4Mj0iNzA5IiB5Mj0iMjI1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyMyIgeDI9IjcwOSIgeTI9IjIyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjAiIHgyPSI3MDkiIHkyPSIyMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE4IiB4Mj0iNzA5IiB5Mj0iMjE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNSIgeDI9IjcwOSIgeTI9IjIxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTMiIHgyPSI3MDkiIHkyPSIyMTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjEwIiB4Mj0iNzA5IiB5Mj0iMjEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwOCIgeDI9IjcwOSIgeTI9IjIwOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDUiIHgyPSI3MDkiIHkyPSIyMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjAzIiB4Mj0iNzA5IiB5Mj0iMjAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMCIgeDI9IjcwOSIgeTI9IjIwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTciIHgyPSI3MDkiIHkyPSIxOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTk1IiB4Mj0iNzA5IiB5Mj0iMTk1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5MiIgeDI9IjcwOSIgeTI9IjE5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTAiIHgyPSI3MDkiIHkyPSIxOTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg3IiB4Mj0iNzA5IiB5Mj0iMTg3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4NSIgeDI9IjcwOSIgeTI9IjE4NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODIiIHgyPSI3MDkiIHkyPSIxODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTgwIiB4Mj0iNzA5IiB5Mj0iMTgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NyIgeDI9IjcwOSIgeTI9IjE3NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzUiIHgyPSI3MDkiIHkyPSIxNzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTcyIiB4Mj0iNzA5IiB5Mj0iMTcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2OSIgeDI9IjcwOSIgeTI9IjE2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjciIHgyPSI3MDkiIHkyPSIxNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY0IiB4Mj0iNzA5IiB5Mj0iMTY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2MiIgeDI9IjcwOSIgeTI9IjE2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTkiIHgyPSI3MDkiIHkyPSIxNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTU3IiB4Mj0iNzA5IiB5Mj0iMTU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1NCIgeDI9IjcwOSIgeTI9IjE1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTIiIHgyPSI3MDkiIHkyPSIxNTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ5IiB4Mj0iNzA5IiB5Mj0iMTQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NyIgeDI9IjcwOSIgeTI9IjE0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDQiIHgyPSI3MDkiIHkyPSIxNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQxIiB4Mj0iNzA5IiB5Mj0iMTQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzOSIgeDI9IjcwOSIgeTI9IjEzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzYiIHgyPSI3MDkiIHkyPSIxMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM0IiB4Mj0iNzA5IiB5Mj0iMTM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzMSIgeDI9IjcwOSIgeTI9IjEzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjkiIHgyPSI3MDkiIHkyPSIxMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI2IiB4Mj0iNzA5IiB5Mj0iMTI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyNCIgeDI9IjcwOSIgeTI9IjEyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjEiIHgyPSI3MDkiIHkyPSIxMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTE5IiB4Mj0iNzA5IiB5Mj0iMTE5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExNiIgeDI9IjcwOSIgeTI9IjExNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTMiIHgyPSI3MDkiIHkyPSIxMTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTExIiB4Mj0iNzA5IiB5Mj0iMTExIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwOCIgeDI9IjcwOSIgeTI9IjEwOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDYiIHgyPSI3MDkiIHkyPSIxMDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTAzIiB4Mj0iNzA5IiB5Mj0iMTAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwMSIgeDI9IjcwOSIgeTI9IjEwMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5OCIgeDI9IjcwOSIgeTI9Ijk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijk2IiB4Mj0iNzA5IiB5Mj0iOTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTMiIHgyPSI3MDkiIHkyPSI5MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MSIgeDI9IjcwOSIgeTI9IjkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg4IiB4Mj0iNzA5IiB5Mj0iODgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODUiIHgyPSI3MDkiIHkyPSI4NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MyIgeDI9IjcwOSIgeTI9IjgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjgwIiB4Mj0iNzA5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzgiIHgyPSI3MDkiIHkyPSI3OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3NSIgeDI9IjcwOSIgeTI9Ijc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjczIiB4Mj0iNzA5IiB5Mj0iNzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzAiIHgyPSI3MDkiIHkyPSI3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2OCIgeDI9IjcwOSIgeTI9IjY4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY1IiB4Mj0iNzA5IiB5Mj0iNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjMiIHgyPSI3MDkiIHkyPSI2MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2MCIgeDI9IjcwOSIgeTI9IjYwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU3IiB4Mj0iNzA5IiB5Mj0iNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTUiIHgyPSI3MDkiIHkyPSI1NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1MiIgeDI9IjcwOSIgeTI9IjUyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjUwIiB4Mj0iNzA5IiB5Mj0iNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDciIHgyPSI3MDkiIHkyPSI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0NSIgeDI9IjcwOSIgeTI9IjQ1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQyIiB4Mj0iNzA5IiB5Mj0iNDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDAiIHgyPSI3MDkiIHkyPSI0MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNyIgeDI9IjcwOSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0IiB4Mj0iNzA5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iMzA5IiB4Mj0iODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTM2IiB5MT0iMzA5IiB4Mj0iMTM2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5MSIgeTE9IjMwOSIgeDI9IjE5MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDUiIHkxPSIzMDkiIHgyPSIyNDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzAwIiB5MT0iMzA5IiB4Mj0iMzAwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1NCIgeTE9IjMwOSIgeDI9IjM1NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDkiIHkxPSIzMDkiIHgyPSI0MDkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDYzIiB5MT0iMzA5IiB4Mj0iNDYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxOCIgeTE9IjMwOSIgeDI9IjUxOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzIiIHkxPSIzMDkiIHgyPSI1NzIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjI3IiB5MT0iMzA5IiB4Mj0iNjI3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjMwOSIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwOSIgeDI9IjcwOSIgeTI9IjMwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODQiIHgyPSI3MDkiIHkyPSIyODQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU5IiB4Mj0iNzA5IiB5Mj0iMjU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMyIgeDI9IjcwOSIgeTI9IjIzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDgiIHgyPSI3MDkiIHkyPSIyMDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTgyIiB4Mj0iNzA5IiB5Mj0iMTgyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1NyIgeDI9IjcwOSIgeTI9IjE1NyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzEiIHgyPSI3MDkiIHkyPSIxMzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA2IiB4Mj0iNzA5IiB5Mj0iMTA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjgwIiB4Mj0iNzA5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTUiIHgyPSI3MDkiIHkyPSI1NSIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzQgNTQsMzA5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMzA5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzA5IDU0LDMwOSAiLz4KPHRleHQgeD0iNDUiIHk9IjI4NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI4NCA1NCwyODQgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyNTkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjU5IDU0LDI1OSAiLz4KPHRleHQgeD0iNDUiIHk9IjIzMyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTUuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyMzMgNTQsMjMzICIvPgo8dGV4dCB4PSI0NSIgeT0iMjA4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDIwOCA1NCwyMDggIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxODIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjI1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTgyIDU0LDE4MiAiLz4KPHRleHQgeD0iNDUiIHk9IjE1NyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMzAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNTcgNTQsMTU3ICIvPgo8dGV4dCB4PSI0NSIgeT0iMTMxIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDEzMSA1NCwxMzEgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxMDYiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjQwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTA2IDU0LDEwNiAiLz4KPHRleHQgeD0iNDUiIHk9IjgwIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0NS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDgwIDU0LDgwICIvPgo8dGV4dCB4PSI0NSIgeT0iNTUiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjUwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksNTUgNTQsNTUgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NSwzMTAgNzA5LDMxMCAiLz4KPHRleHQgeD0iODIiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkJhcmNlbG9uYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4MiwzMTAgODIsMzE1ICIvPgo8dGV4dCB4PSIxMzYiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClBhcmlzIFNhaW50LUdlCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjEzNiwzMTAgMTM2LDMxNSAiLz4KPHRleHQgeD0iMTkxIiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpBcnNlbmFsIFdGQwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxOTEsMzEwIDE5MSwzMTUgIi8+Cjx0ZXh0IHg9IjI0NSIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTWFuY2hlc3RlciBDaXQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjQ1LDMxMCAyNDUsMzE1ICIvPgo8dGV4dCB4PSIzMDAiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkFyc2VuYWwKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzAwLDMxMCAzMDAsMzE1ICIvPgo8dGV4dCB4PSIzNTQiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkJheWVyIExldmVya3VzCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM1NCwzMTAgMzU0LDMxNSAiLz4KPHRleHQgeD0iNDA5IiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpDaGVsc2VhIEZDVwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0MDksMzEwIDQwOSwzMTUgIi8+Cjx0ZXh0IHg9IjQ2MyIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KV2VzdCBIYW0gVW5pdGUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDYzLDMxMCA0NjMsMzE1ICIvPgo8dGV4dCB4PSI1MTgiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClNldmlsbGEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTE4LDMxMCA1MTgsMzE1ICIvPgo8dGV4dCB4PSI1NzIiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClJlYWwgTWFkcmlkCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU3MiwzMTAgNTcyLDMxNSAiLz4KPHRleHQgeD0iNjI3IiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpBdGzDqXRpY28gTWFkcmkKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjI3LDMxMCA2MjcsMzE1ICIvPgo8dGV4dCB4PSI2ODEiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ckp1dmVudHVzCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY4MSwzMTAgNjgxLDMxNSAiLz4KPHJlY3QgeD0iNjMiIHk9IjExMCIgd2lkdGg9IjM4IiBoZWlnaHQ9IjE5OSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjExNyIgeT0iMTA2IiB3aWR0aD0iMzgiIGhlaWdodD0iMjAzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTcyIiB5PSIxMTkiIHdpZHRoPSIzOCIgaGVpZ2h0PSIxOTAiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyMjYiIHk9IjgwIiB3aWR0aD0iMzgiIGhlaWdodD0iMjI5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjgxIiB5PSIxNDAiIHdpZHRoPSIzOCIgaGVpZ2h0PSIxNjkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzMzUiIHk9IjE2NyIgd2lkdGg9IjM4IiBoZWlnaHQ9IjE0MiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjM5MCIgeT0iMTQwIiB3aWR0aD0iMzgiIGhlaWdodD0iMTY5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDQ0IiB5PSIyNjQiIHdpZHRoPSIzOCIgaGVpZ2h0PSI0NSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ5OSIgeT0iMjY2IiB3aWR0aD0iMzgiIGhlaWdodD0iNDMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1NTMiIHk9IjIyMiIgd2lkdGg9IjM4IiBoZWlnaHQ9Ijg3IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjA4IiB5PSIyMjciIHdpZHRoPSIzOCIgaGVpZ2h0PSI4MiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjY2MiIgeT0iMTQwIiB3aWR0aD0iMzgiIGhlaWdodD0iMTY5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPC9zdmc+)

## Discussion

In the StatsBomb subset, **57% of team-matches saw a side trail at some point**
— and **10.5% of those ended in a comeback win** (443 wins).

The shape of comebacks is brutally one-dimensional:

- **Deficit erased = 1 goal:** 414 comebacks
- **Deficit erased = 2 goals:** 29 comebacks
- **Deficit erased = 3+ goals:** **zero**

Comebacks happen — but almost never from three down. The biggest deficits erased
in the dataset were two goals, and even those are rare (~7% of all comebacks).

**Most prolific:** Barcelona, 58 comeback wins in 148 trailed matches (39.2%).
**Best rate (min. 15 trailed games):** Manchester City WFC at 45.0%, then PSG
40.0%, Barcelona 39.2%, Arsenal WFC 37.5%. Notably, the rate leaders skew toward
elite sides — teams good enough to be trailing are also good enough to chase.

_Note: StatsBomb data includes women's and youth competitions — "WFC"/"LFC"
suffixes are the women's teams._

**Limitations.** The analysis is limited to the competitions present in the
database; player-level metrics exist only for StatsBomb-covered tournaments, and
underlying event data may contain errors.

## Conclusion

In the StatsBomb subset, 57% of team-matches saw a side trail at some point —
and 10.5% of those ended in a comeback win (443 wins). Together these results
answer the research question posed in the Introduction and quantify the pattern
across 4,200 matches. The notebook provides a fully reproducible pipeline from
raw CSV extracts to published figures.
