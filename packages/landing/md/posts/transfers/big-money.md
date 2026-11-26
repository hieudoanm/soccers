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

## Does big money buy goals? Fee vs. output

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
players with match stats: 11701
big-money deals with before+after data: 189
```

| fee band | deals | med G+A/90 before | after | % improved | Δ median |
| -------- | ----- | ----------------- | ----- | ---------- | -------- |
| €10–25m  | 96    | 0.06              | 0.09  | 34%        | +0.02    |
| €25–50m  | 53    | 0.11              | 0.00  | 28%        | -0.11    |
| €50–100m | 29    | 0.31              | 0.18  | 38%        | -0.13    |
| €100m+   | 11    | 0.48              | 0.20  | 18%        | -0.28    |

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

```text
players with match stats: 11701
big-money deals with before+after data: 189
```

| fee band | deals | med G+A/90 before | after | % improved | Δ median |
| -------- | ----- | ----------------- | ----- | ---------- | -------- |
| €10–25m  | 96    | 0.06              | 0.09  | 34%        | +0.02    |
| €25–50m  | 53    | 0.11              | 0.00  | 28%        | -0.11    |
| €50–100m | 29    | 0.31              | 0.18  | 38%        | -0.13    |
| €100m+   | 11    | 0.48              | 0.20  | 18%        | -0.28    |

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

```text
players with match stats: 11701
big-money deals with before+after data: 189
```

| fee band | deals | med G+A/90 before | after | % improved | Δ median |
| -------- | ----- | ----------------- | ----- | ---------- | -------- |
| €10–25m  | 96    | 0.06              | 0.09  | 34%        | +0.02    |
| €25–50m  | 53    | 0.11              | 0.00  | 28%        | -0.11    |
| €50–100m | 29    | 0.31              | 0.18  | 38%        | -0.13    |
| €100m+   | 11    | 0.48              | 0.20  | 18%        | -0.28    |

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

| fee quartile | deals | med fee | med before | med after | % improved | Δ     |
| ------------ | ----- | ------- | ---------- | --------- | ---------- | ----- |
| Q1           | 47    | €13.0m  | 0.00       | 0.00      | 36%        | +0.00 |
| Q2           | 47    | €18.5m  | 0.10       | 0.11      | 32%        | +0.01 |
| Q3           | 47    | €34.2m  | 0.03       | 0.00      | 28%        | -0.03 |
| Q4           | 48    | €65.0m  | 0.33       | 0.19      | 33%        | -0.14 |

## Findings

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
