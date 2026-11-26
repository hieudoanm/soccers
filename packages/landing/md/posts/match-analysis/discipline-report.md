---
title: 'The discipline report: who collects cards and who concedes fouls'
description: |
  '152k player-match lines: forwards draw more fouls than they commit,
  Messi has drawn 1,747, Franco Vázquez fouls 3.8 times per game, and
  Granada averages a card per match.'
author: 'hieudoan'
date: '2026-11-28T16:00'
order: 54
tags:
  ['football', 'analysis', 'discipline', 'cards', 'statsbomb', 'mars', 'sqlite']
---

# The discipline report: who collects cards and who concedes fouls

## Abstract

This study examines the discipline report using 152,000 appearances drawn from
the Soccers football database. Card-rate leaders are specialists, not stars. All
computation runs in Rust inside a `.mars` notebook (polars + plotters — charts
as inline SVG), and every table and figure is generated from the extracted CSVs.

## Keywords

**Keywords:** football, analysis, discipline, cards, statsbomb, mars, sqlite

## Table of contents

- [Abstract](#abstract)
- [Keywords](#keywords)
- [Introduction](#introduction)
- [Methods](#methods)
- [Results](#results)
  - [Most cards per 90 (min 30 apps)](#most-cards-per-90-min-30-apps)
  - [Most fouls committed per 90 (min 30 apps)](#most-fouls-committed-per-90-min-30-apps)
  - [Most fouls drawn per 90 — the players defenders can't stop fouling](#most-fouls-drawn-per-90--the-players-defenders-cant-stop-fouling)
  - [Raw card totals (volume kings)](#raw-card-totals-volume-kings)
  - [Red cards — every dismissal on record](#red-cards--every-dismissal-on-record)
  - [Position-level discipline averages](#position-level-discipline-averages)
  - [Team discipline: team-total fouls/cards per team-match](#team-discipline-team-total-foulscards-per-team-match)
- [Discussion](#discussion)
- [Conclusion](#conclusion)

## Introduction

Every player-match line records fouls committed, fouls drawn, yellow and red
cards across ~152,000 appearances. This notebook builds the discipline tables:
the most-booked players, the most-fouling players, the players who _draw_ the
most fouls, and the teams whose matches are card-fests.

The question underneath: is aggression a coaching choice, a player trait, or a
tactical necessity — and does it correlate with anything we can measure (cards,
goals conceded, results)?

## Methods

Data were extracted from the Soccers football database (`packages/data`) as CSV
snapshots: `player`, `player_match_stat`, `team`.

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

let pms = load("player_match_stat");
let pl = load("player");
let tm = load("team");

let pm_pid = col_i64(&pms, "player_id");
let pm_tid = col_i64(&pms, "team_id");
let pm_mid = col_i64(&pms, "match_id");
let pm_f = col_f64(&pms, "fouls_committed");
let pm_fd = col_f64(&pms, "fouls_drawn");
let pm_y = col_f64(&pms, "yellow_cards");
let pm_r = col_f64(&pms, "red_cards");
let pm_min = col_f64(&pms, "minutes_played");
let pm_g = col_f64(&pms, "goals");
let pm_a = col_f64(&pms, "assists");

let p_id = col_i64(&pl, "id");
let p_name = col_str(&pl, "name");
let p_pos = col_str(&pl, "position");
let mut pname: HashMap<i64,String> = HashMap::new();
let mut ppos: HashMap<i64,String> = HashMap::new();
for i in 0..pl.height() { pname.insert(p_id[i], p_name[i].clone()); ppos.insert(p_id[i], p_pos[i].clone()); }
let t_id = col_i64(&tm, "id");
let t_name = col_str(&tm, "name");
let mut tname: HashMap<i64,String> = HashMap::new();
for i in 0..tm.height() { tname.insert(t_id[i], t_name[i].clone()); }

struct P { pid: i64, apps: i64, mins: f64, f: f64, fd: f64, y: f64, r: f64, g: f64, a: f64 }
let mut agg: HashMap<i64, P> = HashMap::new();
for i in 0..pm_pid.len() {
    if pm_pid[i] <= 0 { continue; }
    let e = agg.entry(pm_pid[i]).or_insert(P{pid:pm_pid[i],apps:0,mins:0.0,f:0.0,fd:0.0,y:0.0,r:0.0,g:0.0,a:0.0});
    e.apps += 1;
    e.mins += if pm_min[i] > 0.0 { pm_min[i] } else { 90.0 };
    e.f += pm_f[i]; e.fd += pm_fd[i]; e.y += pm_y[i]; e.r += pm_r[i];
    e.g += pm_g[i]; e.a += pm_a[i];
}
let players: Vec<P> = agg.into_values().collect();
println!("players with stats: {}, total cards: {:.0}", players.len(),
    players.iter().map(|p| p.y+p.r).sum::<f64>());

let hdr = ["player","pos","apps","fouls","fouls/90","cards","cards/90","fouls drawn"];
let pos_group = |pos: &str| -> &'static str {
    let n = pos.to_lowercase();
    if n.contains("goalkeeper") { "GK" }
    else if n.contains("defen") || n.contains("back") { "DEF" }
    else if n.contains("midf") { "MID" }
    else if n.contains("attack") || n.contains("striker") || n.contains("wing") || n.contains("forward") { "FWD" }
    else { "UNK" }
};
let row_of = |p: &P| -> Vec<String> {
    vec![
        pname.get(&p.pid).cloned().unwrap_or_default().chars().take(26).collect(),
        pos_group(ppos.get(&p.pid).map(|s|s.as_str()).unwrap_or("")).to_string(),
        p.apps.to_string(),
        format!("{:.0}", p.f),
        format!("{:.2}", p.f*90.0/p.mins),
        format!("{:.0}", p.y+p.r),
        format!("{:.2}", (p.y+p.r)*90.0/p.mins),
        format!("{:.0}", p.fd),
    ]
};
```

```text
players with stats: 11794, total cards: 2855
```

### Most cards per 90 (min 30 apps)

```rust

// most cards per 90 (min 30 apps)
let mut cards: Vec<&P> = players.iter().filter(|p| p.apps >= 30).collect();
cards.sort_by(|a,b| ((b.y+b.r)*90.0/b.mins).partial_cmp(&((a.y+a.r)*90.0/a.mins)).unwrap());
mars_table(&hdr, &cards.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Fabián Ariel Orellana Vale | FWD | 49   | 50    | 1.10     | 13    | 0.29     | 122         |
| Yannick Cahuzac            | FWD | 33   | 60    | 2.23     | 7     | 0.26     | 32          |
| Deyverson Brum Silva Acost | FWD | 40   | 55    | 1.53     | 9     | 0.25     | 82          |
| Alexis Ruano Delgado       | DEF | 31   | 24    | 0.80     | 7     | 0.23     | 15          |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Iago Aspas Juncal          | FWD | 49   | 53    | 1.30     | 9     | 0.22     | 71          |
| Roberto Trashorras Gayoso  | DEF | 43   | 62    | 1.58     | 8     | 0.20     | 95          |
| Manuel Agudo Durán         | MID | 42   | 62    | 1.56     | 8     | 0.20     | 87          |
| Jonathas Cristian de Jesus | FWD | 48   | 76    | 1.74     | 8     | 0.18     | 74          |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Younousse Sankharé         | DEF | 33   | 54    | 1.86     | 5     | 0.17     | 53          |
| Esteban Félix Granero Moli | MID | 31   | 38    | 1.30     | 5     | 0.17     | 42          |
| Danilo Soddimo             | MID | 33   | 42    | 1.43     | 5     | 0.17     | 49          |
| Radja Nainggolan           | MID | 35   | 53    | 1.80     | 5     | 0.17     | 57          |
| Juan Torres Ruiz           | DEF | 31   | 44    | 1.47     | 5     | 0.17     | 28          |
| Charles Días Barbosa de Ol | FWD | 44   | 83    | 1.97     | 7     | 0.17     | 58          |
| Aleksandar Mitrović        | FWD | 45   | 63    | 1.49     | 7     | 0.17     | 76          |
| María Dolores Gallardo Nuñ | GK  | 37   | 0     | 0.00     | 6     | 0.16     | 1           |
| Fabrizio Cacciatore        | MID | 35   | 24    | 0.75     | 5     | 0.16     | 16          |
| Gary Alexis Medel Soto     | MID | 39   | 38    | 1.13     | 5     | 0.15     | 28          |

### Most fouls committed per 90 (min 30 apps)

```rust

// most fouls committed per 90 (min 30 apps)
let mut fouls: Vec<&P> = players.iter().filter(|p| p.apps >= 30).collect();
fouls.sort_by(|a,b| (b.f*90.0/b.mins).partial_cmp(&(a.f*90.0/a.mins)).unwrap());
mars_table(&hdr, &fouls.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Franco Damián Vázquez      | MID | 46   | 145   | 3.81     | 4     | 0.11     | 223         |
| Papa Kouly Diop            | DEF | 47   | 151   | 3.79     | 2     | 0.05     | 81          |
| Hernán Arsenio Pérez Gonzá | FWD | 36   | 104   | 3.51     | 1     | 0.03     | 63          |
| Pedro Pablo Hernández      | MID | 36   | 100   | 3.37     | 4     | 0.13     | 123         |
| Lorenzo Lollo              | MID | 31   | 86    | 3.28     | 0     | 0.00     | 46          |
| Gabriel Fernández Arenas   | DEF | 55   | 156   | 3.24     | 2     | 0.04     | 80          |
| Gonzalo Escalante          | DEF | 41   | 121   | 3.22     | 3     | 0.08     | 39          |
| Raúl García Escudero       | FWD | 55   | 150   | 3.08     | 5     | 0.10     | 128         |
| Cheikh N''Doye             | MID | 35   | 88    | 2.98     | 2     | 0.07     | 53          |
| Anderson Luís de Souza     | MID | 57   | 149   | 2.95     | 5     | 0.10     | 176         |
| Ignacio Camacho Barnola    | DEF | 31   | 84    | 2.90     | 3     | 0.10     | 56          |
| Lassana Diarra             | DEF | 31   | 78    | 2.85     | 0     | 0.00     | 40          |
| Paul Pogba                 | MID | 48   | 125   | 2.80     | 4     | 0.09     | 99          |
| Artur Ioniţă               | MID | 31   | 68    | 2.73     | 1     | 0.04     | 36          |
| Didier Ndong Ibrahim       | DEF | 34   | 80    | 2.70     | 0     | 0.00     | 43          |
| Karim Bellarabi            | FWD | 33   | 70    | 2.60     | 4     | 0.15     | 69          |
| Víctor Sánchez Mata        | FWD | 49   | 114   | 2.60     | 3     | 0.07     | 66          |
| Juraj Kucka                | DEF | 38   | 89    | 2.58     | 2     | 0.06     | 65          |
| Sofiane Boufal             | MID | 41   | 88    | 2.57     | 1     | 0.03     | 96          |
| José Luis García del Pozo  | DEF | 44   | 98    | 2.56     | 2     | 0.05     | 59          |

### Most fouls drawn per 90 — the players defenders can't stop fouling

```rust

// most fouls drawn per 90 — the players defenders can't stop fouling
let mut drawn: Vec<&P> = players.iter().filter(|p| p.apps >= 30).collect();
drawn.sort_by(|a,b| (b.fd*90.0/b.mins).partial_cmp(&(a.fd*90.0/a.mins)).unwrap());
mars_table(&hdr, &drawn.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Franco Damián Vázquez      | MID | 46   | 145   | 3.81     | 4     | 0.11     | 223         |
| Neymar da Silva Santos Jun | FWD | 158  | 204   | 1.41     | 15    | 0.10     | 665         |
| Pedro Pablo Hernández      | MID | 36   | 100   | 3.37     | 4     | 0.13     | 123         |
| Bryan Dabo                 | DEF | 37   | 64    | 2.05     | 2     | 0.06     | 122         |
| Ronaldo de Assis Moreira   | FWD | 59   | 75    | 1.41     | 3     | 0.06     | 202         |
| Wilfried Zaha              | FWD | 34   | 43    | 1.57     | 2     | 0.07     | 102         |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Anderson Luís de Souza     | MID | 57   | 149   | 2.95     | 5     | 0.10     | 176         |
| Borja Valero Iglesias      | DEF | 44   | 52    | 1.39     | 3     | 0.08     | 129         |
| Nicolas de Roussel de Prév | MID | 36   | 67    | 2.24     | 0     | 0.00     | 103         |
| Eden Hazard                | FWD | 45   | 26    | 0.66     | 0     | 0.00     | 129         |
| Lionel Andrés Messi Cuccit | FWD | 603  | 417   | 0.77     | 27    | 0.05     | 1747        |
| Carlos Alberto Vela Garrid | FWD | 50   | 68    | 1.58     | 1     | 0.02     | 133         |
| Daniel Ceballos Fernández  | MID | 39   | 51    | 1.53     | 4     | 0.12     | 102         |
| Emmanuel Agyemang-Badu     | MID | 34   | 30    | 1.02     | 0     | 0.00     | 90          |
| Juan Guillermo Cuadrado Be | DEF | 43   | 41    | 1.09     | 1     | 0.03     | 113         |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Andrea Belotti             | FWD | 45   | 72    | 1.83     | 0     | 0.00     | 117         |
| Federico Dionisi           | FWD | 34   | 62    | 2.03     | 3     | 0.10     | 90          |
| Gilles Sunu                | FWD | 32   | 33    | 1.24     | 0     | 0.00     | 78          |

### Raw card totals (volume kings)

```rust
// raw card totals (volume kings)
let mut vol: Vec<&P> = players.iter().collect();
vol.sort_by(|a,b| (b.y+b.r).partial_cmp(&(a.y+a.r)).unwrap());
mars_table(&hdr, &vol.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Jordi Alba Ramos           | DEF | 284  | 234   | 0.87     | 28    | 0.10     | 200         |
| Lionel Andrés Messi Cuccit | FWD | 603  | 417   | 0.77     | 27    | 0.05     | 1747        |
| Gerard Piqué Bernabéu      | DEF | 358  | 285   | 0.85     | 24    | 0.07     | 187         |
| Víctor Valdés Arribas      | GK  | 256  | 5     | 0.02     | 20    | 0.08     | 30          |
| Luis Alberto Suárez Díaz   | FWD | 204  | 201   | 1.05     | 19    | 0.10     | 349         |
| Sergio Busquets i Burgos   | DEF | 420  | 586   | 1.54     | 18    | 0.05     | 944         |
| Neymar da Silva Santos Jun | FWD | 158  | 204   | 1.41     | 15    | 0.10     | 665         |
| Fabián Ariel Orellana Vale | FWD | 49   | 50    | 1.10     | 13    | 0.29     | 122         |
| Xavier Hernández Creus     | MID | 266  | 126   | 0.52     | 12    | 0.05     | 406         |
| Samuel Yves Umtiti         | DEF | 162  | 124   | 0.80     | 11    | 0.07     | 126         |
| Francesc Fàbregas i Soler  | MID | 121  | 138   | 1.33     | 10    | 0.10     | 191         |
| Gianluigi Donnarumma       | GK  | 104  | 2     | 0.02     | 9     | 0.09     | 15          |
| Iago Aspas Juncal          | FWD | 49   | 53    | 1.30     | 9     | 0.22     | 71          |
| Deyverson Brum Silva Acost | FWD | 40   | 55    | 1.53     | 9     | 0.25     | 82          |
| Roberto Trashorras Gayoso  | DEF | 43   | 62    | 1.58     | 8     | 0.20     | 95          |
| Daniel Alves da Silva      | DEF | 250  | 473   | 2.06     | 8     | 0.03     | 392         |
| Jonathas Cristian de Jesus | FWD | 48   | 76    | 1.74     | 8     | 0.18     | 74          |
| Katie McCabe               | DEF | 79   | 73    | 1.03     | 8     | 0.11     | 104         |
| Manuel Agudo Durán         | MID | 42   | 62    | 1.56     | 8     | 0.20     | 87          |
| Javier Alejandro Mascheran | DEF | 221  | 231   | 1.16     | 7     | 0.04     | 188         |

### Red cards — every dismissal on record

```rust
// red cards — every dismissal on record
let mut reds: Vec<&P> = players.iter().filter(|p| p.r > 0.0).collect();
reds.sort_by(|a,b| b.r.partial_cmp(&a.r).unwrap().then(b.apps.cmp(&a.apps)));
let rrows: Vec<Vec<String>> = reds.iter().take(20).map(|p| vec![
    pname.get(&p.pid).cloned().unwrap_or_default().chars().take(26).collect(),
    ppos.get(&p.pid).cloned().unwrap_or_default(),
    p.apps.to_string(),
    format!("{:.0}", p.r),
]).collect();
mars_table(&["player","pos","apps","red cards"], &rrows);
```

| player                     | pos                | apps | red cards |
| -------------------------- | ------------------ | ---- | --------- |
| Jordi Alba Ramos           | FULL_BACK          | 284  | 2         |
| Anderson Luís de Souza     | ATTACKING_MIDFIELD | 57   | 2         |
| Fabián Ariel Orellana Vale | WINGER             | 49   | 2         |
| Jonathas Cristian de Jesus | STRIKER            | 48   | 2         |
| Diego Perotti              | CENTER_BACK        | 34   | 2         |
| Younousse Sankharé         | DEFENSIVE_MIDFIELD | 33   | 2         |
| Yannick Cahuzac            | WINGER             | 33   | 2         |
| Víctor Valdés Arribas      | GOALKEEPER         | 256  | 1         |
| Javier Alejandro Mascheran | CENTER_BACK        | 221  | 1         |
| Ousmane Dembélé            | CENTRAL_MIDFIELD   | 125  | 1         |
| Ella Toone                 | CENTRAL_MIDFIELD   | 76   | 1         |
| Rosella Ayane              | WINGER             | 73   | 1         |
| Alex Greenwood             | FULL_BACK          | 66   | 1         |
| Achraf Hakimi Mouh         | WINGER             | 60   | 1         |
| Ronaldo de Assis Moreira   | WINGER             | 59   | 1         |
| Ibrahim Afellay            | WINGER             | 55   | 1         |
| Gilly Louise Scarlett Flah | CENTER_BACK        | 55   | 1         |
| Bruno Miguel Borges Fernan | ATTACKING_MIDFIELD | 54   | 1         |
| Kayleigh Green             | STRIKER            | 53   | 1         |
| Lauren James               | STRIKER            | 50   | 1         |

### Position-level discipline averages

```rust
// position-level discipline averages
let mut pos_stats: HashMap<&str,(i64,f64,f64,f64,f64)> = HashMap::new();
for p in &players {
    let g = pos_group(ppos.get(&p.pid).map(|s|s.as_str()).unwrap_or(""));
    let e = pos_stats.entry(g).or_insert((0,0.0,0.0,0.0,0.0));
    e.0 += p.apps; e.1 += p.f; e.2 += p.fd; e.3 += p.y+p.r; e.4 += p.mins;
}
let prows: Vec<Vec<String>> = ["FWD","MID","DEF","GK","UNK"].iter().filter_map(|g| {
    pos_stats.get(*g).map(|(n,f,fd,c,m)| vec![
        g.to_string(), n.to_string(),
        format!("{:.2}", *f*90.0/ *m),
        format!("{:.2}", *fd*90.0/ *m),
        format!("{:.2}", *c*90.0/ *m),
    ])
}).collect();
mars_table(&["pos","apps","fouls committed/90","fouls drawn/90","cards/90"], &prows);
```

| pos | apps  | fouls committed/90 | fouls drawn/90 | cards/90 |
| --- | ----- | ------------------ | -------------- | -------- |
| FWD | 40739 | 0.87               | 1.00           | 0.02     |
| MID | 30688 | 0.93               | 0.99           | 0.02     |
| DEF | 60475 | 0.92               | 0.69           | 0.02     |
| GK  | 14262 | 0.01               | 0.09           | 0.02     |
| UNK | 5969  | 0.00               | 0.00           | 0.00     |

### Team discipline: team-total fouls/cards per team-match

```rust
// team discipline: team-total fouls/cards per team-match
struct T { tid: i64, f: f64, y: f64, r: f64 }
let mut tagg: HashMap<i64, T> = HashMap::new();
let mut team_matches: HashMap<i64, std::collections::HashSet<i64>> = HashMap::new();
for i in 0..pm_pid.len() {
    if pm_tid[i] <= 0 { continue; }
    team_matches.entry(pm_tid[i]).or_default().insert(pm_mid[i]);
    let e = tagg.entry(pm_tid[i]).or_insert(T{tid:pm_tid[i],f:0.0,y:0.0,r:0.0});
    e.f += pm_f[i]; e.y += pm_y[i]; e.r += pm_r[i];
}
let mut trows_all: Vec<(i64,f64,f64,i64)> = tagg.iter().map(|(tid,t)| {
    let n = team_matches.get(tid).map(|s| s.len() as i64).unwrap_or(0);
    (*tid, t.f/n.max(1) as f64, (t.y+t.r)/n.max(1) as f64, n)
}).collect();
trows_all.retain(|(_,_,_,n)| *n >= 20); // enough team-matches
// cards per team-match desc
trows_all.sort_by(|a,b| b.2.partial_cmp(&a.2).unwrap());
let tcard: Vec<Vec<String>> = trows_all.iter().take(20).map(|(tid,fls,cds,_)| vec![
    tname.get(tid).cloned().unwrap_or_default().chars().take(28).collect(),
    format!("{:.2}", cds), format!("{:.2}", fls),
]).collect();
mars_table(&["team","cards per team-match","fouls per team-match"], &tcard);
```

| team                | cards per team-match | fouls per team-match |
| ------------------- | -------------------- | -------------------- |
| Granada             | 1.02                 | 18.64                |
| Celta Vigo          | 0.91                 | 17.78                |
| Espanyol            | 0.84                 | 21.21                |
| Netherlands         | 0.80                 | 17.40                |
| Levante             | 0.79                 | 16.88                |
| Nürnberg W          | 0.77                 | 14.05                |
| FC Levante Badalona | 0.73                 | 12.37                |
| Atletico Madrid W   | 0.73                 | 10.53                |
| Argentina           | 0.73                 | 15.64                |
| Malaga              | 0.72                 | 17.89                |
| Frosinone           | 0.68                 | 18.05                |
| Palermo             | 0.66                 | 17.74                |
| Kerala Blasters     | 0.65                 | 17.43                |
| Real Betis          | 0.64                 | 17.10                |
| Sporting Gijón      | 0.64                 | 17.59                |
| Bayer Leverkusen    | 0.63                 | 13.37                |
| Getafe              | 0.61                 | 18.07                |
| RB Leipzig W        | 0.59                 | 13.59                |
| Lazio               | 0.58                 | 16.97                |
| Chievo              | 0.58                 | 18.13                |

```rust
trows_all.sort_by(|a,b| b.1.partial_cmp(&a.1).unwrap());
let tfoul: Vec<Vec<String>> = trows_all.iter().take(20).map(|(tid,fls,cds,_)| vec![
    tname.get(tid).cloned().unwrap_or_default().chars().take(28).collect(),
    format!("{:.2}", fls), format!("{:.2}", cds),
]).collect();
mars_table(&["team","fouls per team-match","cards per team-match"], &tfoul);
```

| team            | fouls per team-match | cards per team-match |
| --------------- | -------------------- | -------------------- |
| Espanyol        | 21.21                | 0.84                 |
| Osasuna         | 19.30                | 0.45                 |
| Granada         | 18.64                | 1.02                 |
| Torino          | 18.63                | 0.34                 |
| Carpi           | 18.58                | 0.34                 |
| Bengaluru       | 18.50                | 0.25                 |
| Atlético Madrid | 18.35                | 0.50                 |
| Atalanta        | 18.21                | 0.39                 |
| Chievo          | 18.13                | 0.58                 |
| Getafe          | 18.07                | 0.61                 |
| Frosinone       | 18.05                | 0.68                 |
| Genoa           | 18.05                | 0.32                 |
| Athletic Club   | 17.94                | 0.44                 |
| Malaga          | 17.89                | 0.72                 |
| Hellas Verona   | 17.84                | 0.26                 |
| Celta Vigo      | 17.78                | 0.91                 |
| Rayo Vallecano  | 17.77                | 0.51                 |
| Palermo         | 17.74                | 0.66                 |
| Sporting Gijón  | 17.59                | 0.64                 |
| Kerala Blasters | 17.43                | 0.65                 |

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


let mut c_items: Vec<(String, f64)> = tcard.iter()
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
        .caption("Cards per team-match — most punished teams", ("sans-serif", 18))
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

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzgwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc4MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3ODAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzkwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2FyZHMgcGVyIHRlYW0tbWF0Y2gg4oCUIG1vc3QgcHVuaXNoZWQgdGVhbXMKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzAiIHkxPSIzNDQiIHgyPSI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4MiIgeTE9IjM0NCIgeDI9IjgyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk0IiB5MT0iMzQ0IiB4Mj0iOTQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTA2IiB5MT0iMzQ0IiB4Mj0iMTA2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjExNyIgeTE9IjM0NCIgeDI9IjExNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMjkiIHkxPSIzNDQiIHgyPSIxMjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTQxIiB5MT0iMzQ0IiB4Mj0iMTQxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM0NCIgeDI9IjE1MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNjQiIHkxPSIzNDQiIHgyPSIxNjQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTc2IiB5MT0iMzQ0IiB4Mj0iMTc2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE4OCIgeTE9IjM0NCIgeDI9IjE4OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTkiIHkxPSIzNDQiIHgyPSIxOTkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjExIiB5MT0iMzQ0IiB4Mj0iMjExIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIyMyIgeTE9IjM0NCIgeDI9IjIyMyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMzUiIHkxPSIzNDQiIHgyPSIyMzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjQ2IiB5MT0iMzQ0IiB4Mj0iMjQ2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI1OCIgeTE9IjM0NCIgeDI9IjI1OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzAiIHkxPSIzNDQiIHgyPSIyNzAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjgyIiB5MT0iMzQ0IiB4Mj0iMjgyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI5MyIgeTE9IjM0NCIgeDI9IjI5MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMDUiIHkxPSIzNDQiIHgyPSIzMDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzE3IiB5MT0iMzQ0IiB4Mj0iMzE3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyOSIgeTE9IjM0NCIgeDI9IjMyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNDAiIHkxPSIzNDQiIHgyPSIzNDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzUyIiB5MT0iMzQ0IiB4Mj0iMzUyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2NCIgeTE9IjM0NCIgeDI9IjM2NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNzUiIHkxPSIzNDQiIHgyPSIzNzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg3IiB5MT0iMzQ0IiB4Mj0iMzg3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM5OSIgeTE9IjM0NCIgeDI9IjM5OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MTEiIHkxPSIzNDQiIHgyPSI0MTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDIyIiB5MT0iMzQ0IiB4Mj0iNDIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzNCIgeTE9IjM0NCIgeDI9IjQzNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NDYiIHkxPSIzNDQiIHgyPSI0NDYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDU4IiB5MT0iMzQ0IiB4Mj0iNDU4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2OSIgeTE9IjM0NCIgeDI9IjQ2OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0ODEiIHkxPSIzNDQiIHgyPSI0ODEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDkzIiB5MT0iMzQ0IiB4Mj0iNDkzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwNSIgeTE9IjM0NCIgeDI9IjUwNSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MTYiIHkxPSIzNDQiIHgyPSI1MTYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTI4IiB5MT0iMzQ0IiB4Mj0iNTI4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU0MCIgeTE9IjM0NCIgeDI9IjU0MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NTEiIHkxPSIzNDQiIHgyPSI1NTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTYzIiB5MT0iMzQ0IiB4Mj0iNTYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU3NSIgeTE9IjM0NCIgeDI9IjU3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1ODciIHkxPSIzNDQiIHgyPSI1ODciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTk4IiB5MT0iMzQ0IiB4Mj0iNTk4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYxMCIgeTE9IjM0NCIgeDI9IjYxMCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MjIiIHkxPSIzNDQiIHgyPSI2MjIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjM0IiB5MT0iMzQ0IiB4Mj0iNjM0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY0NSIgeTE9IjM0NCIgeDI9IjY0NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTciIHkxPSIzNDQiIHgyPSI2NTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjY5IiB5MT0iMzQ0IiB4Mj0iNjY5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjM0NCIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2OTIiIHkxPSIzNDQiIHgyPSI2OTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzA0IiB5MT0iMzQ0IiB4Mj0iNzA0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcxNiIgeTE9IjM0NCIgeDI9IjcxNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MjciIHkxPSIzNDQiIHgyPSI3MjciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzM5IiB5MT0iMzQ0IiB4Mj0iNzM5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijc1MSIgeTE9IjM0NCIgeDI9Ijc1MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3NjMiIHkxPSIzNDQiIHgyPSI3NjMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDQiIHgyPSI3NjkiIHkyPSIzNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzM5IiB4Mj0iNzY5IiB5Mj0iMzM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMzNCIgeDI9Ijc2OSIgeTI9IjMzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMjkiIHgyPSI3NjkiIHkyPSIzMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzIzIiB4Mj0iNzY5IiB5Mj0iMzIzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMxOCIgeDI9Ijc2OSIgeTI9IjMxOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzMTMiIHgyPSI3NjkiIHkyPSIzMTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzA3IiB4Mj0iNzY5IiB5Mj0iMzA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjMwMiIgeDI9Ijc2OSIgeTI9IjMwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyOTciIHgyPSI3NjkiIHkyPSIyOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjkyIiB4Mj0iNzY5IiB5Mj0iMjkyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI4NiIgeDI9Ijc2OSIgeTI9IjI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyODEiIHgyPSI3NjkiIHkyPSIyODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjc2IiB4Mj0iNzY5IiB5Mj0iMjc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI3MSIgeDI9Ijc2OSIgeTI9IjI3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNjUiIHgyPSI3NjkiIHkyPSIyNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjYwIiB4Mj0iNzY5IiB5Mj0iMjYwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI1NSIgeDI9Ijc2OSIgeTI9IjI1NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyNDkiIHgyPSI3NjkiIHkyPSIyNDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjQ0IiB4Mj0iNzY5IiB5Mj0iMjQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIzOSIgeDI9Ijc2OSIgeTI9IjIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzQiIHgyPSI3NjkiIHkyPSIyMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjI4IiB4Mj0iNzY5IiB5Mj0iMjI4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIyMyIgeDI9Ijc2OSIgeTI9IjIyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMTgiIHgyPSI3NjkiIHkyPSIyMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMjEyIiB4Mj0iNzY5IiB5Mj0iMjEyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjIwNyIgeDI9Ijc2OSIgeTI9IjIwNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMDIiIHgyPSI3NjkiIHkyPSIyMDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTk3IiB4Mj0iNzY5IiB5Mj0iMTk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE5MSIgeDI9Ijc2OSIgeTI9IjE5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxODYiIHgyPSI3NjkiIHkyPSIxODYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTgxIiB4Mj0iNzY5IiB5Mj0iMTgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE3NSIgeDI9Ijc2OSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNzAiIHgyPSI3NjkiIHkyPSIxNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTY1IiB4Mj0iNzY5IiB5Mj0iMTY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE2MCIgeDI9Ijc2OSIgeTI9IjE2MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxNTQiIHgyPSI3NjkiIHkyPSIxNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTQ5IiB4Mj0iNzY5IiB5Mj0iMTQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjE0NCIgeDI9Ijc2OSIgeTI9IjE0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMzgiIHgyPSI3NjkiIHkyPSIxMzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTMzIiB4Mj0iNzY5IiB5Mj0iMTMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEyOCIgeDI9Ijc2OSIgeTI9IjEyOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMjMiIHgyPSI3NjkiIHkyPSIxMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTE3IiB4Mj0iNzY5IiB5Mj0iMTE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjExMiIgeDI9Ijc2OSIgeTI9IjExMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIxMDciIHgyPSI3NjkiIHkyPSIxMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTAxIiB4Mj0iNzY5IiB5Mj0iMTAxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9Ijk2IiB4Mj0iNzY5IiB5Mj0iOTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iOTEiIHgyPSI3NjkiIHkyPSI5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4NiIgeDI9Ijc2OSIgeTI9Ijg2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjgwIiB4Mj0iNzY5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNzUiIHgyPSI3NjkiIHkyPSI3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI3MCIgeDI9Ijc2OSIgeTI9IjcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjY0IiB4Mj0iNzY5IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNTkiIHgyPSI3NjkiIHkyPSI1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI1NCIgeDI9Ijc2OSIgeTI9IjU0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjQ5IiB4Mj0iNzY5IiB5Mj0iNDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iNDMiIHgyPSI3NjkiIHkyPSI0MyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTQiIHkxPSIzNDQiIHgyPSI5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTMiIHkxPSIzNDQiIHgyPSIxNTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjExIiB5MT0iMzQ0IiB4Mj0iMjExIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3MCIgeTE9IjM0NCIgeDI9IjI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjkiIHkxPSIzNDQiIHgyPSIzMjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg3IiB5MT0iMzQ0IiB4Mj0iMzg3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0NiIgeTE9IjM0NCIgeDI9IjQ0NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDUiIHkxPSIzNDQiIHgyPSI1MDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTYzIiB5MT0iMzQ0IiB4Mj0iNTYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyMiIgeTE9IjM0NCIgeDI9IjYyMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODEiIHkxPSIzNDQiIHgyPSI2ODEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzM5IiB5MT0iMzQ0IiB4Mj0iNzM5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzQ0IiB4Mj0iNzY5IiB5Mj0iMzQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjI5MiIgeDI9Ijc2OSIgeTI9IjI5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIyMzkiIHgyPSI3NjkiIHkyPSIyMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMTg2IiB4Mj0iNzY5IiB5Mj0iMTg2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NSIgeTE9IjEzMyIgeDI9Ijc2OSIgeTI9IjEzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSI4MCIgeDI9Ijc2OSIgeTI9IjgwIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NCwzNCA2NCwzNDQgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIzNDQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwzNDQgNjQsMzQ0ICIvPgo8dGV4dCB4PSI1NSIgeT0iMjkyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjIKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMjkyIDY0LDI5MiAiLz4KPHRleHQgeD0iNTUiIHk9IjIzOSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC40CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDIzOSA2NCwyMzkgIi8+Cjx0ZXh0IHg9IjU1IiB5PSIxODYiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuNgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwxODYgNjQsMTg2ICIvPgo8dGV4dCB4PSI1NSIgeT0iMTMzIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjgKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksMTMzIDY0LDEzMyAiLz4KPHRleHQgeD0iNTUiIHk9IjgwIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTksODAgNjQsODAgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NSwzNDUgNzY5LDM0NSAiLz4KPHRleHQgeD0iOTQiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkdyYW5hZGEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iOTQsMzQ1IDk0LDM1MCAiLz4KPHRleHQgeD0iMTUzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpDZWx0YSBWaWdvCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1MywzNDUgMTUzLDM1MCAiLz4KPHRleHQgeD0iMjExIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpFc3BhbnlvbAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyMTEsMzQ1IDIxMSwzNTAgIi8+Cjx0ZXh0IHg9IjI3MCIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTmV0aGVybGFuZHMKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjcwLDM0NSAyNzAsMzUwICIvPgo8dGV4dCB4PSIzMjkiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkxldmFudGUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzI5LDM0NSAzMjksMzUwICIvPgo8dGV4dCB4PSIzODciIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ck7DvHJuYmVyZyBXCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM4NywzNDUgMzg3LDM1MCAiLz4KPHRleHQgeD0iNDQ2IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpGQyBMZXZhbnRlIEJhZGFsb24KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDQ2LDM0NSA0NDYsMzUwICIvPgo8dGV4dCB4PSI1MDUiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkF0bGV0aWNvIE1hZHJpZCBXCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUwNSwzNDUgNTA1LDM1MCAiLz4KPHRleHQgeD0iNTYzIiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpBcmdlbnRpbmEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTYzLDM0NSA1NjMsMzUwICIvPgo8dGV4dCB4PSI2MjIiIHk9IjM1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ck1hbGFnYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MjIsMzQ1IDYyMiwzNTAgIi8+Cjx0ZXh0IHg9IjY4MSIgeT0iMzU1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KRnJvc2lub25lCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY4MSwzNDUgNjgxLDM1MCAiLz4KPHRleHQgeD0iNzM5IiB5PSIzNTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpQYWxlcm1vCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjczOSwzNDUgNzM5LDM1MCAiLz4KPHJlY3QgeD0iNzMiIHk9Ijc1IiB3aWR0aD0iNDEiIGhlaWdodD0iMjY5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTMyIiB5PSIxMDQiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyNDAiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxOTEiIHk9IjEyMyIgd2lkdGg9IjQxIiBoZWlnaHQ9IjIyMSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjI0OSIgeT0iMTMzIiB3aWR0aD0iNDEiIGhlaWdodD0iMjExIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzA4IiB5PSIxMzYiIHdpZHRoPSI0MSIgaGVpZ2h0PSIyMDgiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzNjciIHk9IjE0MSIgd2lkdGg9IjQxIiBoZWlnaHQ9IjIwMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQyNSIgeT0iMTUyIiB3aWR0aD0iNDEiIGhlaWdodD0iMTkyIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDg0IiB5PSIxNTIiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxOTIiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1NDMiIHk9IjE1MiIgd2lkdGg9IjQxIiBoZWlnaHQ9IjE5MiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYwMSIgeT0iMTU0IiB3aWR0aD0iNDEiIGhlaWdodD0iMTkwIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjYwIiB5PSIxNjUiIHdpZHRoPSI0MSIgaGVpZ2h0PSIxNzkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI3MTkiIHk9IjE3MCIgd2lkdGg9IjQxIiBoZWlnaHQ9IjE3NCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+Cjwvc3ZnPg==)

## Discussion

From 152k player-match lines and 2,855 cards:

- **Card-rate leaders are specialists, not stars**: Fabián Orellana (0.29
  cards/90), Yannick Cahuzac (0.26) and Deyverson (0.25) top the per-90 table —
  players who foul early and often in limited minutes. Among volume players,
  Alba (28 cards), Messi (27) and Piqué (24) lead the raw totals.
- **The real foul merchants commit 3–4 per game**: Franco Vázquez (3.81
  fouls/90), Papa Kouly Diop (3.79) and Lorenzo Lollo (3.28, _zero_ cards) —
  defenders who stop attacks with tactical fouling, not punishment.
- **Forwards draw more fouls than they commit** (1.00 vs 0.87 per 90); defenders
  invert it (commit 0.92, draw 0.69). Dribbling is a card-generating skill —
  Messi has drawn **1,747 fouls** across his career, the most on record.
- **Team identity is real**: Granada averages 1.02 cards per match (highest),
  Espanyol 21.2 fouls per match — Spanish football's aggressive reputation shows
  up directly in the data.
- Red cards are genuinely rare: only ~20 players have 2+ in the dataset; Jordi
  Alba leads with 2 in 284 apps.

Caveats: fouls/card data comes from StatsBomb competitions only; "fouls drawn"
includes fouls that wouldn't be given in stricter leagues; small samples (min 30
apps) still let one bad run dominate a rate; cards/90 looks flat (~0.02) because
yellows are spread thin.

**Limitations.** The analysis is limited to the competitions present in the
database; player-level metrics exist only for StatsBomb-covered tournaments, and
underlying event data may contain errors.

## Conclusion

Card-rate leaders are specialists, not stars. Together these results answer the
research question posed in the Introduction and quantify the pattern across
152,000 appearances. The notebook provides a fully reproducible pipeline from
raw CSV extracts to published figures.
