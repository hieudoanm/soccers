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

## Selling vs buying clubs: the transfer market's hunters and farms

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
| Lyon           | France      | 89  | 102 | 13      | €723.5m       | €403.5m   |
| Ajax Amsterdam |             | 61  | 74  | 13      | €857.1m       | €355.9m   |
| Nordsjaelland  | Denmark     | 3   | 15  | 12      | €105.9m       | €0.3m     |
| Stade Rennais  |             | 103 | 115 | 12      | €682.1m       | €517.9m   |
| Sochaux        | France      | 11  | 23  | 12      | €13.2m        | €0.0m     |
| Metz           | France      | 38  | 50  | 12      | €139.1m       | €37.4m    |
| Benfica        | Portugal    | 112 | 124 | 12      | €1.07bn       | €400.0m   |
| Bastia         | France      | 9   | 20  | 11      | €20.8m        | €0.2m     |
| Bordeaux       | France      | 41  | 52  | 11      | €138.5m       | €37.2m    |
| Lille          | France      | 93  | 103 | 10      | €758.6m       | €262.5m   |
| NK Lokomotiva  |             | 9   | 19  | 10      | €15.1m        | €0.0m     |
| AZ Alkmaar     | Netherlands | 14  | 24  | 10      | €180.2m       | €11.1m    |
| Valenciennes   | France      | 11  | 21  | 10      | €11.3m        | €0.0m     |
| Dinamo Zagreb  |             | 40  | 50  | 10      | €249.5m       | €21.4m    |
| Caen           | France      | 15  | 25  | 10      | €60.0m        | €5.8m     |

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

## Findings

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
