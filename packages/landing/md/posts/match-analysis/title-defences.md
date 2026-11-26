---
title: 'Title defences and dynasties: how often do champions retain?'
description: |
  '999 league-seasons: only 25.1% of champions go back-to-back. Salzburg and Bayern own the record at 11 straight; the 2010s were the dynasty decade.'
author: 'hieudoan'
date: '2026-11-26T18:00'
order: 41
tags: ['football', 'analysis', 'title', 'dynasty', 'standings']
---

# Title defences and dynasties: how rare is repeating?

## Abstract

How rare is repeating? This study answers it using hundreds of thousands of
matches drawn from the Soccers football database. Defending the title is the
hardest thing in club football — only 1 in 4 champions goes back-to-back. All
computation runs in Rust inside a `.mars` notebook (polars + plotters — charts
as inline SVG), and every table and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, title, dynasty, standings

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [Era check: are dynasties dying out?](#era-check-are-dynasties-dying-out)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

The hardest thing in football is winning twice. This notebook computes the
champion of every league-season in the dataset (~590 league-seasons, ~40
leagues, 1990s→2026) and asks:

- How often does the champion retain the title the following season?
- Which teams own the longest championship streaks?
- Are dynasties becoming more or less common over time?

Retention rate = P(next season's champion is the same team | the league had a
champion last season). Streaks count _consecutive_ titles in the same league — a
gap year (missing data season) breaks the chain only if a different team won in
between.

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

// champion per league-season
let mut groups: HashMap<(String,String), Vec<usize>> = HashMap::new();
for &i in &valid { groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i); }

