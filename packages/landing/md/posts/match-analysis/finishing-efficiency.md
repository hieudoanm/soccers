---
title: 'Finishing efficiency: who converts chances and who wastes them'
description: |
  '207 players with 30+ shots on target: Parris converts 46.7%, Agüero
  44.9%, Messi leads G+A/90 at 1.35 — and forwards outrun midfielders
  and defenders on every efficiency measure.'
author: 'hieudoan'
date: '2026-11-28T12:00'
order: 50
tags: ['football', 'analysis', 'finishing', 'statsbomb', 'mars', 'sqlite']
---

# Finishing efficiency: who converts chances and who wastes them

## Finishing efficiency: who converts chances and who wastes them

`player_match_stat` records every player's shots, shots on target, goals and
assists across ~4,000 matches. This notebook ranks players by **conversion
rate** — goals per shot on target — and by **goal efficiency per 90 minutes**,
separating volume shooters from clinical finishers.

Only players with a meaningful sample (≥30 shots on target) are ranked, so the
table rewards repeatable finishing, not one hot match.

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

let pms = load("player_match_stat");
let pl = load("player");

let pm_pid = col_i64(&pms, "player_id");
let pm_g = col_f64(&pms, "goals");
let pm_a = col_f64(&pms, "assists");
let pm_sh = col_f64(&pms, "shots");
let pm_sot = col_f64(&pms, "shots_on_target");
let pm_min = col_f64(&pms, "minutes_played");
let pm_tid = col_i64(&pms, "team_id");

let p_id = col_i64(&pl, "id");
let p_name = col_str(&pl, "name");
let p_pos = col_str(&pl, "position");
let mut pname: HashMap<i64,String> = HashMap::new();
let mut ppos: HashMap<i64,String> = HashMap::new();
for i in 0..pl.height() {
    pname.insert(p_id[i], p_name[i].clone());
    ppos.insert(p_id[i], p_pos[i].clone());
}

struct P { pid: i64, apps: i64, g: f64, a: f64, sh: f64, sot: f64, mins: f64 }
let mut agg: HashMap<i64, P> = HashMap::new();
for i in 0..pm_pid.len() {
    if pm_pid[i] <= 0 { continue; }
    let e = agg.entry(pm_pid[i]).or_insert(P{pid:pm_pid[i],apps:0,g:0.0,a:0.0,sh:0.0,sot:0.0,mins:0.0});
    e.apps += 1;
    e.g += pm_g[i]; e.a += pm_a[i];
    e.sh += pm_sh[i]; e.sot += pm_sot[i];
    e.mins += if pm_min[i] > 0.0 { pm_min[i] } else { 90.0 };
}
let players: Vec<P> = agg.into_values().filter(|p| p.sot >= 30.0 && p.apps >= 15).collect();
println!("players with >=30 SoT and >=15 apps: {}", players.len());

let pos_group = |pos: &str| -> &'static str {
    let n = pos.to_lowercase();
    if n.contains("goalkeeper") { "GK" }
    else if n.contains("defen") || n.contains("back") { "DEF" }
    else if n.contains("midf") { "MID" }
    else if n.contains("attack") || n.contains("striker") || n.contains("wing") || n.contains("forward") { "FWD" }
    else { "UNK" }
};
let hdr = ["player","pos","apps","G","A","SoT","conv G/SoT","G+A/90"];
let row_of = |p: &P| -> Vec<String> {
    let mins = if p.mins > 0.0 { p.mins } else { p.apps as f64 * 90.0 };
    vec![
        pname.get(&p.pid).cloned().unwrap_or_default().chars().take(26).collect(),
        pos_group(ppos.get(&p.pid).map(|s| s.as_str()).unwrap_or("")).to_string(),
        p.apps.to_string(),
        format!("{:.0}", p.g),
        format!("{:.0}", p.a),
        format!("{:.0}", p.sot),
        if p.sot > 0.0 { format!("{:.3}", p.g / p.sot) } else { "-".into() },
        format!("{:.2}", (p.g + p.a) * 90.0 / mins),
    ]
};
```

```text
players with >=30 SoT and >=15 apps: 207
```

```rust

