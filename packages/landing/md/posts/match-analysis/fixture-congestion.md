---
title: 'The Fixture Congestion Effect'
description:
  'Does playing every three days hurt? A rest-day analysis of 300k matches finds
  the effect is real but marginal.'
author: 'hieudoan'
date: '2026-11-25T13:30'
order: 12
tags: ['football', 'analysis', 'fixtures', 'mars', 'sqlite']
---

## The Fixture Congestion Effect

Modern football grinds teams through midweek European nights and domestic
fixtures back-to-back. Does playing too often actually hurt? This notebook
measures **rest days between matches** for every team across **301,353 finished
matches** and asks:

- Do teams earn fewer points when playing every ~3 days?
- Does short rest mean conceding more goals?
- Are teams juggling multiple competitions hit harder?

Rest = days between a team's consecutive matches (any competition).
"Multi-competition" = the team played a match in a _different_ league within the
previous 14 days.

```rust
use polars::prelude::*;

let df = LazyCsvReader::new("data/matches_full.csv")
    .finish()
    .expect("failed to open data/matches_full.csv — run from the notebook directory")
    .collect()
    .expect("failed to collect CSV into DataFrame");

println!(
    "loaded {} rows × {} cols | schema: {:?}",
    df.height(),
    df.width(),
    df.get_column_names()
);
```

```text
loaded 301353 rows × 11 cols | schema: ["id", "country", "league", "season", "date", "hid", "aid", "home", "away", "hg", "ag"]
```

```rust

// pull columns into plain Rust vectors (null-safe)
let s = |name: &str| df.column(name).unwrap_or_else(|_| panic!("missing {name}")).clone();
let col_str = |name: &str| -> Vec<String> {
    s(name).str().unwrap().iter().map(|o| o.unwrap_or("").to_string()).collect()
};
let col_i64 = |name: &str| -> Vec<i64> {
    let c = s(name);
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(0)).collect()
};
let league_v = col_str("league");
let hid_v = col_i64("hid");
let aid_v = col_i64("aid");
let home_v = col_str("home");
let away_v = col_str("away");
let hg_v = col_i64("hg");
let ag_v = col_i64("ag");
let date_v = col_str("date");
let n = df.height();
println!("extracted {n} matches");
```

```text
loaded 301353 rows × 11 cols | schema: ["id", "country", "league", "season", "date", "hid", "aid", "home", "away", "hg", "ag"]
extracted 301353 matches
```

## Rest-day buckets and multi-competition flags

Dates are ISO strings — we convert to serial days, sort each team's fixtures
chronologically, and bucket rest periods. A team's recent fixtures window (last
~20 matches) detects cross-competition congestion.

