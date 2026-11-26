---
title: 'Substitution patterns: when do managers pull the trigger?'
description: |
  '24,726 substitution events: 75% arrive after minute 60, peaking at 70-79. Teams that sub early lose more — but the subs are a symptom of losing, not a cause.'
author: 'hieudoan'
date: '2026-11-26T16:00'
order: 42
tags: ['football', 'analysis', 'substitutions', 'mars', 'sqlite']
---

# Substitution patterns: when do managers pull the trigger?

## Abstract

When do managers pull the trigger? This study answers it using hundreds of
thousands of matches drawn from the Soccers football database. When do managers
sub? Late — and mostly when they're already losing. All computation runs in Rust
inside a `.mars` notebook (polars + plotters — charts as inline SVG), and every
table and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, substitutions, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [The five-sub era](#the-five-sub-era)
  - [When do substitutions happen?](#when-do-substitutions-happen)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

24,726 substitution events across ~4,000 matches — the only in-game decision in
football we can actually observe. Two questions:

1. **When** do substitutions happen — and how has the timing shifted since the
   five-sub rule?
2. Does **when** a team makes its first substitution correlate with the result?

Caveat up front: substitutions are _reactive_ — trailing teams sub more and
earlier. This is association, not causation; the notebook shows the patterns and
flags the confound rather than pretending it away.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `match_event`, `matches_full`.

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

fn col_str(df: &DataFrame, name: &str) -> Vec<String> {
    df.column(name).unwrap().str().unwrap().iter()
        .map(|o| o.unwrap_or("").to_string()).collect()
}
fn col_i64(df: &DataFrame, name: &str) -> Vec<i64> {
    let c = df.column(name).unwrap().clone();
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect()
}

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

let valid: Vec<usize> = (0..mf.height()).filter(|&i| s_hg[i] >= 0 && s_ag[i] >= 0).collect();
println!("completed matches: {}", valid.len());

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

// standings order best->worst for (tid, pts, gd, gf)
fn rank_teams(teams: &[(i64, i64, i64, i64)]) -> Vec<usize> {
    let mut v: Vec<usize> = (0..teams.len()).collect();
    v.sort_by(|&a, &b| {
        teams[b].1.cmp(&teams[a].1)
            .then(teams[b].2.cmp(&teams[a].2))
            .then(teams[b].3.cmp(&teams[a].3))
    });
    v
}

// replay one league-season's matches (idxs sorted by date) -> final standings + max lead per team
// returns (order best->worst of (tid,pts,gd,gf), names, maxlead map)
fn replay_lgsn(idxs: &[usize], hid: &[i64], aid: &[i64], hg: &[i64], ag: &[i64],
               home: &[String], away: &[String]) -> (Vec<(i64,i64,i64,i64)>, HashMap<i64,String>, HashMap<i64,i64>) {
    let mut st: HashMap<i64, (i64, i64, i64)> = HashMap::new();
    let mut names: HashMap<i64, String> = HashMap::new();
    let mut maxlead: HashMap<i64, i64> = HashMap::new();
    for &i in idxs {
        for (tid, gf, ga, nm) in [(hid[i], hg[i], ag[i], &home[i]), (aid[i], ag[i], hg[i], &away[i])] {
            names.insert(tid, nm.clone());
            let e = st.entry(tid).or_insert((0, 0, 0));
            e.1 += gf; e.2 += ga;
            e.0 += if gf > ga { 3 } else if gf == ga { 1 } else { 0 };
        }
        let mut teams: Vec<(i64, i64, i64, i64)> = st.iter().map(|(&t, &(p, gf, ga))| (t, p, gf - ga, gf)).collect();
        let order = rank_teams(&teams);
        if order.len() >= 2 {
            let lead = teams[order[0]].1 - teams[order[1]].1;
            let top = teams[order[0]].0;
            let cur = maxlead.entry(top).or_insert(0);
            if lead > *cur { *cur = lead; }
        }
        teams.clear();
    }
    let mut teams: Vec<(i64, i64, i64, i64)> = st.iter().map(|(&t, &(p, gf, ga))| (t, p, gf - ga, gf)).collect();
    let order = rank_teams(&teams);
    let mut sorted: Vec<(i64,i64,i64,i64)> = order.iter().map(|&o| teams[o]).collect();
    (sorted, names, maxlead)
}

let ev = LazyCsvReader::new("data/match_event.csv")
    .finish().expect("match_event.csv")
    .collect().expect("collect events");

fn ev_str(df: &DataFrame, name: &str) -> Vec<String> {
    df.column(name).unwrap().str().unwrap().iter()
        .map(|o| o.unwrap_or("").to_string()).collect()
}
fn ev_i64(df: &DataFrame, name: &str) -> Vec<i64> {
    let c = df.column(name).unwrap().clone();
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect()
}

let e_match = ev_i64(&ev, "match_id");
let e_team = ev_i64(&ev, "team_id");
let e_min = ev_i64(&ev, "minute");
let e_type = ev_str(&ev, "type");

// match_id -> index in matches_full
let mut midx: HashMap<i64, usize> = HashMap::new();
for i in 0..mf.height() { midx.insert(s_id[i], i); }
println!("events: {} | matched to matches_full: {}",
    e_match.len(), e_match.iter().filter(|m| midx.contains_key(m)).count());

// collect subs per match per team
struct SubInfo { minute: i64 }
let mut subs: Vec<(usize, i64, i64)> = Vec::new(); // (match idx, team_id, minute)
for i in 0..e_match.len() {
    if e_type[i] != "SUBSTITUTION" { continue; }
    if let Some(&mi) = midx.get(&e_match[i]) {
        subs.push((mi, e_team[i], e_min[i]));
    }
}
println!("substitution events matched: {}", subs.len());

// per team-match: earliest sub minute + count
let mut by_tm: HashMap<(i64,i64), (i64,i64)> = HashMap::new(); // (match_id, team_id) -> (first_min, count)
for &(mi, tid, mn) in &subs {
    let e = by_tm.entry((s_id[mi], tid)).or_insert((999,0));
    if mn < e.0 { e.0 = mn; }
    e.1 += 1;
}
println!("team-matches with >=1 sub: {}", by_tm.len());
```

```text
completed matches: 313022
events: 29297 | matched to matches_full: 29297
substitution events matched: 24726
team-matches with >=1 sub: 7869
```

### The five-sub era

Substitution volume and timing by season — the rule changed from 3 to 5 subs in
2020/21 (IFAB) and again in some competitions. Does the data show it?

```rust

// subs per team-match by season
let mut by_season: HashMap<String,(usize,usize)> = HashMap::new(); // season -> (subs, team_matches_with_subs)
let mut all_subs_by_season: HashMap<String,usize> = HashMap::new();
// count team-matches per season from matches_full (both teams)
let mut tm_per_season: HashMap<String,usize> = HashMap::new();
for &i in &valid {
    *tm_per_season.entry(s_season[i].clone()).or_insert(0) += 2;
}
for &(mi, _tid, _mn) in &{
    let mut v = Vec::new();
    for j in 0..e_match.len() {
        if e_type[j] == "SUBSTITUTION" {
            if let Some(&m) = midx.get(&e_match[j]) { v.push((m, e_team[j], e_min[j])); }
        }
    }
    v
} {
    let season = s_season[mi].clone();
    *all_subs_by_season.entry(season).or_insert(0) += 1;
}
// team-matches with subs per season
let mut tm_with_sub: HashMap<String, std::collections::HashSet<(i64,i64)>> = HashMap::new();
for j in 0..e_match.len() {
    if e_type[j] != "SUBSTITUTION" { continue; }
    if let Some(&mi) = midx.get(&e_match[j]) {
        tm_with_sub.entry(s_season[mi].clone()).or_default().insert((s_id[mi], e_team[j]));
    }
}
let mut seasons: Vec<String> = tm_per_season.keys().cloned().collect();
seasons.sort();
let rows: Vec<Vec<String>> = seasons.iter().filter_map(|sn| {
    let tm_n = *tm_per_season.get(sn)?;
    let subs_n = *all_subs_by_season.get(sn).unwrap_or(&0);
    let with = tm_with_sub.get(sn).map(|s| s.len()).unwrap_or(0);
    if tm_n == 0 { return None; }
    Some(vec![sn.clone(), tm_n.to_string(), subs_n.to_string(),
        format!("{:.2}", subs_n as f64 / tm_n as f64),
        format!("{:.0}%", 100.0 * with as f64 / (tm_n/2).max(1) as f64)])
}).collect();
mars_table(&["season","team-matches","subs","subs/team-match","matches w/ sub %"], &rows);
```

| season    | team-matches | subs | subs/team-match | matches w/ sub % |
| --------- | ------------ | ---- | --------------- | ---------------- |
| 1958      | 4            | 0    | 0.00            | 0%               |
| 1962      | 2            | 0    | 0.00            | 0%               |
| 1970      | 12           | 14   | 1.17            | 167%             |
| 1970/1971 | 2            | 2    | 1.00            | 100%             |
| 1971/1972 | 2            | 1    | 0.50            | 100%             |
| 1972/1973 | 2            | 2    | 1.00            | 100%             |
| 1973/1974 | 2            | 1    | 0.50            | 100%             |
| 1974      | 12           | 14   | 1.17            | 150%             |
| 1977      | 2            | 3    | 1.50            | 200%             |
| 1977/1978 | 2            | 2    | 1.00            | 200%             |
| 1979      | 2            | 4    | 2.00            | 200%             |
| 1981      | 2            | 2    | 1.00            | 200%             |
| 1982/1983 | 2            | 1    | 0.50            | 100%             |
| 1983/1984 | 2            | 3    | 1.50            | 200%             |
| 1986      | 6            | 8    | 1.33            | 200%             |
| 1986/1987 | 2            | 4    | 2.00            | 200%             |
| 1988/1989 | 6            | 9    | 1.50            | 200%             |
| 1990      | 2            | 3    | 1.50            | 200%             |
| 1993/94   | 10452        | 0    | 0.00            | 0%               |
| 1994/95   | 11340        | 0    | 0.00            | 0%               |
| 1995/96   | 12296        | 0    | 0.00            | 0%               |
| 1996/97   | 13056        | 0    | 0.00            | 0%               |
| 1997/1998 | 2            | 6    | 3.00            | 200%             |
| 1997/98   | 14388        | 0    | 0.00            | 0%               |
| 1998/99   | 14224        | 0    | 0.00            | 0%               |
| 1999/00   | 14224        | 0    | 0.00            | 0%               |
| 1999/2000 | 2            | 6    | 3.00            | 200%             |
| 2000/01   | 14126        | 0    | 0.00            | 0%               |
| 2001/02   | 14024        | 0    | 0.00            | 0%               |
| 2001/2002 | 432          | 0    | 0.00            | 0%               |
| 2002/03   | 14196        | 0    | 0.00            | 0%               |
| 2002/2003 | 450          | 0    | 0.00            | 0%               |
| 2003/04   | 14662        | 174  | 0.01            | 1%               |
| 2003/2004 | 342          | 5    | 0.01            | 1%               |
| 2004/05   | 14584        | 35   | 0.00            | 0%               |
| 2004/2005 | 342          | 6    | 0.02            | 1%               |
| 2005/06   | 14664        | 86   | 0.01            | 0%               |
| 2005/2006 | 418          | 0    | 0.00            | 0%               |
| 2006/07   | 14542        | 131  | 0.01            | 1%               |
| 2006/2007 | 414          | 6    | 0.01            | 1%               |
| 2007/08   | 14544        | 149  | 0.01            | 1%               |
| 2007/2008 | 426          | 0    | 0.00            | 0%               |
| 2008/09   | 14550        | 165  | 0.01            | 1%               |
| 2008/2009 | 426          | 5    | 0.01            | 1%               |
| 2009/10   | 14280        | 182  | 0.01            | 1%               |
| 2009/2010 | 1378         | 5    | 0.00            | 0%               |
| 2010/11   | 14408        | 177  | 0.01            | 1%               |
| 2010/2011 | 1194         | 5    | 0.00            | 0%               |
| 2011/12   | 14418        | 204  | 0.01            | 1%               |
| 2011/2012 | 1250         | 3    | 0.00            | 0%               |
| 2012      | 3778         | 0    | 0.00            | 0%               |
| 2012/13   | 14414        | 181  | 0.01            | 1%               |
| 2012/2013 | 5366         | 4    | 0.00            | 0%               |
| 2013      | 3816         | 0    | 0.00            | 0%               |
| 2013/14   | 14544        | 162  | 0.01            | 1%               |
| 2013/2014 | 5502         | 4    | 0.00            | 0%               |
| 2014      | 4676         | 0    | 0.00            | 0%               |
| 2014/15   | 14670        | 211  | 0.01            | 1%               |
| 2014/2015 | 4724         | 6    | 0.00            | 0%               |
| 2015      | 5280         | 0    | 0.00            | 0%               |
| 2015/16   | 16344        | 8228 | 0.50            | 38%              |
| 2015/2016 | 4648         | 6    | 0.00            | 0%               |
| 2016      | 5726         | 0    | 0.00            | 0%               |
| 2016/17   | 14540        | 168  | 0.01            | 1%               |
| 2016/2017 | 4792         | 6    | 0.00            | 0%               |
| 2017      | 4398         | 0    | 0.00            | 0%               |
| 2017/18   | 14540        | 196  | 0.01            | 1%               |
| 2017/2018 | 5518         | 3    | 0.00            | 0%               |
| 2018      | 4610         | 543  | 0.12            | 9%               |
| 2018/19   | 14302        | 186  | 0.01            | 1%               |
| 2018/2019 | 5684         | 504  | 0.09            | 7%               |
| 2019      | 4484         | 289  | 0.06            | 5%               |
| 2019/20   | 12930        | 215  | 0.02            | 1%               |
| 2019/2020 | 5362         | 406  | 0.08            | 6%               |
| 2020      | 4134         | 427  | 0.10            | 5%               |
| 2020/2021 | 4352         | 815  | 0.19            | 12%              |
| 2020/21   | 14366        | 282  | 0.02            | 1%               |
| 2021      | 5492         | 0    | 0.00            | 0%               |
| 2021/2022 | 4602         | 882  | 0.19            | 10%              |
| 2021/22   | 14684        | 186  | 0.01            | 1%               |
| 2022      | 5992         | 803  | 0.13            | 6%               |
| 2022/2023 | 4380         | 0    | 0.00            | 0%               |
| 2022/23   | 14620        | 243  | 0.02            | 1%               |
| 2023      | 6236         | 1950 | 0.31            | 17%              |
| 2023/2024 | 5740         | 5126 | 0.89            | 44%              |
| 2023/24   | 14562        | 284  | 0.02            | 1%               |
| 2024      | 6040         | 721  | 0.12            | 5%               |
| 2024/2025 | 4912         | 0    | 0.00            | 0%               |
| 2024/25   | 14258        | 0    | 0.00            | 0%               |
| 2025      | 5836         | 266  | 0.05            | 2%               |
| 2025/2026 | 4922         | 0    | 0.00            | 0%               |
| 2025/26   | 14188        | 0    | 0.00            | 0%               |
| 2026      | 4854         | 0    | 0.00            | 0%               |
| 2026/2027 | 2254         | 0    | 0.00            | 0%               |
| 2026/27   | 4852         | 0    | 0.00            | 0%               |

### When do substitutions happen?

Distribution of sub minutes across all events — and the first-sub timing per
team-match split by result. Teams that sub earlier are usually teams that are
losing; read the result table with that confound in mind.

```rust
// minute histogram of all subs
let mut hist = vec![0usize; 10]; // 0-9 -> 0-9min ... 90+ -> 9
for j in 0..e_match.len() {
    if e_type[j] != "SUBSTITUTION" { continue; }
    let m = e_min[j];
    let b = if m < 0 { continue } else if m > 95 { 9 } else { (m/10) as usize };
    hist[b.min(9)] += 1;
}
let hlabels = ["0-9","10-19","20-29","30-39","40-49","50-59","60-69","70-79","80-89","90+"];
let hrows: Vec<Vec<String>> = (0..10).map(|b| vec![
    hlabels[b].to_string(), hist[b].to_string(),
    format!("{:.1}%", 100.0*hist[b] as f64/hist.iter().sum::<usize>() as f64),
]).collect();
mars_table(&["minute","subs","share"], &hrows);
```

| minute | subs | share |
| ------ | ---- | ----- |
| 0-9    | 13   | 0.1%  |
| 10-19  | 32   | 0.1%  |
| 20-29  | 51   | 0.2%  |
| 30-39  | 89   | 0.4%  |
| 40-49  | 2118 | 8.6%  |
| 50-59  | 2633 | 10.6% |
| 60-69  | 6292 | 25.4% |
| 70-79  | 6922 | 28.0% |
| 80-89  | 5534 | 22.4% |
| 90+    | 1042 | 4.2%  |

```rust
// first-sub minute vs result (team perspective)
let mut by_tm: HashMap<(i64,i64),(i64,i64)> = HashMap::new();
for j in 0..e_match.len() {
    if e_type[j] != "SUBSTITUTION" { continue; }
    if let Some(&mi) = midx.get(&e_match[j]) {
        let e = by_tm.entry((s_id[mi], e_team[j])).or_insert((999,0));
        if e_min[j] < e.0 { e.0 = e_min[j]; }
        e.1 += 1;
    }
}
let buckets = [0i64,55,60,65,70,75,80,81,999]; // <55,55-59,...,75-79,80-80,>=81(no sub sentinel)
let blabels2 = ["no sub","<55","55-59","60-64","65-69","70-74","75-79","80+"];
let mut w = vec![0usize;8]; let mut d = vec![0usize;8]; let mut l = vec![0usize;8];
for (&(mid,tid),v) in &by_tm {
        let first = v.0;
    if let Some(&mi) = midx.get(&mid) {
        let (hg,ag,hid,aid) = (s_hg[mi],s_ag[mi],s_hid[mi],s_aid[mi]);
        let (gf,ga) = if tid==hid {(hg,ag)} else {(ag,hg)};
        let b = if first>=999 {0} else if first<55 {1} else if first<60 {2} else if first<65 {3} else if first<70 {4} else if first<75 {5} else if first<80 {6} else {7};
        let _ = buckets;
        if gf>ga {w[b]+=1} else if gf==ga {d[b]+=1} else {l[b]+=1}
    }
}
// add no-sub team-matches: all team-matches minus those with subs
let mut total_tm = 0usize;
for &i in &valid { total_tm += 2; }
let n_with = by_tm.len();
let n_without = total_tm - n_with;
// distribute no-sub as draws? no — need actual results; compute quickly
let mut nw=0usize; let mut nd=0usize; let mut nl=0usize;
{
    let mut with_set: std::collections::HashSet<(i64,i64)> = std::collections::HashSet::new();
    for k in by_tm.keys() { with_set.insert(*k); }
    for &i in &valid {
        for (tid,gf,ga) in [(s_hid[i],s_hg[i],s_ag[i]),(s_aid[i],s_ag[i],s_hg[i])] {
            if !with_set.contains(&(s_id[i],tid)) {
                if gf>ga {nw+=1} else if gf==ga {nd+=1} else {nl+=1}
            }
        }
    }
}
let tn = (nw+nd+nl) as f64;
w[0]=nw; d[0]=nd; l[0]=nl;
let _ = n_without;
let rows2: Vec<Vec<String>> = (0..8).map(|b| {
    let n = (w[b]+d[b]+l[b]) as f64;
    vec![blabels2[b].to_string(), (w[b]+d[b]+l[b]).to_string(),
         format!("{:.1}%",100.0*w[b] as f64/n.max(1.0)),
         format!("{:.1}%",100.0*d[b] as f64/n.max(1.0)),
         format!("{:.1}%",100.0*l[b] as f64/n.max(1.0))]
}).collect();
mars_table(&["first sub minute","n","win%","draw%","loss%"], &rows2);
```

| first sub minute | n      | win%  | draw% | loss% |
| ---------------- | ------ | ----- | ----- | ----- |
| no sub           | 618175 | 36.7% | 26.6% | 36.7% |
| <55              | 2257   | 28.4% | 19.9% | 51.7% |
| 55-59            | 1198   | 34.4% | 20.6% | 45.0% |
| 60-64            | 1622   | 41.5% | 21.5% | 37.1% |
| 65-69            | 1216   | 46.9% | 21.2% | 31.9% |
| 70-74            | 851    | 46.2% | 29.5% | 24.3% |
| 75-79            | 452    | 49.1% | 25.4% | 25.4% |
| 80+              | 273    | 54.6% | 27.5% | 17.9% |

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


let mut c_items: Vec<(String, f64)> = hrows.iter()
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
        .caption("Substitutions by minute bucket", ("sans-serif", 18))
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

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KU3Vic3RpdHV0aW9ucyBieSBtaW51dGUgYnVja2V0CjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcyIiB5MT0iMzQ0IiB4Mj0iNzIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODYiIHkxPSIzNDQiIHgyPSI4NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDAiIHkxPSIzNDQiIHgyPSIxMDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTE0IiB5MT0iMzQ0IiB4Mj0iMTE0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyOCIgeTE9IjM0NCIgeDI9IjEyOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDIiIHkxPSIzNDQiIHgyPSIxNDIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTU2IiB5MT0iMzQ0IiB4Mj0iMTU2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3MCIgeTE9IjM0NCIgeDI9IjE3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODQiIHkxPSIzNDQiIHgyPSIxODQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTk4IiB5MT0iMzQ0IiB4Mj0iMTk4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxMiIgeTE9IjM0NCIgeDI9IjIxMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMjYiIHkxPSIzNDQiIHgyPSIyMjYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjQxIiB5MT0iMzQ0IiB4Mj0iMjQxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI1NSIgeTE9IjM0NCIgeDI9IjI1NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNjkiIHkxPSIzNDQiIHgyPSIyNjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjgzIiB5MT0iMzQ0IiB4Mj0iMjgzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI5NyIgeTE9IjM0NCIgeDI9IjI5NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTEiIHkxPSIzNDQiIHgyPSIzMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI1IiB5MT0iMzQ0IiB4Mj0iMzI1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMzOSIgeTE9IjM0NCIgeDI9IjMzOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNTMiIHkxPSIzNDQiIHgyPSIzNTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzY3IiB5MT0iMzQ0IiB4Mj0iMzY3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4MSIgeTE9IjM0NCIgeDI9IjM4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTUiIHkxPSIzNDQiIHgyPSIzOTUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDA5IiB5MT0iMzQ0IiB4Mj0iNDA5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQyNCIgeTE9IjM0NCIgeDI9IjQyNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzgiIHkxPSIzNDQiIHgyPSI0MzgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDUyIiB5MT0iMzQ0IiB4Mj0iNDUyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2NiIgeTE9IjM0NCIgeDI9IjQ2NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0ODAiIHkxPSIzNDQiIHgyPSI0ODAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDk0IiB5MT0iMzQ0IiB4Mj0iNDk0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwOCIgeTE9IjM0NCIgeDI9IjUwOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjIiIHkxPSIzNDQiIHgyPSI1MjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTM2IiB5MT0iMzQ0IiB4Mj0iNTM2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1MCIgeTE9IjM0NCIgeDI9IjU1MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjQiIHkxPSIzNDQiIHgyPSI1NjQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTc4IiB5MT0iMzQ0IiB4Mj0iNTc4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5MyIgeTE9IjM0NCIgeDI9IjU5MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MDciIHkxPSIzNDQiIHgyPSI2MDciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjIxIiB5MT0iMzQ0IiB4Mj0iNjIxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYzNSIgeTE9IjM0NCIgeDI9IjYzNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NDkiIHkxPSIzNDQiIHgyPSI2NDkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjYzIiB5MT0iMzQ0IiB4Mj0iNjYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY3NyIgeTE9IjM0NCIgeDI9IjY3NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2OTEiIHkxPSIzNDQiIHgyPSI2OTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzA1IiB5MT0iMzQ0IiB4Mj0iNzA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcxOSIgeTE9IjM0NCIgeDI9IjcxOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MzMiIHkxPSIzNDQiIHgyPSI3MzMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzQ3IiB5MT0iMzQ0IiB4Mj0iNzQ3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijc2MSIgeTE9IjM0NCIgeDI9Ijc2MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0NCIgeDI9Ijc2OSIgeTI9IjM0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDEiIHgyPSI3NjkiIHkyPSIzNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzM3IiB4Mj0iNzY5IiB5Mj0iMzM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMzMyIgeDI9Ijc2OSIgeTI9IjMzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjkiIHgyPSI3NjkiIHkyPSIzMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzI1IiB4Mj0iNzY5IiB5Mj0iMzI1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMyMSIgeDI9Ijc2OSIgeTI9IjMyMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMTciIHgyPSI3NjkiIHkyPSIzMTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzEzIiB4Mj0iNzY5IiB5Mj0iMzEzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMwOSIgeDI9Ijc2OSIgeTI9IjMwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMDYiIHgyPSI3NjkiIHkyPSIzMDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzAyIiB4Mj0iNzY5IiB5Mj0iMzAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5OCIgeDI9Ijc2OSIgeTI9IjI5OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyOTQiIHgyPSI3NjkiIHkyPSIyOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjkwIiB4Mj0iNzY5IiB5Mj0iMjkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI4NiIgeDI9Ijc2OSIgeTI9IjI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyODIiIHgyPSI3NjkiIHkyPSIyODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjc4IiB4Mj0iNzY5IiB5Mj0iMjc4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI3NCIgeDI9Ijc2OSIgeTI9IjI3NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNzEiIHgyPSI3NjkiIHkyPSIyNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjY3IiB4Mj0iNzY5IiB5Mj0iMjY3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI2MyIgeDI9Ijc2OSIgeTI9IjI2MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNTkiIHgyPSI3NjkiIHkyPSIyNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjU1IiB4Mj0iNzY5IiB5Mj0iMjU1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI1MSIgeDI9Ijc2OSIgeTI9IjI1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNDciIHgyPSI3NjkiIHkyPSIyNDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjQzIiB4Mj0iNzY5IiB5Mj0iMjQzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzOSIgeDI9Ijc2OSIgeTI9IjIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzUiIHgyPSI3NjkiIHkyPSIyMzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjMyIiB4Mj0iNzY5IiB5Mj0iMjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIyOCIgeDI9Ijc2OSIgeTI9IjIyOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMjQiIHgyPSI3NjkiIHkyPSIyMjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjIwIiB4Mj0iNzY5IiB5Mj0iMjIwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIxNiIgeDI9Ijc2OSIgeTI9IjIxNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMTIiIHgyPSI3NjkiIHkyPSIyMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjA4IiB4Mj0iNzY5IiB5Mj0iMjA4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIwNCIgeDI9Ijc2OSIgeTI9IjIwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMDAiIHgyPSI3NjkiIHkyPSIyMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTk3IiB4Mj0iNzY5IiB5Mj0iMTk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE5MyIgeDI9Ijc2OSIgeTI9IjE5MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODkiIHgyPSI3NjkiIHkyPSIxODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTg1IiB4Mj0iNzY5IiB5Mj0iMTg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE4MSIgeDI9Ijc2OSIgeTI9IjE4MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNzciIHgyPSI3NjkiIHkyPSIxNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTczIiB4Mj0iNzY5IiB5Mj0iMTczIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE2OSIgeDI9Ijc2OSIgeTI9IjE2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNjUiIHgyPSI3NjkiIHkyPSIxNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTYxIiB4Mj0iNzY5IiB5Mj0iMTYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE1OCIgeDI9Ijc2OSIgeTI9IjE1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTQiIHgyPSI3NjkiIHkyPSIxNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTUwIiB4Mj0iNzY5IiB5Mj0iMTUwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE0NiIgeDI9Ijc2OSIgeTI9IjE0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNDIiIHgyPSI3NjkiIHkyPSIxNDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTM4IiB4Mj0iNzY5IiB5Mj0iMTM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEzNCIgeDI9Ijc2OSIgeTI9IjEzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzAiIHgyPSI3NjkiIHkyPSIxMzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTI2IiB4Mj0iNzY5IiB5Mj0iMTI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyMyIgeDI9Ijc2OSIgeTI9IjEyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMTkiIHgyPSI3NjkiIHkyPSIxMTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTE1IiB4Mj0iNzY5IiB5Mj0iMTE1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExMSIgeDI9Ijc2OSIgeTI9IjExMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMDciIHgyPSI3NjkiIHkyPSIxMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTAzIiB4Mj0iNzY5IiB5Mj0iMTAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijk5IiB4Mj0iNzY5IiB5Mj0iOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iOTUiIHgyPSI3NjkiIHkyPSI5NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI5MSIgeDI9Ijc2OSIgeTI9IjkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijg3IiB4Mj0iNzY5IiB5Mj0iODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iODQiIHgyPSI3NjkiIHkyPSI4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4MCIgeDI9Ijc2OSIgeTI9IjgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijc2IiB4Mj0iNzY5IiB5Mj0iNzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNzIiIHgyPSI3NjkiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI2OCIgeDI9Ijc2OSIgeTI9IjY4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjY0IiB4Mj0iNzY5IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNjAiIHgyPSI3NjkiIHkyPSI2MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI1NiIgeDI9Ijc2OSIgeTI9IjU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjUyIiB4Mj0iNzY5IiB5Mj0iNTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNDkiIHgyPSI3NjkiIHkyPSI0OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI0NSIgeDI9Ijc2OSIgeTI9IjQ1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQxIiB4Mj0iNzY5IiB5Mj0iNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzciIHgyPSI3NjkiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTAwIiB5MT0iMzQ0IiB4Mj0iMTAwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3MCIgeTE9IjM0NCIgeDI9IjE3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDEiIHkxPSIzNDQiIHgyPSIyNDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzExIiB5MT0iMzQ0IiB4Mj0iMzExIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4MSIgeTE9IjM0NCIgeDI9IjM4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTIiIHkxPSIzNDQiIHgyPSI0NTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTIyIiB5MT0iMzQ0IiB4Mj0iNTIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5MyIgeTE9IjM0NCIgeDI9IjU5MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NjMiIHkxPSIzNDQiIHgyPSI2NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzMzIiB5MT0iMzQ0IiB4Mj0iNzMzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzQ0IiB4Mj0iNzY5IiB5Mj0iMzQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMwNiIgeDI9Ijc2OSIgeTI9IjMwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNjciIHgyPSI3NjkiIHkyPSIyNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjI4IiB4Mj0iNzY5IiB5Mj0iMjI4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE4OSIgeDI9Ijc2OSIgeTI9IjE4OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTAiIHgyPSI3NjkiIHkyPSIxNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTExIiB4Mj0iNzY5IiB5Mj0iMTExIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjcyIiB4Mj0iNzY5IiB5Mj0iNzIiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY0LDM0IDY0LDM0NCAiLz4KPHRleHQgeD0iNTUiIHk9IjM0NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wawo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwzNDQgNjQsMzQ0ICIvPgo8dGV4dCB4PSI1NSIgeT0iMzA2IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjBrCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDMwNiA2NCwzMDYgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIyNjciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIuMGsKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMjY3IDY0LDI2NyAiLz4KPHRleHQgeD0iNTUiIHk9IjIyOCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMy4wawo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwyMjggNjQsMjI4ICIvPgo8dGV4dCB4PSI1NSIgeT0iMTg5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0LjBrCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDE4OSA2NCwxODkgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIxNTAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjUuMGsKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMTUwIDY0LDE1MCAiLz4KPHRleHQgeD0iNTUiIHk9IjExMSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNi4wawo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwxMTEgNjQsMTExICIvPgo8dGV4dCB4PSI1NSIgeT0iNzIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjcuMGsKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksNzIgNjQsNzIgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NSwzNDUgNzY5LDM0NSAiLz4KPHRleHQgeD0iMTAwIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo3MC03OQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxMDAsMzQ1IDEwMCwzNTAgIi8+Cjx0ZXh0IHg9IjE3MCIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNjAtNjkKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMTcwLDM0NSAxNzAsMzUwICIvPgo8dGV4dCB4PSIyNDEiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjgwLTg5CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjI0MSwzNDUgMjQxLDM1MCAiLz4KPHRleHQgeD0iMzExIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo1MC01OQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIzMTEsMzQ1IDMxMSwzNTAgIi8+Cjx0ZXh0IHg9IjM4MSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNDAtNDkKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzgxLDM0NSAzODEsMzUwICIvPgo8dGV4dCB4PSI0NTIiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjkwKwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0NTIsMzQ1IDQ1MiwzNTAgIi8+Cjx0ZXh0IHg9IjUyMiIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMzAtMzkKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTIyLDM0NSA1MjIsMzUwICIvPgo8dGV4dCB4PSI1OTMiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwLTI5CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5MywzNDUgNTkzLDM1MCAiLz4KPHRleHQgeD0iNjYzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMC0xOQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NjMsMzQ1IDY2MywzNTAgIi8+Cjx0ZXh0IHg9IjczMyIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC05CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjczMywzNDUgNzMzLDM1MCAiLz4KPHJlY3QgeD0iNzUiIHk9Ijc1IiB3aWR0aD0iNDkiIGhlaWdodD0iMjY5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTQ1IiB5PSI5OSIgd2lkdGg9IjUwIiBoZWlnaHQ9IjI0NSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjIxNiIgeT0iMTI5IiB3aWR0aD0iNDkiIGhlaWdodD0iMjE1IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjg2IiB5PSIyNDIiIHdpZHRoPSI1MCIgaGVpZ2h0PSIxMDIiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzNTciIHk9IjI2MiIgd2lkdGg9IjQ5IiBoZWlnaHQ9IjgyIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDI3IiB5PSIzMDQiIHdpZHRoPSI0OSIgaGVpZ2h0PSI0MCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ5NyIgeT0iMzQxIiB3aWR0aD0iNTAiIGhlaWdodD0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjU2OCIgeT0iMzQzIiB3aWR0aD0iNDkiIGhlaWdodD0iMSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYzOCIgeT0iMzQzIiB3aWR0aD0iNTAiIGhlaWdodD0iMSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjcwOSIgeT0iMzQ0IiB3aWR0aD0iNDkiIGhlaWdodD0iMCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+Cjwvc3ZnPg==)

## Discussion

**When do managers sub? Late — and mostly when they're already losing.**

1. **Subs live in the final half hour.** Across 24,726 substitution events, 75%
   arrive between minutes 60 and 89, peaking at 70–79 (28%). First-half subs are
   rare — under 10% happen before minute 50.

2. **The five-sub era is visible but coverage-limited.** Sub event data exists
   only for StatsBomb-covered competitions (~4,000 matches, concentrated in
   recent seasons): 2023/24 shows ~0.9 subs per team-match and 44% of matches
   with at least one sub — consistent with the five-sub rule. Earlier seasons
   show near-zero coverage, not near-zero subs — the event importer simply
   doesn't reach them.

3. **First-sub timing tracks the scoreline, not the result.** Among team-matches
   with substitution data, teams whose first sub came before minute 55 lost
   **51.7%** of the time; teams holding out until 80+ won **54.6%**. The
   gradient is monotone-ish — but this is the reactive signature: trailing teams
   sub early _because_ they're trailing. With no score-state data we cannot
   separate "early subs cause losses" from "losing causes early subs" — and the
   honest answer is almost certainly the latter.

4. **What we can't see:** who was subbed _off_ (the event's player is the player
   coming on), whether the sub changed the result, and sub patterns for ~97% of
   all matches in the dataset. This is a proof of concept on a small window, not
   a league-wide law.

**Verdict:** substitutions are football's most reactive stat — they measure
desperation more than tactics. The timing curve (peak 70–79) is real; the
win/loss gradient is a mirror of the scoreboard, not a lever on it.

**Limitations.** The analysis is limited to the competitions present in the
database; player-level metrics exist only for StatsBomb-covered tournaments, and
underlying event data may contain errors.

## Conclusion

When do managers sub? Late — and mostly when they're already losing. Together
these results answer the research question posed in the Introduction and
quantify the pattern across 4,000 matches. The notebook provides a fully
reproducible pipeline from raw CSV extracts to published figures.
