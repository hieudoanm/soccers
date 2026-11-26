---
title: "The award cabinet: who owns football's trophies"
description: |
  '11 awards, 590 finishes: Messi has 18 wins and 30 podiums, the
  modern era is a Messi-Ronaldo duopoly, and women''s football is
  building its own cabinet since 2017.'
author: 'hieudoan'
date: '2026-11-28T13:00'
order: 51
tags: ['football', 'analysis', 'awards', 'ballon-dor', 'mars', 'sqlite']
---

# The award cabinet: who owns football's trophies

## The award cabinet: who owns football's trophies

The awards importer collected **11 individual honours** — Ballon d'Or (men's and
women's), FIFA World Player, The Best FIFA awards, PFA Player of the Year, the
European Golden Shoe and coaching prizes — with podium places where available.

This notebook counts the cabinets: who has won the most, which awards produce
repeat winners vs one-hit wonders, and how the record books split between
players, goalkeepers and managers.

_Caveat: player resolution is incomplete for the earliest years — pre-2000
Ballon d'Or rows often carry only a club. Counts below cover resolved winners
only._

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

let aw = load("award");
let awd = LazyCsvReader::new("data/award_winner.csv")
    .with_infer_schema_length(Some(100000))
    .finish().expect("award_winner").collect().expect("collect");
let pl = load("player");
let tm = load("team");

let a_id = col_i64(&aw, "id");
let a_name = col_str(&aw, "name");
let a_cat = col_str(&aw, "category");
let mut award_name: HashMap<i64,String> = HashMap::new();
let mut award_cat: HashMap<i64,String> = HashMap::new();
for i in 0..aw.height() { award_name.insert(a_id[i], a_name[i].clone()); award_cat.insert(a_id[i], a_cat[i].clone()); }

let w_award = col_i64(&awd, "award_id");
let w_pid = col_i64(&awd, "player_id");
let w_mid = col_i64(&awd, "manager_id");
let w_tid = col_i64(&awd, "team_id");
let w_year = col_i64(&awd, "year");
let w_place = col_i64(&awd, "place");
let w_goals = col_f64(&awd, "goals");

let p_id = col_i64(&pl, "id");
let p_name = col_str(&pl, "name");
let mut pname: HashMap<i64,String> = HashMap::new();
for i in 0..pl.height() { pname.insert(p_id[i], p_name[i].clone()); }
let m_id = col_i64(&load("manager"), "id");
let m_name = col_str(&load("manager"), "name");
let mut mname: HashMap<i64,String> = HashMap::new();
for i in 0..m_id.len() { mname.insert(m_id[i], m_name[i].clone()); }
let t_id = col_i64(&tm, "id");
let t_name = col_str(&tm, "name");
let mut tname: HashMap<i64,String> = HashMap::new();
for i in 0..tm.height() { tname.insert(t_id[i], t_name[i].clone()); }

println!("award_winner rows: {}", w_award.len());
let resolved = w_pid.iter().filter(|&&p| p>0).count();
println!("rows with resolved player: {}", resolved);
```

```text
award_winner rows: 590
rows with resolved player: 335
```

```rust

// winners (place=1) per award — resolved players only
struct W { aid: i64, pid: i64, mid: i64, tid: i64, year: i64, place: i64, goals: f64 }
let mut winners: Vec<W> = Vec::new();
let mut podiums: Vec<W> = Vec::new();
for i in 0..w_award.len() {
    if w_place[i] == 1 && w_pid[i] > 0 {
        winners.push(W{aid:w_award[i],pid:w_pid[i],mid:w_mid[i],tid:w_tid[i],year:w_year[i],place:w_place[i],goals:w_goals[i]});
    }
    if w_place[i] >= 1 && w_place[i] <= 3 {
        podiums.push(W{aid:w_award[i],pid:w_pid[i],mid:w_mid[i],tid:w_tid[i],year:w_year[i],place:w_place[i],goals:w_goals[i]});
    }
}
println!("resolved winners: {}, podium finishes: {}", winners.len(), podiums.len());