```rust
use std::collections::HashMap;
use std::collections::VecDeque;

// civil date -> serial day (Howard Hinnant's algorithm)
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn date_to_days(s: &str) -> i64 {
    let b = s.as_bytes();
    let y: i64 = s[0..4].parse().unwrap_or(1970);
    let m: i64 = s[5..7].parse().unwrap_or(1);
    let d: i64 = s[8..10].parse().unwrap_or(1);
    let _ = b;
    days_from_civil(y, m, d)
}

// per-team match list: (day, league, points, gf, ga)
struct TM9 { day: i64, league: String, pts: f64, gf: i64, ga: i64 }
let mut by_team: HashMap<i64, Vec<TM9>> = HashMap::new();
let mut names: HashMap<i64, String> = HashMap::new();

for i in 0..n {
    if league_v[i].to_lowercase().contains("friend") { continue; }
    let day = date_to_days(&date_v[i]);
    let (hg, ag) = (hg_v[i], ag_v[i]);
    let (hp, ap) = if hg > ag { (3.0, 0.0) } else if hg == ag { (1.0, 1.0) } else { (0.0, 3.0) };
    names.entry(hid_v[i]).or_insert_with(|| home_v[i].clone());
    names.entry(aid_v[i]).or_insert_with(|| away_v[i].clone());
    by_team.entry(hid_v[i]).or_default().push(TM9 { day, league: league_v[i].clone(), pts: hp, gf: hg, ga: ag });
    by_team.entry(aid_v[i]).or_default().push(TM9 { day, league: league_v[i].clone(), pts: ap, gf: ag, ga: hg });
}
for v in by_team.values_mut() {
    v.sort_by_key(|m| m.day);
}

// rest buckets: <=3, 4, 5-6, 7-9, 10-14, 15+
// stats: [matches, pts_sum, wins, gf, ga]
let mut buckets: HashMap<&'static str, (u64, f64, u64, i64, i64)> = HashMap::new();
let mut multi: (u64, f64, u64, i64) = (0, 0.0, 0, 0);   // multi-comp: m, pts, ga
let mut single: (u64, f64, u64, i64) = (0, 0.0, 0, 0);

for (_tid, matches) in &by_team {
    let mut window: VecDeque<&TM9> = VecDeque::new();
    for (idx, m) in matches.iter().enumerate() {
        if idx == 0 { window.push_back(m); continue; }
        let rest = m.day - matches[idx - 1].day;
        let label = if rest <= 3 { "≤3 days" } else if rest == 4 { "4 days" } else if rest <= 6 { "5–6 days" } else if rest <= 9 { "7–9 days" } else if rest <= 14 { "10–14 days" } else { "15+ days" };
        let b = buckets.entry(label).or_insert((0, 0.0, 0, 0, 0));
        b.0 += 1; b.1 += m.pts; b.3 += m.gf; b.4 += m.ga;
        if m.pts == 3.0 { b.2 += 1; }

        // multi-competition: different league within previous 14 days
        let is_multi = window.iter().any(|p| p.league != m.league && m.day - p.day <= 14);
        if is_multi {
            multi.0 += 1; multi.1 += m.pts; multi.3 += m.ga;
        } else {
            single.0 += 1; single.1 += m.pts; single.3 += m.ga;
        }
        while window.len() > 20 { window.pop_front(); }
        window.push_back(m);
    }
}

let order_labels = ["≤3 days", "4 days", "5–6 days", "7–9 days", "10–14 days", "15+ days"];
let mut rows: Vec<Vec<String>> = Vec::new();
for l in order_labels {
    if let Some((m, pts, w, gf, ga)) = buckets.get(l) {
        rows.push(vec![
            l.to_string(),
            m.to_string(),
            format!("{:.2}", pts / *m as f64),
            format!("{:.1}%", *w as f64 / *m as f64 * 100.0),
            format!("{:.2}", *gf as f64 / *m as f64),
            format!("{:.2}", *ga as f64 / *m as f64),
        ]);
    }
}
mars_table(&["rest", "matches", "pts/game", "win%", "GF/game", "GA/game"], &rows);

println!("multi-competition matches: {} | pts/game {:.2} | GA/game {:.2}", multi.0, multi.1 / multi.0.max(1) as f64, multi.3 as f64 / multi.0.max(1) as f64);
println!("single-competition matches: {} | pts/game {:.2} | GA/game {:.2}", single.0, single.1 / single.0.max(1) as f64, single.3 as f64 / single.0.max(1) as f64);
```

```text
loaded 301353 rows × 11 cols | schema: ["id", "country", "league", "season", "date", "hid", "aid", "home", "away", "hg", "ag"]
extracted 301353 matches
multi-competition matches: 5178 | pts/game 1.35 | GA/game 1.33
single-competition matches: 595957 | pts/game 1.37 | GA/game 1.32
```

| rest       | matches | pts/game | win%  | GF/game | GA/game |
| ---------- | ------- | -------- | ----- | ------- | ------- |
| ≤3 days    | 68682   | 1.38     | 37.2% | 1.31    | 1.29    |
| 4 days     | 58438   | 1.36     | 36.6% | 1.30    | 1.31    |
| 5–6 days   | 95701   | 1.36     | 36.5% | 1.31    | 1.31    |
| 7–9 days   | 279793  | 1.36     | 36.6% | 1.33    | 1.33    |
| 10–14 days | 55898   | 1.38     | 37.2% | 1.35    | 1.33    |
| 15+ days   | 42623   | 1.36     | 36.4% | 1.32    | 1.33    |

