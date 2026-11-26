---
title: 'Transfer flows: who sells footballers and who buys them'
description: |
  '5,519 cross-border transfers mapped: Europe→Europe is 85% of the
  market, England spends €5.59bn net while Germany banks €1.16bn,
  and Portugal sells €1.21bn of talent for €284m of purchases.'
author: 'hieudoan'
date: '2026-11-28T10:00'
order: 48
tags: ['football', 'analysis', 'transfers', 'transfermarkt', 'mars', 'sqlite']
---

# Transfer flows: who sells footballers and who buys them

## Abstract

Where does football talent move — and which leagues profit? This study answers
it using 19,436 transfers drawn from the Soccers football database. Europe →
Europe is 85% of all international business. All computation runs in Rust inside
a `.mars` notebook (polars + plotters — charts as inline SVG), and every table
and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, transfers, transfermarkt, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [Region-level corridors](#region-level-corridors)
  - [Top country pairs](#top-country-pairs)
  - [Net fee balance per country: fees received (in) minus fees paid (out)](#net-fee-balance-per-country-fees-received-in-minus-fees-paid-out)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

19,436 transfers join two clubs — and every club has a country. This notebook
maps the **pipes** of the transfer market: which regions feed which, which
countries are net exporters of talent and fee money, and where the biggest
cross-border pipelines run.

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
fn eur(e: f64) -> String {
    let m = e / 1_000_000.0;
    if m >= 1000.0 { format!("€{:.2}bn", m / 1000.0) } else { format!("€{:.1}m", m) }
}
fn region(country: &str) -> &'static str {
    match country {
        // macro buckets already in the data
        "Europe" | "South America" | "Africa" | "Asia" | "North and Central America" => "Other",
        "International" => "Other",
        // South America
        "Argentina"|"Bolivia"|"Brazil"|"Chile"|"Colombia"|"Ecuador"|"French Guiana"|"Guyana"|"Paraguay"|"Peru"|"Suriname"|"Uruguay"|"Venezuela (Bolivarian Republic)" => "South America",
        // North America & Caribbean
        "Bermuda"|"Canada"|"Costa Rica"|"Curaçao"|"Dominican Republic"|"El Salvador"|"Grenada"|"Guadeloupe"|"Guatemala"|"Haiti"|"Honduras"|"Jamaica"|"Martinique"|"Mexico"|"Panama"|"Puerto Rico"|"Trinidad and Tobago"|"United States"|"United States of America" => "North America",
        // Oceania
        "Australia"|"Fiji"|"New Caledonia"|"New Zealand" => "Oceania",
        // Asia
        "Bahrain"|"Bhutan"|"China"|"India"|"Iran, Islamic Republic of"|"Iraq"|"Israel"|"Japan"|"Jordan"|"Korea (North)"|"Korea (South)"|"Kuwait"|"Kyrgyzstan"|"Lao PDR"|"Malaysia"|"Maldives"|"Nepal"|"Oman"|"Pakistan"|"Palestine"|"Philippines"|"Qatar"|"Saudi Arabia"|"Syria"|"Syrian Arab Republic (Syria)"|"Thailand"|"Turkmenistan"|"United Arab Emirates"|"Uzbekistan"|"Vietnam"|"Yemen" => "Asia",
        // Africa
        "Algeria"|"Angola"|"Benin"|"Botswana"|"Burkina Faso"|"Burundi"|"Cameroon"|"Cape Verde"|"Central African Republic"|"Chad"|"Comoros"|"Congo, (Kinshasa)"|"Congo (Brazzaville)"|"Côte d'Ivoire"|"DR Congo"|"Egypt"|"Equatorial Guinea"|"Ethiopia"|"Gabon"|"Gambia"|"Ghana"|"Guinea"|"Guinea-Bissau"|"Kenya"|"Lesotho"|"Liberia"|"Libya"|"Madagascar"|"Malawi"|"Mali"|"Mauritania"|"Mauritius"|"Morocco"|"Mozambique"|"Namibia"|"Niger"|"Nigeria"|"Rwanda"|"São Tomé and Príncipe"|"Senegal"|"Seychelles"|"Sierra Leone"|"Somalia"|"South Africa"|"South Sudan"|"Sudan"|"Tanzania, United Republic of"|"Togo"|"Tunisia"|"Uganda"|"Zambia"|"Zimbabwe" => "Africa",
        // Europe (default for UEFA nations)
        "Albania"|"Andorra"|"Armenia"|"Austria"|"Azerbaijan"|"Belarus"|"Belgium"|"Bosnia and Herzegovina"|"Bulgaria"|"Croatia"|"Cyprus"|"Czech Republic"|"Denmark"|"England"|"Estonia"|"Faroe Islands"|"Finland"|"France"|"Georgia"|"Germany"|"Gibraltar"|"Greece"|"Hungary"|"Iceland"|"Ireland"|"Italy"|"Kazakhstan"|"Kosovo"|"Latvia"|"Liechtenstein"|"Lithuania"|"Luxembourg"|"Macedonia, Republic of"|"Malta"|"Moldova"|"Monaco"|"Montenegro"|"Netherlands"|"North Macedonia"|"Northern Ireland"|"Norway"|"Poland"|"Portugal"|"Romania"|"Russia"|"San Marino"|"Scotland"|"Serbia"|"Slovakia"|"Slovenia"|"Spain"|"Sweden"|"Switzerland"|"Turkey"|"Türkiye"|"Ukraine"|"Wales" => "Europe",
        _ => "Other",
    }
}

let tr = LazyCsvReader::new("data/transfer.csv")
    .finish().expect("transfer.csv").collect().expect("collect transfers");
let tm = LazyCsvReader::new("data/team.csv")
    .finish().expect("team.csv").collect().expect("collect teams");
let co = LazyCsvReader::new("data/country.csv")
    .finish().expect("country.csv").collect().expect("collect countries");

let t_from = col_i64(&tr, "from_team_id");
let t_to = col_i64(&tr, "to_team_id");
let t_fee = col_f64(&tr, "fee");
let t_date = col_str(&tr, "date");

let tm_id = col_i64(&tm, "id");
let tm_cid = col_i64(&tm, "country_id");
let tm_name = col_str(&tm, "name");
let mut team_country: HashMap<i64,i64> = HashMap::new();
let mut tname: HashMap<i64,String> = HashMap::new();
for i in 0..tm.height() { team_country.insert(tm_id[i], tm_cid[i]); tname.insert(tm_id[i], tm_name[i].clone()); }

let co_id = col_i64(&co, "id");
let co_name = col_str(&co, "name");
let mut country_name: HashMap<i64,String> = HashMap::new();
for i in 0..co.height() { country_name.insert(co_id[i], co_name[i].clone()); }

fn canon(c: &str) -> &str {
    if c.contains("United States") { "USA" } else { c }
}
let ctry = |tid: i64| -> String {
    team_country.get(&tid).and_then(|c| country_name.get(c))
        .map(|s| canon(s).to_string()).unwrap_or_else(|| "?".to_string())
};

struct Flow { from_c: String, to_c: String, n: usize, fee: f64, year: i32 }
let mut flows: Vec<Flow> = Vec::new();
for i in 0..t_from.len() {
    if t_to[i] <= 0 { continue; }
    let fc = ctry(t_from[i]); let tc = ctry(t_to[i]);
    if fc == "?" || tc == "?" || fc == tc { continue; } // domestic moves excluded
    let y: i32 = if t_date[i].len() >= 4 { t_date[i][0..4].parse().unwrap_or(0) } else { 0 };
    flows.push(Flow{from_c:fc,to_c:tc,n:1,fee:t_fee[i].max(0.0),year:y});
}
println!("cross-border transfers: {}", flows.len());
```

```text
cross-border transfers: 5519
```

### Region-level corridors

```rust
// region-level corridors
let mut by_rr: HashMap<(&str,&str),(usize,f64)> = HashMap::new();
let mut by_cc: HashMap<(String,String),(usize,f64)> = HashMap::new();
for f in &flows {
    let rr = (region(&f.from_c), region(&f.to_c));
    let e = by_rr.entry(rr).or_default(); e.0 += f.n; e.1 += f.fee;
    let cc = (f.from_c.clone(), f.to_c.clone());
    let e2 = by_cc.entry(cc).or_default(); e2.0 += f.n; e2.1 += f.fee;
}
let mut rrs: Vec<((&str,&str),usize,f64)> = by_rr.into_iter().map(|(k,v)|(k,v.0,v.1)).collect();
rrs.sort_by_key(|x| std::cmp::Reverse(x.1));
let rrows: Vec<Vec<String>> = rrs.iter().take(15).map(|&((a,b),n,f)| {
    vec![format!("{} → {}", a, b), n.to_string(), eur(f)]
}).collect();
mars_table(&["corridor","transfers","fees paid"], &rrows);
```

| corridor                      | transfers | fees paid |
| ----------------------------- | --------- | --------- |
| Europe → Europe               | 4702      | €20.95bn  |
| South America → Europe        | 185       | €752.8m   |
| Europe → South America        | 157       | €111.8m   |
| Europe → Other                | 110       | €116.5m   |
| Europe → North America        | 77        | €146.4m   |
| Other → Europe                | 76        | €140.8m   |
| North America → Europe        | 59        | €128.6m   |
| Asia → Europe                 | 30        | €19.4m    |
| Europe → Asia                 | 20        | €9.1m     |
| North America → South America | 19        | €21.9m    |
| South America → Other         | 18        | €26.9m    |
| South America → South America | 17        | €11.1m    |
| Other → South America         | 14        | €13.0m    |
| South America → North America | 13        | €28.7m    |
| Other → North America         | 10        | €18.5m    |

### Top country pairs

```rust
// top country pairs
let mut ccs: Vec<((String,String),usize,f64)> = by_cc.into_iter().map(|(k,v)|(k,v.0,v.1)).collect();
ccs.sort_by_key(|x| std::cmp::Reverse(x.1));
let crows: Vec<Vec<String>> = ccs.iter().take(15).map(|(k,n,f)| {
    vec![format!("{} → {}", k.0, k.1), n.to_string(), eur(*f)]
}).collect();
mars_table(&["country pair","transfers","fees paid"], &crows);
```

| country pair      | transfers | fees paid |
| ----------------- | --------- | --------- |
| Spain → England   | 216       | €1.77bn   |
| England → Spain   | 215       | €1.02bn   |
| France → England  | 176       | €1.42bn   |
| Italy → England   | 142       | €1.39bn   |
| England → Italy   | 139       | €671.8m   |
| England → France  | 133       | €313.8m   |
| France → Italy    | 127       | €431.2m   |
| Germany → England | 127       | €2.07bn   |
| Italy → Spain     | 125       | €455.2m   |
| Spain → Italy     | 124       | €724.0m   |
| France → Spain    | 113       | €531.1m   |
| Italy → France    | 99        | €505.6m   |
| England → Germany | 97        | €547.8m   |
| Spain → France    | 84        | €267.6m   |
| France → Germany  | 73        | €503.5m   |

### Net fee balance per country: fees received (in) minus fees paid (out)

```rust
// net fee balance per country: fees received (in) minus fees paid (out)
let mut bal: HashMap<String,(usize,usize,f64,f64)> = HashMap::new(); // c -> (sold_n, bought_n, sold_fee, bought_fee)
for f in &flows {
    let e = bal.entry(f.from_c.clone()).or_default();
    e.0 += 1; e.2 += f.fee;
    let e2 = bal.entry(f.to_c.clone()).or_default();
    e2.1 += 1; e2.3 += f.fee;
}
let mut bv: Vec<(String,usize,usize,f64,f64)> = bal.into_iter()
    .map(|(c,(sn,bn,sf,bf))| (c,sn,bn,sf,bf)).collect();
bv.sort_by(|a,b| (b.3-b.4).partial_cmp(&(a.3-a.4)).unwrap());
// biggest net RECEIVERS (importers by fee)
let recv: Vec<Vec<String>> = bv.iter().take(12).map(|(c,sn,bn,sf,bf)| {
    vec![c.clone(), bn.to_string(), sn.to_string(), eur(*bf), eur(*sf), eur(bf-sf)]
}).collect();
mars_table(&["country","bought","sold","spent","earned","net spend"], &recv);
```

| country     | bought | sold | spent   | earned  | net spend |
| ----------- | ------ | ---- | ------- | ------- | --------- |
| Germany     | 438    | 456  | €2.28bn | €3.44bn | €-1162.9m |
| France      | 657    | 812  | €2.28bn | €3.33bn | €-1046.6m |
| Portugal    | 204    | 231  | €283.9m | €1.21bn | €-925.4m  |
| Argentina   | 87     | 115  | €74.3m  | €483.5m | €-409.2m  |
| Austria     | 56     | 82   | €58.3m  | €447.9m | €-389.6m  |
| Netherlands | 131    | 145  | €168.0m | €545.6m | €-377.6m  |
| Belgium     | 191    | 216  | €183.6m | €556.6m | €-372.9m  |
| Monaco      | 111    | 117  | €686.4m | €1.05bn | €-367.9m  |
| Brazil      | 122    | 118  | €84.1m  | €336.0m | €-251.9m  |
| Italy       | 693    | 637  | €2.87bn | €3.06bn | €-191.5m  |
| Denmark     | 57     | 71   | €43.8m  | €172.6m | €-128.9m  |
| Scotland    | 95     | 97   | €84.3m  | €187.9m | €-103.7m  |

```rust
let send: Vec<Vec<String>> = bv.iter().rev().take(12).map(|(c,sn,bn,sf,bf)| {
    vec![c.clone(), bn.to_string(), sn.to_string(), eur(*bf), eur(*sf), eur(bf-sf)]
}).collect();
mars_table(&["country","bought","sold","spent","earned","net spend"], &send);
```

| country     | bought | sold | spent   | earned  | net spend |
| ----------- | ------ | ---- | ------- | ------- | --------- |
| England     | 946    | 856  | €8.46bn | €2.87bn | €5.59bn   |
| Turkey      | 360    | 249  | €568.8m | €266.6m | €302.2m   |
| Russia      | 58     | 50   | €240.4m | €123.9m | €116.5m   |
| Spain       | 775    | 767  | €3.64bn | €3.59bn | €47.7m    |
| Mexico      | 100    | 87   | €193.6m | €168.1m | €25.5m    |
| Japan       | 20     | 33   | €9.1m   | €20.1m  | €-11.0m   |
| USA         | 138    | 100  | €161.0m | €172.3m | €-11.2m   |
| Sweden      | 7      | 21   | €0.0m   | €19.8m  | €-19.8m   |
| Norway      | 16     | 28   | €1.5m   | €36.6m  | €-35.1m   |
| Greece      | 134    | 101  | €56.1m  | €97.7m  | €-41.6m   |
| Switzerland | 42     | 36   | €19.9m  | €64.1m  | €-44.2m   |
| Romania     | 14     | 16   | €2.8m   | €58.7m  | €-55.9m   |

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


let mut c_items: Vec<(String, f64)> = recv.iter()
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
        .caption("Transfer spending by country", ("sans-serif", 18))
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

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KVHJhbnNmZXIgc3BlbmRpbmcgYnkgY291bnRyeQo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MCIgeTE9IjM0NCIgeDI9IjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iMzQ0IiB4Mj0iODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTQiIHkxPSIzNDQiIHgyPSI5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDYiIHkxPSIzNDQiIHgyPSIxMDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTE3IiB5MT0iMzQ0IiB4Mj0iMTE3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyOSIgeTE9IjM0NCIgeDI9IjEyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDEiIHkxPSIzNDQiIHgyPSIxNDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzQ0IiB4Mj0iMTUzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2NCIgeTE9IjM0NCIgeDI9IjE2NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNzYiIHkxPSIzNDQiIHgyPSIxNzYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTg4IiB5MT0iMzQ0IiB4Mj0iMTg4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5OSIgeTE9IjM0NCIgeDI9IjE5OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTEiIHkxPSIzNDQiIHgyPSIyMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIzIiB5MT0iMzQ0IiB4Mj0iMjIzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzNSIgeTE9IjM0NCIgeDI9IjIzNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDYiIHkxPSIzNDQiIHgyPSIyNDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU4IiB5MT0iMzQ0IiB4Mj0iMjU4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3MCIgeTE9IjM0NCIgeDI9IjI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyODIiIHkxPSIzNDQiIHgyPSIyODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjkzIiB5MT0iMzQ0IiB4Mj0iMjkzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwNSIgeTE9IjM0NCIgeDI9IjMwNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTciIHkxPSIzNDQiIHgyPSIzMTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI5IiB5MT0iMzQ0IiB4Mj0iMzI5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM0MCIgeTE9IjM0NCIgeDI9IjM0MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNTIiIHkxPSIzNDQiIHgyPSIzNTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzY0IiB5MT0iMzQ0IiB4Mj0iMzY0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM3NSIgeTE9IjM0NCIgeDI9IjM3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODciIHkxPSIzNDQiIHgyPSIzODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzk5IiB5MT0iMzQ0IiB4Mj0iMzk5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQxMSIgeTE9IjM0NCIgeDI9IjQxMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MjIiIHkxPSIzNDQiIHgyPSI0MjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDM0IiB5MT0iMzQ0IiB4Mj0iNDM0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0NiIgeTE9IjM0NCIgeDI9IjQ0NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTgiIHkxPSIzNDQiIHgyPSI0NTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDY5IiB5MT0iMzQ0IiB4Mj0iNDY5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4MSIgeTE9IjM0NCIgeDI9IjQ4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTMiIHkxPSIzNDQiIHgyPSI0OTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA1IiB5MT0iMzQ0IiB4Mj0iNTA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxNiIgeTE9IjM0NCIgeDI9IjUxNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjgiIHkxPSIzNDQiIHgyPSI1MjgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQwIiB5MT0iMzQ0IiB4Mj0iNTQwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1MSIgeTE9IjM0NCIgeDI9IjU1MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjMiIHkxPSIzNDQiIHgyPSI1NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTc1IiB5MT0iMzQ0IiB4Mj0iNTc1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU4NyIgeTE9IjM0NCIgeDI9IjU4NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1OTgiIHkxPSIzNDQiIHgyPSI1OTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjEwIiB5MT0iMzQ0IiB4Mj0iNjEwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyMiIgeTE9IjM0NCIgeDI9IjYyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MzQiIHkxPSIzNDQiIHgyPSI2MzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQ1IiB5MT0iMzQ0IiB4Mj0iNjQ1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1NyIgeTE9IjM0NCIgeDI9IjY1NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NjkiIHkxPSIzNDQiIHgyPSI2NjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgxIiB5MT0iMzQ0IiB4Mj0iNjgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY5MiIgeTE9IjM0NCIgeDI9IjY5MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MDQiIHkxPSIzNDQiIHgyPSI3MDQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzE2IiB5MT0iMzQ0IiB4Mj0iNzE2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcyNyIgeTE9IjM0NCIgeDI9IjcyNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MzkiIHkxPSIzNDQiIHgyPSI3MzkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzUxIiB5MT0iMzQ0IiB4Mj0iNzUxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijc2MyIgeTE9IjM0NCIgeDI9Ijc2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0NCIgeDI9Ijc2OSIgeTI9IjM0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDAiIHgyPSI3NjkiIHkyPSIzNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzM1IiB4Mj0iNzY5IiB5Mj0iMzM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMzMCIgeDI9Ijc2OSIgeTI9IjMzMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjYiIHgyPSI3NjkiIHkyPSIzMjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzIxIiB4Mj0iNzY5IiB5Mj0iMzIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMxNiIgeDI9Ijc2OSIgeTI9IjMxNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMTIiIHgyPSI3NjkiIHkyPSIzMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzA3IiB4Mj0iNzY5IiB5Mj0iMzA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMwMiIgeDI9Ijc2OSIgeTI9IjMwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyOTgiIHgyPSI3NjkiIHkyPSIyOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjkzIiB4Mj0iNzY5IiB5Mj0iMjkzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI4OCIgeDI9Ijc2OSIgeTI9IjI4OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyODMiIHgyPSI3NjkiIHkyPSIyODMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjc5IiB4Mj0iNzY5IiB5Mj0iMjc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI3NCIgeDI9Ijc2OSIgeTI9IjI3NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNjkiIHgyPSI3NjkiIHkyPSIyNjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjY1IiB4Mj0iNzY5IiB5Mj0iMjY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI2MCIgeDI9Ijc2OSIgeTI9IjI2MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNTUiIHgyPSI3NjkiIHkyPSIyNTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjUxIiB4Mj0iNzY5IiB5Mj0iMjUxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI0NiIgeDI9Ijc2OSIgeTI9IjI0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNDEiIHgyPSI3NjkiIHkyPSIyNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjM2IiB4Mj0iNzY5IiB5Mj0iMjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzMiIgeDI9Ijc2OSIgeTI9IjIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMjciIHgyPSI3NjkiIHkyPSIyMjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjIyIiB4Mj0iNzY5IiB5Mj0iMjIyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIxOCIgeDI9Ijc2OSIgeTI9IjIxOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMTMiIHgyPSI3NjkiIHkyPSIyMTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjA4IiB4Mj0iNzY5IiB5Mj0iMjA4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIwNCIgeDI9Ijc2OSIgeTI9IjIwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxOTkiIHgyPSI3NjkiIHkyPSIxOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTk0IiB4Mj0iNzY5IiB5Mj0iMTk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE5MCIgeDI9Ijc2OSIgeTI9IjE5MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODUiIHgyPSI3NjkiIHkyPSIxODUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTgwIiB4Mj0iNzY5IiB5Mj0iMTgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE3NSIgeDI9Ijc2OSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNzEiIHgyPSI3NjkiIHkyPSIxNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTY2IiB4Mj0iNzY5IiB5Mj0iMTY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE2MSIgeDI9Ijc2OSIgeTI9IjE2MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTciIHgyPSI3NjkiIHkyPSIxNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTUyIiB4Mj0iNzY5IiB5Mj0iMTUyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE0NyIgeDI9Ijc2OSIgeTI9IjE0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNDMiIHgyPSI3NjkiIHkyPSIxNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTM4IiB4Mj0iNzY5IiB5Mj0iMTM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEzMyIgeDI9Ijc2OSIgeTI9IjEzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMjgiIHgyPSI3NjkiIHkyPSIxMjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTI0IiB4Mj0iNzY5IiB5Mj0iMTI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExOSIgeDI9Ijc2OSIgeTI9IjExOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMTQiIHgyPSI3NjkiIHkyPSIxMTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTEwIiB4Mj0iNzY5IiB5Mj0iMTEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEwNSIgeDI9Ijc2OSIgeTI9IjEwNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMDAiIHgyPSI3NjkiIHkyPSIxMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iOTYiIHgyPSI3NjkiIHkyPSI5NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI5MSIgeDI9Ijc2OSIgeTI9IjkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijg2IiB4Mj0iNzY5IiB5Mj0iODYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iODIiIHgyPSI3NjkiIHkyPSI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI3NyIgeDI9Ijc2OSIgeTI9Ijc3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjcyIiB4Mj0iNzY5IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNjciIHgyPSI3NjkiIHkyPSI2NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI2MyIgeDI9Ijc2OSIgeTI9IjYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjU4IiB4Mj0iNzY5IiB5Mj0iNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNTMiIHgyPSI3NjkiIHkyPSI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI0OSIgeDI9Ijc2OSIgeTI9IjQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQ0IiB4Mj0iNzY5IiB5Mj0iNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzkiIHgyPSI3NjkiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNSIgeDI9Ijc2OSIgeTI9IjM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NCIgeTE9IjM0NCIgeDI9Ijk0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM0NCIgeDI9IjE1MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTEiIHkxPSIzNDQiIHgyPSIyMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjcwIiB5MT0iMzQ0IiB4Mj0iMjcwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyOSIgeTE9IjM0NCIgeDI9IjMyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODciIHkxPSIzNDQiIHgyPSIzODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDQ2IiB5MT0iMzQ0IiB4Mj0iNDQ2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwNSIgeTE9IjM0NCIgeDI9IjUwNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjMiIHkxPSIzNDQiIHgyPSI1NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjIyIiB5MT0iMzQ0IiB4Mj0iNjIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjM0NCIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MzkiIHkxPSIzNDQiIHgyPSI3MzkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDQiIHgyPSI3NjkiIHkyPSIzNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjk4IiB4Mj0iNzY5IiB5Mj0iMjk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI1MSIgeDI9Ijc2OSIgeTI9IjI1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMDQiIHgyPSI3NjkiIHkyPSIyMDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTU3IiB4Mj0iNzY5IiB5Mj0iMTU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExMCIgeDI9Ijc2OSIgeTI9IjExMCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI2MyIgeDI9Ijc2OSIgeTI9IjYzIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NCwzNCA2NCwzNDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIzNDQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMGJuCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDM0NCA2NCwzNDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIyOTgiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuNWJuCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDI5OCA2NCwyOTggIi8+Cjx0ZXh0IHg9IjU1IiB5PSIyNTEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEuMGJuCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDI1MSA2NCwyNTEgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIyMDQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEuNWJuCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDIwNCA2NCwyMDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIxNTciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIuMGJuCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDE1NyA2NCwxNTcgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIxMTAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIuNWJuCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDExMCA2NCwxMTAgIi8+Cjx0ZXh0IHg9IjU1IiB5PSI2MyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMy4wYm4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksNjMgNjQsNjMgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NSwzNDUgNzY5LDM0NSAiLz4KPHRleHQgeD0iOTQiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ckl0YWx5CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijk0LDM0NSA5NCwzNTAgIi8+Cjx0ZXh0IHg9IjE1MyIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KR2VybWFueQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxNTMsMzQ1IDE1MywzNTAgIi8+Cjx0ZXh0IHg9IjIxMSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KRnJhbmNlCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjIxMSwzNDUgMjExLDM1MCAiLz4KPHRleHQgeD0iMjcwIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpNb25hY28KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjcwLDM0NSAyNzAsMzUwICIvPgo8dGV4dCB4PSIzMjkiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClBvcnR1Z2FsCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjMyOSwzNDUgMzI5LDM1MCAiLz4KPHRleHQgeD0iMzg3IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpCZWxnaXVtCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM4NywzNDUgMzg3LDM1MCAiLz4KPHRleHQgeD0iNDQ2IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpOZXRoZXJsYW5kcwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0NDYsMzQ1IDQ0NiwzNTAgIi8+Cjx0ZXh0IHg9IjUwNSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KU2NvdGxhbmQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTA1LDM0NSA1MDUsMzUwICIvPgo8dGV4dCB4PSI1NjMiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkJyYXppbAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NjMsMzQ1IDU2MywzNTAgIi8+Cjx0ZXh0IHg9IjYyMiIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQXJnZW50aW5hCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjYyMiwzNDUgNjIyLDM1MCAiLz4KPHRleHQgeD0iNjgxIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpBdXN0cmlhCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY4MSwzNDUgNjgxLDM1MCAiLz4KPHRleHQgeD0iNzM5IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpEZW5tYXJrCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjczOSwzNDUgNzM5LDM1MCAiLz4KPHJlY3QgeD0iNzMiIHk9Ijc1IiB3aWR0aD0iNDEiIGhlaWdodD0iMjY5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTMyIiB5PSIxMzAiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyMTQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxOTEiIHk9IjEzMCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjIxNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjI0OSIgeT0iMjgwIiB3aWR0aD0iNDEiIGhlaWdodD0iNjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzMDgiIHk9IjMxOCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjI2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzY3IiB5PSIzMjciIHdpZHRoPSI0MSIgaGVpZ2h0PSIxNyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQyNSIgeT0iMzI5IiB3aWR0aD0iNDEiIGhlaWdodD0iMTUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0ODQiIHk9IjMzNyIgd2lkdGg9IjQxIiBoZWlnaHQ9IjciIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1NDMiIHk9IjMzNyIgd2lkdGg9IjQxIiBoZWlnaHQ9IjciIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2MDEiIHk9IjMzOCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjYiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2NjAiIHk9IjMzOSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI3MTkiIHk9IjM0MCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

## Discussion

Of 19,436 transfers, **5,519 cross a border** — and the map is brutally
eurocentric:

- **Europe → Europe is 85% of all international business** (4,702 moves,
  €20.95bn in fees). The "international" transfer market is mostly
  intra-European.
- **South America → Europe is the great pipeline**: 185 moves for €752.8m — the
  smallest corridor by count that still moves serious money, because every
  player is a premium prospect.
- The busiest country pair isn't a pipeline at all — it's a **rhythm**: Spain ↔
  England (216 + 215 moves, ~€2.8bn combined) and the
  France/Italy/England/Germany cluster trade players back and forth constantly.

The money ledger is starker than the volume ledger:

- **England is the market's ATM**: +€5.59bn net spend — it buys €8.46bn worth of
  foreign players and sells €2.87bn. No other country comes close; second-place
  Turkey is +€302m.
- **Germany is the market's bank**: −€1.16bn net — earns €3.44bn selling abroad,
  spends €2.28bn buying. France (−€1.05bn), Portugal (−€925m) and Argentina
  (−€409m) complete the top talent exporters.
- Portugal's ratio is the most extreme: sells 231 players for €1.21bn, buys 204
  for only €284m — a pure development league.

Caveats: "country" is the club's registered country, so a player moving between
two English clubs counts as domestic; fees only cover the ~28% of transfers with
disclosed money; players moving between two clubs in the same country but
different leagues are excluded by design; ~70 country names needed manual region
mapping (monaco, turkey etc.).

**Limitations.** Transfer fee coverage is incomplete — roughly three quarters of
moves have undisclosed fees — and output is measured only where match statistics
exist for the player.

## Conclusion

Europe → Europe is 85% of all international business. Together these results
answer the research question posed in the Introduction and quantify the pattern
across 19,436 transfers. The notebook provides a fully reproducible pipeline
from raw CSV extracts to published figures.
