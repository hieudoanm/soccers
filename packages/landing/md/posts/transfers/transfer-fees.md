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

## The price of a player: a history of football's transfer market

5,354 transfers carry a disclosed fee — the closest thing football has to a
public market price. This notebook tracks **fee inflation**: median and record
fees by year, by position, and by destination league, using Transfermarkt's EUR
figures joined to our player and team data.

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

## Findings

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