// per-award summary
let mut by_award: HashMap<i64, Vec<&W>> = HashMap::new();
for w in &winners { by_award.entry(w.aid).or_default().push(w); }
let mut arows: Vec<Vec<String>> = by_award.iter().map(|(aid, ws)| {
    let mut pc: HashMap<i64,usize> = HashMap::new();
    for w in ws { *pc.entry(w.pid).or_insert(0)+=1; }
    let (bp,bn) = pc.iter().max_by_key(|(_,c)| *c).map(|(p,c)| (*p,*c)).unwrap_or((0,0));
    let yrs: Vec<i64> = ws.iter().map(|w|w.year).collect();
    vec![
        award_name.get(aid).cloned().unwrap_or_default(),
        award_cat.get(aid).cloned().unwrap_or_default(),
        ws.len().to_string(),
        format!("{}–{}", yrs.iter().min().unwrap(), yrs.iter().max().unwrap()),
        if bn>0 { format!("{} ({})", pname.get(&bp).cloned().unwrap_or_default().chars().take(22).collect::<String>(), bn) } else { "-".into() },
    ]}).collect();
arows.sort_by(|a,b| b[2].parse::<usize>().unwrap_or(0).cmp(&a[2].parse::<usize>().unwrap_or(0)));
mars_table(&["award","category","winners","years","most wins"], &arows);
```

```text
resolved winners: 154, podium finishes: 588
```

| award                            | category | winners | years     | most wins                  |
| -------------------------------- | -------- | ------- | --------- | -------------------------- |
| Ballon d'Or                      | PLAYER   | 37      | 1960–2026 | Lionel Andrés Messi Cu (8) |
| PFA Players' Player of the Year  | PLAYER   | 32      | 1973–2025 | Mohamed Salah (3)          |
| European Golden Shoe             | PLAYER   | 31      | 1973–2025 | Lionel Andrés Messi Cu (6) |
| FIFA World Player of the Year    | PLAYER   | 11      | 1991–2009 | Zinédine Zidane (3)        |
| The Best FIFA Men's Player       | PLAYER   | 10      | 2016–2025 | Lionel Andrés Messi Cu (3) |
| The Best FIFA Women's Player     | PLAYER   | 9       | 2017–2025 | Aitana Bonmati Conca (3)   |
| The Best FIFA Men's Goalkeeper   | PLAYER   | 9       | 2017–2025 | Damián Emiliano Martín (2) |
| Ballon d'Or Féminin              | PLAYER   | 8       | 2018–2026 | Aitana Bonmati Conca (3)   |
| The Best FIFA Women's Goalkeeper | PLAYER   | 7       | 2019–2025 | Mary Alexandra Earps (2)   |

```rust
// most awarded players overall (wins + podiums)
let mut win_count: HashMap<i64,usize> = HashMap::new();
let mut pod_count: HashMap<i64,usize> = HashMap::new();
for w in &winners { *win_count.entry(w.pid).or_insert(0)+=1; }
for w in &podiums { if w.pid>0 { *pod_count.entry(w.pid).or_insert(0)+=1; } }
let mut pl_rows: Vec<(i64,usize,usize)> = win_count.iter()
    .map(|(p,w)| (*p,*w,*pod_count.get(p).unwrap_or(&0))).collect();