```rust
use plotters::prelude::*;

let labels9 = vec!["≤3d", "4d", "5-6d", "7-9d", "10-14d", "15d+"];
let mut pts9: Vec<f64> = Vec::new();
for l in ["≤3 days", "4 days", "5–6 days", "7–9 days", "10–14 days", "15+ days"] {
    if let Some((m, pts, _w, _gf, _ga)) = buckets.get(l) {
        pts9.push(pts / *m as f64);
    } else { pts9.push(0.0); }
}
let ymax9 = pts9.iter().cloned().fold(0.5_f64, f64::max) * 1.2;

let figure = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Points per game by rest days between matches", ("sans-serif", 20))
        .margin(10)
        .x_label_area_size(30)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..5.5, 0.5_f64..ymax9)?;
    chart.configure_mesh().x_labels(6).x_label_formatter(&|x: &f64| labels9[*x as usize].to_string()).draw()?;
    chart.draw_series((0..6).map(|i| {
        let color = if i == 0 { RED } else { BLUE };
        Rectangle::new([(i as f64 - 0.3, 0.5), (i as f64 + 0.3, pts9[i])], color.filled())
    }))?;
    Ok(())
});
figure.evcxr_display();
```

```text
loaded 301353 rows × 11 cols | schema: ["id", "country", "league", "season", "date", "hid", "aid", "home", "away", "hg", "ag"]
extracted 301353 matches
multi-competition matches: 5178 | pts/game 1.35 | GA/game 1.33
single-competition matches: 595957 | pts/game 1.37 | GA/game 1.32
```

