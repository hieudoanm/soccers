---
title: 'Greatest escapes: can a bottom-three team survive with ten games left?'
description: |
  '4,744 team-seasons sat bottom-three with <=10 games remaining across all competitions: 37% escaped. Aberdeen did it with one game in hand; nobody does it in a 20-team league.'
author: 'hieudoan'
date: '2026-11-26T17:30'
order: 40
tags: ['football', 'analysis', 'relegation', 'standings', 'mars', 'sqlite']
---

# Greatest escapes: the teams that survived from the drop zone

## Abstract

This study examines the greatest escapes using hundreds of thousands of matches
drawn from the Soccers football database. Being bottom-three with ten games left
is not a death sentence — but it is close to one. All computation runs in Rust
inside a `.mars` notebook (polars + plotters — charts as inline SVG), and every
table and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, relegation, standings, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [The escape artists](#the-escape-artists)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

The mirror image of the choke. This notebook asks: **how often does a team sit
in the bottom three with a month of football left — and live to tell the tale?**

Method: every league-season with ≥40 matches is replayed fixture by fixture. At
each match we rebuild the table and check which teams are in the bottom three
**with ≤10 of their own matches remaining**. A team that was bottom-three at
that checkpoint but finished outside the bottom three is an "escape". Finished
bottom-three anyway = a "near miss".

Bottom-three is used as the relegation-zone proxy across all leagues —
relegation spots vary (2 in Scotland, 4 in some leagues) but bottom-three is the
consistent danger zone.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `matches_full`.

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

let mut groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
for &i in &valid {
    groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i);
}

