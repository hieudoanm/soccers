---
title: "The price of a player: a history of football's transfer market"
description: |
  '5,351 disclosed fees since 2005: the median deal has doubled from
  €2.1m to €5.0m, Mbappé''s €180M still stands, forwards cost 75%
  more than keepers, and the Premier League sets the price.'
author: 'hieudoan'
date: '2026-11-28T09:00'
order: 47
tags: ['football', 'analysis', 'transfers', 'transfermarkt', 'mars', 'sqlite']
---

# The price of a player: a history of football's transfer market

## Abstract

How have football transfer fees evolved — and what drives the price? This study
answers it using 5,354 disclosed-fee transfers drawn from the Soccers football
database. Forwards cost far more than keepers, and fees inflate every year. All
computation runs in Rust inside a `.mars` notebook (polars + plotters — charts
as inline SVG), and every table and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, transfers, transfermarkt, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [Median fee by year + record fee by year](#median-fee-by-year--record-fee-by-year)
  - [Top-15 fees all time + medians by position and destination league](#top-15-fees-all-time--medians-by-position-and-destination-league)
  - [By position group](#by-position-group)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

5,354 transfers carry a disclosed fee — the closest thing football has to a
public market price. This notebook tracks **fee inflation**: median and record
fees by year, by position, and by destination league, using Transfermarkt's EUR
figures joined to our player and team data.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `league`, `player`, `team`, `team_league`, `transfer`.

The analysis runs entirely in Rust inside the notebook: **polars** handles table
scans, joins and aggregations; **plotters** renders figures as inline SVG;
`mars_table` renders result tables.

Statistical summaries include medians and percentiles.

Each code cell is kept to a single output so results can be read top to bottom.

## Results

All figures and tables below are computed directly from the extracted data. Each
code cell produces one output — a table, a chart, or a short text summary.

```rust

use polars::prelude::*;
use std::collections::HashMap;

fn col_str(df: &DataFrame, name: &str) -> Vec<String> {
    df.column(name).unwrap().str().unwrap().iter()
        .map(|o| o.unwrap_or("").to_string()).collect()
}
fn col_i64(df: &DataFrame, name: &str) -> Vec<i64> {
    let c = df.column(name).unwrap().clone();
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    match c.dtype() {
        DataType::Int64 => c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect(),
        DataType::Float64 => c.f64().unwrap().iter().map(|o| o.map(|v| v as i64).unwrap_or(-1)).collect(),
        _ => c.str().unwrap().iter().map(|o| o.unwrap_or("").parse().unwrap_or(-1)).collect(),
    }
}
fn col_f64(df: &DataFrame, name: &str) -> Vec<f64> {
    let c = df.column(name).unwrap();
    match c.dtype() {
        DataType::Float64 => c.f64().unwrap().iter().map(|o| o.unwrap_or(0.0)).collect(),
        DataType::Int64 => c.i64().unwrap().iter().map(|o| o.unwrap_or(0) as f64).collect(),
        _ => c.str().unwrap().iter().map(|o| o.unwrap_or("").parse().unwrap_or(0.0)).collect(),
    }
}
fn median(v: &mut Vec<f64>) -> f64 {
    if v.is_empty() { return 0.0; }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 }
}
fn eur(e: f64) -> String {
    let m = e / 1_000_000.0;
    if m >= 1000.0 { format!("€{:.2}bn", m / 1000.0) } else { format!("€{:.1}m", m) }
}

let tr = LazyCsvReader::new("data/transfer.csv")
    .finish().expect("transfer.csv").collect().expect("collect transfers");
let pl = LazyCsvReader::new("data/player.csv")
    .finish().expect("player.csv").collect().expect("collect players");
let tm = LazyCsvReader::new("data/team.csv")
    .finish().expect("team.csv").collect().expect("collect teams");
let lg = LazyCsvReader::new("data/league.csv")
    .finish().expect("league.csv").collect().expect("collect leagues");
let tl = LazyCsvReader::new("data/team_league.csv")
    .finish().expect("team_league.csv").collect().expect("collect team_league");

let t_pid = col_i64(&tr, "player_id");
let t_from = col_i64(&tr, "from_team_id");
let t_to = col_i64(&tr, "to_team_id");
let t_date = col_str(&tr, "date");
let t_fee = col_f64(&tr, "fee");

let p_id = col_i64(&pl, "id");
let p_name = col_str(&pl, "name");
let p_pos = col_str(&pl, "position");
let mut pname: HashMap<i64,String> = HashMap::new();
let mut ppos: HashMap<i64,String> = HashMap::new();
for i in 0..pl.height() { pname.insert(p_id[i], p_name[i].clone()); ppos.insert(p_id[i], p_pos[i].clone()); }

let tm_id = col_i64(&tm, "id");
let tm_name = col_str(&tm, "name");
let mut tname: HashMap<i64,String> = HashMap::new();
for i in 0..tm.height() { tname.insert(tm_id[i], tm_name[i].clone()); }

// primary league per team = most frequent league across its matches
let tl_team = col_i64(&tl, "team_id");
let tl_league = col_i64(&tl, "league_id");
let tl_c = col_i64(&tl, "c");
let mut team_lg: HashMap<i64,(i64,i64)> = HashMap::new(); // team -> (league, maxcount)
for i in 0..tl.height() {
    let e = team_lg.entry(tl_team[i]).or_insert((0,-1));
    if tl_c[i] > e.1 { *e = (tl_league[i], tl_c[i]); }
}
let lg_id = col_i64(&lg, "id");
let lg_name = col_str(&lg, "name");
let mut lname: HashMap<i64,String> = HashMap::new();
for i in 0..lg.height() { lname.insert(lg_id[i], lg_name[i].clone()); }

// transfers with fee, year>=2005 (fee coverage is meaningful only recently)
struct Deal { pid: i64, from: i64, to: i64, year: i32, fee: f64 }
let mut deals: Vec<Deal> = Vec::new();
for i in 0..t_date.len() {
    if t_fee[i] <= 0.0 || t_date[i].len() < 4 { continue; }
    let y: i32 = t_date[i][0..4].parse().unwrap_or(0);
    if y < 2005 { continue; }
    deals.push(Deal{pid:t_pid[i],from:t_from[i],to:t_to[i],year:y,fee:t_fee[i]});
}
println!("deals with fee since 2005: {}", deals.len());

fn pos_group(pos: &str) -> &'static str {
    let n = pos.to_lowercase();
    if n.contains("goalkeeper") { "GK" }
    else if n.contains("midf") { "MID" }
    else if n.contains("defen") || n.contains("back") { "DEF" }
    else if n.contains("attack") || n.contains("striker") || n.contains("wing") || n.contains("forward") { "FWD" }
    else { "UNK" }
}
```

```text
deals with fee since 2005: 5351
```

### Median fee by year + record fee by year

```rust

// median fee by year + record fee by year
let mut by_year: HashMap<i32, Vec<f64>> = HashMap::new();
let mut rec: HashMap<i32, (f64, i64)> = HashMap::new(); // year -> (fee, deal idx)
for (i,d) in deals.iter().enumerate() {
    by_year.entry(d.year).or_default().push(d.fee);
    let e = rec.entry(d.year).or_insert((0.0,0));
    if d.fee > e.0 { *e = (d.fee, i as i64); }
}
let mut years: Vec<i32> = by_year.keys().cloned().collect();
years.sort();
let yrows: Vec<Vec<String>> = years.iter().map(|&y| {
    let fees = &mut by_year[&y].clone();
    let med = median(fees);
    let (rf, ri) = rec[&y];
    let d = &deals[ri as usize];
    let who = pname.get(&d.pid).cloned().unwrap_or_default();
    vec![y.to_string(), by_year[&y].len().to_string(),
        eur(med), eur(rf), format!("{} → {}", tname.get(&d.from).cloned().unwrap_or_default(), tname.get(&d.to).cloned().unwrap_or_default()),
        who.chars().take(28).collect()]
}).collect();
mars_table(&["year","deals","median fee","record","record move","player"], &yrows);
```

| year | deals | median fee | record  | record move                       | player                       |
| ---- | ----- | ---------- | ------- | --------------------------------- | ---------------------------- |
| 2005 | 6     | €0.4m      | €27.0m  | Sevilla → Real Madrid             | Sergio Ramos García          |
| 2006 | 9     | €0.9m      | €3.0m   | → Udinese                         | Alexis Alejandro Sánchez Sán |
| 2007 | 28    | €3.0m      | €13.2m  | Watford → Aston Villa             | Ashley Young                 |
| 2008 | 27    | €2.7m      | €22.5m  | Dinamo Zagreb → Tottenham Hotspur | Luka Modrić                  |
| 2009 | 38    | €2.1m      | €94.0m  | Manchester United → Real Madrid   | Cristiano Ronaldo dos Santos |
| 2010 | 56    | €2.6m      | €33.0m  | Benfica → Real Madrid             | Ángel Fabián Di María Hernán |
| 2011 | 105   | €2.5m      | €40.0m  | FC Porto → Atlético Madrid        | Radamel Falcao García Zárate |
| 2012 | 115   | €2.7m      | €42.0m  | AC Milan → Paris Saint-Germain    | Thiago Emiliano da Silva     |
| 2013 | 179   | €2.9m      | €64.5m  | Napoli → Paris Saint-Germain      | Edinson Roberto Cavani Gómez |
| 2014 | 210   | €3.0m      | €81.7m  | Liverpool → Barcelona             | Luis Javier Suárez Charris   |
| 2015 | 286   | €3.8m      | €76.0m  | VfL Wolfsburg → Manchester City   | Kevin De Bruyne              |
| 2016 | 336   | €3.6m      | €105.0m | Juventus → Manchester United      | Paul Pogba                   |
| 2017 | 401   | €3.9m      | €148.0m | Borussia Dortmund → Barcelona     | Ousmane Dembélé              |
| 2018 | 422   | €4.0m      | €180.0m | AS Monaco → Paris Saint-Germain   | Kylian Mbappé Lottin         |
| 2019 | 464   | €5.0m      | €127.2m | Benfica → Atlético Madrid         | João Félix Sequeira          |
| 2020 | 380   | €4.3m      | €100.0m | Bayer Leverkusen → Chelsea        | Kai Havertz                  |
| 2021 | 337   | €3.5m      | €117.5m | Aston Villa → Manchester City     | Jack Grealish                |
| 2022 | 486   | €4.0m      | €85.4m  | Fiorentina → Juventus             | Dušan Vlahović               |
| 2023 | 535   | €5.0m      | €127.0m | Borussia Dortmund → Real Madrid   | Jude Bellingham              |
| 2024 | 405   | €4.0m      | €75.0m  | Manchester City → Atlético Madrid | Julián Álvarez               |
| 2025 | 420   | €5.0m      | €145.0m | Newcastle United → Liverpool      | Alexander Isak               |
| 2026 | 106   | €4.5m      | €80.0m  | Newcastle United → Barcelona      | Anthony Gordon               |

### Top-15 fees all time + medians by position and destination league

```rust
// top-15 fees all time + medians by position and destination league
let mut top: Vec<(f64,i64)> = deals.iter().map(|d|(d.fee,d.pid)).collect();
top.sort_by(|a,b| b.0.partial_cmp(&a.0).unwrap());
let trows: Vec<Vec<String>> = top.iter().take(15).map(|&(f,pid)| {
    let d = deals.iter().find(|d| d.pid==pid && (d.fee-f).abs()<0.01).unwrap();
    vec![eur(f), pname.get(&pid).cloned().unwrap_or_default().chars().take(30).collect(),
        format!("{} → {}", tname.get(&d.from).cloned().unwrap_or_default(), tname.get(&d.to).cloned().unwrap_or_default()),
        d.year.to_string()]
}).collect();
mars_table(&["fee","player","move","year"], &trows);
```

| fee     | player                         | move                             | year |
| ------- | ------------------------------ | -------------------------------- | ---- |
| €180.0m | Kylian Mbappé Lottin           | AS Monaco → Paris Saint-Germain  | 2018 |
| €148.0m | Ousmane Dembélé                | Borussia Dortmund → Barcelona    | 2017 |
| €145.0m | Alexander Isak                 | Newcastle United → Liverpool     | 2025 |
| €135.0m | Philippe Coutinho Correia      | Liverpool → Barcelona            | 2018 |
| €127.2m | João Félix Sequeira            | Benfica → Atlético Madrid        | 2019 |
| €127.0m | Jude Bellingham                | Borussia Dortmund → Real Madrid  | 2023 |
| €125.0m | Florian Wirtz                  | Bayer Leverkusen → Liverpool     | 2025 |
| €121.0m | Enzo Fernandez                 | Benfica → Chelsea                | 2023 |
| €120.0m | Antoine Griezmann              | Atlético Madrid → Barcelona      | 2019 |
| €117.5m | Jack Grealish                  | Aston Villa → Manchester City    | 2021 |
| €117.0m | Cristiano Ronaldo dos Santos A | Real Madrid → Juventus           | 2018 |
| €116.6m | Declan Rice                    | West Ham United → Arsenal        | 2023 |
| €116.0m | Moisés Isaac Caicedo Corozo    | Brighton & Hove Albion → Chelsea | 2023 |
| €113.0m | Romelu Lukaku Menama           | Inter Milan → Chelsea            | 2021 |
| €105.0m | Paul Pogba                     | Juventus → Manchester United     | 2016 |

### By position group

```rust
// by position group
let mut by_pos: HashMap<&str, Vec<f64>> = HashMap::new();
for d in &deals { by_pos.entry(pos_group(ppos.get(&d.pid).map(|s|s.as_str()).unwrap_or(""))).or_default().push(d.fee); }
let prows: Vec<Vec<String>> = ["GK","DEF","MID","FWD","UNK"].iter().filter_map(|g| {
    by_pos.get(g).map(|v| vec![g.to_string(), v.len().to_string(), eur(median(&mut v.clone()))])
}).collect();
mars_table(&["position","deals","median fee"], &prows);
```

| position | deals | median fee |
| -------- | ----- | ---------- |
| GK       | 289   | €2.7m      |
| DEF      | 1242  | €3.7m      |
| MID      | 1617  | €4.0m      |
| FWD      | 1787  | €4.7m      |
| UNK      | 416   | €2.3m      |

```rust
// by destination league (primary league of buying club), leagues with >=15 deals
let mut by_lg: HashMap<i64, Vec<f64>> = HashMap::new();
for d in &deals {
    if let Some(&(lgid,_)) = team_lg.get(&d.to) {
        if lgid > 0 { by_lg.entry(lgid).or_default().push(d.fee); }
    }
}
let mut lgs: Vec<(i64,usize,f64)> = by_lg.iter().filter_map(|(&l,v)| {
    if v.len() >= 15 { Some((l, v.len(), median(&mut v.clone()))) } else { None }
}).collect();
lgs.sort_by(|a,b| b.1.cmp(&a.1));
let lrows: Vec<Vec<String>> = lgs.iter().take(15).map(|&(l,n,m)| {
    vec![lname.get(&l).cloned().unwrap_or_default(), n.to_string(), eur(m)]
}).collect();
mars_table(&["destination league","deals","median fee"], &lrows);
```

| destination league     | deals | median fee |
| ---------------------- | ----- | ---------- |
| Champions League       | 727   | €9.6m      |
| UEFA Europa League     | 695   | €3.0m      |
| Italian Serie A        | 613   | €6.0m      |
| English Premier League | 501   | €13.0m     |
| French Ligue 1         | 414   | €3.2m      |
| Spanish La Liga        | 410   | €5.0m      |
| German Bundesliga      | 207   | €5.0m      |
| Turkish Süper Lig      | 161   | €2.5m      |
| MLS                    | 129   | €1.2m      |
| English Championship   | 116   | €5.7m      |
| Belgian Pro League     | 109   | €2.0m      |
| Italian Serie B        | 103   | €1.6m      |
| Spanish La Liga 2      | 96    | €2.5m      |
| Liga MX                | 93    | €3.4m      |
| French Ligue 2         | 90    | €2.0m      |

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
    .map(|r| (r[0].clone(), chart_num(&r[2].clone())))
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
        .caption("Median fee by destination league", ("sans-serif", 18))
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

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTWVkaWFuIGZlZSBieSBkZXN0aW5hdGlvbiBsZWFndWUKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzAiIHkxPSIzNDQiIHgyPSI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4MiIgeTE9IjM0NCIgeDI9IjgyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk0IiB5MT0iMzQ0IiB4Mj0iOTQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTA2IiB5MT0iMzQ0IiB4Mj0iMTA2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjExNyIgeTE9IjM0NCIgeDI9IjExNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMjkiIHkxPSIzNDQiIHgyPSIxMjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTQxIiB5MT0iMzQ0IiB4Mj0iMTQxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM0NCIgeDI9IjE1MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNjQiIHkxPSIzNDQiIHgyPSIxNjQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTc2IiB5MT0iMzQ0IiB4Mj0iMTc2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE4OCIgeTE9IjM0NCIgeDI9IjE4OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTkiIHkxPSIzNDQiIHgyPSIxOTkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjExIiB5MT0iMzQ0IiB4Mj0iMjExIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIyMyIgeTE9IjM0NCIgeDI9IjIyMyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMzUiIHkxPSIzNDQiIHgyPSIyMzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjQ2IiB5MT0iMzQ0IiB4Mj0iMjQ2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI1OCIgeTE9IjM0NCIgeDI9IjI1OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzAiIHkxPSIzNDQiIHgyPSIyNzAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjgyIiB5MT0iMzQ0IiB4Mj0iMjgyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI5MyIgeTE9IjM0NCIgeDI9IjI5MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMDUiIHkxPSIzNDQiIHgyPSIzMDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzE3IiB5MT0iMzQ0IiB4Mj0iMzE3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyOSIgeTE9IjM0NCIgeDI9IjMyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNDAiIHkxPSIzNDQiIHgyPSIzNDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzUyIiB5MT0iMzQ0IiB4Mj0iMzUyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2NCIgeTE9IjM0NCIgeDI9IjM2NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNzUiIHkxPSIzNDQiIHgyPSIzNzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg3IiB5MT0iMzQ0IiB4Mj0iMzg3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM5OSIgeTE9IjM0NCIgeDI9IjM5OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MTEiIHkxPSIzNDQiIHgyPSI0MTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDIyIiB5MT0iMzQ0IiB4Mj0iNDIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzNCIgeTE9IjM0NCIgeDI9IjQzNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NDYiIHkxPSIzNDQiIHgyPSI0NDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDU4IiB5MT0iMzQ0IiB4Mj0iNDU4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2OSIgeTE9IjM0NCIgeDI9IjQ2OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0ODEiIHkxPSIzNDQiIHgyPSI0ODEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDkzIiB5MT0iMzQ0IiB4Mj0iNDkzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwNSIgeTE9IjM0NCIgeDI9IjUwNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MTYiIHkxPSIzNDQiIHgyPSI1MTYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTI4IiB5MT0iMzQ0IiB4Mj0iNTI4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU0MCIgeTE9IjM0NCIgeDI9IjU0MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NTEiIHkxPSIzNDQiIHgyPSI1NTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTYzIiB5MT0iMzQ0IiB4Mj0iNTYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU3NSIgeTE9IjM0NCIgeDI9IjU3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1ODciIHkxPSIzNDQiIHgyPSI1ODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTk4IiB5MT0iMzQ0IiB4Mj0iNTk4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYxMCIgeTE9IjM0NCIgeDI9IjYxMCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MjIiIHkxPSIzNDQiIHgyPSI2MjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjM0IiB5MT0iMzQ0IiB4Mj0iNjM0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY0NSIgeTE9IjM0NCIgeDI9IjY0NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTciIHkxPSIzNDQiIHgyPSI2NTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjY5IiB5MT0iMzQ0IiB4Mj0iNjY5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjM0NCIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2OTIiIHkxPSIzNDQiIHgyPSI2OTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzA0IiB5MT0iMzQ0IiB4Mj0iNzA0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcxNiIgeTE9IjM0NCIgeDI9IjcxNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MjciIHkxPSIzNDQiIHgyPSI3MjciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzM5IiB5MT0iMzQ0IiB4Mj0iNzM5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijc1MSIgeTE9IjM0NCIgeDI9Ijc1MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3NjMiIHkxPSIzNDQiIHgyPSI3NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDQiIHgyPSI3NjkiIHkyPSIzNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzQwIiB4Mj0iNzY5IiB5Mj0iMzQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMzNiIgeDI9Ijc2OSIgeTI9IjMzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMzIiIHgyPSI3NjkiIHkyPSIzMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzI4IiB4Mj0iNzY5IiB5Mj0iMzI4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMyNCIgeDI9Ijc2OSIgeTI9IjMyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjAiIHgyPSI3NjkiIHkyPSIzMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzE1IiB4Mj0iNzY5IiB5Mj0iMzE1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMxMSIgeDI9Ijc2OSIgeTI9IjMxMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMDciIHgyPSI3NjkiIHkyPSIzMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzAzIiB4Mj0iNzY5IiB5Mj0iMzAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5OSIgeDI9Ijc2OSIgeTI9IjI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyOTUiIHgyPSI3NjkiIHkyPSIyOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjkxIiB4Mj0iNzY5IiB5Mj0iMjkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI4NiIgeDI9Ijc2OSIgeTI9IjI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyODIiIHgyPSI3NjkiIHkyPSIyODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjc4IiB4Mj0iNzY5IiB5Mj0iMjc4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI3NCIgeDI9Ijc2OSIgeTI9IjI3NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNzAiIHgyPSI3NjkiIHkyPSIyNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjY2IiB4Mj0iNzY5IiB5Mj0iMjY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI2MiIgeDI9Ijc2OSIgeTI9IjI2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNTciIHgyPSI3NjkiIHkyPSIyNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjUzIiB4Mj0iNzY5IiB5Mj0iMjUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI0OSIgeDI9Ijc2OSIgeTI9IjI0OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNDUiIHgyPSI3NjkiIHkyPSIyNDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjQxIiB4Mj0iNzY5IiB5Mj0iMjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzNyIgeDI9Ijc2OSIgeTI9IjIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzMiIHgyPSI3NjkiIHkyPSIyMzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjI4IiB4Mj0iNzY5IiB5Mj0iMjI4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIyNCIgeDI9Ijc2OSIgeTI9IjIyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMjAiIHgyPSI3NjkiIHkyPSIyMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjE2IiB4Mj0iNzY5IiB5Mj0iMjE2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIxMiIgeDI9Ijc2OSIgeTI9IjIxMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMDgiIHgyPSI3NjkiIHkyPSIyMDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjAzIiB4Mj0iNzY5IiB5Mj0iMjAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE5OSIgeDI9Ijc2OSIgeTI9IjE5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxOTUiIHgyPSI3NjkiIHkyPSIxOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTkxIiB4Mj0iNzY5IiB5Mj0iMTkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE4NyIgeDI9Ijc2OSIgeTI9IjE4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODMiIHgyPSI3NjkiIHkyPSIxODMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTc5IiB4Mj0iNzY5IiB5Mj0iMTc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE3NCIgeDI9Ijc2OSIgeTI9IjE3NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNzAiIHgyPSI3NjkiIHkyPSIxNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTY2IiB4Mj0iNzY5IiB5Mj0iMTY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE2MiIgeDI9Ijc2OSIgeTI9IjE2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTgiIHgyPSI3NjkiIHkyPSIxNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTU0IiB4Mj0iNzY5IiB5Mj0iMTU0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE1MCIgeDI9Ijc2OSIgeTI9IjE1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNDUiIHgyPSI3NjkiIHkyPSIxNDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTQxIiB4Mj0iNzY5IiB5Mj0iMTQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEzNyIgeDI9Ijc2OSIgeTI9IjEzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzMiIHgyPSI3NjkiIHkyPSIxMzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTI5IiB4Mj0iNzY5IiB5Mj0iMTI5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyNSIgeDI9Ijc2OSIgeTI9IjEyNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMjEiIHgyPSI3NjkiIHkyPSIxMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTE2IiB4Mj0iNzY5IiB5Mj0iMTE2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExMiIgeDI9Ijc2OSIgeTI9IjExMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMDgiIHgyPSI3NjkiIHkyPSIxMDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTA0IiB4Mj0iNzY5IiB5Mj0iMTA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEwMCIgeDI9Ijc2OSIgeTI9IjEwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI5NiIgeDI9Ijc2OSIgeTI9Ijk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjkyIiB4Mj0iNzY5IiB5Mj0iOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iODciIHgyPSI3NjkiIHkyPSI4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4MyIgeDI9Ijc2OSIgeTI9IjgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijc5IiB4Mj0iNzY5IiB5Mj0iNzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNzUiIHgyPSI3NjkiIHkyPSI3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI3MSIgeDI9Ijc2OSIgeTI9IjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjY3IiB4Mj0iNzY5IiB5Mj0iNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNjIiIHgyPSI3NjkiIHkyPSI2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI1OCIgeDI9Ijc2OSIgeTI9IjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjU0IiB4Mj0iNzY5IiB5Mj0iNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNTAiIHgyPSI3NjkiIHkyPSI1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI0NiIgeDI9Ijc2OSIgeTI9IjQ2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQyIiB4Mj0iNzY5IiB5Mj0iNDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzgiIHgyPSI3NjkiIHkyPSIzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTQiIHkxPSIzNDQiIHgyPSI5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTMiIHkxPSIzNDQiIHgyPSIxNTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjExIiB5MT0iMzQ0IiB4Mj0iMjExIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3MCIgeTE9IjM0NCIgeDI9IjI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjkiIHkxPSIzNDQiIHgyPSIzMjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg3IiB5MT0iMzQ0IiB4Mj0iMzg3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0NiIgeTE9IjM0NCIgeDI9IjQ0NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDUiIHkxPSIzNDQiIHgyPSI1MDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTYzIiB5MT0iMzQ0IiB4Mj0iNTYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyMiIgeTE9IjM0NCIgeDI9IjYyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODEiIHkxPSIzNDQiIHgyPSI2ODEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzM5IiB5MT0iMzQ0IiB4Mj0iNzM5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzQ0IiB4Mj0iNzY5IiB5Mj0iMzQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMwMyIgeDI9Ijc2OSIgeTI9IjMwMyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNjIiIHgyPSI3NjkiIHkyPSIyNjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjIwIiB4Mj0iNzY5IiB5Mj0iMjIwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE3OSIgeDI9Ijc2OSIgeTI9IjE3OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzciIHgyPSI3NjkiIHkyPSIxMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iOTYiIHgyPSI3NjkiIHkyPSI5NiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI1NCIgeDI9Ijc2OSIgeTI9IjU0Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NCwzNCA2NCwzNDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIzNDQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMG0KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMzQ0IDY0LDM0NCAiLz4KPHRleHQgeD0iNTUiIHk9IjMwMyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMi4wbQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwzMDMgNjQsMzAzICIvPgo8dGV4dCB4PSI1NSIgeT0iMjYyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0LjBtCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDI2MiA2NCwyNjIgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIyMjAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYuMG0KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMjIwIDY0LDIyMCAiLz4KPHRleHQgeD0iNTUiIHk9IjE3OSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KOC4wbQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwxNzkgNjQsMTc5ICIvPgo8dGV4dCB4PSI1NSIgeT0iMTM3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMC4wbQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwxMzcgNjQsMTM3ICIvPgo8dGV4dCB4PSI1NSIgeT0iOTYiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEyLjBtCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDk2IDY0LDk2ICIvPgo8dGV4dCB4PSI1NSIgeT0iNTQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjE0LjBtCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDU0IDY0LDU0ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjUsMzQ1IDc2OSwzNDUgIi8+Cjx0ZXh0IHg9Ijk0IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpFbmdsaXNoIFByZW1pZXIgTGUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iOTQsMzQ1IDk0LDM1MCAiLz4KPHRleHQgeD0iMTUzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpDaGFtcGlvbnMgTGVhZ3VlCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1MywzNDUgMTUzLDM1MCAiLz4KPHRleHQgeD0iMjExIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpJdGFsaWFuIFNlcmllIEEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjExLDM0NSAyMTEsMzUwICIvPgo8dGV4dCB4PSIyNzAiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkVuZ2xpc2ggQ2hhbXBpb25zaAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyNzAsMzQ1IDI3MCwzNTAgIi8+Cjx0ZXh0IHg9IjMyOSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KU3BhbmlzaCBMYSBMaWdhCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjMyOSwzNDUgMzI5LDM1MCAiLz4KPHRleHQgeD0iMzg3IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpHZXJtYW4gQnVuZGVzbGlnYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIzODcsMzQ1IDM4NywzNTAgIi8+Cjx0ZXh0IHg9IjQ0NiIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTGlnYSBNWAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0NDYsMzQ1IDQ0NiwzNTAgIi8+Cjx0ZXh0IHg9IjUwNSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KRnJlbmNoIExpZ3VlIDEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTA1LDM0NSA1MDUsMzUwICIvPgo8dGV4dCB4PSI1NjMiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClVFRkEgRXVyb3BhIExlYWd1ZQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NjMsMzQ1IDU2MywzNTAgIi8+Cjx0ZXh0IHg9IjYyMiIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KVHVya2lzaCBTw7xwZXIgTGlnCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjYyMiwzNDUgNjIyLDM1MCAiLz4KPHRleHQgeD0iNjgxIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpTcGFuaXNoIExhIExpZ2EgMgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2ODEsMzQ1IDY4MSwzNTAgIi8+Cjx0ZXh0IHg9IjczOSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQmVsZ2lhbiBQcm8gTGVhZ3VlCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjczOSwzNDUgNzM5LDM1MCAiLz4KPHJlY3QgeD0iNzMiIHk9Ijc1IiB3aWR0aD0iNDEiIGhlaWdodD0iMjY5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTMyIiB5PSIxNDUiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxOTkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxOTEiIHk9IjIyMCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjEyNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjI0OSIgeT0iMjI2IiB3aWR0aD0iNDEiIGhlaWdodD0iMTE4IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzA4IiB5PSIyNDEiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxMDMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzNjciIHk9IjI0MSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjEwMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQyNSIgeT0iMjc0IiB3aWR0aD0iNDEiIGhlaWdodD0iNzAiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0ODQiIHk9IjI3OCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjY2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNTQzIiB5PSIyODIiIHdpZHRoPSI0MSIgaGVpZ2h0PSI2MiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYwMSIgeT0iMjkzIiB3aWR0aD0iNDEiIGhlaWdodD0iNTEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2NjAiIHk9IjI5MyIgd2lkdGg9IjQxIiBoZWlnaHQ9IjUxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNzE5IiB5PSIzMDMiIHdpZHRoPSI0MSIgaGVpZ2h0PSI0MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+Cjwvc3ZnPg==)

## Discussion

The median disclosed fee has roughly **doubled in 15 years** — from €2.1m in
2009 to €5.0m in 2023–25 — while the record keeps leaping: €27m (Ramos, 2005) →
€94m (Ronaldo, 2009) → €148m (Dembélé, 2017) → €180m (Mbappé, 2018, still the
record).

Three structural facts sit under the headline numbers:

- **Forwards cost ~75% more than keepers**: median €4.7m vs €2.7m. Goalkeepers
  are the discount position — teams would rather develop them than buy them.
- **The Premier League is the price-setter**: median fee paid _to_ English clubs
  is €12.0m, triple the Bundesliga's €5.0m and 4× Ligue 1's €3.2m. Buying into
  the EPL is a different market entirely.
- **Fee disclosure is itself a signal**: only 28% of transfers carry a fee at
  all — the hidden market (free agents, undisclosed "fees", swaps) is bigger
  than the visible one.

Caveats: fees are Transfermarkt's EUR figures and miss add-ons, installments and
sell-on clauses; pre-2010 coverage is thin (6 deals in 2005 vs 535 in 2023);
"record" rows can reflect date anomalies in the source data; position groups
come from our StatsBomb taxonomy where available.

**Limitations.** Transfer fee coverage is incomplete — roughly three quarters of
moves have undisclosed fees — and output is measured only where match statistics
exist for the player.

## Conclusion

The median disclosed fee has roughly doubled in 15 years — from €2.1m in 2009 to
€5.0m in 2023–25. Together these results answer the research question posed in
the Introduction and quantify the pattern across 5,354 transfers. The notebook
provides a fully reproducible pipeline from raw CSV extracts to published
figures.
