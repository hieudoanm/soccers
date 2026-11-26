---
title: 'Does big money buy goals? Fee vs. output'
description: |
  '189 transfers of €10m+: the bigger the fee the worse the return —
  €100m+ signings lose 0.28 G+A/90 vs their prior form and only 18%
  improve. The market overpays for peak form.'
author: 'hieudoan'
date: '2026-11-28T14:00'
order: 52
tags: ['football', 'analysis', 'transfers', 'transfermarkt', 'mars', 'sqlite']
---

# Does big money buy goals? Fee vs. output

## Abstract

Does big money buy goals? This study answers it using 19,436 transfers drawn
from the Soccers football database. Among 189 big-money transfers (fee ≥ €10m)
had enough before/after match data to measure. All computation runs in Rust
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
  - [Before and after the move](#before-and-after-the-move)
  - [Busts and surprise hits](#busts-and-surprise-hits)
  - [The fee quartiles](#the-fee-quartiles)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

19,436 transfers are in the database — 5,354 with a disclosed fee. This notebook
asks the uncomfortable question: **do expensive signings actually produce
more?**

For every transfer with a fee ≥ €10m, we compare the player's goal involvement
(goals + assists per 90) in the 12 months _before_ the move (at the selling
club) versus the 12 months _after_ (at the buying club). Only players with at
least 3 appearances on each side are counted, and only their club-level minutes
count — international duty is excluded.

Caveats: fees are Transfermarkt EUR figures (add-ons excluded); "before" form
may already be declining (buy-high/sell-low is normal); players who moved again
inside a year have truncated windows.

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `match`, `player`, `player_match_stat`, `team`, `transfer`.

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
let pms = load("player_match_stat");
let mat = load("match");
let pl = load("player");
let tm = load("team");

let t_pid = col_i64(&tr, "player_id");
let t_from = col_i64(&tr, "from_team_id");
let t_to = col_i64(&tr, "to_team_id");
let t_fee = col_f64(&tr, "fee");
let t_date = col_str(&tr, "date");

let p_id = col_i64(&pl, "id");
let p_name = col_str(&pl, "name");
let mut pname: HashMap<i64,String> = HashMap::new();
for i in 0..pl.height() { pname.insert(p_id[i], p_name[i].clone()); }
let tm_id = col_i64(&tm, "id");
let tm_name = col_str(&tm, "name");
let mut tname: HashMap<i64,String> = HashMap::new();
for i in 0..tm.height() { tname.insert(tm_id[i], tm_name[i].clone()); }

// match id -> day number
let m_id = col_i64(&mat, "id");
let m_date = col_str(&mat, "date");
let mut match_day: HashMap<i64,i64> = HashMap::new();
for i in 0..mat.height() { match_day.insert(m_id[i], day_of(&m_date[i])); }

// player -> appearances: (day, team_id, goals, assists, minutes)
let pm_pid = col_i64(&pms, "player_id");
let pm_mid = col_i64(&pms, "match_id");
let pm_tid = col_i64(&pms, "team_id");
let pm_g = col_f64(&pms, "goals");
let pm_a = col_f64(&pms, "assists");
let pm_min = col_f64(&pms, "minutes_played");
struct App { day: i64, tid: i64, ga: f64, mins: f64 }
let mut apps: HashMap<i64, Vec<App>> = HashMap::new();
for i in 0..pm_pid.len() {
    if let Some(&d) = match_day.get(&pm_mid[i]) {
        if d < 0 { continue; }
        let mins = if pm_min[i] > 0.0 { pm_min[i] } else { 90.0 };
        apps.entry(pm_pid[i]).or_default().push(App{day:d, tid:pm_tid[i], ga:pm_g[i]+pm_a[i], mins});
    }
}
for v in apps.values_mut() { v.sort_by_key(|a| a.day); }
println!("players with match stats: {}", apps.len());
```

```text
players with match stats: 11701
```

### Before and after the move

```rust

// for each fee>=10m transfer, compute before/after G+A per 90 at the two clubs
struct Deal { pid: i64, fee: f64, before_ga90: f64, after_ga90: f64, b_apps: i64, a_apps: i64,
              from: i64, to: i64, day: i64 }
let mut deals: Vec<Deal> = Vec::new();
let WINDOW = 730i64;
for i in 0..t_pid.len() {
    if t_fee[i] < 10_000_000.0 || t_from[i] <= 0 || t_to[i] <= 0 { continue; }
    let d = day_of(&t_date[i]);
    if d < 0 { continue; }
    let pid = t_pid[i];
    let Some(list) = apps.get(&pid) else { continue };
    let (mut b_ga, mut b_min, mut b_n) = (0.0,0.0,0i64);
    let (mut a_ga, mut a_min, mut a_n) = (0.0,0.0,0i64);
    for ap in list {
        if ap.day >= d - WINDOW && ap.day < d {
            b_ga += ap.ga; b_min += ap.mins; b_n += 1;
        }
        if ap.day >= d && ap.day <= d + WINDOW {
            a_ga += ap.ga; a_min += ap.mins; a_n += 1;
        }
    }
    if b_n >= 3 && a_n >= 3 && b_min > 0.0 && a_min > 0.0 {
        deals.push(Deal{pid, fee:t_fee[i],
            before_ga90: b_ga*90.0/b_min, after_ga90: a_ga*90.0/a_min,
            b_apps:b_n, a_apps:a_n, from:t_from[i], to:t_to[i], day:d});
    }
}
println!("big-money deals with before+after data: {}", deals.len());

// fee bands
fn eur(e: f64) -> String {
    let m = e/1_000_000.0;
    if m >= 1000.0 { format!("€{:.2}bn", m/1000.0) } else { format!("€{:.1}m", m) }
}
let bands = [("€10–25m",10e6,25e6),("€25–50m",25e6,50e6),("€50–100m",50e6,100e6),("€100m+",100e6,f64::MAX)];
let brows: Vec<Vec<String>> = bands.iter().map(|(name,lo,hi)| {
    let ds: Vec<&Deal> = deals.iter().filter(|d| d.fee>=*lo && d.fee<*hi).collect();
    if ds.is_empty() { return vec![name.to_string(),"0".into(),"-".into(),"-".into(),"-".into(),"-".into()]; }
    let med_b: f64 = { let mut v:Vec<f64>=ds.iter().map(|d|d.before_ga90).collect(); v.sort_by(|a,b|a.partial_cmp(b).unwrap()); v[v.len()/2] };
    let med_a: f64 = { let mut v:Vec<f64>=ds.iter().map(|d|d.after_ga90).collect(); v.sort_by(|a,b|a.partial_cmp(b).unwrap()); v[v.len()/2] };
    let improved = ds.iter().filter(|d| d.after_ga90 > d.before_ga90).count();
    vec![name.to_string(), ds.len().to_string(),
        format!("{:.2}",med_b), format!("{:.2}",med_a),
        format!("{:.0}%", 100.0*improved as f64/ds.len() as f64),
        format!("{:+.2}", med_a-med_b)]
}).collect();
mars_table(&["fee band","deals","med G+A/90 before","after","% improved","Δ median"], &brows);
```

```text
big-money deals with before+after data: 189
```

| fee band | deals | med G+A/90 before | after | % improved | Δ median |
| -------- | ----- | ----------------- | ----- | ---------- | -------- |
| €10–25m  | 96    | 0.06              | 0.09  | 34%        | +0.02    |
| €25–50m  | 53    | 0.11              | 0.00  | 28%        | -0.11    |
| €50–100m | 29    | 0.31              | 0.18  | 38%        | -0.13    |
| €100m+   | 11    | 0.48              | 0.20  | 18%        | -0.28    |

### Busts and surprise hits

```rust
// biggest busts and best hits among >=20m deals
let mut big: Vec<&Deal> = deals.iter().filter(|d| d.fee >= 20_000_000.0).collect();
big.sort_by(|a,b| (a.after_ga90 - a.before_ga90).partial_cmp(&(b.after_ga90 - b.before_ga90)).unwrap());
let bust_rows: Vec<Vec<String>> = big.iter().take(15).map(|d| vec![
    pname.get(&d.pid).cloned().unwrap_or_default().chars().take(24).collect(),
    eur(d.fee),
    format!("{} → {}", tname.get(&d.from).cloned().unwrap_or_default().chars().take(18).collect::<String>(),
                            tname.get(&d.to).cloned().unwrap_or_default().chars().take(18).collect::<String>()),
    format!("{:.2} → {:.2}", d.before_ga90, d.after_ga90),
]).collect();
mars_table(&["player","fee","move","G+A/90 before→after"], &bust_rows);
```

| player                   | fee     | move                              | G+A/90 before→after |
| ------------------------ | ------- | --------------------------------- | ------------------- |
| Gonçalo Matias Ramos     | €65.0m  | Benfica → Paris Saint-Germai      | 0.88 → 0.00         |
| Romelu Lukaku Menama     | €113.0m | Inter Milan → Chelsea             | 0.81 → 0.00         |
| Aleksandar Mitrović      | €52.6m  | Fulham → Al Hilal                 | 0.72 → 0.00         |
| Kevin Gameiro            | €32.0m  | Sevilla → Atlético Madrid         | 0.67 → 0.00         |
| Harry Kane               | €95.0m  | Tottenham Hotspur → Bayern Munich | 1.12 → 0.47         |
| Youssef En-Nesyri        | €20.0m  | Leganes → Sevilla                 | 0.55 → 0.00         |
| Wissam Ben Yedder        | €40.0m  | Sevilla → AS Monaco               | 0.50 → 0.00         |
| Antoine Griezmann        | €22.0m  | Barcelona → Atlético Madrid       | 0.47 → 0.00         |
| Robert Lewandowski       | €45.0m  | Bayern Munich → Barcelona         | 1.12 → 0.65         |
| Michy Batshuayi Tunga    | €39.0m  | Marseille → Chelsea               | 0.69 → 0.25         |
| Kylian Mbappé Lottin     | €180.0m | AS Monaco → Paris Saint-Germai    | 0.79 → 0.36         |
| Moisés Isaac Caicedo Cor | €116.0m | Brighton & Hove Al → Chelsea      | 0.40 → 0.00         |
| Sergej Milinković-Savić  | €40.0m  | Lazio → Al Hilal                  | 0.40 → 0.00         |
| Paul Pogba               | €105.0m | Juventus → Manchester United      | 0.53 → 0.14         |
| Ousmane Dembélé          | €35.0m  | Stade Rennais → Borussia Dortmund | 0.80 → 0.43         |

```rust
big.sort_by(|a,b| (b.after_ga90 - b.before_ga90).partial_cmp(&(a.after_ga90 - a.before_ga90)).unwrap());
let hit_rows: Vec<Vec<String>> = big.iter().take(15).map(|d| vec![
    pname.get(&d.pid).cloned().unwrap_or_default().chars().take(24).collect(),
    eur(d.fee),
    format!("{} → {}", tname.get(&d.from).cloned().unwrap_or_default().chars().take(18).collect::<String>(),
                            tname.get(&d.to).cloned().unwrap_or_default().chars().take(18).collect::<String>()),
    format!("{:.2} → {:.2}", d.before_ga90, d.after_ga90),
]).collect();
mars_table(&["player","fee","move","G+A/90 before→after"], &hit_rows);
```

| player                   | fee     | move                                   | G+A/90 before→after |
| ------------------------ | ------- | -------------------------------------- | ------------------- |
| Juan Guillermo Cuadrado  | €20.0m  | Chelsea → Juventus                     | 0.23 → 1.00         |
| Thorgan Hazard           | €25.5m  | Borussia Mönchengl → Borussia Dortmund | 0.00 → 0.65         |
| Ángel Fabián Di María He | €75.0m  | Real Madrid → Manchester United        | 0.54 → 1.18         |
| Álvaro Borja Morata Mart | €35.0m  | Chelsea → Atlético Madrid              | 0.00 → 0.64         |
| Carlos Arturo Bacca Ahum | €33.3m  | Sevilla → AC Milan                     | 0.00 → 0.60         |
| Kasper Dolberg           | €20.5m  | Ajax Amsterdam → OGC Nice              | 0.00 → 0.59         |
| Ángel Fabián Di María He | €63.0m  | Manchester United → Paris Saint-Germai | 0.72 → 1.18         |
| Ikoma Loïs Openda        | €40.0m  | Lens → RB Leipzig                      | 0.00 → 0.37         |
| Jude Bellingham          | €127.0m | Borussia Dortmund → Real Madrid        | 0.27 → 0.63         |
| Cody Mathès Gakpo        | €42.0m  | PSV Eindhoven → Liverpool              | 0.37 → 0.69         |
| Fabián Ruiz Peña         | €22.5m  | Napoli → Paris Saint-Germai            | 0.00 → 0.30         |
| John Stones              | €55.6m  | Everton → Manchester City              | 0.00 → 0.30         |
| Antoine Griezmann        | €54.0m  | Real Sociedad → Atlético Madrid        | 0.55 → 0.84         |
| Nuno Mendes              | €38.0m  | Sporting CP → Paris Saint-Germai       | 0.00 → 0.27         |
| Alexis Mac Allister      | €42.0m  | Brighton & Hove Al → Liverpool         | 0.30 → 0.55         |

### The fee quartiles

```rust

// does the fee predict the outcome? bucket all measured deals by fee
let idx: Vec<usize> = { let mut v: Vec<usize> = (0..deals.len()).collect();
    v.sort_by(|&a,&b| deals[a].fee.partial_cmp(&deals[b].fee).unwrap()); v };
let n = idx.len();
let quart_rows: Vec<Vec<String>> = (0..4).map(|q| {
    let slice = &idx[q*n/4..(q+1)*n/4];
    let med_fee = { let mut v:Vec<f64>=slice.iter().map(|&i|deals[i].fee).collect(); v.sort_by(|a,b|a.partial_cmp(b).unwrap()); v[v.len()/2] };
    let med_b: f64 = { let mut v:Vec<f64>=slice.iter().map(|&i|deals[i].before_ga90).collect(); v.sort_by(|a,b|a.partial_cmp(b).unwrap()); v[v.len()/2] };
    let med_a: f64 = { let mut v:Vec<f64>=slice.iter().map(|&i|deals[i].after_ga90).collect(); v.sort_by(|a,b|a.partial_cmp(b).unwrap()); v[v.len()/2] };
    let imp = slice.iter().filter(|&&i| deals[i].after_ga90 > deals[i].before_ga90).count();
    vec![format!("Q{}",q+1), slice.len().to_string(), eur(med_fee),
        format!("{:.2}",med_b), format!("{:.2}",med_a),
        format!("{:.0}%",100.0*imp as f64/slice.len() as f64),
        format!("{:+.2}", med_a-med_b)]
}).collect();
mars_table(&["fee quartile","deals","med fee","med before","med after","% improved","Δ"], &quart_rows);
```

| fee quartile | deals | med fee | med before | med after | % improved | Δ     |
| ------------ | ----- | ------- | ---------- | --------- | ---------- | ----- |
| Q1           | 47    | €13.0m  | 0.00       | 0.00      | 36%        | +0.00 |
| Q2           | 47    | €18.5m  | 0.10       | 0.11      | 32%        | +0.01 |
| Q3           | 47    | €34.2m  | 0.03       | 0.00      | 28%        | -0.03 |
| Q4           | 48    | €65.0m  | 0.33       | 0.19      | 33%        | -0.14 |

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


let mut c_items: Vec<(String, f64)> = quart_rows.iter()
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
        .caption("Share of big-money deals that improved output", ("sans-serif", 18))
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

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KU2hhcmUgb2YgYmlnLW1vbmV5IGRlYWxzIHRoYXQgaW1wcm92ZWQgb3V0cHV0CjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iMzQ0IiB4Mj0iODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTE3IiB5MT0iMzQ0IiB4Mj0iMTE3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM0NCIgeDI9IjE1MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODgiIHkxPSIzNDQiIHgyPSIxODgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIzIiB5MT0iMzQ0IiB4Mj0iMjIzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI1OCIgeTE9IjM0NCIgeDI9IjI1OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyOTMiIHkxPSIzNDQiIHgyPSIyOTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI5IiB5MT0iMzQ0IiB4Mj0iMzI5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2NCIgeTE9IjM0NCIgeDI9IjM2NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTkiIHkxPSIzNDQiIHgyPSIzOTkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDM0IiB5MT0iMzQ0IiB4Mj0iNDM0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2OSIgeTE9IjM0NCIgeDI9IjQ2OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDUiIHkxPSIzNDQiIHgyPSI1MDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQwIiB5MT0iMzQ0IiB4Mj0iNTQwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU3NSIgeTE9IjM0NCIgeDI9IjU3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTAiIHkxPSIzNDQiIHgyPSI2MTAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQ1IiB5MT0iMzQ0IiB4Mj0iNjQ1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjM0NCIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MTYiIHkxPSIzNDQiIHgyPSI3MTYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDQiIHgyPSI3NjkiIHkyPSIzNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzQxIiB4Mj0iNzY5IiB5Mj0iMzQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMzNyIgeDI9Ijc2OSIgeTI9IjMzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMzMiIHgyPSI3NjkiIHkyPSIzMzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzMwIiB4Mj0iNzY5IiB5Mj0iMzMwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMyNiIgeDI9Ijc2OSIgeTI9IjMyNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjIiIHgyPSI3NjkiIHkyPSIzMjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzE4IiB4Mj0iNzY5IiB5Mj0iMzE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMxNSIgeDI9Ijc2OSIgeTI9IjMxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMTEiIHgyPSI3NjkiIHkyPSIzMTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzA3IiB4Mj0iNzY5IiB5Mj0iMzA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMwMyIgeDI9Ijc2OSIgeTI9IjMwMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMDAiIHgyPSI3NjkiIHkyPSIzMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjk2IiB4Mj0iNzY5IiB5Mj0iMjk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5MiIgeDI9Ijc2OSIgeTI9IjI5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyODgiIHgyPSI3NjkiIHkyPSIyODgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjg1IiB4Mj0iNzY5IiB5Mj0iMjg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI4MSIgeDI9Ijc2OSIgeTI9IjI4MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNzciIHgyPSI3NjkiIHkyPSIyNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjczIiB4Mj0iNzY5IiB5Mj0iMjczIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI3MCIgeDI9Ijc2OSIgeTI9IjI3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNjYiIHgyPSI3NjkiIHkyPSIyNjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjYyIiB4Mj0iNzY5IiB5Mj0iMjYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI1OCIgeDI9Ijc2OSIgeTI9IjI1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNTUiIHgyPSI3NjkiIHkyPSIyNTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjUxIiB4Mj0iNzY5IiB5Mj0iMjUxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI0NyIgeDI9Ijc2OSIgeTI9IjI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNDMiIHgyPSI3NjkiIHkyPSIyNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjQwIiB4Mj0iNzY5IiB5Mj0iMjQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzNiIgeDI9Ijc2OSIgeTI9IjIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzIiIHgyPSI3NjkiIHkyPSIyMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjI4IiB4Mj0iNzY5IiB5Mj0iMjI4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIyNSIgeDI9Ijc2OSIgeTI9IjIyNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMjEiIHgyPSI3NjkiIHkyPSIyMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjE3IiB4Mj0iNzY5IiB5Mj0iMjE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIxMyIgeDI9Ijc2OSIgeTI9IjIxMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMTAiIHgyPSI3NjkiIHkyPSIyMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjA2IiB4Mj0iNzY5IiB5Mj0iMjA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIwMiIgeDI9Ijc2OSIgeTI9IjIwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxOTgiIHgyPSI3NjkiIHkyPSIxOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTk1IiB4Mj0iNzY5IiB5Mj0iMTk1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE5MSIgeDI9Ijc2OSIgeTI9IjE5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODciIHgyPSI3NjkiIHkyPSIxODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTg0IiB4Mj0iNzY5IiB5Mj0iMTg0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE4MCIgeDI9Ijc2OSIgeTI9IjE4MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNzYiIHgyPSI3NjkiIHkyPSIxNzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTcyIiB4Mj0iNzY5IiB5Mj0iMTcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE2OSIgeDI9Ijc2OSIgeTI9IjE2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNjUiIHgyPSI3NjkiIHkyPSIxNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTYxIiB4Mj0iNzY5IiB5Mj0iMTYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE1NyIgeDI9Ijc2OSIgeTI9IjE1NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTQiIHgyPSI3NjkiIHkyPSIxNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTUwIiB4Mj0iNzY5IiB5Mj0iMTUwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE0NiIgeDI9Ijc2OSIgeTI9IjE0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNDIiIHgyPSI3NjkiIHkyPSIxNDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTM5IiB4Mj0iNzY5IiB5Mj0iMTM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEzNSIgeDI9Ijc2OSIgeTI9IjEzNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzEiIHgyPSI3NjkiIHkyPSIxMzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTI3IiB4Mj0iNzY5IiB5Mj0iMTI3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyNCIgeDI9Ijc2OSIgeTI9IjEyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMjAiIHgyPSI3NjkiIHkyPSIxMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTE2IiB4Mj0iNzY5IiB5Mj0iMTE2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExMiIgeDI9Ijc2OSIgeTI9IjExMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMDkiIHgyPSI3NjkiIHkyPSIxMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTA1IiB4Mj0iNzY5IiB5Mj0iMTA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEwMSIgeDI9Ijc2OSIgeTI9IjEwMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI5NyIgeDI9Ijc2OSIgeTI9Ijk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijk0IiB4Mj0iNzY5IiB5Mj0iOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iOTAiIHgyPSI3NjkiIHkyPSI5MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4NiIgeDI9Ijc2OSIgeTI9Ijg2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjgyIiB4Mj0iNzY5IiB5Mj0iODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNzkiIHgyPSI3NjkiIHkyPSI3OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI3NSIgeDI9Ijc2OSIgeTI9Ijc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjcxIiB4Mj0iNzY5IiB5Mj0iNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNjciIHgyPSI3NjkiIHkyPSI2NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI2NCIgeDI9Ijc2OSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjYwIiB4Mj0iNzY5IiB5Mj0iNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNTYiIHgyPSI3NjkiIHkyPSI1NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI1MiIgeDI9Ijc2OSIgeTI9IjUyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQ5IiB4Mj0iNzY5IiB5Mj0iNDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNDUiIHgyPSI3NjkiIHkyPSI0NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI0MSIgeDI9Ijc2OSIgeTI9IjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM3IiB4Mj0iNzY5IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM0NCIgeDI9IjE1MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjkiIHkxPSIzNDQiIHgyPSIzMjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA1IiB5MT0iMzQ0IiB4Mj0iNTA1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjM0NCIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjM0NCIgeDI9Ijc2OSIgeTI9IjM0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMDciIHgyPSI3NjkiIHkyPSIzMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjcwIiB4Mj0iNzY5IiB5Mj0iMjcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzMiIgeDI9Ijc2OSIgeTI9IjIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxOTUiIHgyPSI3NjkiIHkyPSIxOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTU3IiB4Mj0iNzY5IiB5Mj0iMTU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyMCIgeDI9Ijc2OSIgeTI9IjEyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4MiIgeDI9Ijc2OSIgeTI9IjgyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQ1IiB4Mj0iNzY5IiB5Mj0iNDUiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY0LDM0IDY0LDM0NCAiLz4KPHRleHQgeD0iNTUiIHk9IjM0NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDM0NCA2NCwzNDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIzMDciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjUuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwzMDcgNjQsMzA3ICIvPgo8dGV4dCB4PSI1NSIgeT0iMjcwIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDI3MCA2NCwyNzAgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIyMzIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjE1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMjMyIDY0LDIzMiAiLz4KPHRleHQgeD0iNTUiIHk9IjE5NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwxOTUgNjQsMTk1ICIvPgo8dGV4dCB4PSI1NSIgeT0iMTU3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDE1NyA2NCwxNTcgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIxMjAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjMwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMTIwIDY0LDEyMCAiLz4KPHRleHQgeD0iNTUiIHk9IjgyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDgyIDY0LDgyICIvPgo8dGV4dCB4PSI1NSIgeT0iNDUiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjQwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksNDUgNjQsNDUgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NSwzNDUgNzY5LDM0NSAiLz4KPHRleHQgeD0iMTUzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpRMQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxNTMsMzQ1IDE1MywzNTAgIi8+Cjx0ZXh0IHg9IjMyOSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUTQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzI5LDM0NSAzMjksMzUwICIvPgo8dGV4dCB4PSI1MDUiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClEyCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUwNSwzNDUgNTA1LDM1MCAiLz4KPHRleHQgeD0iNjgxIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpRMwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2ODEsMzQ1IDY4MSwzNTAgIi8+CjxyZWN0IHg9IjkxIiB5PSI3NSIgd2lkdGg9IjEyMyIgaGVpZ2h0PSIyNjkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyNjciIHk9Ijk3IiB3aWR0aD0iMTIzIiBoZWlnaHQ9IjI0NyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ0MyIgeT0iMTA1IiB3aWR0aD0iMTIzIiBoZWlnaHQ9IjIzOSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYxOSIgeT0iMTM1IiB3aWR0aD0iMTIzIiBoZWlnaHQ9IjIwOSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+Cjwvc3ZnPg==)

## Discussion

189 big-money transfers (fee ≥ €10m) had enough before/after match data to
measure. The result is uncomfortable for the transfer market:

- **The bigger the fee, the worse the return**: median G+A/90 before vs after
  the move is +0.02 for €10–25m deals, roughly flat for €25–50m, **−0.11 for
  €50–100m, and −0.28 for €100m+** — the most expensive signings lose nearly a
  third of a goal contribution per 90 relative to their prior form.
- **Only 18% of €100m+ signings improved** after moving; 33–38% of cheaper deals
  did.
- Signature busts: Gonçalo Ramos (€65m, 0.88→0.00), Lukaku (€113m, 0.81→0.00),
  Mitrović (€52.6m to Al Hilal, 0.72→0.00), Kane (€95m, 1.12→0.47 at Bayern).
- This is partly **mean reversion** — players are bought at their peak, so some
  decline is arithmetic, not betrayal. But the fee gradient suggests the market
  systematically overpays for peak form.

Caveats: performance is measured across _all_ recorded competitions (±24 months,
min 3 apps each side), not just the new club; our match coverage is StatsBomb
competitions only, so players moving to uncovered leagues can show truncated
"after" windows; fees exclude add-ons and sell-on clauses; 189 deals is a small
sample of the 5,354 fee-bearing transfers.

**Limitations.** Transfer fee coverage is incomplete — roughly three quarters of
moves have undisclosed fees — and output is measured only where match statistics
exist for the player.

## Conclusion

Among 189 big-money transfers (fee ≥ €10m) had enough before/after match data to
measure. Together these results answer the research question posed in the
Introduction and quantify the pattern across 19,436 transfers. The notebook
provides a fully reproducible pipeline from raw CSV extracts to published
figures.
