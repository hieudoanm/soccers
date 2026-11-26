---
title: "Selling vs buying clubs: the transfer market's hunters and farms"
description: |
  '584 clubs ranked: five of the six biggest net spenders are English,
  Benfica takes in €1.07bn, and Nordsjælland earns 392× what it
  spends — development companies that happen to play football.'
author: 'hieudoan'
date: '2026-11-28T15:00'
order: 53
tags: ['football', 'analysis', 'transfers', 'transfermarkt', 'mars', 'sqlite']
---

# Selling vs buying clubs: the transfer market's hunters and farms

## Abstract

Which clubs spend big — and which clubs quietly sell talent? This study answers
it using 19,436 transfers drawn from the Soccers football database. The analysis
quantifies the pattern directly from the data. All computation runs in Rust
inside a `.mars` notebook (polars + plotters — charts as inline SVG), and every
table and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, transfers, transfermarkt, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [Top net spenders (money in > money out)](#top-net-spenders-money-in--money-out)
  - [Top net sellers (money out > money in) — the farms](#top-net-sellers-money-out--money-in--the-farms)
  - [Net talent flow: most players sold minus bought (min 15 total moves)](#net-talent-flow-most-players-sold-minus-bought-min-15-total-moves)
  - [The factories: high sell-fee, low buy-fee ratio (min €20m sold)](#the-factories-high-sell-fee-low-buy-fee-ratio-min-20m-sold)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

Aggregating all 19,436 transfers by club produces a market map at team level:
who spends, who sells, and who runs a **development-and-flip** operation —
buying young or buying cheap, selling at a huge markup.

This notebook ranks clubs by net spend (fees paid minus fees received), net
talent flow (players in minus players out), and identifies the serial sellers
whose business model _is_ the transfer market.

Caveats: only ~28% of transfers carry a fee, so fee columns understate true
money flows; "net talent" counts all moves including loans-free transfers and
free agents; club names are fuzzy-matched from Transfermarkt and can
occasionally conflate same-named clubs.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `country`, `team`, `transfer`.

The analysis runs entirely in Rust inside the notebook: **polars** handles table
scans, joins and aggregations; **plotters** renders figures as inline SVG;
`mars_table` renders result tables.

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
fn load(name: &str) -> DataFrame {
    LazyCsvReader::new(&format!("data/{}.csv", name))
        .finish().expect(name).collect().expect("collect")
}
fn d10(s: &str) -> &str { &s[..10.min(s.len())] }
fn days(y: i32, m: i32, d: i32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = ((m + 9) % 12) as i64;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}
fn day_of(s: &str) -> i64 {
    let b = d10(s).as_bytes();
    if b.len() < 10 { return -1; }
    let y: i32 = s[0..4].parse().unwrap_or(0);
    let m: i32 = s[5..7].parse().unwrap_or(0);
    let d: i32 = s[8..10].parse().unwrap_or(0);
    days(y, m, d)
}

let tr = load("transfer");
let tm = load("team");

let t_from = col_i64(&tr, "from_team_id");
let t_to = col_i64(&tr, "to_team_id");
let t_fee = col_f64(&tr, "fee");
let t_date = col_str(&tr, "date");

let tm_id = col_i64(&tm, "id");
let tm_name = col_str(&tm, "name");
let tm_cty = col_i64(&tm, "country_id");
let c_id = col_i64(&load("country"), "id");
let c_name = col_str(&load("country"), "name");
let mut cname: HashMap<i64,String> = HashMap::new();
for i in 0..c_id.len() { cname.insert(c_id[i], c_name[i].clone()); }
let mut tname: HashMap<i64,String> = HashMap::new();
let mut tcty: HashMap<i64,String> = HashMap::new();
for i in 0..tm.height() {
    tname.insert(tm_id[i], tm_name[i].clone());
    tcty.insert(tm_id[i], cname.get(&tm_cty[i]).cloned().unwrap_or_default());
}

#[derive(Default)]
struct Club { id: i64, bought_n: i64, sold_n: i64, bought_fee: f64, sold_fee: f64,
              intl_bought: i64, intl_sold: i64 }
let mut clubs: HashMap<i64, Club> = HashMap::new();
let mut intl_pairs = 0i64;
for i in 0..t_from.len() {
    let f = t_from[i]; let t = t_to[i];
    if f <= 0 || t <= 0 { continue; }
    let fee = if t_fee[i] > 0.0 { t_fee[i] } else { 0.0 };
    let intl = tcty.get(&f) != tcty.get(&t);
    if intl { intl_pairs += 1; }
    {
        let e = clubs.entry(t).or_insert(Club{id:t,..Default::default()});
        e.bought_n += 1; e.bought_fee += fee;
        if intl { e.intl_bought += 1; }
    }
    {
        let e = clubs.entry(f).or_insert(Club{id:f,..Default::default()});
        e.sold_n += 1; e.sold_fee += fee;
        if intl { e.intl_sold += 1; }
    }
}
println!("clubs tracked: {}, international moves: {}", clubs.len(), intl_pairs);

fn eur(e: f64) -> String {
    let m = e/1_000_000.0;
    if m >= 1000.0 { format!("€{:.2}bn", m/1000.0) } else { format!("€{:.1}m", m) }
}
fn club_rows(v: &mut Vec<(&i64,&Club)>, tname: &HashMap<i64,String>, tcty: &HashMap<i64,String>, n: usize) -> Vec<Vec<String>> {
    v.truncate(n);
    v.iter().map(|(id,c)| vec![
        tname.get(*id).cloned().unwrap_or_default().chars().take(28).collect(),
        tcty.get(*id).cloned().unwrap_or_default(),
        c.bought_n.to_string(), c.sold_n.to_string(),
        eur(c.bought_fee), eur(c.sold_fee),
        eur(c.bought_fee - c.sold_fee),
    ]).collect()
}
```

```text
clubs tracked: 584, international moves: 8645
```

### Top net spenders (money in > money out)

```rust

// top net spenders (money in > money out)
let mut spend: Vec<(&i64,&Club)> = clubs.iter().map(|(k,v)|(k,v)).collect();
spend.sort_by(|a,b| (b.1.bought_fee - b.1.sold_fee).partial_cmp(&(a.1.bought_fee - a.1.sold_fee)).unwrap());
let srows = club_rows(&mut spend, &tname, &tcty, 20);
mars_table(&["club","country","in","out","fees paid","fees received","net spend"], &srows);
```

| club                | country | in  | out | fees paid | fees received | net spend |
| ------------------- | ------- | --- | --- | --------- | ------------- | --------- |
| Manchester United   | England | 97  | 87  | €1.85bn   | €567.4m       | €1.28bn   |
| Manchester City     | England | 122 | 115 | €1.95bn   | €724.0m       | €1.23bn   |
| Arsenal             | England | 96  | 88  | €1.42bn   | €301.0m       | €1.12bn   |
| Chelsea             | England | 183 | 185 | €2.07bn   | €1.04bn       | €1.03bn   |
| Paris Saint-Germain | France  | 118 | 123 | €1.56bn   | €553.6m       | €1.01bn   |
| Liverpool           | England | 86  | 78  | €1.50bn   | €699.4m       | €799.5m   |
| Tottenham Hotspur   | England | 117 | 100 | €1.25bn   | €516.5m       | €735.0m   |
| Barcelona           | Spain   | 154 | 175 | €1.41bn   | €771.7m       | €643.3m   |
| AC Milan            |         | 121 | 103 | €914.1m   | €369.1m       | €544.9m   |
| Juventus            | Italy   | 143 | 130 | €1.33bn   | €808.1m       | €518.8m   |
| Bayern Munich       | Germany | 88  | 86  | €1.04bn   | €641.0m       | €403.1m   |
| Napoli              | Italy   | 118 | 102 | €895.2m   | €546.4m       | €348.8m   |
| Al Hilal            |         | 20  | 10  | €345.2m   | €6.5m         | €338.7m   |
| Real Madrid         | Spain   | 80  | 81  | €1.01bn   | €681.3m       | €330.9m   |
| West Ham United     | England | 75  | 64  | €730.0m   | €424.1m       | €305.9m   |
| Al Nassr            |         | 25  | 14  | €303.0m   | €31.5m        | €271.5m   |
| Inter Milan         | Italy   | 167 | 157 | €853.8m   | €586.4m       | €267.3m   |
| Aston Villa         | England | 96  | 80  | €667.1m   | €403.7m       | €263.4m   |
| Atlético Madrid     | Spain   | 123 | 122 | €984.6m   | €755.5m       | €229.1m   |
| Al Ahli             |         | 19  | 12  | €200.8m   | €10.4m        | €190.5m   |

### Top net sellers (money out > money in) — the farms

```rust

// top net sellers (money out > money in) — the farms
let mut sell: Vec<(&i64,&Club)> = clubs.iter().map(|(k,v)|(k,v)).collect();
sell.sort_by(|a,b| (a.1.bought_fee - a.1.sold_fee).partial_cmp(&(b.1.bought_fee - b.1.sold_fee)).unwrap());
let rows2 = club_rows(&mut sell, &tname, &tcty, 20);
mars_table(&["club","country","in","out","fees paid","fees received","net spend"], &rows2);
```

| club                | country     | in  | out | fees paid | fees received | net spend |
| ------------------- | ----------- | --- | --- | --------- | ------------- | --------- |
| Benfica             | Portugal    | 112 | 124 | €400.0m   | €1.07bn       | €-673.4m  |
| Ajax Amsterdam      |             | 61  | 74  | €355.9m   | €857.1m       | €-501.1m  |
| Lille               | France      | 93  | 103 | €262.5m   | €758.6m       | €-496.1m  |
| Salzburg            | Austria     | 46  | 65  | €85.7m    | €490.7m       | €-405.0m  |
| Sporting CP         |             | 67  | 82  | €224.9m   | €614.4m       | €-389.5m  |
| AS Monaco           | Monaco      | 124 | 132 | €782.4m   | €1.11bn       | €-329.1m  |
| Lyon                | France      | 89  | 102 | €403.5m   | €723.5m       | €-319.9m  |
| FC Porto            |             | 95  | 96  | €264.3m   | €572.0m       | €-307.7m  |
| Real Sociedad       | Spain       | 47  | 54  | €171.2m   | €426.6m       | €-255.4m  |
| Eintracht Frankfurt | Germany     | 100 | 84  | €307.4m   | €561.8m       | €-254.4m  |
| Udinese             | Italy       | 94  | 97  | €114.7m   | €343.2m       | €-228.5m  |
| Dinamo Zagreb       |             | 40  | 50  | €21.4m    | €249.5m       | €-228.1m  |
| PSV Eindhoven       | Netherlands | 58  | 54  | €205.1m   | €426.7m       | €-221.7m  |
| VfB Stuttgart       |             | 85  | 82  | €204.2m   | €421.8m       | €-217.6m  |
| Atalanta            | Italy       | 101 | 100 | €450.0m   | €665.8m       | €-215.8m  |
| Sevilla             | Spain       | 119 | 112 | €449.9m   | €656.8m       | €-206.9m  |
| FC Basel            |             | 45  | 50  | €51.7m    | €257.6m       | €-205.9m  |
| Genoa               | Italy       | 102 | 103 | €136.2m   | €328.3m       | €-192.2m  |
| Borussia Dortmund   | Germany     | 94  | 94  | €817.9m   | €1.00bn       | €-185.7m  |
| AZ Alkmaar          | Netherlands | 14  | 24  | €11.1m    | €180.2m       | €-169.1m  |

### Net talent flow: most players sold minus bought (min 15 total moves)

```rust
// net talent flow: most players sold minus bought (min 15 total moves)
let mut flow: Vec<(&i64,&Club)> = clubs.iter()
    .filter(|(_,c)| c.bought_n + c.sold_n >= 15).map(|(k,v)|(k,v)).collect();
flow.sort_by(|a,b| (b.1.sold_n - b.1.bought_n).cmp(&(a.1.sold_n - a.1.bought_n)));
let frows: Vec<Vec<String>> = flow.iter().take(20).map(|(id,c)| vec![
    tname.get(*id).cloned().unwrap_or_default().chars().take(28).collect(),
    tcty.get(*id).cloned().unwrap_or_default(),
    c.bought_n.to_string(), c.sold_n.to_string(),
    (c.sold_n - c.bought_n).to_string(),
    eur(c.sold_fee), eur(c.bought_fee),
]).collect();
mars_table(&["club","country","in","out","net out","fees received","fees paid"], &frows);
```

| club           | country     | in  | out | net out | fees received | fees paid |
| -------------- | ----------- | --- | --- | ------- | ------------- | --------- |
| Barcelona      | Spain       | 154 | 175 | 21      | €771.7m       | €1.41bn   |
| Salzburg       | Austria     | 46  | 65  | 19      | €490.7m       | €85.7m    |
| Toulouse       | France      | 44  | 60  | 16      | €184.8m       | €44.7m    |
| Reims          | France      | 58  | 73  | 15      | €216.9m       | €72.7m    |
| Sporting CP    |             | 67  | 82  | 15      | €614.4m       | €224.9m   |
| Ajax Amsterdam |             | 61  | 74  | 13      | €857.1m       | €355.9m   |
| Lyon           | France      | 89  | 102 | 13      | €723.5m       | €403.5m   |
| Metz           | France      | 38  | 50  | 12      | €139.1m       | €37.4m    |
| Stade Rennais  |             | 103 | 115 | 12      | €682.1m       | €517.9m   |
| Benfica        | Portugal    | 112 | 124 | 12      | €1.07bn       | €400.0m   |
| Nordsjaelland  | Denmark     | 3   | 15  | 12      | €105.9m       | €0.3m     |
| Sochaux        | France      | 11  | 23  | 12      | €13.2m        | €0.0m     |
| Bordeaux       | France      | 41  | 52  | 11      | €138.5m       | €37.2m    |
| Bastia         | France      | 9   | 20  | 11      | €20.8m        | €0.2m     |
| Valenciennes   | France      | 11  | 21  | 10      | €11.3m        | €0.0m     |
| AZ Alkmaar     | Netherlands | 14  | 24  | 10      | €180.2m       | €11.1m    |
| Angers         | France      | 41  | 51  | 10      | €139.8m       | €22.7m    |
| Dinamo Zagreb  |             | 40  | 50  | 10      | €249.5m       | €21.4m    |
| Caen           | France      | 15  | 25  | 10      | €60.0m        | €5.8m     |
| NK Lokomotiva  |             | 9   | 19  | 10      | €15.1m        | €0.0m     |

### The factories: high sell-fee, low buy-fee ratio (min €20m sold)

```rust
// the factories: high sell-fee, low buy-fee ratio (min €20m sold)
let mut fac: Vec<(&i64,&Club)> = clubs.iter()
    .filter(|(_,c)| c.sold_fee >= 20_000_000.0).map(|(k,v)|(k,v)).collect();
fac.sort_by(|a,b| {
    let ra = if a.1.bought_fee>0.0 {a.1.sold_fee/a.1.bought_fee} else {f64::MAX};
    let rb = if b.1.bought_fee>0.0 {b.1.sold_fee/b.1.bought_fee} else {f64::MAX};
    rb.partial_cmp(&ra).unwrap()
});
let facrows: Vec<Vec<String>> = fac.iter().take(15).map(|(id,c)| vec![
    tname.get(*id).cloned().unwrap_or_default().chars().take(28).collect(),
    tcty.get(*id).cloned().unwrap_or_default(),
    c.sold_n.to_string(), c.bought_n.to_string(),
    eur(c.sold_fee), eur(c.bought_fee),
    if c.bought_fee>0.0 { format!("{:.1}x", c.sold_fee/c.bought_fee) } else { "∞".into() },
]).collect();
mars_table(&["club","country","sold","bought","fees in","fees out","sell/buy"], &facrows);
```

| club              | country     | sold | bought | fees in | fees out | sell/buy |
| ----------------- | ----------- | ---- | ------ | ------- | -------- | -------- |
| Mechelen          | Belgium     | 8    | 6      | €20.8m  | €0.0m    | ∞        |
| Lanus             | Argentina   | 8    | 6      | €27.1m  | €0.0m    | ∞        |
| Nordsjaelland     | Denmark     | 15   | 3      | €105.9m | €0.3m    | 392.3x   |
| Nacional          | Portugal    | 23   | 17     | €33.1m  | €0.3m    | 127.3x   |
| Bastia            | France      | 20   | 9      | €20.8m  | €0.2m    | 83.2x    |
| Hajduk Split      |             | 22   | 17     | €31.4m  | €0.4m    | 78.5x    |
| Le Havre          | France      | 34   | 31     | €33.9m  | €1.3m    | 26.0x    |
| Porto             | Portugal    | 15   | 13     | €44.1m  | €2.0m    | 22.1x    |
| Partizan Belgrade |             | 20   | 13     | €64.6m  | €3.8m    | 16.8x    |
| Lech Poznan       | Poland      | 21   | 13     | €45.3m  | €2.7m    | 16.8x    |
| AZ Alkmaar        | Netherlands | 24   | 14     | €180.2m | €11.1m   | 16.2x    |
| Parana            | Brazil      | 10   | 9      | €79.2m  | €5.7m    | 13.9x    |
| Viktoria Plzen    |             | 15   | 9      | €34.7m  | €2.5m    | 13.7x    |
| Bochum            | Germany     | 40   | 41     | €34.1m  | €2.5m    | 13.4x    |
| FC Groningen      |             | 20   | 12     | €42.8m  | €3.5m    | 12.3x    |

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


let mut c_items: Vec<(String, f64)> = srows.iter()
    .map(|r| (r[0].clone(), chart_num(&r[5].clone())))
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
        .caption("Transfer fees received — biggest player-trading clubs", ("sans-serif", 18))
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

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KVHJhbnNmZXIgZmVlcyByZWNlaXZlZCDigJQgYmlnZ2VzdCBwbGF5ZXItdHJhZGluZyBjbHVicwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MCIgeTE9IjM0NCIgeDI9IjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iMzQ0IiB4Mj0iODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTQiIHkxPSIzNDQiIHgyPSI5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDYiIHkxPSIzNDQiIHgyPSIxMDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTE3IiB5MT0iMzQ0IiB4Mj0iMTE3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyOSIgeTE9IjM0NCIgeDI9IjEyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDEiIHkxPSIzNDQiIHgyPSIxNDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzQ0IiB4Mj0iMTUzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2NCIgeTE9IjM0NCIgeDI9IjE2NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNzYiIHkxPSIzNDQiIHgyPSIxNzYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTg4IiB5MT0iMzQ0IiB4Mj0iMTg4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5OSIgeTE9IjM0NCIgeDI9IjE5OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTEiIHkxPSIzNDQiIHgyPSIyMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIzIiB5MT0iMzQ0IiB4Mj0iMjIzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzNSIgeTE9IjM0NCIgeDI9IjIzNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDYiIHkxPSIzNDQiIHgyPSIyNDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU4IiB5MT0iMzQ0IiB4Mj0iMjU4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3MCIgeTE9IjM0NCIgeDI9IjI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyODIiIHkxPSIzNDQiIHgyPSIyODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjkzIiB5MT0iMzQ0IiB4Mj0iMjkzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwNSIgeTE9IjM0NCIgeDI9IjMwNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTciIHkxPSIzNDQiIHgyPSIzMTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI5IiB5MT0iMzQ0IiB4Mj0iMzI5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM0MCIgeTE9IjM0NCIgeDI9IjM0MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNTIiIHkxPSIzNDQiIHgyPSIzNTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzY0IiB5MT0iMzQ0IiB4Mj0iMzY0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM3NSIgeTE9IjM0NCIgeDI9IjM3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODciIHkxPSIzNDQiIHgyPSIzODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzk5IiB5MT0iMzQ0IiB4Mj0iMzk5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQxMSIgeTE9IjM0NCIgeDI9IjQxMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MjIiIHkxPSIzNDQiIHgyPSI0MjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDM0IiB5MT0iMzQ0IiB4Mj0iNDM0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0NiIgeTE9IjM0NCIgeDI9IjQ0NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTgiIHkxPSIzNDQiIHgyPSI0NTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDY5IiB5MT0iMzQ0IiB4Mj0iNDY5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4MSIgeTE9IjM0NCIgeDI9IjQ4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTMiIHkxPSIzNDQiIHgyPSI0OTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA1IiB5MT0iMzQ0IiB4Mj0iNTA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxNiIgeTE9IjM0NCIgeDI9IjUxNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjgiIHkxPSIzNDQiIHgyPSI1MjgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQwIiB5MT0iMzQ0IiB4Mj0iNTQwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1MSIgeTE9IjM0NCIgeDI9IjU1MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjMiIHkxPSIzNDQiIHgyPSI1NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTc1IiB5MT0iMzQ0IiB4Mj0iNTc1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU4NyIgeTE9IjM0NCIgeDI9IjU4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1OTgiIHkxPSIzNDQiIHgyPSI1OTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjEwIiB5MT0iMzQ0IiB4Mj0iNjEwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyMiIgeTE9IjM0NCIgeDI9IjYyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MzQiIHkxPSIzNDQiIHgyPSI2MzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQ1IiB5MT0iMzQ0IiB4Mj0iNjQ1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1NyIgeTE9IjM0NCIgeDI9IjY1NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NjkiIHkxPSIzNDQiIHgyPSI2NjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgxIiB5MT0iMzQ0IiB4Mj0iNjgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY5MiIgeTE9IjM0NCIgeDI9IjY5MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MDQiIHkxPSIzNDQiIHgyPSI3MDQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzE2IiB5MT0iMzQ0IiB4Mj0iNzE2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcyNyIgeTE9IjM0NCIgeDI9IjcyNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MzkiIHkxPSIzNDQiIHgyPSI3MzkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzUxIiB5MT0iMzQ0IiB4Mj0iNzUxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijc2MyIgeTE9IjM0NCIgeDI9Ijc2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0NCIgeDI9Ijc2OSIgeTI9IjM0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMzkiIHgyPSI3NjkiIHkyPSIzMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzM0IiB4Mj0iNzY5IiB5Mj0iMzM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMyOSIgeDI9Ijc2OSIgeTI9IjMyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjQiIHgyPSI3NjkiIHkyPSIzMjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzE5IiB4Mj0iNzY5IiB5Mj0iMzE5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMxMyIgeDI9Ijc2OSIgeTI9IjMxMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMDgiIHgyPSI3NjkiIHkyPSIzMDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzAzIiB4Mj0iNzY5IiB5Mj0iMzAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5OCIgeDI9Ijc2OSIgeTI9IjI5OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyOTMiIHgyPSI3NjkiIHkyPSIyOTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjg3IiB4Mj0iNzY5IiB5Mj0iMjg3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI4MiIgeDI9Ijc2OSIgeTI9IjI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNzciIHgyPSI3NjkiIHkyPSIyNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjcyIiB4Mj0iNzY5IiB5Mj0iMjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI2NyIgeDI9Ijc2OSIgeTI9IjI2NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNjIiIHgyPSI3NjkiIHkyPSIyNjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjU2IiB4Mj0iNzY5IiB5Mj0iMjU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI1MSIgeDI9Ijc2OSIgeTI9IjI1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNDYiIHgyPSI3NjkiIHkyPSIyNDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjQxIiB4Mj0iNzY5IiB5Mj0iMjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzNiIgeDI9Ijc2OSIgeTI9IjIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzAiIHgyPSI3NjkiIHkyPSIyMzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjI1IiB4Mj0iNzY5IiB5Mj0iMjI1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIyMCIgeDI9Ijc2OSIgeTI9IjIyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMTUiIHgyPSI3NjkiIHkyPSIyMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjEwIiB4Mj0iNzY5IiB5Mj0iMjEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIwNSIgeDI9Ijc2OSIgeTI9IjIwNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxOTkiIHgyPSI3NjkiIHkyPSIxOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTk0IiB4Mj0iNzY5IiB5Mj0iMTk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE4OSIgeDI9Ijc2OSIgeTI9IjE4OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODQiIHgyPSI3NjkiIHkyPSIxODQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTc5IiB4Mj0iNzY5IiB5Mj0iMTc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE3MyIgeDI9Ijc2OSIgeTI9IjE3MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNjgiIHgyPSI3NjkiIHkyPSIxNjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTYzIiB4Mj0iNzY5IiB5Mj0iMTYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE1OCIgeDI9Ijc2OSIgeTI9IjE1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTMiIHgyPSI3NjkiIHkyPSIxNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTQ4IiB4Mj0iNzY5IiB5Mj0iMTQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE0MiIgeDI9Ijc2OSIgeTI9IjE0MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzciIHgyPSI3NjkiIHkyPSIxMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTMyIiB4Mj0iNzY5IiB5Mj0iMTMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyNyIgeDI9Ijc2OSIgeTI9IjEyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMjIiIHgyPSI3NjkiIHkyPSIxMjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTE2IiB4Mj0iNzY5IiB5Mj0iMTE2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExMSIgeDI9Ijc2OSIgeTI9IjExMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMDYiIHgyPSI3NjkiIHkyPSIxMDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTAxIiB4Mj0iNzY5IiB5Mj0iMTAxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijk2IiB4Mj0iNzY5IiB5Mj0iOTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iOTAiIHgyPSI3NjkiIHkyPSI5MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4NSIgeDI9Ijc2OSIgeTI9Ijg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjgwIiB4Mj0iNzY5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNzUiIHgyPSI3NjkiIHkyPSI3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI3MCIgeDI9Ijc2OSIgeTI9IjcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjY1IiB4Mj0iNzY5IiB5Mj0iNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNTkiIHgyPSI3NjkiIHkyPSI1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI1NCIgeDI9Ijc2OSIgeTI9IjU0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQ5IiB4Mj0iNzY5IiB5Mj0iNDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNDQiIHgyPSI3NjkiIHkyPSI0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzOSIgeDI9Ijc2OSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NCIgeTE9IjM0NCIgeDI9Ijk0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM0NCIgeDI9IjE1MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTEiIHkxPSIzNDQiIHgyPSIyMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjcwIiB5MT0iMzQ0IiB4Mj0iMjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyOSIgeTE9IjM0NCIgeDI9IjMyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODciIHkxPSIzNDQiIHgyPSIzODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDQ2IiB5MT0iMzQ0IiB4Mj0iNDQ2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwNSIgeTE9IjM0NCIgeDI9IjUwNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjMiIHkxPSIzNDQiIHgyPSI1NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjIyIiB5MT0iMzQ0IiB4Mj0iNjIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjM0NCIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MzkiIHkxPSIzNDQiIHgyPSI3MzkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDQiIHgyPSI3NjkiIHkyPSIzNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjkzIiB4Mj0iNzY5IiB5Mj0iMjkzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI0MSIgeDI9Ijc2OSIgeTI9IjI0MSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODkiIHgyPSI3NjkiIHkyPSIxODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTM3IiB4Mj0iNzY5IiB5Mj0iMTM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijg1IiB4Mj0iNzY5IiB5Mj0iODUiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY0LDM0IDY0LDM0NCAiLz4KPHRleHQgeD0iNTUiIHk9IjM0NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wYm4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMzQ0IDY0LDM0NCAiLz4KPHRleHQgeD0iNTUiIHk9IjI5MyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4yYm4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMjkzIDY0LDI5MyAiLz4KPHRleHQgeD0iNTUiIHk9IjI0MSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC40Ym4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMjQxIDY0LDI0MSAiLz4KPHRleHQgeD0iNTUiIHk9IjE4OSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC42Ym4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMTg5IDY0LDE4OSAiLz4KPHRleHQgeD0iNTUiIHk9IjEzNyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC44Ym4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMTM3IDY0LDEzNyAiLz4KPHRleHQgeD0iNTUiIHk9Ijg1IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjBibgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSw4NSA2NCw4NSAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY1LDM0NSA3NjksMzQ1ICIvPgo8dGV4dCB4PSI5NCIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2hlbHNlYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI5NCwzNDUgOTQsMzUwICIvPgo8dGV4dCB4PSIxNTMiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ckp1dmVudHVzCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1MywzNDUgMTUzLDM1MCAiLz4KPHRleHQgeD0iMjExIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpCYXJjZWxvbmEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjExLDM0NSAyMTEsMzUwICIvPgo8dGV4dCB4PSIyNzAiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkF0bMOpdGljbyBNYWRyaWQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjcwLDM0NSAyNzAsMzUwICIvPgo8dGV4dCB4PSIzMjkiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ck1hbmNoZXN0ZXIgQ2l0eQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIzMjksMzQ1IDMyOSwzNTAgIi8+Cjx0ZXh0IHg9IjM4NyIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTGl2ZXJwb29sCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM4NywzNDUgMzg3LDM1MCAiLz4KPHRleHQgeD0iNDQ2IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpSZWFsIE1hZHJpZAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0NDYsMzQ1IDQ0NiwzNTAgIi8+Cjx0ZXh0IHg9IjUwNSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQmF5ZXJuIE11bmljaAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1MDUsMzQ1IDUwNSwzNTAgIi8+Cjx0ZXh0IHg9IjU2MyIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KSW50ZXIgTWlsYW4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTYzLDM0NSA1NjMsMzUwICIvPgo8dGV4dCB4PSI2MjIiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ck1hbmNoZXN0ZXIgVW5pdGVkCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjYyMiwzNDUgNjIyLDM1MCAiLz4KPHRleHQgeD0iNjgxIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpQYXJpcyBTYWludC1HZXJtYWkKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjgxLDM0NSA2ODEsMzUwICIvPgo8dGV4dCB4PSI3MzkiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ck5hcG9saQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI3MzksMzQ1IDczOSwzNTAgIi8+CjxyZWN0IHg9IjczIiB5PSI3NSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjI2OSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjEzMiIgeT0iMTM1IiB3aWR0aD0iNDEiIGhlaWdodD0iMjA5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTkxIiB5PSIxNDQiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyMDAiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyNDkiIHk9IjE0OSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjE5NSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjMwOCIgeT0iMTU3IiB3aWR0aD0iNDEiIGhlaWdodD0iMTg3IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzY3IiB5PSIxNjMiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxODEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0MjUiIHk9IjE2OCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjE3NiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ4NCIgeT0iMTc4IiB3aWR0aD0iNDEiIGhlaWdodD0iMTY2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNTQzIiB5PSIxOTMiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxNTEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2MDEiIHk9IjE5NyIgd2lkdGg9IjQxIiBoZWlnaHQ9IjE0NyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjY2MCIgeT0iMjAxIiB3aWR0aD0iNDEiIGhlaWdodD0iMTQzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNzE5IiB5PSIyMDMiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxNDEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

## Discussion

584 clubs, 19,436 transfers, 8,645 international moves:

- **The Premier League is the spending league**: Manchester United (+€1.28bn
  net), Manchester City (+€1.23bn), Arsenal (+€1.12bn), Chelsea (+€1.03bn) and
  Liverpool (+€800m) fill the top five net-spend slots — five of the six biggest
  spenders on earth are English.
- **The farms are familiar names**: Salzburg (65 out / 46 in, €490m received vs
  €86m paid), Sporting CP (€614m in vs €225m out), Ajax (€857m vs €356m),
  Benfica (€1.07bn received — the biggest seller by fee in the dataset).
- **The sell/buy ratio exposes the business model**: Nordsjælland earns 392×
  what it spends, AZ Alkmaar 16×, Porto 22× — these clubs aren't football teams
  with transfer departments, they're development companies that happen to play
  matches.
- **France is the volume hub**: Toulouse, Reims, Metz, Sochaux, Bordeaux, Bastia
  all appear in the net-talent-out table — Ligue 1's lower-table churn is a
  player-export engine.

Caveats: fee columns only capture the ~28% of transfers with disclosed money —
true spending is higher everywhere; some clubs show blank country (country
matching gaps in the source data); "net spend" ignores wages, which are the real
cost of a transfer; loan deals and free agents count as moves without fees.

**Limitations.** Transfer fee coverage is incomplete — roughly three quarters of
moves have undisclosed fees — and output is measured only where match statistics
exist for the player.

## Conclusion

The Premier League is the spending league. Together these results answer the
research question posed in the Introduction and quantify the pattern across
19,436 transfers. The notebook provides a fully reproducible pipeline from raw
CSV extracts to published figures.