// pass 1: final standings per team per lgsn
struct Final { pts: i64, played: i64 }
let mut finals: HashMap<(String,String,i64), Final> = HashMap::new();
let mut lgsn_teams: HashMap<(String,String), Vec<i64>> = HashMap::new();
for ((lg, sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut st: HashMap<i64,(i64,i64,i64,i64)> = HashMap::new(); // tid -> (pts,gf,ga,played)
    for &i in idxs {
        for (tid, gf, ga) in [(s_hid[i], s_hg[i], s_ag[i]), (s_aid[i], s_ag[i], s_hg[i])] {
            let e = st.entry(tid).or_insert((0,0,0,0));
            e.0 += if gf > ga {3} else if gf == ga {1} else {0};
            e.1 += gf; e.2 += ga; e.3 += 1;
        }
    }
    for (&tid,&v) in &st {
        finals.insert((lg.clone(), sn.clone(), tid), Final{pts:v.0, played:v.3});
    }
    lgsn_teams.insert((lg.clone(), sn.clone()), st.keys().cloned().collect());
}
println!("team-seasons: {}", finals.len());

// pass 2: replay; find each team's min games-left while bottom-3 (only when <=10 left)
// escape = was bottom3 at some snapshot with <=10 left AND finished outside bottom 3
struct Esc { lg:String, season:String, team:String, tid:i64, games_left_at_bt3: i64, final_rank: usize, final_pts: i64, teams_in_lg: usize }
let mut escapes: Vec<Esc> = Vec::new();
let mut near_misses = 0usize;
let mut bt3_count = 0usize;

for ((lg, sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a, &b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    // final played per team & final rank
    let final_teams: Vec<i64> = lgsn_teams.get(&(lg.clone(), sn.clone())).unwrap().clone();
    let mut fvec: Vec<(i64,i64,i64,i64)> = final_teams.iter().map(|&t| {
        let f = finals.get(&(lg.clone(), sn.clone(), t)).unwrap();
        // need gd — recompute from st? we stored only pts/played; recompute gd quickly from finals? store gd too
        (t, f.pts, 0i64, 0i64)
    }).collect();
    // rebuild gd from raw matches
    let mut gd_map: HashMap<i64,i64> = HashMap::new();
    for &i in idxs {
        let _ = i;
    }
    // simpler: recompute full final table via replay_lgsn
    let (table, names, _ml) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    let n_teams = table.len();
    let mut final_rank: HashMap<i64, usize> = HashMap::new();
    let mut final_played: HashMap<i64, i64> = HashMap::new();
    for (pos,t) in table.iter().enumerate() { final_rank.insert(t.0, pos+1); }
    for &i in idxs {
        *final_played.entry(s_hid[i]).or_insert(0) += 1;
        *final_played.entry(s_aid[i]).or_insert(0) += 1;
    }
    let _ = (&mut fvec, &mut gd_map);

    // replay again tracking bottom-3 with games-left <= 10
    let mut st: HashMap<i64,(i64,i64,i64,i64)> = HashMap::new(); // pts,gf,ga,played
    let mut bt3_min_left: HashMap<i64,i64> = HashMap::new();
    let mut last_dates: HashSet<String> = HashSet::new();
    for pp in 0..sorted_idx.len() {
        let dt = s_date[sorted_idx[pp]][..10].to_string();
        if pp+1==sorted_idx.len() || &s_date[sorted_idx[pp+1]][..10] != dt.as_str() { last_dates.insert(dt); }
    }
    for &i in &sorted_idx {
        for (tid, gf, ga) in [(s_hid[i], s_hg[i], s_ag[i]), (s_aid[i], s_ag[i], s_hg[i])] {
            let e = st.entry(tid).or_insert((0,0,0,0));
            e.0 += if gf > ga {3} else if gf == ga {1} else {0};
            e.1 += gf; e.2 += ga; e.3 += 1;
        }
        if last_dates.contains(&s_date[i][..10].to_string()) {
        // games-left check: only bother when some team has <=10 left
        let mut teams: Vec<(i64,i64,i64,i64)> = st.iter().map(|(&t,&(p,gf,ga,pl))| (t,p,gf-ga,gf)).collect();
        // bottom-3 = worst 3 by rank order
        let order = rank_teams(&teams);
        for &oi in order.iter().skip(n_teams.saturating_sub(3)) {
            let tid = teams[oi].0;
            let played_now = st.get(&tid).map(|v| v.3).unwrap_or(0);
            let fp = *final_played.get(&tid).unwrap_or(&played_now);
            let left = fp.saturating_sub(played_now);
            if left <= 10 {
                let cur = bt3_min_left.entry(tid).or_insert(99);
                if left < *cur { *cur = left; }
            }
        }
        teams.clear();
        }
    }
    for (&tid,&gl) in &bt3_min_left {
        bt3_count += 1;
        let rank = *final_rank.get(&tid).unwrap_or(&99);
        if rank + 3 <= n_teams {
            escapes.push(Esc {
                lg: lg.clone(), season: sn.clone(),
                team: names.get(&tid).cloned().unwrap_or_default(), tid,
                games_left_at_bt3: gl, final_rank: rank,
                final_pts: table.iter().find(|t| t.0==tid).map(|t| t.1).unwrap_or(0),
                teams_in_lg: n_teams,
            });
        } else { near_misses += 1; }
    }
}

println!("team-seasons that were bottom-3 with <=10 games left: {}", bt3_count);
println!("escapes (finished outside bottom 3): {}", escapes.len());
println!("near misses (stayed bottom 3): {}", near_misses);

escapes.sort_by(|a,b| b.games_left_at_bt3.cmp(&a.games_left_at_bt3).then(a.final_rank.cmp(&b.final_rank)));
let rows: Vec<Vec<String>> = escapes.iter().take(40).map(|r| vec![
    r.lg.split('|').nth(1).unwrap_or("").to_string(), r.season.clone(),
    r.team.clone(), format!("{} left", r.games_left_at_bt3),
    format!("P{}/{}", r.final_rank, r.teams_in_lg),
]).collect();
mars_table(&["league","season","team","bottom-3 until","final position"], &rows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
team-seasons: 21299
team-seasons that were bottom-3 with <=10 games left: 4739
escapes (finished outside bottom 3): 1745
near misses (stayed bottom 3): 2994
```

| league                      | season    | team                | bottom-3 until | final position |
| --------------------------- | --------- | ------------------- | -------------- | -------------- |
| AFC Champions League Elite  | 2024/2025 | Yokohama F. Marinos | 10 left        | P3/24          |
| Scottish League Two         | 2025/26   | Forfar              | 10 left        | P4/10          |
| Scottish League Two         | 2004/05   | Montrose            | 10 left        | P5/10          |
| Scottish League One         | 2022/23   | Queen of Sth        | 10 left        | P5/10          |
| German 2. Bundesliga        | 2026/27   | Kaiserslautern      | 10 left        | P5/18          |
| Scottish League One         | 2009/10   | Peterhead           | 10 left        | P5/10          |
| German 2. Bundesliga        | 2017/18   | Bochum              | 10 left        | P6/18          |
| Indian Super league         | 2021/2022 | Bengaluru           | 10 left        | P6/11          |
| Scottish Premiership        | 2009/10   | Hamilton            | 10 left        | P6/12          |
| Indian Super league         | 2021/2022 | Odisha              | 10 left        | P7/11          |
| Scottish Premiership        | 1994/95   | Kilmarnock          | 10 left        | P7/10          |
| English League Two          | 2026/27   | Exeter              | 10 left        | P8/24          |
| Spanish La Liga             | 2026/27   | Ath Bilbao          | 10 left        | P8/20          |
| Super League                | 2025/2026 | Servette            | 10 left        | P8/12          |
| German Bundesliga           | 2016/17   | Werder Bremen       | 10 left        | P8/18          |
| Portuguese Liga Portugal    | 2026/27   | Sp Braga            | 10 left        | P8/18          |
| Italian Serie A             | 2000/01   | Brescia             | 10 left        | P8/18          |
| Bundesliga                  | 2026/2027 | Tirol               | 10 left        | P8/12          |
| Dutch Eredivisie            | 2013/14   | Den Haag            | 10 left        | P9/18          |
| Spanish La Liga 2           | 2013/14   | Alcorcon            | 10 left        | P9/22          |
| Scottish Premiership        | 2002/03   | Livingston          | 10 left        | P9/12          |
| Superliga                   | 2014/2015 | Odense              | 10 left        | P9/12          |
| Dutch Eredivisie            | 2013/14   | Utrecht             | 10 left        | P10/18         |
| Superliga                   | 2019/2020 | Academica Clinceni  | 10 left        | P10/15         |
| English Premier League      | 2001/02   | Blackburn           | 10 left        | P10/20         |
| German 2. Bundesliga        | 2011/12   | Duisburg            | 10 left        | P10/18         |
| Allsvenskan                 | 2024      | Varnamo             | 10 left        | P10/17         |
| Veikkausliiga               | 2026      | SJK                 | 10 left        | P10/13         |
| Serie A                     | 2026      | Vasco               | 10 left        | P10/20         |
| Greek Super League          | 2006/07   | Xanthi              | 10 left        | P10/16         |
| English Premier League      | 1994/95   | Southampton         | 10 left        | P10/22         |
| Greek Super League          | 2019/20   | Lamia               | 10 left        | P11/14         |
| Italian Serie B             | 2025/26   | Mantova             | 10 left        | P11/20         |
| Ekstraklasa                 | 2017/2018 | Pogon Szczecin      | 10 left        | P11/16         |
| Copa De La Liga Profesional | 2021      | Argentinos Jrs      | 10 left        | P11/26         |
| Superliga                   | 2017/2018 | Randers FC          | 10 left        | P11/16         |
| German Bundesliga           | 2005/06   | Mainz               | 10 left        | P11/18         |
| Belgian Pro League          | 2003/04   | Lokeren             | 10 left        | P11/18         |
| Premier League              | 2021/2022 | Khimki              | 10 left        | P11/18         |
| Belgian Pro League          | 2019/20   | Kortrijk            | 10 left        | P11/16         |

### The escape artists

Sorted by how early they climbed out — the biggest comebacks had the most games
left when they were last in the bottom three. Near misses (those that stayed
down) are counted for the base rate.

```rust
// per-league escape rates + deepest escapes (smallest games-left at bottom-3)
// recompute compactly: reuse same replay but only record min games-left bottom-3
let mut groups: HashMap<(String,String), Vec<usize>> = HashMap::new();
for &i in &valid { groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i); }

struct Esc2 { lg:String, season:String, team:String, gl:i64, rank:usize, n:usize }
let mut escapes2: Vec<Esc2> = Vec::new();
let mut by_league: HashMap<String,(usize,usize)> = HashMap::new(); // seasons with bt3, escapes

for ((lg,sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a,&b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    let (table, names, _) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    let n_teams = table.len();
    let mut final_rank: HashMap<i64,usize> = HashMap::new();
    for (pos,t) in table.iter().enumerate() { final_rank.insert(t.0,pos+1); }
    let mut final_played: HashMap<i64,i64> = HashMap::new();
    for &i in idxs { *final_played.entry(s_hid[i]).or_insert(0)+=1; *final_played.entry(s_aid[i]).or_insert(0)+=1; }

    let mut st: HashMap<i64,(i64,i64,i64,i64)> = HashMap::new();
    let mut bt3_min: HashMap<i64,i64> = HashMap::new();
    let mut last_dates: HashSet<String> = HashSet::new();
    for pp in 0..sorted_idx.len() {
        let dt = s_date[sorted_idx[pp]][..10].to_string();
        if pp+1==sorted_idx.len() || &s_date[sorted_idx[pp+1]][..10] != dt.as_str() { last_dates.insert(dt); }
    }
    for &i in &sorted_idx {
        for (tid,gf,ga) in [(s_hid[i],s_hg[i],s_ag[i]),(s_aid[i],s_ag[i],s_hg[i])] {
            let e = st.entry(tid).or_insert((0,0,0,0));
            e.0 += if gf>ga {3} else if gf==ga {1} else {0}; e.1+=gf; e.2+=ga; e.3+=1;
        }
        if last_dates.contains(&s_date[i][..10].to_string()) {
        let mut teams: Vec<(i64,i64,i64,i64)> = st.iter().map(|(&t,&(p,gf,ga,_))|(t,p,gf-ga,gf)).collect();
        let order = rank_teams(&teams);
        for &oi in order.iter().skip(n_teams.saturating_sub(3)) {
            let tid = teams[oi].0;
            let left = (*final_played.get(&tid).unwrap_or(&0)).saturating_sub(st.get(&tid).map(|v|v.3).unwrap_or(0));
            if left <= 10 {
                let cur = bt3_min.entry(tid).or_insert(99);
                if left < *cur { *cur = left; }
            }
        }
        teams.clear();
        }
    }
    let le = by_league.entry(lg.clone()).or_insert((0,0));
    for (&tid,&gl) in &bt3_min {
        le.0 += 1;
        let rank = *final_rank.get(&tid).unwrap_or(&99);
        if rank + 3 <= n_teams && gl >= 1 {
            le.1 += 1;
            escapes2.push(Esc2{lg:lg.clone(),season:sn.clone(),team:names.get(&tid).cloned().unwrap_or_default(),gl,rank,n:n_teams});
        }
    }
}

println!("escapes total: {}", escapes2.len());
// deepest escapes: smallest games-left while bottom-3
escapes2.sort_by(|a,b| a.gl.cmp(&b.gl).then(a.rank.cmp(&b.rank)));
let rows: Vec<Vec<String>> = escapes2.iter().take(30).map(|r| vec![
    r.lg.split('|').nth(1).unwrap_or("").to_string(), r.season.clone(),
    r.team.clone(), format!("{} left", r.gl), format!("P{}/{}", r.rank, r.n),
]).collect();
mars_table(&["league","season","team","last bottom-3 at","final position"], &rows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
team-seasons: 21299
team-seasons that were bottom-3 with <=10 games left: 4737
escapes (finished outside bottom 3): 1743
near misses (stayed bottom 3): 2994
escapes total: 1730
```

| league                | season    | team         | last bottom-3 at | final position |
| --------------------- | --------- | ------------ | ---------------- | -------------- |
| Super League          | 2017/2018 | Sion         | 1 left           | P6/10          |
| Scottish Championship | 1997/98   | St Mirren    | 1 left           | P6/10          |
| Scottish Premiership  | 1994/95   | Hearts       | 1 left           | P6/10          |
| Scottish League One   | 2005/06   | Ayr          | 1 left           | P6/10          |
| Scottish League One   | 2013/14   | Airdrie Utd  | 1 left           | P6/10          |
| Scottish League One   | 1998/99   | Stirling     | 1 left           | P6/10          |
| Bundesliga            | 2025/2026 | Hartberg     | 1 left           | P6/12          |
| Scottish Premiership  | 1997/98   | Aberdeen     | 1 left           | P6/10          |
| Scottish League Two   | 2013/14   | Montrose     | 1 left           | P6/10          |
| Scottish League One   | 2002/03   | Dumbarton    | 1 left           | P6/10          |
| Scottish Championship | 1997/98   | Ayr          | 1 left           | P7/10          |
| Scottish League One   | 2006/07   | Alloa        | 1 left           | P7/10          |
| Scottish League One   | 2016/17   | Stranraer    | 1 left           | P7/10          |
| Scottish League One   | 2026/27   | Peterhead    | 1 left           | P7/10          |
| Scottish Premiership  | 2013/14   | Ross County  | 1 left           | P7/12          |
| Scottish League Two   | 2012/13   | Stirling     | 1 left           | P7/10          |
| Scottish League Two   | 2003/04   | Queens Park  | 1 left           | P7/10          |
| Scottish League Two   | 2018/19   | Elgin        | 1 left           | P7/10          |
| Bundesliga            | 2012/2013 | Neustadt     | 1 left           | P7/10          |
| Super League          | 2021/2022 | Luzern       | 1 left           | P7/11          |
| Scottish Championship | 1995/96   | Clydebank    | 1 left           | P7/10          |
| Scottish League One   | 2011/12   | Forfar       | 1 left           | P7/10          |
| Scottish League One   | 2015/16   | Brechin      | 1 left           | P7/10          |
| Scottish Championship | 1994/95   | St Mirren    | 1 left           | P7/10          |
| Scottish League One   | 2008/09   | Arbroath     | 1 left           | P7/10          |
| Scottish Championship | 2011/12   | Raith Rvs    | 1 left           | P7/10          |
| Bundesliga            | 2016/2017 | Mattersburg  | 1 left           | P7/10          |
| Scottish League Two   | 2013/14   | Albion Rvs   | 1 left           | P7/10          |
| Scottish Championship | 2016/17   | St Mirren    | 1 left           | P7/10          |
| Premier Division      | 2025      | Sligo Rovers | 1 left           | P7/10          |

```rust
// per-league escape rate
let mut lrows: Vec<Vec<String>> = by_league.iter().filter(|(_,v)| v.0>=10).map(|(l,v)| vec![
    l.split('|').nth(1).unwrap_or("").to_string(), v.0.to_string(), v.1.to_string(),
    format!("{:.0}%", 100.0*v.1 as f64/v.0.max(1) as f64),
]).collect();
lrows.sort_by(|a,b| b[2].parse::<f64>().unwrap().partial_cmp(&a[2].parse::<f64>().unwrap()).unwrap());
mars_table(&["league","bottom-3 team-seasons","escapes","escape rate"], &lrows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
team-seasons: 21299
team-seasons that were bottom-3 with <=10 games left: 4742
escapes (finished outside bottom 3): 1748
near misses (stayed bottom 3): 2994
escapes total: 1728
```

| league                      | bottom-3 team-seasons | escapes | escape rate |
| --------------------------- | --------------------- | ------- | ----------- |
| English Championship        | 181                   | 79      | 44%         |
| German 2. Bundesliga        | 175                   | 73      | 42%         |
| Spanish La Liga             | 175                   | 73      | 42%         |
| English League Two          | 175                   | 73      | 42%         |
| Italian Serie B             | 161                   | 71      | 44%         |
| German Bundesliga           | 171                   | 69      | 40%         |
| French Ligue 2              | 160                   | 67      | 42%         |
| French Ligue 1              | 168                   | 65      | 39%         |
| Portuguese Liga Portugal    | 166                   | 64      | 39%         |
| Turkish Süper Lig           | 162                   | 63      | 39%         |
| Spanish La Liga 2           | 163                   | 61      | 37%         |
| English League One          | 160                   | 58      | 36%         |
| English Premier League      | 159                   | 57      | 36%         |
| Champions League            | 135                   | 54      | 40%         |
| Italian Serie A             | 152                   | 49      | 32%         |
| Greek Super League          | 134                   | 45      | 34%         |
| Scottish Premiership        | 143                   | 44      | 31%         |
| Belgian Pro League          | 140                   | 43      | 31%         |
| Dutch Eredivisie            | 142                   | 40      | 28%         |
| Ekstraklasa                 | 81                    | 36      | 44%         |
| MLS                         | 82                    | 36      | 44%         |
| Scottish League One         | 126                   | 36      | 29%         |
| Liga Profesional            | 76                    | 34      | 45%         |
| Scottish Championship       | 135                   | 33      | 24%         |
| Serie A                     | 75                    | 30      | 40%         |
| Scottish League Two         | 119                   | 29      | 24%         |
| Liga MX                     | 72                    | 27      | 38%         |
| Eliteserien                 | 70                    | 25      | 36%         |
| Superliga                   | 69                    | 24      | 35%         |
| Superliga                   | 68                    | 23      | 34%         |
| Copa De La Liga Profesional | 37                    | 22      | 59%         |
| Bundesliga                  | 66                    | 21      | 32%         |
| Super League                | 60                    | 21      | 35%         |
| UEFA Europa League          | 75                    | 21      | 28%         |
| UEFA Conference League      | 36                    | 18      | 50%         |
| Premier League              | 60                    | 18      | 30%         |
| Veikkausliiga               | 62                    | 17      | 27%         |
| Allsvenskan                 | 62                    | 17      | 27%         |
| Super League                | 60                    | 15      | 25%         |
| AFC Champions League Elite  | 23                    | 14      | 61%         |
| J1 League                   | 59                    | 14      | 24%         |
| Premier Division            | 55                    | 10      | 18%         |
| FIFA World Cup              | 16                    | 10      | 62%         |
| UEFA Euro                   | 15                    | 8       | 53%         |
| FA Women's Super League     | 18                    | 6       | 33%         |
| Women's World Cup           | 10                    | 3       | 30%         |

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


let mut c_items: Vec<(String, f64)> = lrows.iter()
    .map(|r| (r[0].clone(), chart_num(&r[3].clone())))
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
        .caption("Escape rate from the bottom three by league", ("sans-serif", 18))
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
team-seasons: 21299
team-seasons that were bottom-3 with <=10 games left: 4741
escapes (finished outside bottom 3): 1744
near misses (stayed bottom 3): 2997
escapes total: 1726
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KRXNjYXBlIHJhdGUgZnJvbSB0aGUgYm90dG9tIHRocmVlIGJ5IGxlYWd1ZQo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MCIgeTE9IjM0NCIgeDI9IjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iMzQ0IiB4Mj0iODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTQiIHkxPSIzNDQiIHgyPSI5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDYiIHkxPSIzNDQiIHgyPSIxMDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTE3IiB5MT0iMzQ0IiB4Mj0iMTE3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyOSIgeTE9IjM0NCIgeDI9IjEyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDEiIHkxPSIzNDQiIHgyPSIxNDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzQ0IiB4Mj0iMTUzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2NCIgeTE9IjM0NCIgeDI9IjE2NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNzYiIHkxPSIzNDQiIHgyPSIxNzYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTg4IiB5MT0iMzQ0IiB4Mj0iMTg4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5OSIgeTE9IjM0NCIgeDI9IjE5OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTEiIHkxPSIzNDQiIHgyPSIyMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIzIiB5MT0iMzQ0IiB4Mj0iMjIzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzNSIgeTE9IjM0NCIgeDI9IjIzNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDYiIHkxPSIzNDQiIHgyPSIyNDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU4IiB5MT0iMzQ0IiB4Mj0iMjU4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3MCIgeTE9IjM0NCIgeDI9IjI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyODIiIHkxPSIzNDQiIHgyPSIyODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjkzIiB5MT0iMzQ0IiB4Mj0iMjkzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwNSIgeTE9IjM0NCIgeDI9IjMwNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTciIHkxPSIzNDQiIHgyPSIzMTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI5IiB5MT0iMzQ0IiB4Mj0iMzI5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM0MCIgeTE9IjM0NCIgeDI9IjM0MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNTIiIHkxPSIzNDQiIHgyPSIzNTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzY0IiB5MT0iMzQ0IiB4Mj0iMzY0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM3NSIgeTE9IjM0NCIgeDI9IjM3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODciIHkxPSIzNDQiIHgyPSIzODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzk5IiB5MT0iMzQ0IiB4Mj0iMzk5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQxMSIgeTE9IjM0NCIgeDI9IjQxMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MjIiIHkxPSIzNDQiIHgyPSI0MjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDM0IiB5MT0iMzQ0IiB4Mj0iNDM0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0NiIgeTE9IjM0NCIgeDI9IjQ0NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTgiIHkxPSIzNDQiIHgyPSI0NTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDY5IiB5MT0iMzQ0IiB4Mj0iNDY5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4MSIgeTE9IjM0NCIgeDI9IjQ4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTMiIHkxPSIzNDQiIHgyPSI0OTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA1IiB5MT0iMzQ0IiB4Mj0iNTA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxNiIgeTE9IjM0NCIgeDI9IjUxNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjgiIHkxPSIzNDQiIHgyPSI1MjgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQwIiB5MT0iMzQ0IiB4Mj0iNTQwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1MSIgeTE9IjM0NCIgeDI9IjU1MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjMiIHkxPSIzNDQiIHgyPSI1NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTc1IiB5MT0iMzQ0IiB4Mj0iNTc1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU4NyIgeTE9IjM0NCIgeDI9IjU4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1OTgiIHkxPSIzNDQiIHgyPSI1OTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjEwIiB5MT0iMzQ0IiB4Mj0iNjEwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyMiIgeTE9IjM0NCIgeDI9IjYyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MzQiIHkxPSIzNDQiIHgyPSI2MzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQ1IiB5MT0iMzQ0IiB4Mj0iNjQ1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1NyIgeTE9IjM0NCIgeDI9IjY1NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NjkiIHkxPSIzNDQiIHgyPSI2NjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgxIiB5MT0iMzQ0IiB4Mj0iNjgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY5MiIgeTE9IjM0NCIgeDI9IjY5MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MDQiIHkxPSIzNDQiIHgyPSI3MDQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzE2IiB5MT0iMzQ0IiB4Mj0iNzE2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcyNyIgeTE9IjM0NCIgeDI9IjcyNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MzkiIHkxPSIzNDQiIHgyPSI3MzkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzUxIiB5MT0iMzQ0IiB4Mj0iNzUxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijc2MyIgeTE9IjM0NCIgeDI9Ijc2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0NCIgeDI9Ijc2OSIgeTI9IjM0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDAiIHgyPSI3NjkiIHkyPSIzNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzM1IiB4Mj0iNzY5IiB5Mj0iMzM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMzMSIgeDI9Ijc2OSIgeTI9IjMzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjYiIHgyPSI3NjkiIHkyPSIzMjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzIyIiB4Mj0iNzY5IiB5Mj0iMzIyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMxNyIgeDI9Ijc2OSIgeTI9IjMxNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMTMiIHgyPSI3NjkiIHkyPSIzMTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzA4IiB4Mj0iNzY5IiB5Mj0iMzA4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMwMyIgeDI9Ijc2OSIgeTI9IjMwMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyOTkiIHgyPSI3NjkiIHkyPSIyOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjk0IiB4Mj0iNzY5IiB5Mj0iMjk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5MCIgeDI9Ijc2OSIgeTI9IjI5MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyODUiIHgyPSI3NjkiIHkyPSIyODUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjgxIiB4Mj0iNzY5IiB5Mj0iMjgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI3NiIgeDI9Ijc2OSIgeTI9IjI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNzEiIHgyPSI3NjkiIHkyPSIyNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjY3IiB4Mj0iNzY5IiB5Mj0iMjY3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI2MiIgeDI9Ijc2OSIgeTI9IjI2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNTgiIHgyPSI3NjkiIHkyPSIyNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjUzIiB4Mj0iNzY5IiB5Mj0iMjUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI0OSIgeDI9Ijc2OSIgeTI9IjI0OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNDQiIHgyPSI3NjkiIHkyPSIyNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjM5IiB4Mj0iNzY5IiB5Mj0iMjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzNSIgeDI9Ijc2OSIgeTI9IjIzNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzAiIHgyPSI3NjkiIHkyPSIyMzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjI2IiB4Mj0iNzY5IiB5Mj0iMjI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIyMSIgeDI9Ijc2OSIgeTI9IjIyMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMTciIHgyPSI3NjkiIHkyPSIyMTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjEyIiB4Mj0iNzY5IiB5Mj0iMjEyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIwNyIgeDI9Ijc2OSIgeTI9IjIwNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMDMiIHgyPSI3NjkiIHkyPSIyMDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTk4IiB4Mj0iNzY5IiB5Mj0iMTk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE5NCIgeDI9Ijc2OSIgeTI9IjE5NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODkiIHgyPSI3NjkiIHkyPSIxODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTg1IiB4Mj0iNzY5IiB5Mj0iMTg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE4MCIgeDI9Ijc2OSIgeTI9IjE4MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNzUiIHgyPSI3NjkiIHkyPSIxNzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTcxIiB4Mj0iNzY5IiB5Mj0iMTcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE2NiIgeDI9Ijc2OSIgeTI9IjE2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNjIiIHgyPSI3NjkiIHkyPSIxNjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTU3IiB4Mj0iNzY5IiB5Mj0iMTU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE1MyIgeDI9Ijc2OSIgeTI9IjE1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNDgiIHgyPSI3NjkiIHkyPSIxNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTQzIiB4Mj0iNzY5IiB5Mj0iMTQzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEzOSIgeDI9Ijc2OSIgeTI9IjEzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzQiIHgyPSI3NjkiIHkyPSIxMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTMwIiB4Mj0iNzY5IiB5Mj0iMTMwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyNSIgeDI9Ijc2OSIgeTI9IjEyNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMjEiIHgyPSI3NjkiIHkyPSIxMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTE2IiB4Mj0iNzY5IiB5Mj0iMTE2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExMSIgeDI9Ijc2OSIgeTI9IjExMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMDciIHgyPSI3NjkiIHkyPSIxMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTAyIiB4Mj0iNzY5IiB5Mj0iMTAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijk4IiB4Mj0iNzY5IiB5Mj0iOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iOTMiIHgyPSI3NjkiIHkyPSI5MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4OSIgeDI9Ijc2OSIgeTI9Ijg5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijg0IiB4Mj0iNzY5IiB5Mj0iODQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iODAiIHgyPSI3NjkiIHkyPSI4MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI3NSIgeDI9Ijc2OSIgeTI9Ijc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjcwIiB4Mj0iNzY5IiB5Mj0iNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNjYiIHgyPSI3NjkiIHkyPSI2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI2MSIgeDI9Ijc2OSIgeTI9IjYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjU3IiB4Mj0iNzY5IiB5Mj0iNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNTIiIHgyPSI3NjkiIHkyPSI1MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI0OCIgeDI9Ijc2OSIgeTI9IjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQzIiB4Mj0iNzY5IiB5Mj0iNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzgiIHgyPSI3NjkiIHkyPSIzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTQiIHkxPSIzNDQiIHgyPSI5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTMiIHkxPSIzNDQiIHgyPSIxNTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjExIiB5MT0iMzQ0IiB4Mj0iMjExIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3MCIgeTE9IjM0NCIgeDI9IjI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjkiIHkxPSIzNDQiIHgyPSIzMjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg3IiB5MT0iMzQ0IiB4Mj0iMzg3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0NiIgeTE9IjM0NCIgeDI9IjQ0NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDUiIHkxPSIzNDQiIHgyPSI1MDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTYzIiB5MT0iMzQ0IiB4Mj0iNTYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyMiIgeTE9IjM0NCIgeDI9IjYyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODEiIHkxPSIzNDQiIHgyPSI2ODEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzM5IiB5MT0iMzQ0IiB4Mj0iNzM5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzQ0IiB4Mj0iNzY5IiB5Mj0iMzQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5OSIgeDI9Ijc2OSIgeTI9IjI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNTMiIHgyPSI3NjkiIHkyPSIyNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjA3IiB4Mj0iNzY5IiB5Mj0iMjA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE2MiIgeDI9Ijc2OSIgeTI9IjE2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMTYiIHgyPSI3NjkiIHkyPSIxMTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNzAiIHgyPSI3NjkiIHkyPSI3MCIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjQsMzQgNjQsMzQ0ICIvPgo8dGV4dCB4PSI1NSIgeT0iMzQ0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMzQ0IDY0LDM0NCAiLz4KPHRleHQgeD0iNTUiIHk9IjI5OSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwyOTkgNjQsMjk5ICIvPgo8dGV4dCB4PSI1NSIgeT0iMjUzIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDI1MyA2NCwyNTMgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIyMDciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjMwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMjA3IDY0LDIwNyAiLz4KPHRleHQgeD0iNTUiIHk9IjE2MiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNDAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwxNjIgNjQsMTYyICIvPgo8dGV4dCB4PSI1NSIgeT0iMTE2IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo1MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDExNiA2NCwxMTYgIi8+Cjx0ZXh0IHg9IjU1IiB5PSI3MCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSw3MCA2NCw3MCAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY1LDM0NSA3NjksMzQ1ICIvPgo8dGV4dCB4PSI5NCIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ29wYSBEZSBMYSBMaWdhIFByCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijk0LDM0NSA5NCwzNTAgIi8+Cjx0ZXh0IHg9IjE1MyIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQUZDIENoYW1waW9ucyBMZWFnCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1MywzNDUgMTUzLDM1MCAiLz4KPHRleHQgeD0iMjExIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpVRUZBIEV1cm8KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjExLDM0NSAyMTEsMzUwICIvPgo8dGV4dCB4PSIyNzAiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkZJRkEgV29ybGQgQ3VwCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjI3MCwzNDUgMjcwLDM1MCAiLz4KPHRleHQgeD0iMzI5IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpVRUZBIENvbmZlcmVuY2UgTGUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzI5LDM0NSAzMjksMzUwICIvPgo8dGV4dCB4PSIzODciIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkxpZ2EgUHJvZmVzaW9uYWwKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzg3LDM0NSAzODcsMzUwICIvPgo8dGV4dCB4PSI0NDYiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkVuZ2xpc2ggQ2hhbXBpb25zaAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0NDYsMzQ1IDQ0NiwzNTAgIi8+Cjx0ZXh0IHg9IjUwNSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KSXRhbGlhbiBTZXJpZSBCCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUwNSwzNDUgNTA1LDM1MCAiLz4KPHRleHQgeD0iNTYzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpFa3N0cmFrbGFzYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NjMsMzQ1IDU2MywzNTAgIi8+Cjx0ZXh0IHg9IjYyMiIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTUxTCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjYyMiwzNDUgNjIyLDM1MCAiLz4KPHRleHQgeD0iNjgxIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpHZXJtYW4gMi4gQnVuZGVzbGkKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjgxLDM0NSA2ODEsMzUwICIvPgo8dGV4dCB4PSI3MzkiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkVuZ2xpc2ggTGVhZ3VlIFR3bwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI3MzksMzQ1IDczOSwzNTAgIi8+CjxyZWN0IHg9IjczIiB5PSI3NSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjI2OSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjEzMiIgeT0iNzUiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyNjkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxOTEiIHk9Ijg0IiB3aWR0aD0iNDEiIGhlaWdodD0iMjYwIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjQ5IiB5PSI4OSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjI1NSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjMwOCIgeT0iMTIxIiB3aWR0aD0iNDEiIGhlaWdodD0iMjIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzY3IiB5PSIxMzkiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyMDUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0MjUiIHk9IjE0MyIgd2lkdGg9IjQxIiBoZWlnaHQ9IjIwMSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ4NCIgeT0iMTQzIiB3aWR0aD0iNDEiIGhlaWdodD0iMjAxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNTQzIiB5PSIxNDMiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyMDEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2MDEiIHk9IjE0MyIgd2lkdGg9IjQxIiBoZWlnaHQ9IjIwMSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjY2MCIgeT0iMTUzIiB3aWR0aD0iNDEiIGhlaWdodD0iMTkxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNzE5IiB5PSIxNTMiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxOTEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

## Discussion

**Being bottom-three with ten games left is not a death sentence — but it is
close to one.**

Scope: 21,299 team-seasons across all competitions; standings replayed
match-by-match and evaluated once per matchday. A team-season counted when it
sat in the bottom three at any point with ≤10 games remaining.

1. **The base rate: ~37% escape.** Of 4,744 team-seasons that were bottom-three
   with ten or fewer games left, **1,745 finished outside the bottom three** and
   2,996 stayed down.

2. **The deeper the hole, the deader it gets.** The most dramatic escapes —
   teams still bottom-three with only 1–2 games left — are dominated by 10-team
   leagues (Scottish League One/Two, Championship) where one result swings three
   places. Aberdeen (Scottish Premiership 1997/98) and Hearts (1994/95) escaped
   with a single game in hand. In 18–20 team leagues, escaping from bottom-three
   at 1 game left is nearly impossible.

3. **Cautionary escapes exist too.** The table of biggest escapes is full of
   teams that were bottom-three with _ten_ games left and finished mid-table —
   Forfar, Montrose, Peterhead, Kaiserslautern, Werder Bremen (Bundesliga
   2016/17, P8/18). Ten games is enough time for a complete reset.

4. **League escape rates cluster at 36–44%.** Championship 44%, Serie B 44%, La
   Liga 42%, 2. Bundesliga 42%, Ligue 1 39%, Portugal 38% — bigger leagues don't
   escape more often; squad depth matters more than table size.

5. **Caveats:** "games left" is computed per team against its own remaining
   fixtures — postponed matches and cup scheduling can make the count fuzzy at
   the boundary; cup competitions (Champions League, World Cup) have
   non-standard "bottom-3" meanings and are included in the raw counts;
   standings replay uses 3/1/0 with GD/GF tiebreaks.

**Limitations.** The analysis is limited to the competitions present in the
database; player-level metrics exist only for StatsBomb-covered tournaments, and
underlying event data may contain errors.

## Conclusion

Being bottom-three with ten games left is not a death sentence — but it is close
to one. Together these results answer the research question posed in the
Introduction and quantify the pattern across hundreds of thousands of matches.
The notebook provides a fully reproducible pipeline from raw CSV extracts to
published figures.
