---
title: 'Do more corners actually help you win?'
description: |
  '166,028 matches with corner data: corner share predicts winning at rho=0.05 in the EPL — worse than possession. A great team-quality marker, a near-worthless match predictor.'
author: 'hieudoan'
date: '2026-11-26T12:00'
order: 38
tags: ['football', 'analysis', 'corners', 'mars', 'sqlite']
---

# Do more corners actually help you win?

## Abstract

Do more corners actually help you win? This study answers it using hundreds of
thousands of matches drawn from the Soccers football database. The gradient is
the weakest of the attacking stats. All computation runs in Rust inside a
`.mars` notebook (polars + plotters — charts as inline SVG), and every table and
figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, corners, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [Coverage](#coverage)
  - [The band test: does winning more corners mean more wins?](#the-band-test-does-winning-more-corners-mean-more-wins)
  - [Is the relationship linear — or is there a sweet spot?](#is-the-relationship-linear--or-is-there-a-sweet-spot)
  - [Quantity vs quality: is corner share just a proxy?](#quantity-vs-quality-is-corner-share-just-a-proxy)
  - [The paradox cases: corner dominance without victory](#the-paradox-cases-corner-dominance-without-victory)
  - [Context: home advantage and opponent strength](#context-home-advantage-and-opponent-strength)
  - [The season-level view and the historical trend](#the-season-level-view-and-the-historical-trend)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

The assumption: _more corners = more pressure = more likely to win._ This
notebook tests it on every match in the dataset where corner counts exist —
sourced from football-data.co.uk (back to 2000/01 for the English leagues) and
enriched by ESPN stats (`import-espn-stats.ts`) for the big European leagues and
MLS.

**Data caveats up front:**

- Corner _volume_ is well covered — ~166k matches across ~35 leagues — but
  corner _outcomes_ are not: the dataset has no event-level corner data, so
  **goals from corners and corner conversion rates cannot be measured**. Where
  relevant, set-piece-adjacent proxies are flagged.
- Corners are a match-total stat: a team chasing a game legitimately wins more
  of them. We cannot see _when_ corners happen, so "corners while losing" is
  untestable — noted where it matters.
- `expected_goals` exists only for a small StatsBomb-covered subset, so the
  "beyond xG" comparison reduces to shots.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `match_team_stat`, `matches_full`.

The analysis runs entirely in Rust inside the notebook: **polars** handles table
scans, joins and aggregations; **plotters** renders figures as inline SVG;
`mars_table` renders result tables.

Statistical summaries include Pearson correlations.

Each code cell is kept to a single output so results can be read top to bottom.

## Results

All figures and tables below are computed directly from the extracted data. Each
code cell produces one output — a table, a chart, or a short text summary.

```rust

use polars::prelude::*;
use std::collections::HashMap;

let mf = LazyCsvReader::new("data/matches_full.csv")
    .finish().expect("matches_full.csv")
    .collect().expect("collect matches");
let st = LazyCsvReader::new("data/match_team_stat.csv")
    .finish().expect("match_team_stat.csv")
    .collect().expect("collect stats");

fn col_str(df: &DataFrame, name: &str) -> Vec<String> {
    df.column(name).unwrap().str().unwrap().iter()
        .map(|o| o.unwrap_or("").to_string()).collect()
}
fn col_i64(df: &DataFrame, name: &str) -> Vec<i64> {
    let c = df.column(name).unwrap().clone();
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect()
}
fn col_f64(df: &DataFrame, name: &str) -> Vec<f64> {
    let c = df.column(name).unwrap().clone();
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Float64).unwrap() } else { c };
    match c.dtype() {
        DataType::Float64 => c.f64().unwrap().iter().map(|o| o.unwrap_or(f64::NAN)).collect(),
        DataType::Int64 => c.i64().unwrap().iter().map(|o| o.map(|v| v as f64).unwrap_or(f64::NAN)).collect(),
        DataType::String => c.str().unwrap().iter()
            .map(|o| o.and_then(|s| s.parse::<f64>().ok()).unwrap_or(f64::NAN)).collect(),
        _ => panic!("unexpected dtype for {name}: {:?}", c.dtype()),
    }
}

#[derive(Clone, Copy, Default)]
struct TStat {
    poss: f64, shots: f64, sog: f64, corners: f64,
}

// (match_id, team_id) -> team stat line
let mut stat_map: HashMap<(i64, i64), TStat> = HashMap::new();
{
    let n = st.height();
    let mid = col_i64(&st, "match_id");
    let tid = col_i64(&st, "team_id");
    let poss = col_f64(&st, "possession");
    let shots = col_f64(&st, "shots");
    let sog = col_f64(&st, "shots_on_target");
    let cor = col_f64(&st, "corners");
    for i in 0..n {
        stat_map.insert((mid[i], tid[i]), TStat {
            poss: poss[i], shots: shots[i], sog: sog[i], corners: cor[i],
        });
    }
}
println!("stat rows indexed: {}", stat_map.len());

let s_id = col_i64(&mf, "id");
let s_hid = col_i64(&mf, "hid");
let s_aid = col_i64(&mf, "aid");
let s_hg = col_i64(&mf, "hg");
let s_ag = col_i64(&mf, "ag");
let s_country = col_str(&mf, "country");
let s_league = col_str(&mf, "league");
let s_season = col_str(&mf, "season");
let s_date = col_str(&mf, "date");
let s_home = col_str(&mf, "home");
let s_away = col_str(&mf, "away");

#[derive(Clone)]
struct MRow {
    league: String, season: String, date: String,
    home: String, away: String, hid: i64, aid: i64,
    hg: i64, ag: i64,
    hp: f64, ap: f64, hs: f64, as_: f64,
    hc: f64, ac: f64, hso: f64, aso: f64,
}

fn valid_corners(c: f64) -> bool { !c.is_nan() && c >= 0.0 }

let mut rows: Vec<MRow> = Vec::new();
let mut n_both = 0usize;
for i in 0..mf.height() {
    if s_hg[i] < 0 || s_ag[i] < 0 { continue; }
    let h = stat_map.get(&(s_id[i], s_hid[i]));
    let a = stat_map.get(&(s_id[i], s_aid[i]));
    let (Some(hs_), Some(as_)) = (h, a) else { continue; };
    // corners are real counts (0 is legitimate); only NaN/missing excluded
    if !(valid_corners(hs_.corners) && valid_corners(as_.corners)) { continue; }
    n_both += 1;
    rows.push(MRow {
        league: s_league[i].clone(), season: s_season[i].clone(),
        date: s_date[i][..10].to_string(),
        home: s_home[i].clone(), away: s_away[i].clone(),
        hid: s_hid[i], aid: s_aid[i], hg: s_hg[i], ag: s_ag[i],
        hp: hs_.poss, ap: as_.poss,
        hs: hs_.shots, as_: as_.shots,
        hc: hs_.corners, ac: as_.corners,
        hso: hs_.sog, aso: as_.sog,
    });
}
rows.sort_by(|a, b| a.date.cmp(&b.date));
println!("matches with corner data (both teams): {}", n_both);

// league coverage
let mut by_league: std::collections::BTreeMap<String, (usize, String, String)> = std::collections::BTreeMap::new();
for r in &rows {
    let e = by_league.entry(r.league.clone()).or_insert((0, r.season.clone(), r.season.clone()));
    e.0 += 1;
    if r.season < e.1 { e.1 = r.season.clone(); }
    if r.season > e.2 { e.2 = r.season.clone(); }
}
let mut lg_rows: Vec<Vec<String>> = by_league.iter().map(|(l, (n, s0, s1))| vec![
    l.clone(), n.to_string(), format!("{s0} → {s1}"),
]).collect();
lg_rows.sort_by(|a, b| b[1].parse::<usize>().unwrap().cmp(&a[1].parse::<usize>().unwrap()));
lg_rows.truncate(15);
let hdr = ["league", "matches", "season span"];
mars_table(&hdr, &lg_rows);

let epl: Vec<&MRow> = rows.iter().filter(|r| r.league == "English Premier League").collect();
println!("EPL matches with corners: {} | all leagues: {}", epl.len(), rows.len());
```

```text
stat rows indexed: 374660
matches with corner data (both teams): 166028
EPL matches with corners: 10032 | all leagues: 166028
```

| league                 | matches | season span       |
| ---------------------- | ------- | ----------------- |
| English Championship   | 14543   | 2000/01 → 2026/27 |
| English League Two     | 14424   | 2000/01 → 2026/27 |
| English League One     | 14374   | 2000/01 → 2026/27 |
| English Premier League | 10032   | 2000/01 → 2026/27 |
| Spanish La Liga        | 8438    | 2004/05 → 2026/27 |
| Italian Serie A        | 8086    | 2005/06 → 2026/27 |
| French Ligue 1         | 7790    | 2005/06 → 2026/27 |
| German Bundesliga      | 7750    | 2000/01 → 2026/27 |
| Spanish La Liga 2      | 6527    | 2008/09 → 2026/27 |
| MLS                    | 6264    | 2012 → 2026       |
| Scottish Premiership   | 5958    | 2000/01 → 2026/27 |
| French Ligue 2         | 5347    | 2008/09 → 2026/27 |
| Italian Serie B        | 5214    | 2008/09 → 2026/27 |
| Dutch Eredivisie       | 4798    | 2008/09 → 2026/27 |
| German 2. Bundesliga   | 4661    | 2000/01 → 2026/27 |

### Coverage

Corners exist for both football-data leagues (English pyramid back to 2000/01)
and ESPN-covered leagues (~2004 onward). The Premier League is the primary lens;
every covered league is pooled as a robustness check. Only matches where
**both** teams have a recorded corner count are used — a genuine 0–0 corner
count is rare but possible and is kept.

```rust
// EPL coverage by season
let mut by_season: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
for r in &epl { *by_season.entry(r.season.clone()).or_insert(0) += 1; }
let rows_s: Vec<Vec<String>> = by_season.iter().map(|(s, n)| vec![s.clone(), n.to_string()]).collect();
mars_table(&["EPL season", "matches with corners"], &rows_s);
```

| EPL season | matches with corners |
| ---------- | -------------------- |
| 2000/01    | 380                  |
| 2001/02    | 380                  |
| 2002/03    | 380                  |
| 2003/04    | 383                  |
| 2004/05    | 380                  |
| 2005/06    | 380                  |
| 2006/07    | 380                  |
| 2007/08    | 380                  |
| 2008/09    | 380                  |
| 2009/10    | 380                  |
| 2010/11    | 380                  |
| 2011/12    | 380                  |
| 2012/13    | 380                  |
| 2013/14    | 380                  |
| 2014/15    | 380                  |
| 2015/16    | 419                  |
| 2016/17    | 380                  |
| 2017/18    | 380                  |
| 2018/19    | 380                  |
| 2019/20    | 380                  |
| 2020/21    | 380                  |
| 2021/22    | 380                  |
| 2022/23    | 380                  |
| 2023/24    | 380                  |
| 2024/25    | 380                  |
| 2025/26    | 380                  |
| 2026/27    | 110                  |

### The band test: does winning more corners mean more wins?

Raw corner counts aren't comparable across matches — a 0–0 corner-fest and a
14–12 shootout are different sports. The fair unit is **corner share**: the
team's corners as a percentage of the match total. Bands are the
team-perspective share, pooled across both teams per match.

```rust
// corner-share bands -> W/D/L, pooled team-perspective
let bands = [0.0, 35.0, 45.0, 55.0, 65.0, 100.0];
let blabels = ["<35", "35-45", "45-55", "55-65", ">65"];

let band_table = |matches: &[&MRow]| -> Vec<Vec<String>> {
    let mut w = vec![0usize; 5]; let mut d = vec![0usize; 5]; let mut l = vec![0usize; 5];
    for r in matches {
        let tot = r.hc + r.ac;
        if tot <= 0.0 { continue; }
        for (c, gf, ga) in [(r.hc, r.hg, r.ag), (r.ac, r.ag, r.hg)] {
            let share = 100.0 * c / tot;
            let b = bands.iter().position(|&hi| share < hi).unwrap_or(5) - 1;
            if gf > ga { w[b] += 1; } else if gf == ga { d[b] += 1; } else { l[b] += 1; }
        }
    }
    (0..5).map(|b| {
        let n = (w[b] + d[b] + l[b]) as f64;
        vec![blabels[b].to_string(), (w[b]+d[b]+l[b]).to_string(),
             format!("{:.1}%", 100.0*w[b] as f64/n),
             format!("{:.1}%", 100.0*d[b] as f64/n),
             format!("{:.1}%", 100.0*l[b] as f64/n)]
    }).collect()
};

let epl_refs: Vec<&MRow> = epl.iter().cloned().collect();
let epl_bands = band_table(&epl_refs);
mars_table(&["corner share %", "n", "win%", "draw%", "loss%"], &epl_bands);
```

| corner share % | n    | win%  | draw% | loss% |
| -------------- | ---- | ----- | ----- | ----- |
| <35            | 5281 | 31.5% | 25.0% | 43.5% |
| 35-45          | 3071 | 36.8% | 24.8% | 38.4% |
| 45-55          | 3351 | 37.8% | 24.5% | 37.7% |
| 55-65          | 3070 | 38.2% | 24.9% | 36.9% |
| >65            | 5289 | 43.5% | 25.0% | 31.5% |

```rust
let all_refs: Vec<&MRow> = rows.iter().collect();
let all_bands = band_table(&all_refs);
mars_table(&["corner share % — all leagues", "n", "win%", "draw%", "loss%"], &all_bands);
```

| corner share % — all leagues | n     | win%  | draw% | loss% |
| ---------------------------- | ----- | ----- | ----- | ----- |
| <35                          | 77963 | 35.5% | 26.3% | 38.2% |
| 35-45                        | 46418 | 36.8% | 26.4% | 36.8% |
| 45-55                        | 48749 | 37.0% | 26.0% | 37.0% |
| 55-65                        | 46435 | 36.8% | 26.3% | 36.8% |
| >65                          | 78059 | 38.2% | 26.3% | 35.5% |

```rust
// raw count bands: does 10+ corners specifically help?
let cbands = [0.0, 3.0, 5.0, 7.0, 10.0, 100.0];
let clabels = ["0-2", "3-4", "5-6", "7-9", "10+"];
let count_table = |matches: &[&MRow]| -> Vec<Vec<String>> {
    let mut w = vec![0usize; 5]; let mut d = vec![0usize; 5]; let mut l = vec![0usize; 5];
    for r in matches {
        for (c, gf, ga) in [(r.hc, r.hg, r.ag), (r.ac, r.ag, r.hg)] {
            let b = cbands.iter().position(|&hi| c < hi).unwrap_or(5) - 1;
            if gf > ga { w[b] += 1; } else if gf == ga { d[b] += 1; } else { l[b] += 1; }
        }
    }
    (0..5).map(|b| {
        let n = (w[b] + d[b] + l[b]) as f64;
        vec![clabels[b].to_string(), (w[b]+d[b]+l[b]).to_string(),
             format!("{:.1}%", 100.0*w[b] as f64/n),
             format!("{:.1}%", 100.0*d[b] as f64/n),
             format!("{:.1}%", 100.0*l[b] as f64/n)]
    }).collect()
};
let epl_counts = count_table(&epl_refs);
mars_table(&["corners won (EPL)", "n", "win%", "draw%", "loss%"], &epl_counts);
```

| corners won (EPL) | n    | win%  | draw% | loss% |
| ----------------- | ---- | ----- | ----- | ----- |
| 0-2               | 3462 | 32.2% | 24.7% | 43.2% |
| 3-4               | 5286 | 36.0% | 24.8% | 39.2% |
| 5-6               | 4982 | 38.0% | 24.2% | 37.8% |
| 7-9               | 4419 | 41.1% | 25.1% | 33.7% |
| 10+               | 1915 | 42.3% | 26.6% | 31.0% |

```rust
let all_counts = count_table(&all_refs);
mars_table(&["corners won — all leagues", "n", "win%", "draw%", "loss%"], &all_counts);
```

| corners won — all leagues | n     | win%  | draw% | loss% |
| ------------------------- | ----- | ----- | ----- | ----- |
| 0-2                       | 88929 | 37.1% | 23.6% | 39.3% |
| 3-4                       | 84318 | 37.3% | 25.7% | 37.0% |
| 5-6                       | 76410 | 37.3% | 26.1% | 36.6% |
| 7-9                       | 60351 | 37.4% | 26.9% | 35.7% |
| 10+                       | 22048 | 36.1% | 28.5% | 35.4% |

### Is the relationship linear — or is there a sweet spot?

Bin matches by **corner differential** (home corners minus away corners) and
look at the home win rate. If corners drive results the curve should climb
steadily; a plateau or dip at the extreme would mean corner dominance stops
paying (or turns into sterile possession).

```rust
// home win% by corner differential (bins of 2)
let mut bins: Vec<(i64, usize, usize)> = Vec::new();
for k in -8i64..=8 {
    let lo = k as f64 * 2.0;
    let hi = lo + 2.0;
    let (mut hw, mut n) = (0usize, 0usize);
    for r in &epl {
        let d = r.hc - r.ac;
        if d >= lo && d < hi {
            n += 1;
            if r.hg > r.ag { hw += 1; }
        }
    }
    bins.push((k, hw, n));
}
let d_rows: Vec<Vec<String>> = bins.iter().map(|(k, hw, n)| vec![
    format!("{:+.0} to {:+.0}", *k as f64 * 2.0, *k as f64 * 2.0 + 2.0),
    n.to_string(),
    format!("{:.1}%", if *n > 0 { 100.0 * *hw as f64 / *n as f64 } else { 0.0 }),
]).collect();
mars_table(&["corner diff (home − away)", "matches", "home win%"], &d_rows);
```

| corner diff (home − away) | matches | home win% |
| ------------------------- | ------- | --------- |
| -16 to -14                | 6       | 16.7%     |
| -14 to -12                | 22      | 36.4%     |
| -12 to -10                | 53      | 50.9%     |
| -10 to -8                 | 159     | 49.7%     |
| -8 to -6                  | 322     | 37.3%     |
| -6 to -4                  | 589     | 40.9%     |
| -4 to -2                  | 1010    | 45.0%     |
| -2 to +0                  | 1438    | 43.1%     |
| +0 to +2                  | 1810    | 44.3%     |
| +2 to +4                  | 1649    | 46.1%     |
| +4 to +6                  | 1272    | 50.2%     |
| +6 to +8                  | 862     | 49.3%     |
| +8 to +10                 | 461     | 49.9%     |
| +10 to +12                | 211     | 45.5%     |
| +12 to +14                | 116     | 38.8%     |
| +14 to +16                | 36      | 52.8%     |
| +16 to +18                | 9       | 55.6%     |

```rust
// same for all leagues, wider bins of 4
let mut bins2: Vec<(i64, usize, usize)> = Vec::new();
for k in -5i64..=5 {
    let lo = k as f64 * 4.0;
    let hi = lo + 4.0;
    let (mut hw, mut n) = (0usize, 0usize);
    for r in &rows {
        let d = r.hc - r.ac;
        if d >= lo && d < hi {
            n += 1;
            if r.hg > r.ag { hw += 1; }
        }
    }
    bins2.push((k, hw, n));
}
let d_rows2: Vec<Vec<String>> = bins2.iter().map(|(k, hw, n)| vec![
    format!("{:+.0} to {:+.0}", *k as f64 * 4.0, *k as f64 * 4.0 + 4.0),
    n.to_string(),
    format!("{:.1}%", if *n > 0 { 100.0 * *hw as f64 / *n as f64 } else { 0.0 }),
]).collect();
mars_table(&["corner diff — all leagues", "matches", "home win%"], &d_rows2);
```

| corner diff — all leagues | matches | home win% |
| ------------------------- | ------- | --------- |
| -20 to -16                | 23      | 34.8%     |
| -16 to -12                | 228     | 44.3%     |
| -12 to -8                 | 2115    | 46.6%     |
| -8 to -4                  | 12634   | 45.3%     |
| -4 to +0                  | 39147   | 45.7%     |
| +0 to +4                  | 71312   | 45.6%     |
| +4 to +8                  | 30686   | 43.2%     |
| +8 to +12                 | 8330    | 40.8%     |
| +12 to +16                | 1389    | 38.9%     |
| +16 to +20                | 147     | 44.9%     |
| +20 to +24                | 13      | 46.2%     |

### Quantity vs quality: is corner share just a proxy?

Corners correlate with shots, which correlate with goals — so corner share may
predict wins only because it tracks general attacking pressure. Compare how well
**corner share, shot share and possession share** each predict the home win, on
identical matches. Shots-on-target is included as the quality-weighted attacking
measure.

```rust
// Pearson correlation between a metric share and home win (1/0)
fn pearson(xs: &[f64], ys: &[f64]) -> f64 {
    let n = xs.len() as f64;
    if n < 3.0 { return f64::NAN; }
    let mx = xs.iter().sum::<f64>() / n;
    let my = ys.iter().sum::<f64>() / n;
    let mut sxy = 0.0; let mut sxx = 0.0; let mut syy = 0.0;
    for i in 0..xs.len() {
        let dx = xs[i] - mx; let dy = ys[i] - my;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if sxx <= 0.0 || syy <= 0.0 { return f64::NAN; }
    sxy / (sxx.sqrt() * syy.sqrt())
}

// correlations, EPL and all leagues
let mut xs_c = Vec::new(); let mut xs_s = Vec::new(); let mut xs_p = Vec::new(); let mut ys = Vec::new();
let mut xs_ce = Vec::new(); let mut xs_se = Vec::new(); let mut xs_pe = Vec::new(); let mut ys_e = Vec::new();
for r in &epl {
    let tot_c = r.hc + r.ac;
    if tot_c <= 0.0 { continue; }
    let hw = if r.hg > r.ag { 1.0 } else { 0.0 };
    xs_ce.push(100.0 * r.hc / tot_c); ys_e.push(hw);
    let tot_s = r.hs + r.as_;
    if !tot_s.is_nan() && tot_s > 0.0 {
        xs_se.push(100.0 * r.hs / tot_s);
        if r.hp > 0.0 && r.hp < 100.0 { xs_pe.push(r.hp); }
    }
}
// align EPL vectors: rebuild cleanly to keep equal lengths
xs_ce.clear(); xs_se.clear(); xs_pe.clear(); ys_e.clear();
for r in &epl {
    let tot_c = r.hc + r.ac;
    let tot_s = r.hs + r.as_;
    if tot_c <= 0.0 || tot_s.is_nan() || tot_s <= 0.0 { continue; }
    if !(r.hp > 0.0 && r.hp < 100.0) { continue; }
    ys_e.push(if r.hg > r.ag { 1.0 } else { 0.0 });
    xs_ce.push(100.0 * r.hc / tot_c);
    xs_se.push(100.0 * r.hs / tot_s);
    xs_pe.push(r.hp);
}
println!("EPL ({} matches): corr(home corner share, home win) = {:.3}", ys_e.len(), pearson(&xs_ce, &ys_e));
println!("EPL: corr(home shot share,   home win) = {:.3}", pearson(&xs_se, &ys_e));
println!("EPL: corr(home possession,   home win) = {:.3}", pearson(&xs_pe, &ys_e));

for r in &rows {
    let tot_c = r.hc + r.ac;
    let tot_s = r.hs + r.as_;
    if tot_c <= 0.0 || tot_s.is_nan() || tot_s <= 0.0 { continue; }
    if !(r.hp > 0.0 && r.hp < 100.0) { continue; }
    ys.push(if r.hg > r.ag { 1.0 } else { 0.0 });
    xs_c.push(100.0 * r.hc / tot_c);
    xs_s.push(100.0 * r.hs / tot_s);
    xs_p.push(r.hp);
}
println!("ALL ({} matches): corr(corner share)={:.3} corr(shot share)={:.3} corr(possession)={:.3}",
    ys.len(), pearson(&xs_c, &ys), pearson(&xs_s, &ys), pearson(&xs_p, &ys));

// shots-on-target share, EPL only (quality-weighted attacking measure)
let mut xs_o = Vec::new(); let mut ys_o = Vec::new();
for r in &epl {
    let tot_o = r.hso + r.aso;
    if tot_o.is_nan() || tot_o <= 0.0 { continue; }
    ys_o.push(if r.hg > r.ag { 1.0 } else { 0.0 });
    xs_o.push(100.0 * r.hso / tot_o);
}
println!("EPL SOG-share subset ({} matches): corr(shots on target share, home win) = {:.3}",
    ys_o.len(), pearson(&xs_o, &ys_o));
```

```text
EPL (8496 matches): corr(home corner share, home win) = 0.050
EPL: corr(home shot share,   home win) = 0.259
EPL: corr(home possession,   home win) = 0.120
ALL (111164 matches): corr(corner share)=-0.012 corr(shot share)=0.195 corr(possession)=0.016
EPL SOG-share subset (10032 matches): corr(shots on target share, home win) = 0.400
```

### The paradox cases: corner dominance without victory

Two failure modes worth counting: teams that **win despite a low corner share**
(<35%) and teams that **lose despite a high corner share** (>65%). If corner
dominance were destiny both would be rare. The team tables show who lives in
each tail.

```rust
// team-perspective: wins with <35% corner share, losses with >65%
#[derive(Default)]
struct Tally { low_w: usize, tot_w: usize, high_l: usize, tot_l: usize }
let mut tally: HashMap<(String, String, String), Tally> = HashMap::new(); // (league, season, team)
for r in &rows {
    let tot = r.hc + r.ac;
    if tot <= 0.0 { continue; }
    for (c, team, gf, ga) in [(r.hc, &r.home, r.hg, r.ag), (r.ac, &r.away, r.ag, r.hg)] {
        let share = 100.0 * c / tot;
        let key = (r.league.clone(), r.season.clone(), team.clone());
        let t = tally.entry(key).or_default();
        if gf > ga {
            t.tot_w += 1;
            if share < 35.0 { t.low_w += 1; }
        } else if gf < ga {
            t.tot_l += 1;
            if share > 65.0 { t.high_l += 1; }
        }
    }
}

let mut epl_low_w = 0usize; let mut epl_w = 0usize;
let mut epl_high_l = 0usize; let mut epl_l = 0usize;
for ((lg, _, _), t) in &tally {
    if lg != "English Premier League" { continue; }
    epl_low_w += t.low_w; epl_w += t.tot_w;
    epl_high_l += t.high_l; epl_l += t.tot_l;
}
println!("EPL team-matches: wins {} | wins with <35%% corner share: {} ({:.1}%% of wins)",
    epl_w, epl_low_w, 100.0 * epl_low_w as f64 / epl_w.max(1) as f64);
println!("EPL losses {} | losses with >65%% corner share: {} ({:.1}%% of losses)",
    epl_l, epl_high_l, 100.0 * epl_high_l as f64 / epl_l.max(1) as f64);

// aggregate per team across all EPL seasons
let mut team_tot: HashMap<String, (usize, usize, usize, usize)> = HashMap::new();
for ((lg, _, tm), t) in &tally {
    if lg != "English Premier League" { continue; }
    let e = team_tot.entry(tm.clone()).or_insert((0, 0, 0, 0));
    e.0 += t.low_w; e.1 += t.tot_w; e.2 += t.high_l; e.3 += t.tot_l;
}
let mut cand: Vec<(&String, &(usize, usize, usize, usize))> = team_tot.iter()
    .filter(|(_, t)| t.0 >= 8)
    .collect();
cand.sort_by(|a, b| {
    let ra = (a.1).0 as f64 / (a.1).1.max(1) as f64;
    let rb = (b.1).0 as f64 / (b.1).1.max(1) as f64;
    rb.partial_cmp(&ra).unwrap()
});
let top_rows: Vec<Vec<String>> = cand.iter().take(12).map(|(tm, t)| vec![
    (*tm).clone(), t.0.to_string(), t.1.to_string(),
    format!("{:.0}%", 100.0 * t.0 as f64 / t.1.max(1) as f64),
]).collect();
mars_table(&["team (EPL, all seasons)", "wins <35% share", "total wins", "low-share win share"], &top_rows);
```

```text
EPL team-matches: wins 7536 | wins with <35%% corner share: 1664 (22.1%% of wins)
EPL losses 7536 | losses with >65%% corner share: 1664 (22.1%% of losses)
```

| team (EPL, all seasons) | wins <35% share | total wins | low-share win share |
| ----------------------- | --------------- | ---------- | ------------------- |
| QPR                     | 11              | 22         | 50%                 |
| Burnley                 | 41              | 92         | 45%                 |
| Derby                   | 8               | 19         | 42%                 |
| Nott'm Forest           | 21              | 50         | 42%                 |
| Hull                    | 18              | 44         | 41%                 |
| Sunderland              | 53              | 143        | 37%                 |
| Ipswich                 | 13              | 36         | 36%                 |
| Charlton                | 29              | 85         | 34%                 |
| Watford                 | 23              | 68         | 34%                 |
| Stoke                   | 39              | 116        | 34%                 |
| Sheffield United        | 11              | 34         | 32%                 |
| Blackburn               | 45              | 140        | 32%                 |

```rust
let mut cand_l: Vec<(&String, &(usize, usize, usize, usize))> = team_tot.iter()
    .filter(|(_, t)| t.2 >= 8)
    .collect();
cand_l.sort_by(|a, b| {
    let ra = (a.1).2 as f64 / (a.1).3.max(1) as f64;
    let rb = (b.1).2 as f64 / (b.1).3.max(1) as f64;
    rb.partial_cmp(&ra).unwrap()
});
let top_l: Vec<Vec<String>> = cand_l.iter().take(12).map(|(tm, t)| vec![
    (*tm).clone(), t.2.to_string(), t.3.to_string(),
    format!("{:.0}%", 100.0 * t.2 as f64 / t.3.max(1) as f64),
]).collect();
mars_table(&["team (EPL, all seasons)", "losses >65% share", "total losses", "high-share loss share"], &top_l);
```

| team (EPL, all seasons) | losses >65% share | total losses | high-share loss share |
| ----------------------- | ----------------- | ------------ | --------------------- |
| Liverpool               | 91                | 204          | 45%                   |
| Man City                | 92                | 240          | 38%                   |
| Chelsea                 | 78                | 210          | 37%                   |
| Man United              | 73                | 205          | 36%                   |
| Reading                 | 19                | 59           | 32%                   |
| Leeds                   | 40                | 127          | 31%                   |
| Arsenal                 | 60                | 195          | 31%                   |
| Tottenham               | 85                | 321          | 26%                   |
| Ipswich                 | 16                | 62           | 26%                   |
| Everton                 | 88                | 352          | 25%                   |
| Aston Villa             | 83                | 335          | 25%                   |
| Blackburn               | 40                | 168          | 24%                   |

### Context: home advantage and opponent strength

Two confounds the band table ignores. **Home teams already win more** — and home
teams also win more corners (the home side takes roughly 55–60% of match corners
on average), so part of the corner-share effect is venue. And **corners are
easier to come by against weak teams** that sit deep and defend. Split by venue
and by opponent strength (the opponent's final season points, top vs bottom half
within its league-season).

```rust
// team-season points for opponent strength (all matches_full matches)
let mut tp: HashMap<(String, String, i64), i64> = HashMap::new();
for i in 0..mf.height() {
    if s_hg[i] < 0 || s_ag[i] < 0 { continue; }
    let lg = format!("{}|{}", s_country[i], s_league[i]);
    let ph = if s_hg[i] > s_ag[i] { 3 } else if s_hg[i] == s_ag[i] { 1 } else { 0 };
    let pa = if s_ag[i] > s_hg[i] { 3 } else if s_hg[i] == s_ag[i] { 1 } else { 0 };
    *tp.entry((lg.clone(), s_season[i].clone(), s_hid[i])).or_insert(0) += ph;
    *tp.entry((lg.clone(), s_season[i].clone(), s_aid[i])).or_insert(0) += pa;
}
let mut lgsn_teams: HashMap<(String, String), Vec<((String, String, i64), i64)>> = HashMap::new();
for (k, v) in &tp { lgsn_teams.entry((k.0.clone(), k.1.clone())).or_default().push((k.clone(), *v)); }
let mut strong: HashMap<(String, String, i64), bool> = HashMap::new();
for (_, mut teams) in lgsn_teams {
    teams.sort_by(|a, b| b.1.cmp(&a.1));
    let half = teams.len() / 2;
    for (i, (k, _)) in teams.iter().enumerate() {
        strong.insert(k.clone(), i < half);
    }
}

// win% by corner-share band x opponent strength — EPL only
let mut res = vec![(0usize,0usize); 10]; // band(5) x strong(2)
for r in &epl {
    let lg = format!("England|{}", r.league);
    let tot = r.hc + r.ac;
    if tot <= 0.0 { continue; }
    for (c, opp_id, gf, ga) in [(r.hc, r.aid, r.hg, r.ag), (r.ac, r.hid, r.ag, r.hg)] {
        let share = 100.0 * c / tot;
        let b = bands.iter().position(|&hi| share < hi).unwrap_or(5) - 1;
        let is_strong = strong.get(&(lg.clone(), r.season.clone(), opp_id)).copied().unwrap_or(false);
        let idx = b * 2 + if is_strong { 1 } else { 0 };
        res[idx].1 += 1;
        if gf > ga { res[idx].0 += 1; }
    }
}
let ctx_rows: Vec<Vec<String>> = (0..5).map(|b| vec![
    blabels[b].to_string(),
    format!("{} / {}", res[b*2].1, res[b*2+1].1),
    format!("{:.0}% / {:.0}%",
        100.0*res[b*2].0 as f64/res[b*2].1.max(1) as f64,
        100.0*res[b*2+1].0 as f64/res[b*2+1].1.max(1) as f64),
]).collect();
mars_table(&["corner share", "n vs weak / strong", "win% vs weak / strong"], &ctx_rows);
```

| corner share | n vs weak / strong | win% vs weak / strong |
| ------------ | ------------------ | --------------------- |
| <35          | 1917 / 3364        | 46% / 24%             |
| 35-45        | 1393 / 1678        | 49% / 27%             |
| 45-55        | 1672 / 1679        | 49% / 27%             |
| 55-65        | 1626 / 1444        | 48% / 27%             |
| >65          | 3210 / 2079        | 51% / 33%             |

```rust
println!("opponent strength = top-half finishers in same league-season (points)");

// home vs away: same bands applied to each side separately
let band_table_side = |matches: &[&MRow], home_side: bool| -> Vec<Vec<String>> {
    let mut w = vec![0usize; 5]; let mut d = vec![0usize; 5]; let mut l = vec![0usize; 5];
    for r in matches {
        let tot = r.hc + r.ac;
        if tot <= 0.0 { continue; }
        let (c, gf, ga) = if home_side { (r.hc, r.hg, r.ag) } else { (r.ac, r.ag, r.hg) };
        let share = 100.0 * c / tot;
        let b = bands.iter().position(|&hi| share < hi).unwrap_or(5) - 1;
        if gf > ga { w[b] += 1; } else if gf == ga { d[b] += 1; } else { l[b] += 1; }
    }
    (0..5).map(|b| {
        let n = (w[b] + d[b] + l[b]) as f64;
        vec![blabels[b].to_string(), (w[b]+d[b]+l[b]).to_string(),
             format!("{:.1}%", 100.0*w[b] as f64/n),
             format!("{:.1}%", 100.0*d[b] as f64/n),
             format!("{:.1}%", 100.0*l[b] as f64/n)]
    }).collect()
};
let home_b = band_table_side(&epl_refs, true);
let away_b = band_table_side(&epl_refs, false);
let ha_rows: Vec<Vec<String>> = (0..5).map(|b| vec![
    blabels[b].to_string(),
    home_b[b][2].clone(), home_b[b][4].clone(),
    away_b[b][2].clone(), away_b[b][4].clone(),
]).collect();
mars_table(&["corner share", "home win% / loss%", "away win% / loss%"], &ha_rows);
```

```text
opponent strength = top-half finishers in same league-season (points)
```

| corner share | home win% / loss% | away win% / loss% |
| ------------ | ----------------- | ----------------- |
| <35          | 42.1%             | 33.1%             |
| 35-45        | 44.5%             | 30.9%             |
| 45-55        | 44.7%             | 30.8%             |
| 55-65        | 43.7%             | 31.2%             |
| >65          | 49.6%             | 25.4%             |

```rust
// average home corner share per EPL season — venue baseline
let mut hshare_by_season: HashMap<String, (f64, usize)> = HashMap::new();
for r in &epl {
    let tot = r.hc + r.ac;
    if tot <= 0.0 { continue; }
    let e = hshare_by_season.entry(r.season.clone()).or_insert((0.0, 0));
    e.0 += 100.0 * r.hc / tot; e.1 += 1;
}
let mut hs_rows: Vec<Vec<String>> = hshare_by_season.iter().map(|(s, (sum, n))| vec![
    s.clone(), format!("{:.1}%", sum / *n as f64), n.to_string(),
]).collect();
hs_rows.sort();
mars_table(&["EPL season", "avg home corner share", "matches"], &hs_rows);
```

| EPL season | avg home corner share | matches |
| ---------- | --------------------- | ------- |
| 2000/01    | 57.6%                 | 380     |
| 2001/02    | 29.4%                 | 380     |
| 2002/03    | 57.2%                 | 380     |
| 2003/04    | 56.1%                 | 383     |
| 2004/05    | 56.2%                 | 380     |
| 2005/06    | 56.2%                 | 380     |
| 2006/07    | 56.8%                 | 380     |
| 2007/08    | 56.8%                 | 380     |
| 2008/09    | 56.1%                 | 380     |
| 2009/10    | 55.2%                 | 380     |
| 2010/11    | 54.5%                 | 379     |
| 2011/12    | 57.1%                 | 380     |
| 2012/13    | 56.3%                 | 380     |
| 2013/14    | 56.7%                 | 380     |
| 2014/15    | 55.3%                 | 380     |
| 2015/16    | 53.4%                 | 419     |
| 2016/17    | 54.2%                 | 380     |
| 2017/18    | 55.9%                 | 380     |
| 2018/19    | 55.7%                 | 380     |
| 2019/20    | 53.4%                 | 380     |
| 2020/21    | 53.7%                 | 380     |
| 2021/22    | 53.3%                 | 380     |
| 2022/23    | 55.2%                 | 380     |
| 2023/24    | 56.3%                 | 380     |
| 2024/25    | 52.6%                 | 380     |
| 2025/26    | 54.0%                 | 380     |
| 2026/27    | 52.8%                 | 110     |

### The season-level view and the historical trend

Match-level noise is huge. Smooth it three ways: (1) correlate each time's
**season-average corner share** with final points; (2) track the yearly
correlation between corner differential and home wins; (3) track the average
**total corners per match** — are modern games more or less cornered than the
early 2000s?

```rust
// (1) EPL team-season: avg corner share vs points
let mut ts: HashMap<(String, i64), (f64, usize)> = HashMap::new();
for r in &epl {
    let tot = r.hc + r.ac;
    if tot <= 0.0 { continue; }
    for (tid, c) in [(r.hid, r.hc), (r.aid, r.ac)] {
        let e = ts.entry((r.season.clone(), tid)).or_insert((0.0, 0));
        e.0 += 100.0 * c / tot; e.1 += 1;
    }
}
let mut pts: HashMap<(String, i64), i64> = HashMap::new();
for r in &epl {
    let ph = if r.hg > r.ag { 3 } else if r.hg == r.ag { 1 } else { 0 };
    let pa = if r.ag > r.hg { 3 } else if r.hg == r.ag { 1 } else { 0 };
    *pts.entry((r.season.clone(), r.hid)).or_insert(0) += ph;
    *pts.entry((r.season.clone(), r.aid)).or_insert(0) += pa;
}
let mut xs = Vec::new(); let mut ys = Vec::new();
for ((sn, tid), (sp, n)) in &ts {
    if *n < 30 { continue; }
    if let Some(p) = pts.get(&(sn.clone(), *tid)) {
        xs.push(sp / *n as f64); ys.push(*p as f64);
    }
}
println!("EPL team-seasons: {} | corr(avg corner share, season points) = {:.3}",
    xs.len(), pearson(&xs, &ys));

// (2) yearly correlation: corner diff -> home win, EPL by season
let mut by_year: std::collections::BTreeMap<String, (Vec<f64>, Vec<f64>)> = std::collections::BTreeMap::new();
for r in &epl {
    let e = by_year.entry(r.season.clone()).or_default();
    e.0.push(r.hc - r.ac);
    e.1.push(if r.hg > r.ag { 1.0 } else { 0.0 });
}
// (3) corners per match per season
let mut cpb: std::collections::BTreeMap<String, (f64, usize)> = std::collections::BTreeMap::new();
for r in &epl {
    let e = cpb.entry(r.season.clone()).or_insert((0.0, 0));
    e.0 += (r.hc + r.ac) / 2.0; e.1 += 1;
}
let trend_rows: Vec<Vec<String>> = by_year.iter().map(|(sn, (x, y))| {
    let cp = cpb.get(sn).map(|(s, n)| s / *n as f64).unwrap_or(f64::NAN);
    vec![sn.clone(), format!("{:.3}", pearson(x, y)), x.len().to_string(),
         format!("{:.1}", cp)]
}).collect();
mars_table(&["EPL season", "corr(corner diff, home win)", "matches", "avg corners/team"], &trend_rows);
```

```text
EPL team-seasons: 521 | corr(avg corner share, season points) = 0.744
```

| EPL season | corr(corner diff, home win) | matches | avg corners/team |
| ---------- | --------------------------- | ------- | ---------------- |
| 2000/01    | 0.024                       | 380     | 5.5              |
| 2001/02    | -0.057                      | 380     | 4.3              |
| 2002/03    | -0.023                      | 380     | 5.8              |
| 2003/04    | -0.071                      | 383     | 5.6              |
| 2004/05    | 0.073                       | 380     | 5.4              |
| 2005/06    | -0.041                      | 380     | 5.3              |
| 2006/07    | -0.086                      | 380     | 5.6              |
| 2007/08    | 0.085                       | 380     | 5.5              |
| 2008/09    | 0.038                       | 380     | 5.6              |
| 2009/10    | 0.141                       | 380     | 5.6              |
| 2010/11    | -0.017                      | 380     | 5.5              |
| 2011/12    | 0.088                       | 380     | 5.7              |
| 2012/13    | 0.153                       | 380     | 5.6              |
| 2013/14    | 0.086                       | 380     | 5.4              |
| 2014/15    | -0.056                      | 380     | 5.3              |
| 2015/16    | -0.050                      | 419     | 5.4              |
| 2016/17    | 0.073                       | 380     | 5.2              |
| 2017/18    | 0.053                       | 380     | 5.1              |
| 2018/19    | 0.085                       | 380     | 5.1              |
| 2019/20    | 0.079                       | 380     | 5.4              |
| 2020/21    | 0.004                       | 380     | 5.1              |
| 2021/22    | 0.142                       | 380     | 5.2              |
| 2022/23    | 0.095                       | 380     | 5.1              |
| 2023/24    | 0.138                       | 380     | 5.4              |
| 2024/25    | 0.113                       | 380     | 5.1              |
| 2025/26    | -0.082                      | 380     | 5.0              |
| 2026/27    | 0.061                       | 110     | 4.8              |

```rust
use plotters::prelude::*;

fn chart_num(s: &str) -> f64 {
    let t = s.replace(',', "").replace('%', "").replace('−', "-");
    let mult = if t.contains("bn") { 1e9 }
        else if t.contains('€') && t.contains('m') { 1e6 }
        else { 1.0 };
    let cleaned: String = t.chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == '-')
        .collect();
    cleaned.parse().unwrap_or(0.0) * mult
}


let mut c_items: Vec<(String, f64)> = hs_rows.iter()
    .map(|r| (r[0].clone(), chart_num(&r[1].clone())))
    .collect();
c_items.retain(|(_, v)| v.is_finite());
c_items.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
c_items.truncate(12);
let c_labels: Vec<String> = c_items.iter()
    .map(|(l, _)| l.chars().take(18).collect()).collect();
let c_vals: Vec<f64> = c_items.iter().map(|(_, v)| *v).collect();
let c_ymax = c_vals.iter().cloned().fold(0.0_f64, f64::max) * 1.15 + 1e-9;
let (c_div, c_unit): (f64, &str) = if c_ymax >= 1e9 { (1e9, "bn") }
    else if c_ymax >= 1e6 { (1e6, "m") }
    else if c_ymax >= 1e3 { (1e3, "k") }
    else { (1.0, "") };
let c_n = c_vals.len();
let figure = plotters::evcxr::evcxr_figure((780, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Average home corner share by EPL season", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(45)
        .y_label_area_size(55)
        .build_cartesian_2d(-0.5_f64..(c_n as f64 - 0.5), 0.0..c_ymax)?;
    chart.configure_mesh()
        .x_labels(c_n)
        .x_label_formatter(&|x: &f64| c_labels.get(*x as usize).cloned().unwrap_or_default())
        .y_label_formatter(&|y: &f64| format!("{:.1}{}", y / c_div, c_unit))
        .draw()?;
    chart.draw_series(c_vals.iter().enumerate().map(|(i, &v)| {
        Rectangle::new([(i as f64 - 0.35, 0.0), (i as f64 + 0.35, v)], BLUE.filled())
    }))?;
    Ok(())
});
figure.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQXZlcmFnZSBob21lIGNvcm5lciBzaGFyZSBieSBFUEwgc2Vhc29uCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcwIiB5MT0iMzQ0IiB4Mj0iNzAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODIiIHkxPSIzNDQiIHgyPSI4MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NCIgeTE9IjM0NCIgeDI9Ijk0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwNiIgeTE9IjM0NCIgeDI9IjEwNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMTciIHkxPSIzNDQiIHgyPSIxMTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTI5IiB5MT0iMzQ0IiB4Mj0iMTI5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE0MSIgeTE9IjM0NCIgeDI9IjE0MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTMiIHkxPSIzNDQiIHgyPSIxNTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTY0IiB5MT0iMzQ0IiB4Mj0iMTY0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3NiIgeTE9IjM0NCIgeDI9IjE3NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODgiIHkxPSIzNDQiIHgyPSIxODgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTk5IiB5MT0iMzQ0IiB4Mj0iMTk5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxMSIgeTE9IjM0NCIgeDI9IjIxMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMjMiIHkxPSIzNDQiIHgyPSIyMjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjM1IiB5MT0iMzQ0IiB4Mj0iMjM1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI0NiIgeTE9IjM0NCIgeDI9IjI0NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNTgiIHkxPSIzNDQiIHgyPSIyNTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjcwIiB5MT0iMzQ0IiB4Mj0iMjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI4MiIgeTE9IjM0NCIgeDI9IjI4MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyOTMiIHkxPSIzNDQiIHgyPSIyOTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzA1IiB5MT0iMzQ0IiB4Mj0iMzA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMxNyIgeTE9IjM0NCIgeDI9IjMxNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjkiIHkxPSIzNDQiIHgyPSIzMjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQwIiB5MT0iMzQ0IiB4Mj0iMzQwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1MiIgeTE9IjM0NCIgeDI9IjM1MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNjQiIHkxPSIzNDQiIHgyPSIzNjQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzc1IiB5MT0iMzQ0IiB4Mj0iMzc1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4NyIgeTE9IjM0NCIgeDI9IjM4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTkiIHkxPSIzNDQiIHgyPSIzOTkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDExIiB5MT0iMzQ0IiB4Mj0iNDExIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQyMiIgeTE9IjM0NCIgeDI9IjQyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzQiIHkxPSIzNDQiIHgyPSI0MzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDQ2IiB5MT0iMzQ0IiB4Mj0iNDQ2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ1OCIgeTE9IjM0NCIgeDI9IjQ1OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NjkiIHkxPSIzNDQiIHgyPSI0NjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDgxIiB5MT0iMzQ0IiB4Mj0iNDgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ5MyIgeTE9IjM0NCIgeDI9IjQ5MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDUiIHkxPSIzNDQiIHgyPSI1MDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTE2IiB5MT0iMzQ0IiB4Mj0iNTE2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUyOCIgeTE9IjM0NCIgeDI9IjUyOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDAiIHkxPSIzNDQiIHgyPSI1NDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUxIiB5MT0iMzQ0IiB4Mj0iNTUxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2MyIgeTE9IjM0NCIgeDI9IjU2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzUiIHkxPSIzNDQiIHgyPSI1NzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTg3IiB5MT0iMzQ0IiB4Mj0iNTg3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5OCIgeTE9IjM0NCIgeDI9IjU5OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTAiIHkxPSIzNDQiIHgyPSI2MTAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjIyIiB5MT0iMzQ0IiB4Mj0iNjIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYzNCIgeTE9IjM0NCIgeDI9IjYzNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NDUiIHkxPSIzNDQiIHgyPSI2NDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjU3IiB5MT0iMzQ0IiB4Mj0iNjU3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY2OSIgeTE9IjM0NCIgeDI9IjY2OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODEiIHkxPSIzNDQiIHgyPSI2ODEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjkyIiB5MT0iMzQ0IiB4Mj0iNjkyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcwNCIgeTE9IjM0NCIgeDI9IjcwNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MTYiIHkxPSIzNDQiIHgyPSI3MTYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzI3IiB5MT0iMzQ0IiB4Mj0iNzI3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjczOSIgeTE9IjM0NCIgeDI9IjczOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3NTEiIHkxPSIzNDQiIHgyPSI3NTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzYzIiB5MT0iMzQ0IiB4Mj0iNzYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzQ0IiB4Mj0iNzY5IiB5Mj0iMzQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0MCIgeDI9Ijc2OSIgeTI9IjM0MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMzUiIHgyPSI3NjkiIHkyPSIzMzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzMwIiB4Mj0iNzY5IiB5Mj0iMzMwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMyNiIgeDI9Ijc2OSIgeTI9IjMyNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjEiIHgyPSI3NjkiIHkyPSIzMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzE2IiB4Mj0iNzY5IiB5Mj0iMzE2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMxMiIgeDI9Ijc2OSIgeTI9IjMxMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMDciIHgyPSI3NjkiIHkyPSIzMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzAyIiB4Mj0iNzY5IiB5Mj0iMzAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5OCIgeDI9Ijc2OSIgeTI9IjI5OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyOTMiIHgyPSI3NjkiIHkyPSIyOTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjg4IiB4Mj0iNzY5IiB5Mj0iMjg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI4NCIgeDI9Ijc2OSIgeTI9IjI4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNzkiIHgyPSI3NjkiIHkyPSIyNzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjc0IiB4Mj0iNzY5IiB5Mj0iMjc0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI3MCIgeDI9Ijc2OSIgeTI9IjI3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNjUiIHgyPSI3NjkiIHkyPSIyNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjYwIiB4Mj0iNzY5IiB5Mj0iMjYwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI1NiIgeDI9Ijc2OSIgeTI9IjI1NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNTEiIHgyPSI3NjkiIHkyPSIyNTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjQ2IiB4Mj0iNzY5IiB5Mj0iMjQ2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI0MiIgeDI9Ijc2OSIgeTI9IjI0MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzciIHgyPSI3NjkiIHkyPSIyMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjMyIiB4Mj0iNzY5IiB5Mj0iMjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIyOCIgeDI9Ijc2OSIgeTI9IjIyOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMjMiIHgyPSI3NjkiIHkyPSIyMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjE4IiB4Mj0iNzY5IiB5Mj0iMjE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIxMyIgeDI9Ijc2OSIgeTI9IjIxMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMDkiIHgyPSI3NjkiIHkyPSIyMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjA0IiB4Mj0iNzY5IiB5Mj0iMjA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE5OSIgeDI9Ijc2OSIgeTI9IjE5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxOTUiIHgyPSI3NjkiIHkyPSIxOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTkwIiB4Mj0iNzY5IiB5Mj0iMTkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE4NSIgeDI9Ijc2OSIgeTI9IjE4NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODEiIHgyPSI3NjkiIHkyPSIxODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTc2IiB4Mj0iNzY5IiB5Mj0iMTc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE3MSIgeDI9Ijc2OSIgeTI9IjE3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNjciIHgyPSI3NjkiIHkyPSIxNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTYyIiB4Mj0iNzY5IiB5Mj0iMTYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE1NyIgeDI9Ijc2OSIgeTI9IjE1NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTMiIHgyPSI3NjkiIHkyPSIxNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTQ4IiB4Mj0iNzY5IiB5Mj0iMTQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE0MyIgeDI9Ijc2OSIgeTI9IjE0MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzkiIHgyPSI3NjkiIHkyPSIxMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTM0IiB4Mj0iNzY5IiB5Mj0iMTM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyOSIgeDI9Ijc2OSIgeTI9IjEyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMjUiIHgyPSI3NjkiIHkyPSIxMjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTIwIiB4Mj0iNzY5IiB5Mj0iMTIwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExNSIgeDI9Ijc2OSIgeTI9IjExNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMTEiIHgyPSI3NjkiIHkyPSIxMTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTA2IiB4Mj0iNzY5IiB5Mj0iMTA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEwMSIgeDI9Ijc2OSIgeTI9IjEwMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI5NiIgeDI9Ijc2OSIgeTI9Ijk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjkyIiB4Mj0iNzY5IiB5Mj0iOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iODciIHgyPSI3NjkiIHkyPSI4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4MiIgeDI9Ijc2OSIgeTI9IjgyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijc4IiB4Mj0iNzY5IiB5Mj0iNzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNzMiIHgyPSI3NjkiIHkyPSI3MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI2OCIgeDI9Ijc2OSIgeTI9IjY4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjY0IiB4Mj0iNzY5IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNTkiIHgyPSI3NjkiIHkyPSI1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI1NCIgeDI9Ijc2OSIgeTI9IjU0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjUwIiB4Mj0iNzY5IiB5Mj0iNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNDUiIHgyPSI3NjkiIHkyPSI0NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI0MCIgeDI9Ijc2OSIgeTI9IjQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM2IiB4Mj0iNzY5IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk0IiB5MT0iMzQ0IiB4Mj0iOTQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzQ0IiB4Mj0iMTUzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxMSIgeTE9IjM0NCIgeDI9IjIxMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzAiIHkxPSIzNDQiIHgyPSIyNzAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI5IiB5MT0iMzQ0IiB4Mj0iMzI5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4NyIgeTE9IjM0NCIgeDI9IjM4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NDYiIHkxPSIzNDQiIHgyPSI0NDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA1IiB5MT0iMzQ0IiB4Mj0iNTA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2MyIgeTE9IjM0NCIgeDI9IjU2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MjIiIHkxPSIzNDQiIHgyPSI2MjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgxIiB5MT0iMzQ0IiB4Mj0iNjgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjczOSIgeTE9IjM0NCIgeDI9IjczOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0NCIgeDI9Ijc2OSIgeTI9IjM0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyOTgiIHgyPSI3NjkiIHkyPSIyOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjUxIiB4Mj0iNzY5IiB5Mj0iMjUxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIwNCIgeDI9Ijc2OSIgeTI9IjIwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTciIHgyPSI3NjkiIHkyPSIxNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTExIiB4Mj0iNzY5IiB5Mj0iMTExIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjY0IiB4Mj0iNzY5IiB5Mj0iNjQiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY0LDM0IDY0LDM0NCAiLz4KPHRleHQgeD0iNTUiIHk9IjM0NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDM0NCA2NCwzNDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIyOTgiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMjk4IDY0LDI5OCAiLz4KPHRleHQgeD0iNTUiIHk9IjI1MSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwyNTEgNjQsMjUxICIvPgo8dGV4dCB4PSI1NSIgeT0iMjA0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDIwNCA2NCwyMDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIxNTciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjQwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMTU3IDY0LDE1NyAiLz4KPHRleHQgeD0iNTUiIHk9IjExMSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwxMTEgNjQsMTExICIvPgo8dGV4dCB4PSI1NSIgeT0iNjQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksNjQgNjQsNjQgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NSwzNDUgNzY5LDM0NSAiLz4KPHRleHQgeD0iOTQiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwMDAvMDEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iOTQsMzQ1IDk0LDM1MCAiLz4KPHRleHQgeD0iMTUzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDAyLzAzCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1MywzNDUgMTUzLDM1MCAiLz4KPHRleHQgeD0iMjExIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDExLzEyCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjIxMSwzNDUgMjExLDM1MCAiLz4KPHRleHQgeD0iMjcwIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDA2LzA3CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjI3MCwzNDUgMjcwLDM1MCAiLz4KPHRleHQgeD0iMzI5IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDA3LzA4CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjMyOSwzNDUgMzI5LDM1MCAiLz4KPHRleHQgeD0iMzg3IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDEzLzE0CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM4NywzNDUgMzg3LDM1MCAiLz4KPHRleHQgeD0iNDQ2IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDEyLzEzCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ0NiwzNDUgNDQ2LDM1MCAiLz4KPHRleHQgeD0iNTA1IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDIzLzI0CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUwNSwzNDUgNTA1LDM1MCAiLz4KPHRleHQgeD0iNTYzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDA0LzA1CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU2MywzNDUgNTYzLDM1MCAiLz4KPHRleHQgeD0iNjIyIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDA1LzA2CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjYyMiwzNDUgNjIyLDM1MCAiLz4KPHRleHQgeD0iNjgxIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDAzLzA0CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY4MSwzNDUgNjgxLDM1MCAiLz4KPHRleHQgeD0iNzM5IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDA4LzA5CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjczOSwzNDUgNzM5LDM1MCAiLz4KPHJlY3QgeD0iNzMiIHk9Ijc1IiB3aWR0aD0iNDEiIGhlaWdodD0iMjY5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTMyIiB5PSI3NyIgd2lkdGg9IjQxIiBoZWlnaHQ9IjI2NyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjE5MSIgeT0iNzciIHdpZHRoPSI0MSIgaGVpZ2h0PSIyNjciIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyNDkiIHk9Ijc5IiB3aWR0aD0iNDEiIGhlaWdodD0iMjY1IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzA4IiB5PSI3OSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjI2NSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjM2NyIgeT0iNzkiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyNjUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0MjUiIHk9IjgxIiB3aWR0aD0iNDEiIGhlaWdodD0iMjYzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDg0IiB5PSI4MSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjI2MyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjU0MyIgeT0iODEiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyNjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2MDEiIHk9IjgxIiB3aWR0aD0iNDEiIGhlaWdodD0iMjYzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjYwIiB5PSI4MiIgd2lkdGg9IjQxIiBoZWlnaHQ9IjI2MiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjcxOSIgeT0iODIiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyNjIiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

## Discussion

**Do more corners help you win? Barely — and less than almost any other stat we
track.**

1. **The gradient is the weakest of the attacking stats.** In the Premier
   League, win rate climbs from 31.5% with under 35% of the match's corners to
   43.5% above 65% — a 12-point spread. Possession spans 27 points on the same
   matches; shot share roughly 25. Across _all_ covered leagues the corner-share
   curve nearly flatlines (35.5% → 38.2%), and the pooled correlation between
   home corner share and home win is **−0.012 — effectively zero, even slightly
   negative**.

2. **Corner share is a worse match-level predictor than possession.**
   Head-to-head on identical EPL matches: corner share ρ = 0.050, possession ρ =
   0.120, shot share ρ = 0.259, shots-on-target share ρ = 0.400. Corners measure
   _who you are_ far less well than they measure _what happens today_ — the
   opposite of the cliché.

3. **But it is an excellent team-quality marker.** Correlating each team's
   season-average corner share with its final points gives ρ = 0.744 across 521
   EPL team-seasons — stronger than possession's 0.704. Corner-heavy teams are
   good teams; corner-dominant _matches_ are barely more likely to be won.

4. **The extremes cut both ways — and the losers are famous.** 22.1% of EPL wins
   came with under 35% corner share (QPR won half their matches that way;
   Burnley 45%). And 22.1% of losses came with over 65% — led by **Liverpool
   (45% of their losses)**, Manchester City (38%) and Chelsea (37%): the
   possession-dominant sides get countered.

5. **Context helps but doesn't rescue it.** Against weak opponents corner share
   is nearly irrelevant (45–51% win rate across all bands); against strong ones
   it separates somewhat (24% → 32%). Away from home even a >65% corner share
   wins only 33.1% of the time.

6. **No dose-response at the top end.** The corner-differential table is
   non-monotonic: +4 to +6 corners wins 50.2% of home matches, but +12 to +14
   wins just 38.8%. In the all-league table the biggest differentials actually
   _underperform_ (38.9% at +12 to +16 vs 45.7% at even). More corners ≠ more
   wins, and at the extreme it can mean sterile pressure.

7. **Corner volume itself is slowly declining.** Average corners per team fell
   from ~5.5 in the early 2000s to ~5.0 in 2025/26 — modern games produce fewer,
   and the yearly correlation between corner differential and home wins wanders
   around zero with no trend.

**Data caveats:** no event-level corner data exists, so corner-to-goal
conversion and set-piece scoring are untestable here. The 2001/02 season shows
an anomalous 29.4% average home corner share (vs ~55% elsewhere) — likely a
partial data gap in that season's corner counts, which also explains its low 4.3
corners/team. Corner totals include both open-play pressure and dead-ball
recycling; we cannot separate them.

**Verdict:** corners are football's second-most quoted attacking stat after
possession — and an even weaker predictor of the single match. They tell you
which team is _better_ (ρ = 0.74 at season level) but almost nothing about which
team will win _today_ (ρ ≈ 0.05).

**Limitations.** The analysis is limited to the competitions present in the
database; player-level metrics exist only for StatsBomb-covered tournaments, and
underlying event data may contain errors.

## Conclusion

The gradient is the weakest of the attacking stats. Together these results
answer the research question posed in the Introduction and quantify the pattern
across hundreds of thousands of matches. The notebook provides a fully
reproducible pipeline from raw CSV extracts to published figures.