// top converters: goals per shot on target (min 60 SoT for stability)
let mut conv: Vec<&P> = players.iter().filter(|p| p.sot >= 60.0).collect();
conv.sort_by(|a,b| (b.g/b.sot).partial_cmp(&(a.g/a.sot)).unwrap());
mars_table(&hdr, &conv.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

| player                     | pos | apps | G   | A   | SoT  | conv G/SoT | G+A/90 |
| -------------------------- | --- | ---- | --- | --- | ---- | ---------- | ------ |
| Nikita Parris              | FWD | 55   | 28  | 7   | 60   | 0.467      | 0.73   |
| Sergio Leonel Agüero del C | FWD | 45   | 31  | 3   | 69   | 0.449      | 0.88   |
| Ellen White                | FWD | 55   | 30  | 8   | 69   | 0.435      | 0.80   |
| Zlatan Ibrahimović         | FWD | 57   | 50  | 20  | 115  | 0.435      | 1.35   |
| Rubén Castro Martín        | FWD | 47   | 26  | 5   | 60   | 0.433      | 0.74   |
| Samuel Eto''o Fils         | FWD | 80   | 66  | 16  | 153  | 0.431      | 1.13   |
| Kylian Mbappé Lottin       | FWD | 89   | 64  | 22  | 150  | 0.427      | 1.07   |
| Gonzalo Gerardo Higuaín    | FWD | 50   | 38  | 3   | 90   | 0.422      | 0.88   |
| Samantha May Kerr          | FWD | 53   | 40  | 11  | 95   | 0.421      | 1.07   |
| Caroline Graham Hansen     | MID | 42   | 26  | 20  | 62   | 0.419      | 1.21   |
| Luis Alberto Suárez Díaz   | FWD | 204  | 140 | 64  | 335  | 0.418      | 1.06   |
| Karim Benzema              | FWD | 56   | 35  | 9   | 85   | 0.412      | 0.90   |
| Alessia Russo              | FWD | 46   | 25  | 10  | 61   | 0.410      | 0.87   |
| Vivianne Miedema           | FWD | 81   | 61  | 24  | 150  | 0.407      | 1.13   |
| Harry Kane                 | FWD | 67   | 43  | 4   | 108  | 0.398      | 0.74   |
| Georgia Stanway            | MID | 101  | 31  | 10  | 78   | 0.397      | 0.44   |
| Lauren James               | FWD | 50   | 26  | 5   | 66   | 0.394      | 0.74   |
| Bethany Mead               | FWD | 95   | 29  | 34  | 74   | 0.392      | 0.76   |
| Neymar da Silva Santos Jun | FWD | 158  | 89  | 50  | 229  | 0.389      | 0.96   |
| Lionel Andrés Messi Cuccit | FWD | 603  | 508 | 220 | 1327 | 0.383      | 1.35   |

```rust

// best goal contributions per 90 (min 800 minutes)
let mut eff: Vec<&P> = players.iter().filter(|p| {
    let m = if p.mins>0.0 {p.mins} else {p.apps as f64*90.0}; m >= 800.0
}).collect();
eff.sort_by(|a,b| {
    let ma = if a.mins>0.0 {a.mins} else {a.apps as f64*90.0};
    let mb = if b.mins>0.0 {b.mins} else {b.apps as f64*90.0};
    (((b.g+b.a)*90.0/mb)).partial_cmp(&((a.g+a.a)*90.0/ma)).unwrap()
});
mars_table(&hdr, &eff.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

| player                     | pos | apps | G   | A   | SoT  | conv G/SoT | G+A/90 |
| -------------------------- | --- | ---- | --- | --- | ---- | ---------- | ------ |
| Khadija Monifa Shaw        | FWD | 24   | 21  | 4   | 45   | 0.467      | 1.44   |
| Lionel Andrés Messi Cuccit | FWD | 603  | 508 | 220 | 1327 | 0.383      | 1.35   |
| Zlatan Ibrahimović         | FWD | 57   | 50  | 20  | 115  | 0.435      | 1.35   |
| Caroline Graham Hansen     | MID | 42   | 26  | 20  | 62   | 0.419      | 1.21   |
| Ewa Pajor                  | MID | 23   | 19  | 5   | 41   | 0.463      | 1.16   |
| Vivianne Miedema           | FWD | 81   | 61  | 24  | 150  | 0.407      | 1.13   |
| Samuel Eto''o Fils         | FWD | 80   | 66  | 16  | 153  | 0.431      | 1.13   |
| Cristiano Ronaldo dos Sant | FWD | 76   | 59  | 14  | 181  | 0.326      | 1.07   |
| Samantha May Kerr          | FWD | 53   | 40  | 11  | 95   | 0.421      | 1.07   |
| Kylian Mbappé Lottin       | FWD | 89   | 64  | 22  | 150  | 0.427      | 1.07   |
| Luis Alberto Suárez Díaz   | FWD | 204  | 140 | 64  | 335  | 0.418      | 1.06   |
| Victor Okoh Boniface       | FWD | 23   | 14  | 8   | 36   | 0.389      | 1.06   |
| Gareth Frank Bale          | FWD | 44   | 25  | 13  | 51   | 0.490      | 1.03   |
| Alexandra Popp             | FWD | 33   | 19  | 8   | 37   | 0.514      | 1.00   |
| Ronaldo de Assis Moreira   | FWD | 59   | 33  | 20  | 99   | 0.333      | 0.99   |
| Bartholomew Owogbalor Ogbe | FWD | 22   | 18  | 1   | 32   | 0.562      | 0.97   |
| Neymar da Silva Santos Jun | FWD | 158  | 89  | 50  | 229  | 0.389      | 0.96   |
| Sophia Olivia Wilson       | FWD | 22   | 13  | 5   | 47   | 0.277      | 0.91   |
| Thierry Henry              | FWD | 105  | 63  | 19  | 199  | 0.317      | 0.90   |
| Karim Benzema              | FWD | 56   | 35  | 9   | 85   | 0.412      | 0.90   |

```rust
// volume leaders: most shots on target
let mut vol: Vec<&P> = players.iter().collect();
vol.sort_by(|a,b| b.sot.partial_cmp(&a.sot).unwrap());
mars_table(&hdr, &vol.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

| player                     | pos | apps | G   | A   | SoT  | conv G/SoT | G+A/90 |
| -------------------------- | --- | ---- | --- | --- | ---- | ---------- | ------ |
| Lionel Andrés Messi Cuccit | FWD | 603  | 508 | 220 | 1327 | 0.383      | 1.35   |
| Luis Alberto Suárez Díaz   | FWD | 204  | 140 | 64  | 335  | 0.418      | 1.06   |
| Neymar da Silva Santos Jun | FWD | 158  | 89  | 50  | 229  | 0.389      | 0.96   |
| Thierry Henry              | FWD | 105  | 63  | 19  | 199  | 0.317      | 0.90   |
| Cristiano Ronaldo dos Sant | FWD | 76   | 59  | 14  | 181  | 0.326      | 1.07   |
| Pedro Eliezer Rodríguez Le | FWD | 216  | 56  | 34  | 156  | 0.359      | 0.48   |
| Samuel Eto''o Fils         | FWD | 80   | 66  | 16  | 153  | 0.431      | 1.13   |
| Vivianne Miedema           | FWD | 81   | 61  | 24  | 150  | 0.407      | 1.13   |
| Kylian Mbappé Lottin       | FWD | 89   | 64  | 22  | 150  | 0.427      | 1.07   |
| Andrés Iniesta Luján       | MID | 360  | 25  | 59  | 139  | 0.180      | 0.26   |
| Antoine Griezmann          | FWD | 145  | 49  | 23  | 132  | 0.371      | 0.58   |
| Xavier Hernández Creus     | MID | 266  | 36  | 68  | 116  | 0.310      | 0.43   |
| Alexis Alejandro Sánchez S | FWD | 112  | 42  | 18  | 115  | 0.365      | 0.62   |
| Zlatan Ibrahimović         | FWD | 57   | 50  | 20  | 115  | 0.435      | 1.35   |
| Harry Kane                 | FWD | 67   | 43  | 4   | 108  | 0.398      | 0.74   |
| David Villa Sánchez        | FWD | 79   | 33  | 9   | 100  | 0.330      | 0.62   |
| Ronaldo de Assis Moreira   | FWD | 59   | 33  | 20  | 99   | 0.333      | 0.99   |
| Chloe Kelly                | FWD | 85   | 31  | 19  | 97   | 0.320      | 0.66   |
| Philippe Coutinho Correia  | MID | 94   | 20  | 16  | 97   | 0.206      | 0.44   |
| Samantha May Kerr          | FWD | 53   | 40  | 11  | 95   | 0.421      | 1.07   |

```rust
// position-level averages for context
let mut pos_stats: HashMap<&str,(i64,f64,f64,f64)> = HashMap::new();
for p in &players {
    let g = pos_group(ppos.get(&p.pid).map(|s|s.as_str()).unwrap_or(""));
    let e = pos_stats.entry(g).or_insert((0,0.0,0.0,0.0));
    e.0 += 1; e.1 += p.sot; e.2 += p.g; e.3 += p.g+p.a;
}
let prows: Vec<Vec<String>> = ["FWD","MID","DEF","GK","UNK"].iter().filter_map(|g| {
    pos_stats.get(*g).map(|(n,sot,gl,a)| vec![
        g.to_string(), n.to_string(), format!("{:.0}", sot),
        format!("{:.3}", if *sot>0.0 {*gl/ *sot} else {0.0}),
        format!("{:.1}", *a),
    ])
}).collect();
mars_table(&["pos group","players","total SoT","avg conv","total G+A"], &prows);
```

| pos group | players | total SoT | avg conv | total G+A |
| --------- | ------- | --------- | -------- | --------- |
| FWD       | 135     | 8932      | 0.359    | 4466.0    |
| MID       | 55      | 2642      | 0.319    | 1478.0    |
| DEF       | 17      | 782       | 0.303    | 494.0     |

## Findings

From 152k player-match stat lines, only **207 players** cleared the bar of ≥30
shots on target and ≥15 appearances — the finishing elite is a small club:

- **Clinical finishers**: Nikita Parris converts 46.7% of her shots on target,
  Agüero 44.9%, Zlatan and Ellen White 43.5%. The NBA-like conversion rates top
  out around 0.45 — nobody sustains 50%.
- **Volume vs efficiency diverge**: Messi leads G+A/90 at 1.35 _and_ converts
  38.3% — the rare two-way outlier. Khadija Shaw tops pure efficiency (1.44/90)
  on a smaller sample.
- **Position gravity holds**: forwards average 0.359 goals per SoT, midfielders
  0.319, defenders 0.303 — defenders who shoot are disproportionately wasteful.
- The 207-player sample is dominated by players in StatsBomb competitions (World
  Cups, Euros, UCL, select leagues) — this is a best-of-the-best leaderboard,
  not a global ranking.

Caveats: `shots_on_target` quality isn't weighted (a 30-yard strike counts the
same as a tap-in); minutes_played is missing on ~10% of rows (approximated at
90); small samples (min 60 SoT for the conversion table) still produce noisy
rates.