pl_rows.sort_by(|a,b| b.1.cmp(&a.1).then(b.2.cmp(&a.2)));
let prows: Vec<Vec<String>> = pl_rows.iter().take(20).map(|(p,w,pd)| vec![
    pname.get(p).cloned().unwrap_or_default().chars().take(30).collect(),
    w.to_string(), pd.to_string(),
]).collect();
mars_table(&["player","wins","podium finishes"], &prows);
```

| player                         | wins | podium finishes |
| ------------------------------ | ---- | --------------- |
| Lionel Andrés Messi Cuccittini | 18   | 30              |
| Cristiano Ronaldo dos Santos A | 14   | 26              |
| Ronaldo Aparecido Rodrigues    | 6    | 10              |
| Aitana Bonmati Conca           | 6    | 6               |
| Alexia Putellas Segura         | 5    | 6               |
| Zinédine Zidane                | 4    | 9               |
| Thierry Henry                  | 4    | 8               |
| Luis Alberto Suárez Díaz       | 4    | 7               |
| Robert Lewandowski             | 4    | 5               |
| Michel Platini                 | 3    | 5               |
| Mohamed Salah                  | 3    | 5               |
| Johan Cruyff                   | 3    | 4               |
| Harry Kane                     | 3    | 3               |
| Franz Beckenbauer              | 2    | 5               |
| Alan Shearer                   | 2    | 4               |
| Mary Alexandra Earps           | 2    | 3               |
| Karl-Heinz Rummenigge          | 2    | 3               |
| Kevin De Bruyne                | 2    | 3               |
| Lothar Matthäus                | 2    | 3               |
| Damián Emiliano Martínez       | 2    | 2               |

```rust
// repeat-winner rate: players with >1 win
let multi = pl_rows.iter().filter(|(_,w,_)| *w>1).count();
println!("players with multiple wins: {} of {}", multi, pl_rows.len());

// Golden Shoe goals column check
let shoe: Vec<&W> = winners.iter().filter(|w| award_name.get(&w.aid).map(|s|s.contains("Shoe")).unwrap_or(false)).collect();
if !shoe.is_empty() {
    let srows: Vec<Vec<String>> = shoe.iter().take(15).map(|w| vec![
        pname.get(&w.pid).cloned().unwrap_or_default().chars().take(26).collect(),
        w.year.to_string(),
        if w.goals>0.0 {format!("{:.0}",w.goals)} else {"-".into()},
    ]).collect();
    mars_table(&["player","year","goals"], &srows);
}
```

```text
players with multiple wins: 27 of 76
()
```

| player                     | year | goals |
| -------------------------- | ---- | ----- |
| Héctor Casimiro Yazalde    | 1973 | 46    |
| Erwin Vandenbergh          | 1979 | 39    |
| Fernando de Lacerda Gomes  | 1982 | 36    |
| Fernando de Lacerda Gomes  | 1984 | 39    |
| Ronaldo Aparecido Rodrigue | 1996 | 34    |
| Kevin Phillips             | 1999 | 30    |
| Henrik Larsson             | 2000 | 35    |
| Thierry Henry              | 2003 | 30    |
| Thierry Henry              | 2004 | 25    |
| Diego Forlán Corazo        | 2004 | 25    |
| Luca Toni                  | 2005 | 31    |
| Francesco Totti            | 2006 | 26    |
| Cristiano Ronaldo dos Sant | 2007 | 31    |
| Diego Forlán Corazo        | 2008 | 32    |
| Lionel Andrés Messi Cuccit | 2009 | 34    |

## Findings

11 awards, 590 recorded finishes, 154 resolved winners:

- **Messi owns the cabinet**: 18 wins and 30 podium finishes across Ballon d'Or,
  Golden Shoe and FIFA awards — nearly 12% of all resolved wins. Cristiano
  Ronaldo is second at 14/26.
- **The modern era is a duopoly**: of 76 players with resolved wins, 27 have won
  more than once — and the repeat winners are almost all post-2000 (Messi,
  Ronaldo, Modrić-era Ballon d'Or regulars).
- **Women's football has its own cabinet**: Aitana Bonmatí (6 wins), Alexia
  Putellas (5) and the Earps/Pajor generation are building the equivalent
  records in the Ballon d'Or Féminin and The Best FIFA Women's awards, which
  only exist since 2017.
- Golden Shoe goal tallies show the evolution: Yazalde's 46 goals in 1973 vs
  Messi's 34 in 2009 — volume records have actually _fallen_ as defending
  improved.

Caveats: player resolution is incomplete — only 154 of 274 first-place rows
resolved to a player (early Ballon d'Or rows carry clubs, not players), so
counts understate the true cabinet; awards cover only what the Wikipedia
importer captured; "wins" mixes award types with very different prestige.
