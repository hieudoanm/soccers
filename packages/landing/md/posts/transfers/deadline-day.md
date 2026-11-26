---
title: 'Deadline day: football's most expensive 24 hours'
description: |
  '19,436 transfers by date: 1 July is the real deadline — Jun 30/Jul 1
  contract stamps swamp everything. Aug 31 and Jan 31 spike 5-7x, the
  window share doubled since 2020, and deadline-day money is no bigger
  than any other day's.'
author: 'hieudoan'
date: '2026-11-27T09:00'
order: 45
tags: ['football', 'analysis', 'transfers', 'transfermarkt', 'mars', 'sqlite']
---

## Deadline day: football's most expensive 24 hours

Every summer and winter, European football compresses a month of dealing into
24–72 hours. The transfer window shuts at 23:59 and suddenly every unfinished
negotiation becomes a fait accompli — or collapses entirely.

This notebook measures the phenomenon directly: **when** do the 19,436 recorded
transfers actually happen, and does the deadline spike survive once you account
for free transfers and academy promotions?

```rust

use polars::prelude::*;
use std::collections::HashMap;

let tr = LazyCsvReader::new("data/transfer.csv")
    .finish().expect("transfer.csv")
    .collect().expect("collect transfers");

fn col_str(df: &DataFrame, name: &str) -> Vec<String> {
    df.column(name).unwrap().str().unwrap().iter()
        .map(|o| o.unwrap_or("").to_string()).collect()
}
fn col_f64(df: &DataFrame, name: &str) -> Vec<f64> {
    let c = df.column(name).unwrap();
    match c.dtype() {
        DataType::Float64 => c.f64().unwrap().iter().map(|o| o.unwrap_or(0.0)).collect(),
        DataType::Int64 => c.i64().unwrap().iter().map(|o| o.unwrap_or(0) as f64).collect(),
        _ => c.str().unwrap().iter().map(|o| o.unwrap_or("").parse().unwrap_or(0.0)).collect(),
    }
}

let t_date = col_str(&tr, "date");
let t_fee = col_f64(&tr, "fee");

// (year, month, day, fee) — fee is EUR, 0/empty means undisclosed or free
let mut rows: Vec<(i32, u32, u32, f64)> = Vec::new();
for i in 0..t_date.len() {
    let s = &t_date[i];
    if s.len() < 10 { continue; }
    let y: i32 = s[0..4].parse().unwrap_or(0);
    let m: u32 = s[5..7].parse().unwrap_or(0);
    let dd: u32 = s[8..10].parse().unwrap_or(0);
    let f: f64 = t_fee[i];
    if y > 0 && m > 0 && dd > 0 { rows.push((y, m, dd, f)); }
}
println!("transfers with parseable date: {}", rows.len());

// monthly totals
let mut by_month: HashMap<u32, usize> = HashMap::new();
for &(_, m, _, _) in &rows { *by_month.entry(m).or_default() += 1; }
let mut months: Vec<u32> = by_month.keys().cloned().collect();
months.sort();
let mrows: Vec<Vec<String>> = months.iter().map(|&m| {
    vec![format!("{}", m), by_month[&m].to_string()]
}).collect();
mars_table(&["month", "transfers"], &mrows);
```

```text
transfers with parseable date: 19436
```

| month | transfers |
| ----- | --------- |
| 1     | 3355      |
| 2     | 700       |
| 3     | 98        |
| 4     | 70        |
| 5     | 299       |
| 6     | 3376      |
| 7     | 6818      |
| 8     | 3033      |
| 9     | 974       |
| 10    | 236       |
| 11    | 119       |
| 12    | 358       |

```rust

// Daily profile around the two windows, aggregated across all years
let mut by_md: HashMap<(u32, u32), usize> = HashMap::new();
for &(y, m, dd, _) in &rows {
    if (m == 8 && dd >= 20) || (m == 9 && dd <= 10) ||
       (m == 1 && dd >= 20) || (m == 2 && dd <= 10) {
        *by_md.entry((m, dd)).or_default() += 1;
    }
}
let mut keys: Vec<(u32, u32)> = by_md.keys().cloned().collect();
keys.sort();
let drows: Vec<Vec<String>> = keys.iter().map(|&(m, dd)| {
    vec![format!("{:02}-{:02}", m, dd), by_md[&(m, dd)].to_string()]
}).collect();
mars_table(&["month-day", "transfers (all years)"], &drows);

// deadline-window share per year: Aug 30-Sep 2 and Jan 30-Feb 2
// window membership: (m==8 && dd>=30) || (m==9 && dd<=2) || (m==1 && dd>=30) || (m==2 && dd<=2)
let in_window = |m: u32, dd: u32| (m == 8 && dd >= 30) || (m == 9 && dd <= 2) || (m == 1 && dd >= 30) || (m == 2 && dd <= 2);
let mut by_year: HashMap<i32, (usize, usize)> = HashMap::new();
for &(y, m, dd, _) in &rows {
    let e = by_year.entry(y).or_default();
    e.0 += 1;
    if in_window(m, dd) { e.1 += 1; }
}
let mut years: Vec<i32> = by_year.keys().cloned().collect();
years.sort();
let yrows: Vec<Vec<String>> = years.iter().filter(|&&y| y >= 2005 && by_year[&y].0 >= 200).map(|&y| {
    let (tot, win) = by_year[&y];
    vec![y.to_string(), tot.to_string(), win.to_string(), format!("{:.1}%", 100.0 * win as f64 / tot as f64)]
}).collect();
mars_table(&["year", "transfers", "in deadline window", "share %"], &yrows);
```

