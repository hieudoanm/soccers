---
title: 'Does the first half of the season predict the final table?'
description: |
  '897 league-seasons split at the median fixture date: the mid-season leader wins the title 57% of the time, and the halfway table correlates with the final at rho=0.87 in the Premier League.'
author: 'hieudoan'
date: '2026-11-26T20:00'
order: 44
tags: ['football', 'analysis', 'standings', 'mars', 'sqlite']
---

# Does the first half of the season predict the final table?

## Abstract

Does the first half of the season predict the final table? This study answers it
using 897 team-seasons drawn from the Soccers football database. Yes —
emphatically. The team leading after half the fixtures wins the title 57% of the
time, and the mid-season table predicts the final one at ρ≈0.87 in the Premier
League. All computation runs in Rust inside a `.mars` notebook (polars +
plotters — charts as inline SVG), and every table and figure is generated from
the extracted CSVs.

## Keywords

**Keywords:** football, analysis, standings, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [By league: which tables are most predictable?](#by-league-which-tables-are-most-predictable)
  - [The climbers and the collapsers](#the-climbers-and-the-collapsers)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

The oldest question in football analysis: **is the table at Christmas real, or
does it lie?** This notebook splits every league-season at its midpoint — first
half of fixtures vs second half — rebuilds both tables, and measures how well
the mid-season table predicts the finish.

Metrics per league-season (≥8 teams, ≥40 matches):

- **Spearman rank correlation** between mid-season and final position
- **Top-4 retention**: % of mid-table top-4 finishing top-4
- **Bottom-3 retention**: % of mid-table bottom-3 finishing bottom-3
- **Title accuracy**: % of mid-table leaders winning the league

Then the fun part: the biggest risers and fallers between the two tables.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `matches_full`.

The analysis runs entirely in Rust inside the notebook: **polars** handles table
scans, joins and aggregations; **plotters** renders figures as inline SVG;
`mars_table` renders result tables.

Statistical summaries include Pearson correlations, medians and percentiles.

Each code cell is kept to a single output so results can be read top to bottom.

## Results

All figures and tables below are computed directly from the extracted data. Each
code cell produces one output — a table, a chart, or a short text summary.

```rust

use polars::prelude::*;
use std::collections::HashMap;
use std::collections::HashSet;

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
let s_hg = col_i64(&mf, "hg");
let s_ag = col_i64(&mf, "ag");
let s_country = col_str(&mf, "country");
let s_league = col_str(&mf, "league");
let s_season = col_str(&mf, "season");
let s_date = col_str(&mf, "date");
let s_home_raw = col_str(&mf, "home");
let s_away_raw = col_str(&mf, "away");

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






// canonical team names (football-data style) — collapses name-variant dupes
let s_home: Vec<String> = s_home_raw.iter().map(|n| canon(n).to_string()).collect();
let s_away: Vec<String> = s_away_raw.iter().map(|n| canon(n).to_string()).collect();

// synthetic team ids keyed by (country|league|canonical name) so variants
// of the same club share one id within a competition
let mut tid_map: HashMap<String, i64> = HashMap::new();
let mut s_hid = vec![-1i64; mf.height()];
let mut s_aid = vec![-1i64; mf.height()];
for i in 0..mf.height() {
    for (nm, is_home) in [(&s_home[i], true), (&s_away[i], false)] {
        let key = format!("{}|{}|{}", s_country[i], s_league[i], nm);
        let next = tid_map.len() as i64;
        let id = *tid_map.entry(key).or_insert(next);
        if is_home { s_hid[i] = id; } else { s_aid[i] = id; }
    }
}

// dedup fixtures: same league-season, canonical pairing, date and score
// appears twice when two importers used different name variants
let mut seen: HashSet<(String, String, String, String, String, String, i64, i64)> = HashSet::new();
let mut valid: Vec<usize> = Vec::new();
let mut n_dupes = 0usize;
for i in 0..mf.height() {
    if s_hg[i] < 0 || s_ag[i] < 0 { continue; }
    let key = (s_country[i].clone(), s_league[i].clone(), s_season[i].clone(),
               s_home[i].clone(), s_away[i].clone(), s_date[i][..10].to_string(), s_hg[i], s_ag[i]);
    // unordered pairing: canonical order home<away not guaranteed; use both directions check
    if seen.contains(&key) || seen.contains(&(key.0.clone(), key.1.clone(), key.2.clone(), key.4.clone(), key.3.clone(), key.5.clone(), key.6, key.7)) {
        n_dupes += 1; continue;
    }
    seen.insert(key);
    valid.push(i);
}
println!("completed matches after dedup: {} ({} dupes dropped)", valid.len(), n_dupes);

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

let mut groups: HashMap<(String,String), Vec<usize>> = HashMap::new();
for &i in &valid { groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i); }

// for each lgsn: split matches into first/second half by date order
struct HalfRes { lg:String, sn:String, n_teams:usize, spear:f64, top4_kept:usize, top4_tot:usize, bot3_kept:usize, bot3_tot:usize, leader_won:bool, mid_leader:String, champ:String }
let mut results: Vec<HalfRes> = Vec::new();

for ((lg,sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a,&b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    // unique dates -> midpoint
    let mut dates: Vec<String> = sorted_idx.iter().map(|&i| s_date[i][..10].to_string()).collect();
    dates.sort(); dates.dedup();
    if dates.len() < 10 { continue; }
    let mid_date = dates[dates.len()/2].clone();
    let first: Vec<usize> = sorted_idx.iter().cloned().filter(|&i| &s_date[i][..10] <= mid_date.as_str()).collect();
    let second: Vec<usize> = sorted_idx.iter().cloned().filter(|&i| &s_date[i][..10] > mid_date.as_str()).collect();
    if first.len() < 20 || second.len() < 20 { continue; }

    // mid table
    let (mid_table, mid_names, _) = replay_lgsn(&first, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    let (fin_table, fin_names, _) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    let n = mid_table.len();
    if n < 8 || fin_table.len() != n { continue; }

    // mid rank per tid; final rank per tid
    let mut mid_rank: HashMap<i64,usize> = HashMap::new();
    for (pos,t) in mid_table.iter().enumerate() { mid_rank.insert(t.0, pos+1); }
    let mut fin_rank: HashMap<i64,usize> = HashMap::new();
    for (pos,t) in fin_table.iter().enumerate() { fin_rank.insert(t.0, pos+1); }

    // spearman: pearson on ranks (only teams present in both)
    let mut xs = Vec::new(); let mut ys = Vec::new();
    for (&tid,&mr) in &mid_rank {
        if let Some(&fr) = fin_rank.get(&tid) { xs.push(mr as f64); ys.push(fr as f64); }
    }
    let spear = pearson(&xs,&ys);

    // top4 retention
    let mut t4k=0; let mut t4t=0;
    for (pos,t) in mid_table.iter().enumerate().take(4) {
        if let Some(&fr) = fin_rank.get(&t.0) { t4t+=1; if fr<=4 {t4k+=1;} }
    }
    let mut b3k=0; let mut b3t=0;
    for (pos,t) in mid_table.iter().enumerate().skip(n.saturating_sub(3)) {
        if let Some(&fr) = fin_rank.get(&t.0) { b3t+=1; if fr>n-3 {b3k+=1;} }
    }
    let mid_leader = mid_names.get(&mid_table[0].0).cloned().unwrap_or_default();
    let champ = fin_names.get(&fin_table[0].0).cloned().unwrap_or_default();
    results.push(HalfRes{lg:lg.clone(),sn:sn.clone(),n_teams:n,spear,top4_kept:t4k,top4_tot:t4t,bot3_kept:b3k,bot3_tot:b3t,leader_won: mid_table[0].0==fin_table[0].0, mid_leader, champ});
}

println!("league-seasons analysed: {}", results.len());
let spears: Vec<f64> = results.iter().map(|r| r.spear).collect();
let mean_spear = spears.iter().sum::<f64>()/spears.len() as f64;
let mut sorted_s = spears.clone(); sorted_s.sort_by(|a,b| a.partial_cmp(b).unwrap());
let median_spear = sorted_s[sorted_s.len()/2];
let t4k: usize = results.iter().map(|r| r.top4_kept).sum();
let t4t: usize = results.iter().map(|r| r.top4_tot).sum();
let b3k: usize = results.iter().map(|r| r.bot3_kept).sum();
let b3t: usize = results.iter().map(|r| r.bot3_tot).sum();
let lw = results.iter().filter(|r| r.leader_won).count();
println!("mean Spearman(mid,final) = {:.3} | median = {:.3}", mean_spear, median_spear);
println!("mid top-4 -> final top-4: {}/{} = {:.0}%", t4k, t4t, 100.0*t4k as f64/t4t.max(1) as f64);
println!("mid bottom-3 -> final bottom-3: {}/{} = {:.0}%", b3k, b3t, 100.0*b3k as f64/b3t.max(1) as f64);
println!("mid leader wins title: {}/{} = {:.0}%", lw, results.len(), 100.0*lw as f64/results.len() as f64);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
league-seasons analysed: 897
mean Spearman(mid,final) = 0.838 | median = 0.857
mid top-4 -> final top-4: 2701/3588 = 75%
mid bottom-3 -> final bottom-3: 1746/2691 = 65%
mid leader wins title: 510/897 = 57%
```

### By league: which tables are most predictable?

Not all leagues are equally chaotic — a dominant league produces stable tables,
a parity league produces coin flips. Rank the leagues by their average
mid-season correlation.

```rust

// per-league mean spearman + counts — recompute compactly using stored results? results persists in kernel
// group results by league name
let mut by_lg: HashMap<String, Vec<f64>> = HashMap::new();
for r in &results { by_lg.entry(r.lg.clone()).or_default().push(r.spear); }
let mut lrows: Vec<Vec<String>> = by_lg.iter().filter(|(_,v)| v.len()>=3).map(|(l,v)| {
    let mean = v.iter().sum::<f64>()/v.len() as f64;
    let mut s=v.clone(); s.sort_by(|a,b| a.partial_cmp(b).unwrap());
    vec![l.split('|').nth(1).unwrap_or("").to_string(), v.len().to_string(),
         format!("{:.3}", mean), format!("{:.3}", s[s.len()/2])]
}).collect();
lrows.sort_by(|a,b| b[2].parse::<f64>().unwrap().partial_cmp(&a[2].parse::<f64>().unwrap()).unwrap());
mars_table(&["league","seasons","mean ρ","median ρ"], &lrows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
league-seasons analysed: 897
mean Spearman(mid,final) = 0.838 | median = 0.856
mid top-4 -> final top-4: 2702/3588 = 75%
mid bottom-3 -> final bottom-3: 1744/2691 = 65%
mid leader wins title: 510/897 = 57%
```

| league                      | seasons | mean ρ | median ρ |
| --------------------------- | ------- | ------ | -------- |
| Champions League            | 22      | 0.928  | 0.940    |
| FA Women's Super League     | 4       | 0.928  | 0.930    |
| UEFA Conference League      | 5       | 0.916  | 0.927    |
| UEFA Europa League          | 6       | 0.904  | 0.944    |
| AFC Champions League Elite  | 3       | 0.897  | 0.922    |
| Eliteserien                 | 3       | 0.893  | 0.894    |
| Italian Serie A             | 34      | 0.889  | 0.899    |
| Scottish Premiership        | 33      | 0.884  | 0.902    |
| Dutch Eredivisie            | 34      | 0.879  | 0.891    |
| Scottish Championship       | 34      | 0.871  | 0.879    |
| English Premier League      | 34      | 0.868  | 0.884    |
| Greek Super League          | 28      | 0.863  | 0.886    |
| J1 League                   | 12      | 0.861  | 0.872    |
| Belgian Pro League          | 32      | 0.860  | 0.870    |
| Super League                | 11      | 0.859  | 0.886    |
| Portuguese Liga Portugal    | 34      | 0.854  | 0.868    |
| Premier League              | 4       | 0.850  | 0.888    |
| German Bundesliga           | 34      | 0.849  | 0.878    |
| Scottish League Two         | 30      | 0.842  | 0.867    |
| English League Two          | 34      | 0.838  | 0.837    |
| Spanish La Liga             | 34      | 0.837  | 0.848    |
| Turkish Süper Lig           | 33      | 0.837  | 0.870    |
| Allsvenskan                 | 3       | 0.835  | 0.838    |
| French Ligue 1              | 34      | 0.833  | 0.836    |
| Superliga                   | 5       | 0.833  | 0.871    |
| English League One          | 34      | 0.829  | 0.837    |
| Bundesliga                  | 13      | 0.828  | 0.846    |
| Serie A                     | 15      | 0.823  | 0.848    |
| Italian Serie B             | 30      | 0.818  | 0.839    |
| Scottish League One         | 30      | 0.816  | 0.867    |
| Veikkausliiga               | 5       | 0.806  | 0.832    |
| German 2. Bundesliga        | 34      | 0.805  | 0.812    |
| Liga MX                     | 15      | 0.805  | 0.804    |
| English Championship        | 34      | 0.801  | 0.817    |
| Liga Profesional            | 14      | 0.797  | 0.812    |
| Superliga                   | 12      | 0.794  | 0.853    |
| Spanish La Liga 2           | 34      | 0.792  | 0.792    |
| French Ligue 2              | 31      | 0.785  | 0.815    |
| MLS                         | 15      | 0.751  | 0.753    |
| Copa De La Liga Profesional | 5       | 0.741  | 0.795    |
| Super League                | 10      | 0.740  | 0.709    |
| Ekstraklasa                 | 14      | 0.727  | 0.721    |

### The climbers and the collapsers

The biggest rank swings between the mid-season and final table — teams that
proved the halfway table wrong in both directions.

```rust
// biggest rank changes mid->final across all lgsns
struct Swing { lg:String, sn:String, team:String, mid:usize, fin:usize, delta:i64 }
let mut swings: Vec<Swing> = Vec::new();
for ((lg,sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a,&b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    let mut dates: Vec<String> = sorted_idx.iter().map(|&i| s_date[i][..10].to_string()).collect();
    dates.sort(); dates.dedup();
    if dates.len() < 10 { continue; }
    let mid_date = dates[dates.len()/2].clone();
    let first: Vec<usize> = sorted_idx.iter().cloned().filter(|&i| &s_date[i][..10] <= mid_date.as_str()).collect();
    let (mid_table, mid_names, _) = replay_lgsn(&first, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    let (fin_table, _fn, _) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    if mid_table.len() != fin_table.len() || mid_table.len() < 8 { continue; }
    let mut mid_rank: HashMap<i64,usize> = HashMap::new();
    for (pos,t) in mid_table.iter().enumerate() { mid_rank.insert(t.0,pos+1); }
    let mut fin_rank: HashMap<i64,usize> = HashMap::new();
    for (pos,t) in fin_table.iter().enumerate() { fin_rank.insert(t.0,pos+1); }
    for (&tid,&mr) in &mid_rank {
        if let Some(&fr) = fin_rank.get(&tid) {
            let d = fr as i64 - mr as i64;
            if d.abs() >= 4 {
                swings.push(Swing{lg:lg.clone(),sn:sn.clone(),team:mid_names.get(&tid).cloned().unwrap_or_default(),mid:mr,fin:fr,delta:d});
            }
        }
    }
}
// biggest risers (delta negative = moved up) and fallers
let mut risers: Vec<&Swing> = swings.iter().collect(); risers.sort_by(|a,b| a.delta.cmp(&b.delta));
let rrows: Vec<Vec<String>> = risers.iter().take(20).map(|s| vec![
    s.lg.split('|').nth(1).unwrap_or("").to_string(), s.sn.clone(), s.team.clone(),
    format!("P{}", s.mid), format!("P{}", s.fin), format!("{:+}", -s.delta),
]).collect();
mars_table(&["league","season","team","mid pos","final pos","places up"], &rrows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
league-seasons analysed: 897
mean Spearman(mid,final) = 0.838 | median = 0.857
mid top-4 -> final top-4: 2701/3588 = 75%
mid bottom-3 -> final bottom-3: 1745/2691 = 65%
mid leader wins title: 510/897 = 57%
```

| league                 | season    | team           | mid pos | final pos | places up |
| ---------------------- | --------- | -------------- | ------- | --------- | --------- |
| Champions League       | 2019/2020 | Atalanta       | P79     | P17       | +62       |
| Champions League       | 2018/2019 | Tottenham      | P44     | P5        | +39       |
| Champions League       | 2019/2020 | Leverkusen     | P76     | P40       | +36       |
| Champions League       | 2008/2009 | FC Porto       | P48     | P16       | +32       |
| Champions League       | 2016/2017 | Dynamo Kyiv    | P69     | P37       | +32       |
| UEFA Europa League     | 2020/2021 | Man United     | P39     | P8        | +31       |
| Champions League       | 2005/2006 | Benfica        | P42     | P11       | +31       |
| Champions League       | 2012/2013 | Galatasaray    | P40     | P10       | +30       |
| Champions League       | 2005/2006 | AC Milan       | P37     | P7        | +30       |
| Champions League       | 2018/2019 | Liverpool      | P32     | P3        | +29       |
| Champions League       | 2011/2012 | FC Basel       | P41     | P12       | +29       |
| Champions League       | 2005/2006 | Olympiacos     | P74     | P45       | +29       |
| Champions League       | 2015/2016 | Arsenal        | P57     | P29       | +28       |
| UEFA Conference League | 2023/2024 | Olympiacos     | P32     | P4        | +28       |
| Champions League       | 2015/2016 | VfL Wolfsburg  | P33     | P6        | +27       |
| Champions League       | 2014/2015 | Juventus       | P32     | P5        | +27       |
| Champions League       | 2018/2019 | Man City       | P30     | P4        | +26       |
| Champions League       | 2018/2019 | Viktoria Plzen | P67     | P41       | +26       |
| Champions League       | 2011/2012 | Napoli         | P37     | P11       | +26       |
| Champions League       | 2008/2009 | Celtic         | P65     | P39       | +26       |

```rust
let mut fallers: Vec<&Swing> = swings.iter().collect(); fallers.sort_by(|a,b| b.delta.cmp(&a.delta));
let frows: Vec<Vec<String>> = fallers.iter().take(20).map(|s| vec![
    s.lg.split('|').nth(1).unwrap_or("").to_string(), s.sn.clone(), s.team.clone(),
    format!("P{}", s.mid), format!("P{}", s.fin), format!("{:+}", s.delta),
]).collect();
mars_table(&["league","season","team","mid pos","final pos","places down"], &frows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
league-seasons analysed: 897
mean Spearman(mid,final) = 0.838 | median = 0.857
mid top-4 -> final top-4: 2701/3588 = 75%
mid bottom-3 -> final bottom-3: 1743/2691 = 65%
mid leader wins title: 510/897 = 57%
```

| league                      | season    | team                 | mid pos | final pos | places down |
| --------------------------- | --------- | -------------------- | ------- | --------- | ----------- |
| Copa De La Liga Profesional | 2023      | Defensa y Justicia   | P8      | P24       | +16         |
| Champions League            | 2017/2018 | Olympiacos           | P10     | P25       | +15         |
| English Championship        | 2022/23   | QPR                  | P6      | P21       | +15         |
| Champions League            | 2019/2020 | Apoel Nicosia        | P11     | P26       | +15         |
| English Championship        | 2002/03   | Coventry             | P6      | P20       | +14         |
| Champions League            | 2012/2013 | Hapoel Kiryat Shmona | P11     | P25       | +14         |
| Champions League            | 2012/2013 | Helsingborg          | P12     | P26       | +14         |
| Champions League            | 2018/2019 | Celtic               | P5      | P19       | +14         |
| Champions League            | 2018/2019 | PAOK                 | P6      | P20       | +14         |
| Champions League            | 2018/2019 | Dinamo Zagreb        | P4      | P18       | +14         |
| Champions League            | 2018/2019 | AEK Athens           | P21     | P35       | +14         |
| Champions League            | 2018/2019 | Ludogorets Razgrad   | P22     | P36       | +14         |
| Champions League            | 2007/2008 | Dinamo Zagreb        | P13     | P27       | +14         |
| UEFA Europa League          | 2024/2025 | Galatasaray          | P5      | P19       | +14         |
| UEFA Europa League          | 2024/2025 | Anderlecht           | P3      | P17       | +14         |
| English Championship        | 2019/20   | Sheffield Weds       | P3      | P17       | +14         |
| Champions League            | 2017/2018 | Hapoel Be'er         | P8      | P22       | +14         |
| Champions League            | 2017/2018 | FC Astana            | P12     | P26       | +14         |
| Champions League            | 2017/2018 | FK Qarabag           | P3      | P17       | +14         |
| Champions League            | 2017/2018 | Legia Warsaw         | P13     | P27       | +14         |

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


let mut c_items: Vec<(String, f64)> = rrows.iter()
    .map(|r| (format!("{} {}", r[2], r[0]), chart_num(&r[5].clone())))
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
        .caption("Biggest mid-season risers — places gained", ("sans-serif", 18))
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

```text
completed matches after dedup: 311832 (1190 dupes dropped)
league-seasons analysed: 897
mean Spearman(mid,final) = 0.838 | median = 0.857
mid top-4 -> final top-4: 2701/3588 = 75%
mid bottom-3 -> final bottom-3: 1745/2691 = 65%
mid leader wins title: 511/897 = 57%
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQmlnZ2VzdCBtaWQtc2Vhc29uIHJpc2VycyDigJQgcGxhY2VzIGdhaW5lZAo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MCIgeTE9IjM0NCIgeDI9IjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iMzQ0IiB4Mj0iODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTQiIHkxPSIzNDQiIHgyPSI5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDYiIHkxPSIzNDQiIHgyPSIxMDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTE3IiB5MT0iMzQ0IiB4Mj0iMTE3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyOSIgeTE9IjM0NCIgeDI9IjEyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDEiIHkxPSIzNDQiIHgyPSIxNDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzQ0IiB4Mj0iMTUzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2NCIgeTE9IjM0NCIgeDI9IjE2NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNzYiIHkxPSIzNDQiIHgyPSIxNzYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTg4IiB5MT0iMzQ0IiB4Mj0iMTg4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5OSIgeTE9IjM0NCIgeDI9IjE5OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTEiIHkxPSIzNDQiIHgyPSIyMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIzIiB5MT0iMzQ0IiB4Mj0iMjIzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzNSIgeTE9IjM0NCIgeDI9IjIzNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDYiIHkxPSIzNDQiIHgyPSIyNDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU4IiB5MT0iMzQ0IiB4Mj0iMjU4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3MCIgeTE9IjM0NCIgeDI9IjI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyODIiIHkxPSIzNDQiIHgyPSIyODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjkzIiB5MT0iMzQ0IiB4Mj0iMjkzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwNSIgeTE9IjM0NCIgeDI9IjMwNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTciIHkxPSIzNDQiIHgyPSIzMTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI5IiB5MT0iMzQ0IiB4Mj0iMzI5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM0MCIgeTE9IjM0NCIgeDI9IjM0MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNTIiIHkxPSIzNDQiIHgyPSIzNTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzY0IiB5MT0iMzQ0IiB4Mj0iMzY0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM3NSIgeTE9IjM0NCIgeDI9IjM3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODciIHkxPSIzNDQiIHgyPSIzODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzk5IiB5MT0iMzQ0IiB4Mj0iMzk5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQxMSIgeTE9IjM0NCIgeDI9IjQxMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MjIiIHkxPSIzNDQiIHgyPSI0MjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDM0IiB5MT0iMzQ0IiB4Mj0iNDM0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0NiIgeTE9IjM0NCIgeDI9IjQ0NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTgiIHkxPSIzNDQiIHgyPSI0NTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDY5IiB5MT0iMzQ0IiB4Mj0iNDY5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4MSIgeTE9IjM0NCIgeDI9IjQ4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTMiIHkxPSIzNDQiIHgyPSI0OTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA1IiB5MT0iMzQ0IiB4Mj0iNTA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxNiIgeTE9IjM0NCIgeDI9IjUxNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjgiIHkxPSIzNDQiIHgyPSI1MjgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQwIiB5MT0iMzQ0IiB4Mj0iNTQwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1MSIgeTE9IjM0NCIgeDI9IjU1MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjMiIHkxPSIzNDQiIHgyPSI1NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTc1IiB5MT0iMzQ0IiB4Mj0iNTc1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU4NyIgeTE9IjM0NCIgeDI9IjU4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1OTgiIHkxPSIzNDQiIHgyPSI1OTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjEwIiB5MT0iMzQ0IiB4Mj0iNjEwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyMiIgeTE9IjM0NCIgeDI9IjYyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MzQiIHkxPSIzNDQiIHgyPSI2MzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQ1IiB5MT0iMzQ0IiB4Mj0iNjQ1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1NyIgeTE9IjM0NCIgeDI9IjY1NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NjkiIHkxPSIzNDQiIHgyPSI2NjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgxIiB5MT0iMzQ0IiB4Mj0iNjgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY5MiIgeTE9IjM0NCIgeDI9IjY5MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MDQiIHkxPSIzNDQiIHgyPSI3MDQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzE2IiB5MT0iMzQ0IiB4Mj0iNzE2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcyNyIgeTE9IjM0NCIgeDI9IjcyNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MzkiIHkxPSIzNDQiIHgyPSI3MzkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzUxIiB5MT0iMzQ0IiB4Mj0iNzUxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijc2MyIgeTE9IjM0NCIgeDI9Ijc2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0NCIgeDI9Ijc2OSIgeTI9IjM0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDAiIHgyPSI3NjkiIHkyPSIzNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzM2IiB4Mj0iNzY5IiB5Mj0iMzM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMzMSIgeDI9Ijc2OSIgeTI9IjMzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjciIHgyPSI3NjkiIHkyPSIzMjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzIzIiB4Mj0iNzY5IiB5Mj0iMzIzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMxOCIgeDI9Ijc2OSIgeTI9IjMxOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMTQiIHgyPSI3NjkiIHkyPSIzMTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzEwIiB4Mj0iNzY5IiB5Mj0iMzEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMwNSIgeDI9Ijc2OSIgeTI9IjMwNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMDEiIHgyPSI3NjkiIHkyPSIzMDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjk3IiB4Mj0iNzY5IiB5Mj0iMjk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5MiIgeDI9Ijc2OSIgeTI9IjI5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyODgiIHgyPSI3NjkiIHkyPSIyODgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjg0IiB4Mj0iNzY5IiB5Mj0iMjg0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI3OSIgeDI9Ijc2OSIgeTI9IjI3OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNzUiIHgyPSI3NjkiIHkyPSIyNzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjcxIiB4Mj0iNzY5IiB5Mj0iMjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI2NiIgeDI9Ijc2OSIgeTI9IjI2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNjIiIHgyPSI3NjkiIHkyPSIyNjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjU4IiB4Mj0iNzY5IiB5Mj0iMjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI1MyIgeDI9Ijc2OSIgeTI9IjI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNDkiIHgyPSI3NjkiIHkyPSIyNDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjQ0IiB4Mj0iNzY5IiB5Mj0iMjQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI0MCIgeDI9Ijc2OSIgeTI9IjI0MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzYiIHgyPSI3NjkiIHkyPSIyMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjMxIiB4Mj0iNzY5IiB5Mj0iMjMxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIyNyIgeDI9Ijc2OSIgeTI9IjIyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMjMiIHgyPSI3NjkiIHkyPSIyMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjE4IiB4Mj0iNzY5IiB5Mj0iMjE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIxNCIgeDI9Ijc2OSIgeTI9IjIxNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMTAiIHgyPSI3NjkiIHkyPSIyMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjA1IiB4Mj0iNzY5IiB5Mj0iMjA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIwMSIgeDI9Ijc2OSIgeTI9IjIwMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxOTciIHgyPSI3NjkiIHkyPSIxOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTkyIiB4Mj0iNzY5IiB5Mj0iMTkyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE4OCIgeDI9Ijc2OSIgeTI9IjE4OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODQiIHgyPSI3NjkiIHkyPSIxODQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTc5IiB4Mj0iNzY5IiB5Mj0iMTc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE3NSIgeDI9Ijc2OSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNzEiIHgyPSI3NjkiIHkyPSIxNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTY2IiB4Mj0iNzY5IiB5Mj0iMTY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE2MiIgeDI9Ijc2OSIgeTI9IjE2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTgiIHgyPSI3NjkiIHkyPSIxNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTUzIiB4Mj0iNzY5IiB5Mj0iMTUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE0OSIgeDI9Ijc2OSIgeTI9IjE0OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNDQiIHgyPSI3NjkiIHkyPSIxNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTQwIiB4Mj0iNzY5IiB5Mj0iMTQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEzNiIgeDI9Ijc2OSIgeTI9IjEzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzEiIHgyPSI3NjkiIHkyPSIxMzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTI3IiB4Mj0iNzY5IiB5Mj0iMTI3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyMyIgeDI9Ijc2OSIgeTI9IjEyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMTgiIHgyPSI3NjkiIHkyPSIxMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTE0IiB4Mj0iNzY5IiB5Mj0iMTE0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExMCIgeDI9Ijc2OSIgeTI9IjExMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMDUiIHgyPSI3NjkiIHkyPSIxMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTAxIiB4Mj0iNzY5IiB5Mj0iMTAxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijk3IiB4Mj0iNzY5IiB5Mj0iOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iOTIiIHgyPSI3NjkiIHkyPSI5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4OCIgeDI9Ijc2OSIgeTI9Ijg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijg0IiB4Mj0iNzY5IiB5Mj0iODQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNzkiIHgyPSI3NjkiIHkyPSI3OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI3NSIgeDI9Ijc2OSIgeTI9Ijc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjcxIiB4Mj0iNzY5IiB5Mj0iNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNjYiIHgyPSI3NjkiIHkyPSI2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI2MiIgeDI9Ijc2OSIgeTI9IjYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjU4IiB4Mj0iNzY5IiB5Mj0iNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNTMiIHgyPSI3NjkiIHkyPSI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI0OSIgeDI9Ijc2OSIgeTI9IjQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQ0IiB4Mj0iNzY5IiB5Mj0iNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNDAiIHgyPSI3NjkiIHkyPSI0MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNiIgeDI9Ijc2OSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NCIgeTE9IjM0NCIgeDI9Ijk0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM0NCIgeDI9IjE1MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTEiIHkxPSIzNDQiIHgyPSIyMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjcwIiB5MT0iMzQ0IiB4Mj0iMjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyOSIgeTE9IjM0NCIgeDI9IjMyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODciIHkxPSIzNDQiIHgyPSIzODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDQ2IiB5MT0iMzQ0IiB4Mj0iNDQ2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwNSIgeTE9IjM0NCIgeDI9IjUwNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjMiIHkxPSIzNDQiIHgyPSI1NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjIyIiB5MT0iMzQ0IiB4Mj0iNjIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjM0NCIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MzkiIHkxPSIzNDQiIHgyPSI3MzkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDQiIHgyPSI3NjkiIHkyPSIzNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzAxIiB4Mj0iNzY5IiB5Mj0iMzAxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI1OCIgeDI9Ijc2OSIgeTI9IjI1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMTQiIHgyPSI3NjkiIHkyPSIyMTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTcxIiB4Mj0iNzY5IiB5Mj0iMTcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyNyIgeDI9Ijc2OSIgeTI9IjEyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4NCIgeDI9Ijc2OSIgeTI9Ijg0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQwIiB4Mj0iNzY5IiB5Mj0iNDAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY0LDM0IDY0LDM0NCAiLz4KPHRleHQgeD0iNTUiIHk9IjM0NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDM0NCA2NCwzNDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIzMDEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMzAxIDY0LDMwMSAiLz4KPHRleHQgeD0iNTUiIHk9IjI1OCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwyNTggNjQsMjU4ICIvPgo8dGV4dCB4PSI1NSIgeT0iMjE0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDIxNCA2NCwyMTQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIxNzEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjQwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMTcxIDY0LDE3MSAiLz4KPHRleHQgeD0iNTUiIHk9IjEyNyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwxMjcgNjQsMTI3ICIvPgo8dGV4dCB4PSI1NSIgeT0iODQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksODQgNjQsODQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSI0MCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNzAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSw0MCA2NCw0MCAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY1LDM0NSA3NjksMzQ1ICIvPgo8dGV4dCB4PSI5NCIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQXRhbGFudGEgQ2hhbXBpb25zCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijk0LDM0NSA5NCwzNTAgIi8+Cjx0ZXh0IHg9IjE1MyIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KVG90dGVuaGFtIENoYW1waW9uCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1MywzNDUgMTUzLDM1MCAiLz4KPHRleHQgeD0iMjExIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMZXZlcmt1c2VuIENoYW1waW8KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjExLDM0NSAyMTEsMzUwICIvPgo8dGV4dCB4PSIyNzAiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkR5bmFtbyBLeWl2IENoYW1waQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyNzAsMzQ1IDI3MCwzNTAgIi8+Cjx0ZXh0IHg9IjMyOSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQmVuZmljYSBDaGFtcGlvbnMgCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjMyOSwzNDUgMzI5LDM1MCAiLz4KPHRleHQgeD0iMzg3IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpNYW4gVW5pdGVkIFVFRkEgRXUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzg3LDM0NSAzODcsMzUwICIvPgo8dGV4dCB4PSI0NDYiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkZDIFBvcnRvIENoYW1waW9ucwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0NDYsMzQ1IDQ0NiwzNTAgIi8+Cjx0ZXh0IHg9IjUwNSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQUMgTWlsYW4gQ2hhbXBpb25zCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUwNSwzNDUgNTA1LDM1MCAiLz4KPHRleHQgeD0iNTYzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpHYWxhdGFzYXJheSBDaGFtcGkKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTYzLDM0NSA1NjMsMzUwICIvPgo8dGV4dCB4PSI2MjIiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkxpdmVycG9vbCBDaGFtcGlvbgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MjIsMzQ1IDYyMiwzNTAgIi8+Cjx0ZXh0IHg9IjY4MSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KT2x5bXBpYWNvcyBDaGFtcGlvCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY4MSwzNDUgNjgxLDM1MCAiLz4KPHRleHQgeD0iNzM5IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpGQyBCYXNlbCBDaGFtcGlvbnMKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzM5LDM0NSA3MzksMzUwICIvPgo8cmVjdCB4PSI3MyIgeT0iNzUiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyNjkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxMzIiIHk9IjE3NSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjE2OSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjE5MSIgeT0iMTg4IiB3aWR0aD0iNDEiIGhlaWdodD0iMTU2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjQ5IiB5PSIyMDUiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxMzkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzMDgiIHk9IjIxMCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjEzNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjM2NyIgeT0iMjEwIiB3aWR0aD0iNDEiIGhlaWdodD0iMTM0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDI1IiB5PSIyMTAiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxMzQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0ODQiIHk9IjIxNCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjEzMCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjU0MyIgeT0iMjE0IiB3aWR0aD0iNDEiIGhlaWdodD0iMTMwIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjAxIiB5PSIyMTgiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxMjYiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2NjAiIHk9IjIxOCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjEyNiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjcxOSIgeT0iMjE4IiB3aWR0aD0iNDEiIGhlaWdodD0iMTI2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPC9zdmc+)

## Discussion

**Yes — emphatically. The team leading after half the fixtures wins the title
57% of the time, and the mid-season table predicts the final one at ρ≈0.87 in
the Premier League.**

Scope: 897 league-seasons with ≥40 matches, split at the median fixture date.
For each we rebuilt the standings from results only (3/1/0, GD-then-GF) at the
midpoint and compared with the final table.

1. **The mid-season table is highly predictive.** Mean Spearman rank-correlation
   between mid and final positions: **0.838** across all competitions, median
   0.857. In the **Premier League: 0.868** (mean across 34 seasons); Serie A
   0.889, Scottish Premiership 0.884, Eredivisie 0.879.

2. **Leading at the halfway point is worth more than half a title.** The
   mid-season leader went on to win in **510 of 897 seasons (57%)**. Mid-table
   top-4 sides held a top-4 finish **75%** of the time; mid-table bottom-3 sides
   stayed bottom-3 **65%** of the time.

3. **But the second half still produces real churn.** Across all league-seasons,
   the biggest mid→final rises include Tottenham (P44→P5, UCL 2018/19),
   Liverpool (P32→P3, UCL 2018/19) and Atalanta (P79→P17, UCL 2019/20); in
   domestic leagues, QPR (P6→P21, Championship 2022/23) and Sheffield Wednesday
   (P3→P17, Championship 2019/20) are the cautionary tales. The correlation is
   strong — not deterministic.

4. **Caveats:** (a) cup competitions (Champions League, Europa League) produce
   noisy "mid-tables" — their group/league-phase formats don't map cleanly onto
   a single-table season, which inflates both the biggest risers and the
   league-level ρ; read the domestic-league rows for the true signal. (b) "Half
   season" = split at the median fixture _date_, which for leagues with split
   schedules approximates but doesn't exactly equal gameweek 19 of 38. (c)
   Standings replay uses standard tiebreaks; real-world tiebreak rules vary by
   league and era.

**Limitations.** The analysis is limited to the competitions present in the
database; player-level metrics exist only for StatsBomb-covered tournaments, and
underlying event data may contain errors.

## Conclusion

Yes — emphatically. The team leading after half the fixtures wins the title 57%
of the time, and the mid-season table predicts the final one at ρ≈0.87 in the
Premier League. Together these results answer the research question posed in the
Introduction and quantify the pattern across 897 seasons. The notebook provides
a fully reproducible pipeline from raw CSV extracts to published figures.