| rest       | matches | pts/game | win%  | GF/game | GA/game |
| ---------- | ------- | -------- | ----- | ------- | ------- |
| ≤3 days    | 68682   | 1.38     | 37.2% | 1.31    | 1.29    |
| 4 days     | 58438   | 1.36     | 36.6% | 1.30    | 1.31    |
| 5–6 days   | 95701   | 1.36     | 36.5% | 1.31    | 1.31    |
| 7–9 days   | 279793  | 1.36     | 36.6% | 1.33    | 1.33    |
| 10–14 days | 55898   | 1.38     | 37.2% | 1.35    | 1.33    |
| 15+ days   | 42623   | 1.36     | 36.4% | 1.32    | 1.33    |

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYuMTI5MDMyMjU4MDY0NTE2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUG9pbnRzIHBlciBnYW1lIGJ5IHJlc3QgZGF5cyBiZXR3ZWVuIG1hdGNoZXMKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNTkiIHgyPSI2NSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NyIgeTE9IjM1OSIgeDI9Ijg3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwOSIgeTE9IjM1OSIgeDI9IjEwOSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMzEiIHkxPSIzNTkiIHgyPSIxMzEiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzU5IiB4Mj0iMTUzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3NCIgeTE9IjM1OSIgeDI9IjE3NCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTYiIHkxPSIzNTkiIHgyPSIxOTYiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjE4IiB5MT0iMzU5IiB4Mj0iMjE4IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI0MCIgeTE9IjM1OSIgeDI9IjI0MCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNjIiIHkxPSIzNTkiIHgyPSIyNjIiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjgzIiB5MT0iMzU5IiB4Mj0iMjgzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwNSIgeTE9IjM1OSIgeDI9IjMwNSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjciIHkxPSIzNTkiIHgyPSIzMjciIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQ5IiB5MT0iMzU5IiB4Mj0iMzQ5IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM3MSIgeTE9IjM1OSIgeDI9IjM3MSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTIiIHkxPSIzNTkiIHgyPSIzOTIiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDE0IiB5MT0iMzU5IiB4Mj0iNDE0IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzNiIgeTE9IjM1OSIgeDI9IjQzNiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTgiIHkxPSIzNTkiIHgyPSI0NTgiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDgwIiB5MT0iMzU5IiB4Mj0iNDgwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwMSIgeTE9IjM1OSIgeDI9IjUwMSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjMiIHkxPSIzNTkiIHgyPSI1MjMiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQ1IiB5MT0iMzU5IiB4Mj0iNTQ1IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2NyIgeTE9IjM1OSIgeDI9IjU2NyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1ODkiIHkxPSIzNTkiIHgyPSI1ODkiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjEwIiB5MT0iMzU5IiB4Mj0iNjEwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYzMiIgeTE9IjM1OSIgeDI9IjYzMiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTQiIHkxPSIzNTkiIHgyPSI2NTQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjc2IiB5MT0iMzU5IiB4Mj0iNjc2IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzU5IiB4Mj0iNzA5IiB5Mj0iMzU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1NCIgeDI9IjcwOSIgeTI9IjM1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNDgiIHgyPSI3MDkiIHkyPSIzNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQzIiB4Mj0iNzA5IiB5Mj0iMzQzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMzNyIgeDI9IjcwOSIgeTI9IjMzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzIiIHgyPSI3MDkiIHkyPSIzMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzI2IiB4Mj0iNzA5IiB5Mj0iMzI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyMSIgeDI9IjcwOSIgeTI9IjMyMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMTUiIHgyPSI3MDkiIHkyPSIzMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA5IiB4Mj0iNzA5IiB5Mj0iMzA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwNCIgeDI9IjcwOSIgeTI9IjMwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTgiIHgyPSI3MDkiIHkyPSIyOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjkzIiB4Mj0iNzA5IiB5Mj0iMjkzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4NyIgeDI9IjcwOSIgeTI9IjI4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODIiIHgyPSI3MDkiIHkyPSIyODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc2IiB4Mj0iNzA5IiB5Mj0iMjc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MCIgeDI9IjcwOSIgeTI9IjI3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjUiIHgyPSI3MDkiIHkyPSIyNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU5IiB4Mj0iNzA5IiB5Mj0iMjU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1NCIgeDI9IjcwOSIgeTI9IjI1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDgiIHgyPSI3MDkiIHkyPSIyNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQzIiB4Mj0iNzA5IiB5Mj0iMjQzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzNyIgeDI9IjcwOSIgeTI9IjIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzIiIHgyPSI3MDkiIHkyPSIyMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI2IiB4Mj0iNzA5IiB5Mj0iMjI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyMCIgeDI9IjcwOSIgeTI9IjIyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTUiIHgyPSI3MDkiIHkyPSIyMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA5IiB4Mj0iNzA5IiB5Mj0iMjA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwNCIgeDI9IjcwOSIgeTI9IjIwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTgiIHgyPSI3MDkiIHkyPSIxOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTkzIiB4Mj0iNzA5IiB5Mj0iMTkzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4NyIgeDI9IjcwOSIgeTI9IjE4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODEiIHgyPSI3MDkiIHkyPSIxODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTc2IiB4Mj0iNzA5IiB5Mj0iMTc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3MCIgeDI9IjcwOSIgeTI9IjE3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjUiIHgyPSI3MDkiIHkyPSIxNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTU5IiB4Mj0iNzA5IiB5Mj0iMTU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1NCIgeDI9IjcwOSIgeTI9IjE1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDgiIHgyPSI3MDkiIHkyPSIxNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQzIiB4Mj0iNzA5IiB5Mj0iMTQzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzNyIgeDI9IjcwOSIgeTI9IjEzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzEiIHgyPSI3MDkiIHkyPSIxMzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI2IiB4Mj0iNzA5IiB5Mj0iMTI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyMCIgeDI9IjcwOSIgeTI9IjEyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTUiIHgyPSI3MDkiIHkyPSIxMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA5IiB4Mj0iNzA5IiB5Mj0iMTA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwNCIgeDI9IjcwOSIgeTI9IjEwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5OCIgeDI9IjcwOSIgeTI9Ijk4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjkyIiB4Mj0iNzA5IiB5Mj0iOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODciIHgyPSI3MDkiIHkyPSI4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MSIgeDI9IjcwOSIgeTI9IjgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc2IiB4Mj0iNzA5IiB5Mj0iNzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzAiIHgyPSI3MDkiIHkyPSI3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2NSIgeDI9IjcwOSIgeTI9IjY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU5IiB4Mj0iNzA5IiB5Mj0iNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTQiIHgyPSI3MDkiIHkyPSI1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0OCIgeDI9IjcwOSIgeTI9IjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQyIiB4Mj0iNzA5IiB5Mj0iNDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwOSIgeTE9IjM1OSIgeDI9IjEwOSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTgiIHkxPSIzNTkiIHgyPSIyMTgiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI3IiB5MT0iMzU5IiB4Mj0iMzI3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzNiIgeTE9IjM1OSIgeDI9IjQzNiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDUiIHkxPSIzNTkiIHgyPSI1NDUiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjU0IiB5MT0iMzU5IiB4Mj0iNjU0IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzMyIiB4Mj0iNzA5IiB5Mj0iMzMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3NiIgeDI9IjcwOSIgeTI9IjI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjAiIHgyPSI3MDkiIHkyPSIyMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY1IiB4Mj0iNzA5IiB5Mj0iMTY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwOSIgeDI9IjcwOSIgeTI9IjEwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1NCIgeDI9IjcwOSIgeTI9IjU0Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNiA1NCwzNTkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzMzIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuNgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMzIgNTQsMzMyICIvPgo8dGV4dCB4PSI0NSIgeT0iMjc2IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjgKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjc2IDU0LDI3NiAiLz4KPHRleHQgeD0iNDUiIHk9IjIyMCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDIyMCA1NCwyMjAgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxNjUiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEuMgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNjUgNTQsMTY1ICIvPgo8dGV4dCB4PSI0NSIgeT0iMTA5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTA5IDU0LDEwOSAiLz4KPHRleHQgeD0iNDUiIHk9IjU0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjYKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksNTQgNTQsNTQgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NSwzNjAgNzA5LDM2MCAiLz4KPHRleHQgeD0iMTA5IiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgriiaQzZAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxMDksMzYwIDEwOSwzNjUgIi8+Cjx0ZXh0IHg9IjIxOCIgeT0iMzcwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNGQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjE4LDM2MCAyMTgsMzY1ICIvPgo8dGV4dCB4PSIzMjciIHk9IjM3MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjUtNmQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzI3LDM2MCAzMjcsMzY1ICIvPgo8dGV4dCB4PSI0MzYiIHk9IjM3MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjctOWQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDM2LDM2MCA0MzYsMzY1ICIvPgo8dGV4dCB4PSI1NDUiIHk9IjM3MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLTE0ZAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NDUsMzYwIDU0NSwzNjUgIi8+Cjx0ZXh0IHg9IjY1NCIgeT0iMzcwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTVkKwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NTQsMzYwIDY1NCwzNjUgIi8+CjxyZWN0IHg9Ijc2IiB5PSIxMTQiIHdpZHRoPSI2NiIgaGVpZ2h0PSIyNDUiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxODUiIHk9IjExOSIgd2lkdGg9IjY2IiBoZWlnaHQ9IjI0MCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjI5NCIgeT0iMTE5IiB3aWR0aD0iNjYiIGhlaWdodD0iMjQwIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDAzIiB5PSIxMTkiIHdpZHRoPSI2NiIgaGVpZ2h0PSIyNDAiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1MTIiIHk9IjExNSIgd2lkdGg9IjY2IiBoZWlnaHQ9IjI0NCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYyMSIgeT0iMTIwIiB3aWR0aD0iNjYiIGhlaWdodD0iMjM5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPC9zdmc+)