```text
transfers with parseable date: 19436
```

| month | transfers |
| ----- | --------- |
| 1     | 3355      |
| 2     | 700       |
| 3     | 98        |
| 4     | 70        |
| 5     | 299       |
| 6     | 3376      |
| 7     | 6818      |
| 8     | 3033      |
| 9     | 974       |
| 10    | 236       |
| 11    | 119       |
| 12    | 358       |

| month-day | transfers (all years) |
| --------- | --------------------- |
| 01-20     | 58                    |
| 01-21     | 60                    |
| 01-22     | 59                    |
| 01-23     | 86                    |
| 01-24     | 81                    |
| 01-25     | 84                    |
| 01-26     | 97                    |
| 01-27     | 88                    |
| 01-28     | 96                    |
| 01-29     | 138                   |
| 01-30     | 203                   |
| 01-31     | 449                   |
| 02-01     | 240                   |
| 02-02     | 103                   |
| 02-03     | 60                    |
| 02-04     | 15                    |
| 02-05     | 17                    |
| 02-06     | 26                    |
| 02-07     | 16                    |
| 02-08     | 18                    |
| 02-09     | 23                    |
| 02-10     | 16                    |
| 08-20     | 64                    |
| 08-21     | 67                    |
| 08-22     | 57                    |
| 08-23     | 75                    |
| 08-24     | 53                    |
| 08-25     | 69                    |
| 08-26     | 91                    |
| 08-27     | 75                    |
| 08-28     | 91                    |
| 08-29     | 113                   |
| 08-30     | 225                   |
| 08-31     | 463                   |
| 09-01     | 370                   |
| 09-02     | 136                   |
| 09-03     | 23                    |
| 09-04     | 39                    |
| 09-05     | 21                    |
| 09-06     | 30                    |
| 09-07     | 21                    |
| 09-08     | 36                    |
| 09-09     | 22                    |
| 09-10     | 21                    |

| year | transfers | in deadline window | share % |
| ---- | --------- | ------------------ | ------- |
| 2010 | 285       | 15                 | 5.3%    |
| 2011 | 377       | 27                 | 7.2%    |
| 2012 | 473       | 37                 | 7.8%    |
| 2013 | 603       | 62                 | 10.3%   |
| 2014 | 762       | 71                 | 9.3%    |
| 2015 | 990       | 88                 | 8.9%    |
| 2016 | 1106      | 110                | 9.9%    |
| 2017 | 1274      | 120                | 9.4%    |
| 2018 | 1368      | 111                | 8.1%    |
| 2019 | 1537      | 162                | 10.5%   |
| 2020 | 1474      | 227                | 15.4%   |
| 2021 | 1431      | 208                | 14.5%   |
| 2022 | 1684      | 203                | 12.1%   |
| 2023 | 1713      | 228                | 13.3%   |
| 2024 | 1543      | 219                | 14.2%   |
| 2025 | 1504      | 179                | 11.9%   |
| 2026 | 709       | 92                 | 13.0%   |

```rust

// Do deadline-day moves differ? fee disclosure + median fee inside vs outside window
fn median(v: &mut Vec<f64>) -> f64 {
    if v.is_empty() { return 0.0; }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 }
}
let (mut win_fees, mut out_fees) = (Vec::new(), Vec::new());
let (mut win_n, mut out_n) = (0usize, 0usize);
for &(y, m, dd, f) in &rows {
    if y < 2010 { continue; } // fee data is sparse before ~2010
    if in_window(m, dd) { win_n += 1; if f > 0.0 { win_fees.push(f); } }
    else { out_n += 1; if f > 0.0 { out_fees.push(f); } }
}
println!("2010+ transfers: {} | in window: {} ({:.1}%) | with fee: {}",
    win_n + out_n, win_n, 100.0 * win_n as f64 / (win_n + out_n) as f64,
    win_fees.len() + out_fees.len());
println!("median fee — window: €{}M over {} moves | other days: €{}M over {} moves",
    median(&mut win_fees.clone()) as i64 / 1_000_000, win_fees.len(),
    median(&mut out_fees.clone()) as i64 / 1_000_000, out_fees.len());

// top-15 busiest calendar days overall
let mut all_md: HashMap<(u32, u32), usize> = HashMap::new();
for &(y, m, dd, _) in &rows { *all_md.entry((m, dd)).or_default() += 1; }
let mut top: Vec<((u32, u32), usize)> = all_md.into_iter().collect();
top.sort_by_key(|&(_, c)| std::cmp::Reverse(c));
let trows: Vec<Vec<String>> = top.iter().take(15).map(|&((m, dd), c)| {
    vec![format!("{:02}-{:02}", m, dd), c.to_string()]
}).collect();
mars_table(&["month-day", "transfers (all years)"], &trows);
```