struct Champ { lg:String, sn:String, skey:i64, tid:i64, team:String, pts:i64, margin:i64 }
let mut champs: Vec<Champ> = Vec::new();
for ((lg,sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a,&b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    let (table, names, _) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    if table.len() < 2 { continue; }
    champs.push(Champ{
        lg: lg.clone(), sn: sn.clone(), skey: sn.get(..4).and_then(|y| y.parse::<i64>().ok()).unwrap_or(0),
        tid: table[0].0, team: names.get(&table[0].0).cloned().unwrap_or_default(),
        pts: table[0].1, margin: table[0].1 - table[1].1,
    });
}
println!("league-seasons with a champion: {}", champs.len());

// per league: sort by season key, compute streaks + retention
let mut by_lg: HashMap<String, Vec<&Champ>> = HashMap::new();
for c in &champs { by_lg.entry(c.lg.clone()).or_default().push(c); }
for v in by_lg.values_mut() { v.sort_by(|a,b| a.skey.cmp(&b.skey).then(a.sn.cmp(&b.sn))); }

struct Streak { lg:String, team:String, tid:i64, len:usize, from:String, to:String, pts_avg:f64 }
let mut streaks: Vec<Streak> = Vec::new();
let mut retained = 0usize; let mut opportunities = 0usize;
let mut margins_ret: Vec<i64> = Vec::new();
let mut margins_all: Vec<i64> = Vec::new();

for (lg, cs) in &by_lg {
    // retention
    for w in cs.windows(2) {
        opportunities += 1;
        margins_all.push(w[1].margin);
        if w[0].tid == w[1].tid { retained += 1; margins_ret.push(w[1].margin); }
    }
    // streaks
    let mut i = 0;
    while i < cs.len() {
        let mut j = i;
        while j + 1 < cs.len() && cs[j+1].tid == cs[i].tid { j += 1; }
        let len = j - i + 1;
        if len >= 2 {
            let avg_pts = cs[i..=j].iter().map(|c| c.pts as f64).sum::<f64>() / len as f64;
            streaks.push(Streak{
                lg: lg.clone(), team: cs[i].team.clone(), tid: cs[i].tid, len,
                from: cs[i].sn.clone(), to: cs[j].sn.clone(), pts_avg: avg_pts,
            });
        }
        i = j + 1;
    }
}

println!("title retention rate: {}/{} = {:.1}%", retained, opportunities, 100.0*retained as f64/opportunities.max(1) as f64);
println!("avg winning margin — retained titles: {:.1} | all titles: {:.1}",
    margins_ret.iter().sum::<i64>() as f64/margins_ret.len().max(1) as f64,
    margins_all.iter().sum::<i64>() as f64/margins_all.len().max(1) as f64);

streaks.sort_by(|a,b| b.len.cmp(&a.len).then(a.lg.cmp(&b.lg)));
let rows: Vec<Vec<String>> = streaks.iter().take(40).map(|s| vec![
    s.lg.split('|').nth(1).unwrap_or("").to_string(), s.team.clone(),
    s.len.to_string(), format!("{} → {}", s.from, s.to), format!("{:.0}", s.pts_avg),
]).collect();
mars_table(&["league","team","consecutive titles","span","avg pts"], &rows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
league-seasons with a champion: 999
title retention rate: 238/947 = 25.1%
avg winning margin — retained titles: 8.2 | all titles: 6.6
```

| league                   | team                 | consecutive titles | span                  | avg pts |
| ------------------------ | -------------------- | ------------------ | --------------------- | ------- |
| Bundesliga               | Salzburg             | 11                 | 2013/2014 → 2023/2024 | 77      |
| German Bundesliga        | Bayern Munich        | 11                 | 2012/13 → 2022/23     | 82      |
| Italian Serie A          | Juventus             | 9                  | 2011/12 → 2019/20     | 90      |
| Scottish Premiership     | Celtic               | 9                  | 2011/12 → 2019/20     | 89      |
| French Ligue 1           | Lyon                 | 7                  | 2001/02 → 2007/08     | 77      |
| Greek Super League       | Olympiakos           | 7                  | 2010/11 → 2016/17     | 77      |
| French Ligue 1           | Paris SG             | 6                  | 2021/22 → 2026/27     | 72      |
| Greek Super League       | Olympiakos           | 6                  | 1996/97 → 2006/07     | 82      |
| Premier League           | Zenit                | 6                  | 2018/2019 → 2023/2024 | 66      |
| Scottish Premiership     | Celtic               | 6                  | 2021/22 → 2026/27     | 82      |
| Belgian Pro League       | Anderlecht           | 5                  | 2008/09 → 2012/13     | 69      |
| Portuguese Liga Portugal | Porto                | 5                  | 1994/95 → 1998/99     | 83      |
| Superliga                | CFR Cluj             | 5                  | 2017/2018 → 2021/2022 | 82      |
| Super League             | Basel                | 5                  | 2012/2013 → 2016/2017 | 78      |
| Turkish Süper Lig        | Galatasaray          | 5                  | 2022/23 → 2026/27     | 79      |
| Super League             | Guangzhou Evergrande | 4                  | 2014 → 2017           | 66      |
| English Premier League   | Man City             | 4                  | 2020/21 → 2023/24     | 90      |
| French Ligue 1           | Paris SG             | 4                  | 2012/13 → 2015/16     | 89      |
| Premier Division         | Shamrock Rovers      | 4                  | 2020 → 2023           | 69      |
| Italian Serie A          | Inter                | 4                  | 2006/07 → 2009/10     | 87      |
| Dutch Eredivisie         | PSV Eindhoven        | 4                  | 2004/05 → 2007/08     | 80      |
| Dutch Eredivisie         | Ajax                 | 4                  | 2010/11 → 2013/14     | 74      |
| Dutch Eredivisie         | Ajax                 | 4                  | 2018/19 → 2021/22     | 78      |
| Dutch Eredivisie         | PSV Eindhoven        | 4                  | 2023/24 → 2026/27     | 71      |
| Eliteserien              | Rosenborg            | 4                  | 2015 → 2018           | 66      |
| Portuguese Liga Portugal | Porto                | 4                  | 2005/06 → 2008/09     | 73      |
| Portuguese Liga Portugal | Benfica              | 4                  | 2013/14 → 2016/17     | 82      |
| Super League             | Young Boys           | 4                  | 2017/2018 → 2020/2021 | 84      |
| Turkish Süper Lig        | Galatasaray          | 4                  | 1996/97 → 1999/00     | 78      |
| Super League             | Shanghai Port        | 3                  | 2023 → 2025           | 69      |
| English Premier League   | Man United           | 3                  | 1998/99 → 2000/01     | 83      |
| English Premier League   | Man United           | 3                  | 2006/07 → 2008/09     | 89      |
| Veikkausliiga            | HJK                  | 3                  | 2012 → 2014           | 70      |
| Veikkausliiga            | HJK                  | 3                  | 2020 → 2022           | 55      |
| French Ligue 1           | Paris SG             | 3                  | 2017/18 → 2019/20     | 84      |
| German Bundesliga        | Bayern Munich        | 3                  | 1998/99 → 2000/01     | 71      |
| Greek Super League       | Olympiakos           | 3                  | 2019/20 → 2021/22     | 88      |
| Premier Division         | Dundalk              | 3                  | 2014 → 2016           | 76      |
| Dutch Eredivisie         | Ajax                 | 3                  | 1993/94 → 1995/96     | 84      |
| Ekstraklasa              | Legia                | 3                  | 2015/2016 → 2017/2018 | 72      |

```rust
// retention rate by league (min 8 seasons)
let mut ret_by_lg: HashMap<String,(usize,usize)> = HashMap::new();
for (lg, cs) in &by_lg {
    if cs.len() < 8 { continue; }
    let mut r = 0; let mut o = 0;
    for w in cs.windows(2) { o += 1; if w[0].tid == w[1].tid { r += 1; } }
    ret_by_lg.insert(lg.clone(), (r,o));
}
let mut rrows: Vec<Vec<String>> = ret_by_lg.iter().map(|(l,(r,o))| vec![
    l.split('|').nth(1).unwrap_or("").to_string(), o.to_string(), r.to_string(),
    format!("{:.0}%", 100.0*(*r) as f64/(*o).max(1) as f64),
]).collect();
rrows.sort_by(|a,b| b[3].trim_end_matches('%').parse::<f64>().unwrap().partial_cmp(&a[3].trim_end_matches('%').parse::<f64>().unwrap()).unwrap());
mars_table(&["league","opportunities","retained","retention %"], &rrows);
```

| league                   | opportunities | retained | retention % |
| ------------------------ | ------------- | -------- | ----------- |
| Bundesliga               | 14            | 10       | 71%         |
| Scottish Premiership     | 32            | 21       | 66%         |
| Super League             | 14            | 8        | 57%         |
| Superliga                | 14            | 8        | 57%         |
| Greek Super League       | 27            | 14       | 52%         |
| Premier Division         | 14            | 7        | 50%         |
| Super League             | 12            | 6        | 50%         |
| French Ligue 1           | 33            | 16       | 48%         |
| Dutch Eredivisie         | 33            | 16       | 48%         |
| German Bundesliga        | 33            | 16       | 48%         |
| Premier League           | 13            | 6        | 46%         |
| Portuguese Liga Portugal | 33            | 15       | 45%         |
| Ekstraklasa              | 14            | 6        | 43%         |
| Veikkausliiga            | 14            | 6        | 43%         |
| Italian Serie A          | 33            | 14       | 42%         |
| Eliteserien              | 14            | 5        | 36%         |
| Turkish Süper Lig        | 32            | 11       | 34%         |
| English Premier League   | 33            | 11       | 33%         |
| Belgian Pro League       | 31            | 9        | 29%         |
| Serie A                  | 14            | 4        | 29%         |
| Liga MX                  | 14            | 4        | 29%         |
| Allsvenskan              | 14            | 4        | 29%         |
| J1 League                | 14            | 4        | 29%         |
| Spanish La Liga          | 33            | 9        | 27%         |
| Superliga                | 14            | 2        | 14%         |
| Champions League         | 25            | 2        | 8%          |
| MLS                      | 14            | 1        | 7%          |
| UEFA Europa League       | 17            | 0        | 0%          |
| Liga Profesional         | 13            | 0        | 0%          |
| Scottish Championship    | 33            | 0        | 0%          |
| English League Two       | 33            | 0        | 0%          |
| English League One       | 33            | 0        | 0%          |
| Italian Serie B          | 29            | 0        | 0%          |
| Scottish League Two      | 29            | 0        | 0%          |
| Scottish League One      | 29            | 0        | 0%          |
| French Ligue 2           | 30            | 0        | 0%          |
| German 2. Bundesliga     | 33            | 0        | 0%          |
| English Championship     | 33            | 0        | 0%          |
| Spanish La Liga 2        | 33            | 0        | 0%          |

### Era check: are dynasties dying out?

Split the dataset into decades and ask whether repeat champions are becoming
rarer — the parity era thesis — or whether a few leagues still produce them
every year.

```rust

// decade of champion's season key -> retained or not
let mut groups: HashMap<(String,String), Vec<usize>> = HashMap::new();
for &i in &valid { groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i); }
let mut champs: Vec<(String,i64,i64,String)> = Vec::new(); // (lg, skey, tid, team)
for ((lg,sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a,&b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    let (table, names, _) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    if table.is_empty() { continue; }
    champs.push((lg.clone(), sn.get(..4).and_then(|y|y.parse::<i64>().ok()).unwrap_or(0), table[0].0, names.get(&table[0].0).cloned().unwrap_or_default()));
}
let mut by_lg: HashMap<String, Vec<(i64,i64,String)>> = HashMap::new();
for (lg,sk,tid,team) in champs { by_lg.entry(lg).or_default().push((sk,tid,team)); }
for v in by_lg.values_mut() { v.sort_by(|a,b| a.0.cmp(&b.0)); }

let mut decade: HashMap<i64,(usize,usize)> = HashMap::new(); // decade -> (retained, opportunities)
let mut unique_winners: HashMap<i64, std::collections::HashSet<i64>> = HashMap::new();
for (_lg, cs) in &by_lg {
    for w in cs.windows(2) {
        let d = (w[1].0 / 10) * 10;
        let e = decade.entry(d).or_insert((0,0));
        e.1 += 1;
        if w[0].1 == w[1].1 { e.0 += 1; }
        unique_winners.entry(d).or_default().insert(w[1].1);
    }
}
let dlabels = ["1990s","2000s","2010s","2020s"];
let dkeys = [1990i64,2000,2010,2020];
let drows: Vec<Vec<String>> = dkeys.iter().enumerate().map(|(i,&d)| {
    let (r,o) = decade.get(&d).copied().unwrap_or((0,0));
    let uniq = unique_winners.get(&d).map(|s| s.len()).unwrap_or(0);
    vec![dlabels[i].to_string(), o.to_string(), r.to_string(),
         format!("{:.0}%", 100.0*r as f64/o.max(1) as f64), uniq.to_string()]
}).collect();
mars_table(&["decade","opportunities","retained","retention %","unique champions"], &drows);
```

| decade | opportunities | retained | retention % | unique champions |
| ------ | ------------- | -------- | ----------- | ---------------- |
| 1990s  | 106           | 22       | 21%         | 77               |
| 2000s  | 218           | 41       | 19%         | 140              |
| 2010s  | 341           | 101      | 30%         | 195              |
| 2020s  | 287           | 77       | 27%         | 191              |

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
        .caption("Title retention rate by league", ("sans-serif", 18))
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

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KVGl0bGUgcmV0ZW50aW9uIHJhdGUgYnkgbGVhZ3VlCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcwIiB5MT0iMzQ0IiB4Mj0iNzAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODIiIHkxPSIzNDQiIHgyPSI4MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NCIgeTE9IjM0NCIgeDI9Ijk0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwNiIgeTE9IjM0NCIgeDI9IjEwNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMTciIHkxPSIzNDQiIHgyPSIxMTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTI5IiB5MT0iMzQ0IiB4Mj0iMTI5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE0MSIgeTE9IjM0NCIgeDI9IjE0MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTMiIHkxPSIzNDQiIHgyPSIxNTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTY0IiB5MT0iMzQ0IiB4Mj0iMTY0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3NiIgeTE9IjM0NCIgeDI9IjE3NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODgiIHkxPSIzNDQiIHgyPSIxODgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTk5IiB5MT0iMzQ0IiB4Mj0iMTk5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxMSIgeTE9IjM0NCIgeDI9IjIxMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMjMiIHkxPSIzNDQiIHgyPSIyMjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjM1IiB5MT0iMzQ0IiB4Mj0iMjM1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI0NiIgeTE9IjM0NCIgeDI9IjI0NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNTgiIHkxPSIzNDQiIHgyPSIyNTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjcwIiB5MT0iMzQ0IiB4Mj0iMjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI4MiIgeTE9IjM0NCIgeDI9IjI4MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyOTMiIHkxPSIzNDQiIHgyPSIyOTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzA1IiB5MT0iMzQ0IiB4Mj0iMzA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMxNyIgeTE9IjM0NCIgeDI9IjMxNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjkiIHkxPSIzNDQiIHgyPSIzMjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQwIiB5MT0iMzQ0IiB4Mj0iMzQwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1MiIgeTE9IjM0NCIgeDI9IjM1MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNjQiIHkxPSIzNDQiIHgyPSIzNjQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzc1IiB5MT0iMzQ0IiB4Mj0iMzc1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4NyIgeTE9IjM0NCIgeDI9IjM4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTkiIHkxPSIzNDQiIHgyPSIzOTkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDExIiB5MT0iMzQ0IiB4Mj0iNDExIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQyMiIgeTE9IjM0NCIgeDI9IjQyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzQiIHkxPSIzNDQiIHgyPSI0MzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDQ2IiB5MT0iMzQ0IiB4Mj0iNDQ2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ1OCIgeTE9IjM0NCIgeDI9IjQ1OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NjkiIHkxPSIzNDQiIHgyPSI0NjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDgxIiB5MT0iMzQ0IiB4Mj0iNDgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ5MyIgeTE9IjM0NCIgeDI9IjQ5MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDUiIHkxPSIzNDQiIHgyPSI1MDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTE2IiB5MT0iMzQ0IiB4Mj0iNTE2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUyOCIgeTE9IjM0NCIgeDI9IjUyOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDAiIHkxPSIzNDQiIHgyPSI1NDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUxIiB5MT0iMzQ0IiB4Mj0iNTUxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2MyIgeTE9IjM0NCIgeDI9IjU2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzUiIHkxPSIzNDQiIHgyPSI1NzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTg3IiB5MT0iMzQ0IiB4Mj0iNTg3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5OCIgeTE9IjM0NCIgeDI9IjU5OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTAiIHkxPSIzNDQiIHgyPSI2MTAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjIyIiB5MT0iMzQ0IiB4Mj0iNjIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYzNCIgeTE9IjM0NCIgeDI9IjYzNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NDUiIHkxPSIzNDQiIHgyPSI2NDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjU3IiB5MT0iMzQ0IiB4Mj0iNjU3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY2OSIgeTE9IjM0NCIgeDI9IjY2OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODEiIHkxPSIzNDQiIHgyPSI2ODEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjkyIiB5MT0iMzQ0IiB4Mj0iNjkyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcwNCIgeTE9IjM0NCIgeDI9IjcwNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MTYiIHkxPSIzNDQiIHgyPSI3MTYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzI3IiB5MT0iMzQ0IiB4Mj0iNzI3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjczOSIgeTE9IjM0NCIgeDI9IjczOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3NTEiIHkxPSIzNDQiIHgyPSI3NTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzYzIiB5MT0iMzQ0IiB4Mj0iNzYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzQ0IiB4Mj0iNzY5IiB5Mj0iMzQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0MSIgeDI9Ijc2OSIgeTI9IjM0MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMzciIHgyPSI3NjkiIHkyPSIzMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzMzIiB4Mj0iNzY5IiB5Mj0iMzMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMyOSIgeDI9Ijc2OSIgeTI9IjMyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjYiIHgyPSI3NjkiIHkyPSIzMjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzIyIiB4Mj0iNzY5IiB5Mj0iMzIyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMxOCIgeDI9Ijc2OSIgeTI9IjMxOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMTQiIHgyPSI3NjkiIHkyPSIzMTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzEwIiB4Mj0iNzY5IiB5Mj0iMzEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMwNyIgeDI9Ijc2OSIgeTI9IjMwNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMDMiIHgyPSI3NjkiIHkyPSIzMDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjk5IiB4Mj0iNzY5IiB5Mj0iMjk5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5NSIgeDI9Ijc2OSIgeTI9IjI5NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyOTEiIHgyPSI3NjkiIHkyPSIyOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjg4IiB4Mj0iNzY5IiB5Mj0iMjg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI4NCIgeDI9Ijc2OSIgeTI9IjI4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyODAiIHgyPSI3NjkiIHkyPSIyODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjc2IiB4Mj0iNzY5IiB5Mj0iMjc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI3MiIgeDI9Ijc2OSIgeTI9IjI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNjkiIHgyPSI3NjkiIHkyPSIyNjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjY1IiB4Mj0iNzY5IiB5Mj0iMjY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI2MSIgeDI9Ijc2OSIgeTI9IjI2MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNTciIHgyPSI3NjkiIHkyPSIyNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjUzIiB4Mj0iNzY5IiB5Mj0iMjUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI1MCIgeDI9Ijc2OSIgeTI9IjI1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNDYiIHgyPSI3NjkiIHkyPSIyNDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjQyIiB4Mj0iNzY5IiB5Mj0iMjQyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzOCIgeDI9Ijc2OSIgeTI9IjIzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzQiIHgyPSI3NjkiIHkyPSIyMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjMxIiB4Mj0iNzY5IiB5Mj0iMjMxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIyNyIgeDI9Ijc2OSIgeTI9IjIyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMjMiIHgyPSI3NjkiIHkyPSIyMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjE5IiB4Mj0iNzY5IiB5Mj0iMjE5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIxNSIgeDI9Ijc2OSIgeTI9IjIxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMTIiIHgyPSI3NjkiIHkyPSIyMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjA4IiB4Mj0iNzY5IiB5Mj0iMjA4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIwNCIgeDI9Ijc2OSIgeTI9IjIwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMDAiIHgyPSI3NjkiIHkyPSIyMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTk2IiB4Mj0iNzY5IiB5Mj0iMTk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE5MyIgeDI9Ijc2OSIgeTI9IjE5MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODkiIHgyPSI3NjkiIHkyPSIxODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTg1IiB4Mj0iNzY5IiB5Mj0iMTg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE4MSIgeDI9Ijc2OSIgeTI9IjE4MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNzciIHgyPSI3NjkiIHkyPSIxNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTc0IiB4Mj0iNzY5IiB5Mj0iMTc0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE3MCIgeDI9Ijc2OSIgeTI9IjE3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNjYiIHgyPSI3NjkiIHkyPSIxNjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTYyIiB4Mj0iNzY5IiB5Mj0iMTYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE1OCIgeDI9Ijc2OSIgeTI9IjE1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTUiIHgyPSI3NjkiIHkyPSIxNTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTUxIiB4Mj0iNzY5IiB5Mj0iMTUxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE0NyIgeDI9Ijc2OSIgeTI9IjE0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNDMiIHgyPSI3NjkiIHkyPSIxNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTM5IiB4Mj0iNzY5IiB5Mj0iMTM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEzNiIgeDI9Ijc2OSIgeTI9IjEzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzIiIHgyPSI3NjkiIHkyPSIxMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTI4IiB4Mj0iNzY5IiB5Mj0iMTI4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyNCIgeDI9Ijc2OSIgeTI9IjEyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMjAiIHgyPSI3NjkiIHkyPSIxMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTE3IiB4Mj0iNzY5IiB5Mj0iMTE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExMyIgeDI9Ijc2OSIgeTI9IjExMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMDkiIHgyPSI3NjkiIHkyPSIxMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTA1IiB4Mj0iNzY5IiB5Mj0iMTA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEwMiIgeDI9Ijc2OSIgeTI9IjEwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI5OCIgeDI9Ijc2OSIgeTI9Ijk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijk0IiB4Mj0iNzY5IiB5Mj0iOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iOTAiIHgyPSI3NjkiIHkyPSI5MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4NiIgeDI9Ijc2OSIgeTI9Ijg2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjgzIiB4Mj0iNzY5IiB5Mj0iODMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNzkiIHgyPSI3NjkiIHkyPSI3OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI3NSIgeDI9Ijc2OSIgeTI9Ijc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjcxIiB4Mj0iNzY5IiB5Mj0iNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNjciIHgyPSI3NjkiIHkyPSI2NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI2NCIgeDI9Ijc2OSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjYwIiB4Mj0iNzY5IiB5Mj0iNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNTYiIHgyPSI3NjkiIHkyPSI1NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI1MiIgeDI9Ijc2OSIgeTI9IjUyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQ4IiB4Mj0iNzY5IiB5Mj0iNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNDUiIHgyPSI3NjkiIHkyPSI0NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI0MSIgeDI9Ijc2OSIgeTI9IjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM3IiB4Mj0iNzY5IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk0IiB5MT0iMzQ0IiB4Mj0iOTQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzQ0IiB4Mj0iMTUzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxMSIgeTE9IjM0NCIgeDI9IjIxMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzAiIHkxPSIzNDQiIHgyPSIyNzAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI5IiB5MT0iMzQ0IiB4Mj0iMzI5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4NyIgeTE9IjM0NCIgeDI9IjM4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NDYiIHkxPSIzNDQiIHgyPSI0NDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA1IiB5MT0iMzQ0IiB4Mj0iNTA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2MyIgeTE9IjM0NCIgeDI9IjU2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MjIiIHkxPSIzNDQiIHgyPSI2MjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgxIiB5MT0iMzQ0IiB4Mj0iNjgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjczOSIgeTE9IjM0NCIgeDI9IjczOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0NCIgeDI9Ijc2OSIgeTI9IjM0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMDciIHgyPSI3NjkiIHkyPSIzMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjY5IiB4Mj0iNzY5IiB5Mj0iMjY5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzMSIgeDI9Ijc2OSIgeTI9IjIzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxOTMiIHgyPSI3NjkiIHkyPSIxOTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTU1IiB4Mj0iNzY5IiB5Mj0iMTU1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExNyIgeDI9Ijc2OSIgeTI9IjExNyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI3OSIgeDI9Ijc2OSIgeTI9Ijc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQxIiB4Mj0iNzY5IiB5Mj0iNDEiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY0LDM0IDY0LDM0NCAiLz4KPHRleHQgeD0iNTUiIHk9IjM0NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDM0NCA2NCwzNDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIzMDciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMzA3IDY0LDMwNyAiLz4KPHRleHQgeD0iNTUiIHk9IjI2OSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwyNjkgNjQsMjY5ICIvPgo8dGV4dCB4PSI1NSIgeT0iMjMxIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDIzMSA2NCwyMzEgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIxOTMiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjQwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMTkzIDY0LDE5MyAiLz4KPHRleHQgeD0iNTUiIHk9IjE1NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwxNTUgNjQsMTU1ICIvPgo8dGV4dCB4PSI1NSIgeT0iMTE3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo2MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDExNyA2NCwxMTcgIi8+Cjx0ZXh0IHg9IjU1IiB5PSI3OSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNzAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSw3OSA2NCw3OSAiLz4KPHRleHQgeD0iNTUiIHk9IjQxIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo4MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDQxIDY0LDQxICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjUsMzQ1IDc2OSwzNDUgIi8+Cjx0ZXh0IHg9Ijk0IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpCdW5kZXNsaWdhCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijk0LDM0NSA5NCwzNTAgIi8+Cjx0ZXh0IHg9IjE1MyIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KU2NvdHRpc2ggUHJlbWllcnNoCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1MywzNDUgMTUzLDM1MCAiLz4KPHRleHQgeD0iMjExIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpTdXBlciBMZWFndWUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjExLDM0NSAyMTEsMzUwICIvPgo8dGV4dCB4PSIyNzAiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClN1cGVybGlnYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyNzAsMzQ1IDI3MCwzNTAgIi8+Cjx0ZXh0IHg9IjMyOSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KR3JlZWsgU3VwZXIgTGVhZ3VlCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjMyOSwzNDUgMzI5LDM1MCAiLz4KPHRleHQgeD0iMzg3IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpQcmVtaWVyIERpdmlzaW9uCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM4NywzNDUgMzg3LDM1MCAiLz4KPHRleHQgeD0iNDQ2IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpTdXBlciBMZWFndWUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDQ2LDM0NSA0NDYsMzUwICIvPgo8dGV4dCB4PSI1MDUiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ckdlcm1hbiBCdW5kZXNsaWdhCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUwNSwzNDUgNTA1LDM1MCAiLz4KPHRleHQgeD0iNTYzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpEdXRjaCBFcmVkaXZpc2llCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU2MywzNDUgNTYzLDM1MCAiLz4KPHRleHQgeD0iNjIyIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpGcmVuY2ggTGlndWUgMQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MjIsMzQ1IDYyMiwzNTAgIi8+Cjx0ZXh0IHg9IjY4MSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUHJlbWllciBMZWFndWUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjgxLDM0NSA2ODEsMzUwICIvPgo8dGV4dCB4PSI3MzkiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClBvcnR1Z3Vlc2UgTGlnYSBQbwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI3MzksMzQ1IDczOSwzNTAgIi8+CjxyZWN0IHg9IjczIiB5PSI3NSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjI2OSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjEzMiIgeT0iOTQiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyNTAiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxOTEiIHk9IjEyOCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjIxNiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjI0OSIgeT0iMTI4IiB3aWR0aD0iNDEiIGhlaWdodD0iMjE2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzA4IiB5PSIxNDciIHdpZHRoPSI0MSIgaGVpZ2h0PSIxOTciIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzNjciIHk9IjE1NSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjE4OSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQyNSIgeT0iMTU1IiB3aWR0aD0iNDEiIGhlaWdodD0iMTg5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDg0IiB5PSIxNjIiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxODIiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1NDMiIHk9IjE2MiIgd2lkdGg9IjQxIiBoZWlnaHQ9IjE4MiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYwMSIgeT0iMTYyIiB3aWR0aD0iNDEiIGhlaWdodD0iMTgyIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjYwIiB5PSIxNzAiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxNzQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI3MTkiIHk9IjE3NCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjE3MCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+Cjwvc3ZnPg==)

## Discussion

**Defending the title is the hardest thing in club football — only 1 in 4
champions goes back-to-back.**

Scope: 999 league-seasons with a determinable champion; 947 offered a defending
champion a chance to retain.

1. **The base rate is 25.1%** — 238 of 947 title defences succeeded. The other
   three-quarters of champions are dethroned.

2. **Dynasties are real but concentrated.** Longest consecutive-title runs: RB
   Salzburg 11 (2013/14→2023/24), Bayern Munich 11 (2012/13→ 2022/23), Juventus
   9, Celtic 9 (both 2011/12→2019/20). Five-peat-or- better is a short list —
   the table is dominated by a handful of superclubs.

3. **Some leagues are structurally easier to defend.** Austria's Bundesliga: 71%
   retention (10/14). Scottish Premiership: 66% (21/32) — the Old Firm duopoly.
   The big-5 leagues sit at 42–48%; Ligue 1 48%, Serie A 42%, EPL ('Premier
   League' label, incl. Russia) 46%.

4. **Defended titles are slightly more dominant.** Champions who retained
   averaged an **8.2-point** winning margin vs **6.6** across all titles —
   retention correlates with winning comfortably.

5. **The 2010s were the dynasty decade.** Retention by decade: 21% (1990s) → 19%
   (2000s) → **30%** (2010s) → 27% (2020s), with unique champions per decade
   rising 77 → 140 → 195 → 191. The modern game is more parity-driven _and_
   produced more dynasties — both at once, because a few superclubs monopolised
   the top while the rest churned.

6. **Caveats:** league labels are source-dependent ('Bundesliga' = Austria,
   'German Bundesliga' = Germany, 'Premier League' = Russia); short-history
   leagues have small opportunity counts; seasons ending mid-table or with
   shared champions are excluded.

**Limitations.** The analysis is limited to the competitions present in the
database; player-level metrics exist only for StatsBomb-covered tournaments, and
underlying event data may contain errors.

## Conclusion

Defending the title is the hardest thing in club football — only 1 in 4
champions goes back-to-back. Together these results answer the research question
posed in the Introduction and quantify the pattern across hundreds of thousands
of matches. The notebook provides a fully reproducible pipeline from raw CSV
extracts to published figures.
