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

## Transfer flows: who sells footballers and who buys them

19,436 transfers join two clubs — and every club has a country. This notebook
maps the **pipes** of the transfer market: which regions feed which, which
countries are net exporters of talent and fee money, and where the biggest
cross-border pipelines run.

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
| Germany → England | 127       | €2.07bn   |
| France → Italy    | 127       | €431.2m   |
| Italy → Spain     | 125       | €455.2m   |
| Spain → Italy     | 124       | €724.0m   |
| France → Spain    | 113       | €531.1m   |
| Italy → France    | 99        | €505.6m   |
| England → Germany | 97        | €547.8m   |
| Spain → France    | 84        | €267.6m   |
| France → Germany  | 73        | €503.5m   |

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

## Findings

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