```text
transfers with parseable date: 19436
2010+ transfers: 18837 | in window: 2159 (11.5%) | with fee: 5243
median fee — window: €4M over 651 moves | other days: €4M over 4592 moves
```

| month | transfers |
| ----- | --------- |
| 1     | 3355      |
| 2     | 700       |
| 3     | 98        |
| 4     | 70        |
| 5     | 299       |
| 6     | 3376      |
| 7     | 6818      |
| 8     | 3033      |
| 9     | 974       |
| 10    | 236       |
| 11    | 119       |
| 12    | 358       |

| month-day | transfers (all years) |
| --------- | --------------------- |
| 01-20     | 58                    |
| 01-21     | 60                    |
| 01-22     | 59                    |
| 01-23     | 86                    |
| 01-24     | 81                    |
| 01-25     | 84                    |
| 01-26     | 97                    |
| 01-27     | 88                    |
| 01-28     | 96                    |
| 01-29     | 138                   |
| 01-30     | 203                   |
| 01-31     | 449                   |
| 02-01     | 240                   |
| 02-02     | 103                   |
| 02-03     | 60                    |
| 02-04     | 15                    |
| 02-05     | 17                    |
| 02-06     | 26                    |
| 02-07     | 16                    |
| 02-08     | 18                    |
| 02-09     | 23                    |
| 02-10     | 16                    |
| 08-20     | 64                    |
| 08-21     | 67                    |
| 08-22     | 57                    |
| 08-23     | 75                    |
| 08-24     | 53                    |
| 08-25     | 69                    |
| 08-26     | 91                    |
| 08-27     | 75                    |
| 08-28     | 91                    |
| 08-29     | 113                   |
| 08-30     | 225                   |
| 08-31     | 463                   |
| 09-01     | 370                   |
| 09-02     | 136                   |
| 09-03     | 23                    |
| 09-04     | 39                    |
| 09-05     | 21                    |
| 09-06     | 30                    |
| 09-07     | 21                    |
| 09-08     | 36                    |
| 09-09     | 22                    |
| 09-10     | 21                    |

| year | transfers | in deadline window | share % |
| ---- | --------- | ------------------ | ------- |
| 2010 | 285       | 15                 | 5.3%    |
| 2011 | 377       | 27                 | 7.2%    |
| 2012 | 473       | 37                 | 7.8%    |
| 2013 | 603       | 62                 | 10.3%   |
| 2014 | 762       | 71                 | 9.3%    |
| 2015 | 990       | 88                 | 8.9%    |
| 2016 | 1106      | 110                | 9.9%    |
| 2017 | 1274      | 120                | 9.4%    |
| 2018 | 1368      | 111                | 8.1%    |
| 2019 | 1537      | 162                | 10.5%   |
| 2020 | 1474      | 227                | 15.4%   |
| 2021 | 1431      | 208                | 14.5%   |
| 2022 | 1684      | 203                | 12.1%   |
| 2023 | 1713      | 228                | 13.3%   |
| 2024 | 1543      | 219                | 14.2%   |
| 2025 | 1504      | 179                | 11.9%   |
| 2026 | 709       | 92                 | 13.0%   |

| month-day | transfers (all years) |
| --------- | --------------------- |
| 07-01     | 4011                  |
| 06-30     | 3314                  |
| 01-01     | 694                   |
| 08-31     | 463                   |
| 01-31     | 449                   |
| 09-01     | 370                   |
| 12-31     | 272                   |
| 02-01     | 240                   |
| 08-30     | 225                   |
| 05-31     | 211                   |
| 01-30     | 203                   |
| 08-01     | 157                   |
| 01-29     | 138                   |
| 07-05     | 137                   |
| 09-02     | 136                   |

## Findings

The headline is not deadline day — it is **1 July**. Jun 30–Jul 1 alone accounts
for ~7,300 moves, nearly 40% of the dataset: Transfermarkt dates most
season-long agreements to the contract year boundary, so the summer window's
true shape is hidden under a mountain of Jul 1 stamps.

Stripping that out, the deadline effect is still real and getting bigger:

- **Aug 31 (463) and Jan 31 (449)** run ~5–7× a normal day (~65–90 moves). Sep 1
  (370) and Feb 1 (240) carry the spillover as deals roll past midnight.
- The share of a year's business done inside the four deadline days rose from
  **~8% in 2010–2015 to 13–15% since 2020** — windows got shorter and clubs
  adapted by waiting.
- But deadline-day moves are not bigger moves: median fee is **€4M** both inside
  and outside the window. Deadline day concentrates _volume_, not _money_ — the
  €100M deals were agreed weeks earlier; what lands on Aug 31 is the long tail
  of squad fillers, loans and panic buys.

Caveats: Transfermarkt's `transfer_date` is the contract date for many
pre-agreed moves (hence the Jul 1 spike), window deadlines differ by country
(England Sep 1, others Sep 2 / Feb 1), and fee data is only reliably populated
from ~2010.