## Findings

The hypothesis was that short rest hurts — the data says **barely, if at all**:

| Rest       | Matches | Pts/game | Win%  | GA/game |
| ---------- | ------- | -------- | ----- | ------- |
| ≤3 days    | 68,682  | **1.38** | 37.2% | 1.29    |
| 4 days     | 58,438  | 1.36     | 36.6% | 1.31    |
| 5–6 days   | 95,701  | 1.36     | 36.5% | 1.31    |
| 7–9 days   | 279,793 | 1.36     | 36.6% | 1.33    |
| 10–14 days | 55,898  | 1.38     | 37.2% | 1.33    |
| 15+ days   | 42,623  | 1.36     | 36.4% | 1.33    |

Teams playing every ≤3 days actually post the _joint-highest_ points game (1.38)
— though this is partly selection bias: elite sides play in more competitions
and more often, and they're better. Goals conceded are remarkably flat
(~1.3/game) across every rest bucket.

**Multi-competition check:** matches where a team played a different league
within 14 days average 1.35 pts/game vs 1.37 for single-competition fixtures — a
real but tiny (~1.5%) dip, within noise for most teams.

_Honest verdict: fixture congestion is real for players' bodies, but at the
team-results level elite squads are deep enough that the effect is statistically
marginal across 300k matches._
