---
title: 'The Opening Goal Advantage'
description:
  'Scoring first wins 71.2% of the time — but timing matters, and the best
  protectors and recoverers might surprise you.'
author: 'hieudoan'
date: '2026-11-25T12:30'
order: 10
tags: ['football', 'analysis', 'comebacks', 'mars', 'sqlite']
---

# The Opening Goal Advantage

## The Opening Goal Advantage

Scoring first is football's oldest cliché — but how much is it actually worth?
This notebook replays the goal timelines of **3,703 matches** with timing data
and measures what happens after the first goal: how often the first scorer wins,
which teams are best at _protecting_ an early lead, and which are best at
_recovering_ after conceding first.

We also split by when the first goal arrives (first half vs second half), since
a 10th-minute opener and an 80th-minute opener are not the same thing.

```rust
use polars::prelude::*;

let df = LazyCsvReader::new("data/goal_events.csv")
    .finish()
    .expect("failed to open data/goal_events.csv — run from the notebook directory")
    .collect()
    .expect("failed to collect CSV into DataFrame");

println!(
    "loaded {} goal rows | schema: {:?}",
    df.height(),
    df.get_column_names()
);
```

```text
loaded 11328 goal rows | schema: ["mid", "minute", "added_minute", "player", "gtid", "gteam", "hid", "aid", "home", "away", "hg", "ag", "league", "date", "season"]
```

```rust

let s = |name: &str| df.column(name).unwrap_or_else(|_| panic!("missing {name}")).clone();
let col_str = |name: &str| -> Vec<String> {
    s(name).str().unwrap().iter().map(|o| o.unwrap_or("").to_string()).collect()
};
let col_i64 = |name: &str| -> Vec<i64> {
    let c = s(name);
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(0)).collect()
};
let mid_v = col_i64("mid");
let league_v = col_str("league");
let hid_v = col_i64("hid");
let aid_v = col_i64("aid");
let home_v = col_str("home");
let away_v = col_str("away");
let hg_v = col_i64("hg");
let ag_v = col_i64("ag");
let minute_v = col_i64("minute");
let added_v = col_i64("added_minute");
let gtid_v = col_i64("gtid");
let gteam_v = col_str("gteam");
let ng = df.height();
println!("extracted {ng} goal rows");
// index goals by match, sorted by (minute, added)
use std::collections::BTreeMap;
let mut order: Vec<usize> = (0..ng).collect();
order.sort_by_key(|&i| (mid_v[i], minute_v[i], added_v[i]));

// per-match goal lists
let mut match_goals: BTreeMap<i64, Vec<usize>> = BTreeMap::new();
for &i in &order {
    match_goals.entry(mid_v[i]).or_default().push(i);
}

// team display names
let mut names: std::collections::HashMap<i64, String> = std::collections::HashMap::new();
for i in 0..ng {
    names.entry(hid_v[i]).or_insert_with(|| home_v[i].clone());
    names.entry(aid_v[i]).or_insert_with(|| away_v[i].clone());
}
println!("matches with goal data: {}", match_goals.len());
```

```text
extracted 11328 goal rows
matches with goal data: 3703
```

## First-goal outcomes

For each match: the first goal's scorer "scored first"; the other side "conceded
first". We record the final result for both, plus the minute of the opener.

```rust
use std::collections::HashMap;

#[derive(Default, Clone)]
struct FO {
    scored_first: u64, won_after_first: u64,
    conceded_first: u64, won_after_conceding: u64,
}

let mut fo: HashMap<i64, FO> = HashMap::new();
// first-goal minute buckets: (label range) -> [matches, first-scorer wins]
let mut fbuckets: HashMap<&'static str, (u64, u64)> = HashMap::new();

for (_mid, idxs) in match_goals.iter() {
    let first = idxs[0];
    let i0 = idxs[0];
    let (hid, aid, hg, ag) = (hid_v[i0], aid_v[i0], hg_v[i0], ag_v[i0]);
    let scorer_home = gtid_v[first] == hid;
    let scorer = if scorer_home { hid } else { aid };
    let conceded_by = if scorer_home { aid } else { hid };
    let scorer_won = if scorer_home { hg > ag } else { ag > hg };
    let conceded_won = if scorer_home { ag > hg } else { hg > ag };

    let eff = minute_v[first] + added_v[first];
    let bucket = if eff <= 30 { "1–30'" } else if eff <= 60 { "31–60'" } else { "61+'" };
    let b = fbuckets.entry(bucket).or_insert((0, 0));
    b.0 += 1;
    if scorer_won { b.1 += 1; }

    let e = fo.entry(scorer).or_default();
    e.scored_first += 1;
    if scorer_won { e.won_after_first += 1; }

    let e = fo.entry(conceded_by).or_default();
    e.conceded_first += 1;
    if conceded_won { e.won_after_conceding += 1; }
}

let (mut sf, mut wf, mut cf, mut wc) = (0u64, 0u64, 0u64, 0u64);
for a in fo.values() {
    sf += a.scored_first; wf += a.won_after_first;
    cf += a.conceded_first; wc += a.won_after_conceding;
}
println!("matches decided by at least one goal: {}", match_goals.len());
println!("first scorer went on to WIN: {:.1}% of {}", wf as f64 / sf as f64 * 100.0, sf);
println!("first conceder WON anyway: {:.1}% of {}", wc as f64 / cf as f64 * 100.0, cf);

let mut frows: Vec<Vec<String>> = Vec::new();
for label in ["1–30'", "31–60'", "61+'"] {
    if let Some((m, w)) = fbuckets.get(label) {
        frows.push(vec![
            label.to_string(),
            m.to_string(),
            w.to_string(),
            format!("{:.1}%", *w as f64 / *m as f64 * 100.0),
        ]);
    }
}
mars_table(&["first goal at", "matches", "scorer wins", "win%"], &frows);
```

```text
matches decided by at least one goal: 3703
first scorer went on to WIN: 71.2% of 3703
first conceder WON anyway: 11.4% of 3703
```

| first goal at | matches | scorer wins | win%  |
| ------------- | ------- | ----------- | ----- |
| 1–30'         | 2187    | 1491        | 68.2% |
| 31–60'        | 1045    | 756         | 72.3% |
| 61+'          | 471     | 388         | 82.4% |

```rust
// protectors: best win% after scoring first (min 15)
let mut prot: Vec<(&i64, &FO)> = fo.iter().filter(|(_, a)| a.scored_first >= 15).collect();
prot.sort_by(|a, b| {
    let ra = a.1.won_after_first as f64 / a.1.scored_first as f64;
    let rb = b.1.won_after_first as f64 / b.1.scored_first as f64;
    rb.partial_cmp(&ra).unwrap()
});
let prot_rows: Vec<Vec<String>> = prot.iter().take(15).map(|(tid, a)| {
    vec![
        names.get(*tid).cloned().unwrap_or_else(|| tid.to_string()),
        a.scored_first.to_string(),
        a.won_after_first.to_string(),
        format!("{:.1}%", a.won_after_first as f64 / a.scored_first as f64 * 100.0),
    ]
}).collect();
mars_table(&["team (best protectors)", "scored first", "won", "protect rate"], &prot_rows);
```

| team (best protectors) | scored first | won | protect rate |
| ---------------------- | ------------ | --- | ------------ |
| Juventus W             | 16           | 16  | 100.0%       |
| AS Roma W              | 21           | 21  | 100.0%       |
| Barcelona WFC          | 29           | 28  | 96.6%        |
| Real Madrid CF W       | 21           | 20  | 95.2%        |
| Bayer Leverkusen       | 40           | 38  | 95.0%        |
| Bayern München W       | 19           | 18  | 94.7%        |
| England Women's        | 17           | 16  | 94.1%        |
| Seattle Reign          | 15           | 14  | 93.3%        |
| Stade Malherbe Caen    | 15           | 14  | 93.3%        |
| VfL Wolfsburg WFC      | 15           | 14  | 93.3%        |
| Juventus               | 25           | 23  | 92.0%        |
| Chelsea FCW            | 59           | 53  | 89.8%        |
| Paris Saint-Germain    | 68           | 61  | 89.7%        |
| Arsenal WFC            | 58           | 52  | 89.7%        |
| Napoli                 | 26           | 23  | 88.5%        |

```rust
// recoverers: best win% after conceding first (min 15)
let mut rec: Vec<(&i64, &FO)> = fo.iter().filter(|(_, a)| a.conceded_first >= 15).collect();
rec.sort_by(|a, b| {
    let ra = a.1.won_after_conceding as f64 / a.1.conceded_first as f64;
    let rb = b.1.won_after_conceding as f64 / b.1.conceded_first as f64;
    rb.partial_cmp(&ra).unwrap()
});
let rec_rows: Vec<Vec<String>> = rec.iter().take(15).map(|(tid, a)| {
    vec![
        names.get(*tid).cloned().unwrap_or_else(|| tid.to_string()),
        a.conceded_first.to_string(),
        a.won_after_conceding.to_string(),
        format!("{:.1}%", a.won_after_conceding as f64 / a.conceded_first as f64 * 100.0),
    ]
}).collect();
mars_table(&["team (best recoverers)", "conceded first", "won", "recover rate"], &rec_rows);
```

| team (best recoverers) | conceded first | won | recover rate |
| ---------------------- | -------------- | --- | ------------ |
| Manchester City WFC    | 17             | 9   | 52.9%        |
| Arsenal WFC            | 20             | 9   | 45.0%        |
| Barcelona              | 127            | 55  | 43.3%        |
| Chelsea FCW            | 15             | 6   | 40.0%        |
| Arsenal                | 18             | 7   | 38.9%        |
| Paris Saint-Germain    | 22             | 8   | 36.4%        |
| Bayer Leverkusen       | 24             | 7   | 29.2%        |
| Orlando Pride          | 18             | 4   | 22.2%        |
| OGC Nice               | 20             | 4   | 20.0%        |
| Atlético Madrid        | 25             | 5   | 20.0%        |
| Chievo                 | 17             | 3   | 17.6%        |
| Toulouse               | 17             | 3   | 17.6%        |
| Real Madrid            | 23             | 4   | 17.4%        |
| Torino                 | 23             | 4   | 17.4%        |
| Lorient                | 23             | 4   | 17.4%        |

```rust
use plotters::prelude::*;

// protect rate for top 12 by volume
let mut chart_rows: Vec<(&i64, &FO)> = fo
    .iter()
    .filter(|(_, a)| a.scored_first >= 10 && a.won_after_first >= 5)
    .collect();
chart_rows.sort_by(|a, b| b.1.won_after_first.cmp(&a.1.won_after_first));
chart_rows.truncate(12);

let mut labels7: Vec<String> = Vec::new();
let mut vals: Vec<f64> = Vec::new();
for (tid, a) in &chart_rows {
    labels7.push(names.get(*tid).cloned().unwrap_or_default().chars().take(14).collect());
    vals.push(a.won_after_first as f64 / a.scored_first as f64 * 100.0);
}
let ymax7 = vals.iter().cloned().fold(1.0_f64, f64::max) * 1.2;
let n7 = vals.len();

let figure = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Win rate after scoring first — the best protectors", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(80)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n7 as f64 - 0.5), 0.0_f64..ymax7)?;
    chart.configure_mesh().x_labels(n7).x_label_formatter(&|x: &f64| {
        labels7.get(*x as usize).cloned().unwrap_or_default()
    }).draw()?;
    chart.draw_series((0..n7).map(|i| {
        Rectangle::new([(i as f64 - 0.35, 0.0), (i as f64 + 0.35, vals[i])], GREEN.filled())
    }))?;
    Ok(())
});
figure.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KV2luIHJhdGUgYWZ0ZXIgc2NvcmluZyBmaXJzdCDigJQgdGhlIGJlc3QgcHJvdGVjdG9ycwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMwOSIgeDI9IjYwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcxIiB5MT0iMzA5IiB4Mj0iNzEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODIiIHkxPSIzMDkiIHgyPSI4MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5MyIgeTE9IjMwOSIgeDI9IjkzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwNCIgeTE9IjMwOSIgeDI9IjEwNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMTQiIHkxPSIzMDkiIHgyPSIxMTQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTI1IiB5MT0iMzA5IiB4Mj0iMTI1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEzNiIgeTE9IjMwOSIgeDI9IjEzNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDciIHkxPSIzMDkiIHgyPSIxNDciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTU4IiB5MT0iMzA5IiB4Mj0iMTU4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2OSIgeTE9IjMwOSIgeDI9IjE2OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODAiIHkxPSIzMDkiIHgyPSIxODAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTkxIiB5MT0iMzA5IiB4Mj0iMTkxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIwMiIgeTE9IjMwOSIgeDI9IjIwMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTMiIHkxPSIzMDkiIHgyPSIyMTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIzIiB5MT0iMzA5IiB4Mj0iMjIzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzNCIgeTE9IjMwOSIgeDI9IjIzNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDUiIHkxPSIzMDkiIHgyPSIyNDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU2IiB5MT0iMzA5IiB4Mj0iMjU2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI2NyIgeTE9IjMwOSIgeDI9IjI2NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzgiIHkxPSIzMDkiIHgyPSIyNzgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjg5IiB5MT0iMzA5IiB4Mj0iMjg5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwMCIgeTE9IjMwOSIgeDI9IjMwMCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTEiIHkxPSIzMDkiIHgyPSIzMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzIyIiB5MT0iMzA5IiB4Mj0iMzIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMzMiIgeTE9IjMwOSIgeDI9IjMzMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNDMiIHkxPSIzMDkiIHgyPSIzNDMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzU0IiB5MT0iMzA5IiB4Mj0iMzU0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2NSIgeTE9IjMwOSIgeDI9IjM2NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNzYiIHkxPSIzMDkiIHgyPSIzNzYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg3IiB5MT0iMzA5IiB4Mj0iMzg3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM5OCIgeTE9IjMwOSIgeDI9IjM5OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDkiIHkxPSIzMDkiIHgyPSI0MDkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDIwIiB5MT0iMzA5IiB4Mj0iNDIwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzMSIgeTE9IjMwOSIgeDI9IjQzMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NDEiIHkxPSIzMDkiIHgyPSI0NDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDUyIiB5MT0iMzA5IiB4Mj0iNDUyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2MyIgeTE9IjMwOSIgeDI9IjQ2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NzQiIHkxPSIzMDkiIHgyPSI0NzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDg1IiB5MT0iMzA5IiB4Mj0iNDg1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ5NiIgeTE9IjMwOSIgeDI9IjQ5NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDciIHkxPSIzMDkiIHgyPSI1MDciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTE4IiB5MT0iMzA5IiB4Mj0iNTE4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUyOSIgeTE9IjMwOSIgeDI9IjUyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDAiIHkxPSIzMDkiIHgyPSI1NDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUwIiB5MT0iMzA5IiB4Mj0iNTUwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2MSIgeTE9IjMwOSIgeDI9IjU2MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzIiIHkxPSIzMDkiIHgyPSI1NzIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTgzIiB5MT0iMzA5IiB4Mj0iNTgzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5NCIgeTE9IjMwOSIgeDI9IjU5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MDUiIHkxPSIzMDkiIHgyPSI2MDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjE2IiB5MT0iMzA5IiB4Mj0iNjE2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyNyIgeTE9IjMwOSIgeDI9IjYyNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MzgiIHkxPSIzMDkiIHgyPSI2MzgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQ5IiB5MT0iMzA5IiB4Mj0iNjQ5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1OSIgeTE9IjMwOSIgeDI9IjY1OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NzAiIHkxPSIzMDkiIHgyPSI2NzAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgxIiB5MT0iMzA5IiB4Mj0iNjgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY5MiIgeTE9IjMwOSIgeDI9IjY5MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MDMiIHkxPSIzMDkiIHgyPSI3MDMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDkiIHgyPSI3MDkiIHkyPSIzMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA1IiB4Mj0iNzA5IiB5Mj0iMzA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwMCIgeDI9IjcwOSIgeTI9IjMwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTUiIHgyPSI3MDkiIHkyPSIyOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjkxIiB4Mj0iNzA5IiB5Mj0iMjkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4NiIgeDI9IjcwOSIgeTI9IjI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODEiIHgyPSI3MDkiIHkyPSIyODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc2IiB4Mj0iNzA5IiB5Mj0iMjc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MiIgeDI9IjcwOSIgeTI9IjI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjciIHgyPSI3MDkiIHkyPSIyNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjYyIiB4Mj0iNzA5IiB5Mj0iMjYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1NyIgeDI9IjcwOSIgeTI9IjI1NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTMiIHgyPSI3MDkiIHkyPSIyNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ4IiB4Mj0iNzA5IiB5Mj0iMjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0MyIgeDI9IjcwOSIgeTI9IjI0MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzgiIHgyPSI3MDkiIHkyPSIyMzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM0IiB4Mj0iNzA5IiB5Mj0iMjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyOSIgeDI9IjcwOSIgeTI9IjIyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjQiIHgyPSI3MDkiIHkyPSIyMjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE5IiB4Mj0iNzA5IiB5Mj0iMjE5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNSIgeDI9IjcwOSIgeTI9IjIxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTAiIHgyPSI3MDkiIHkyPSIyMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA1IiB4Mj0iNzA5IiB5Mj0iMjA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMCIgeDI9IjcwOSIgeTI9IjIwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTYiIHgyPSI3MDkiIHkyPSIxOTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTkxIiB4Mj0iNzA5IiB5Mj0iMTkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4NiIgeDI9IjcwOSIgeTI9IjE4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODEiIHgyPSI3MDkiIHkyPSIxODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTc3IiB4Mj0iNzA5IiB5Mj0iMTc3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3MiIgeDI9IjcwOSIgeTI9IjE3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjciIHgyPSI3MDkiIHkyPSIxNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTYyIiB4Mj0iNzA5IiB5Mj0iMTYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1OCIgeDI9IjcwOSIgeTI9IjE1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTMiIHgyPSI3MDkiIHkyPSIxNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ4IiB4Mj0iNzA5IiB5Mj0iMTQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0MyIgeDI9IjcwOSIgeTI9IjE0MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzkiIHgyPSI3MDkiIHkyPSIxMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM0IiB4Mj0iNzA5IiB5Mj0iMTM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyOSIgeDI9IjcwOSIgeTI9IjEyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjQiIHgyPSI3MDkiIHkyPSIxMjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIwIiB4Mj0iNzA5IiB5Mj0iMTIwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExNSIgeDI9IjcwOSIgeTI9IjExNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTAiIHgyPSI3MDkiIHkyPSIxMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA1IiB4Mj0iNzA5IiB5Mj0iMTA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwMSIgeDI9IjcwOSIgeTI9IjEwMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NiIgeDI9IjcwOSIgeTI9Ijk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjkxIiB4Mj0iNzA5IiB5Mj0iOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODYiIHgyPSI3MDkiIHkyPSI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MiIgeDI9IjcwOSIgeTI9IjgyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc3IiB4Mj0iNzA5IiB5Mj0iNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzIiIHgyPSI3MDkiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2NyIgeDI9IjcwOSIgeTI9IjY3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjYzIiB4Mj0iNzA5IiB5Mj0iNjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTgiIHgyPSI3MDkiIHkyPSI1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1MyIgeDI9IjcwOSIgeTI9IjUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ4IiB4Mj0iNzA5IiB5Mj0iNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDQiIHgyPSI3MDkiIHkyPSI0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzOSIgeDI9IjcwOSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4MiIgeTE9IjMwOSIgeDI9IjgyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEzNiIgeTE9IjMwOSIgeDI9IjEzNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTEiIHkxPSIzMDkiIHgyPSIxOTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjQ1IiB5MT0iMzA5IiB4Mj0iMjQ1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwMCIgeTE9IjMwOSIgeDI9IjMwMCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNTQiIHkxPSIzMDkiIHgyPSIzNTQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDA5IiB5MT0iMzA5IiB4Mj0iNDA5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2MyIgeTE9IjMwOSIgeDI9IjQ2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MTgiIHkxPSIzMDkiIHgyPSI1MTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTcyIiB5MT0iMzA5IiB4Mj0iNTcyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyNyIgeTE9IjMwOSIgeDI9IjYyNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODEiIHkxPSIzMDkiIHgyPSI2ODEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDkiIHgyPSI3MDkiIHkyPSIzMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjYyIiB4Mj0iNzA5IiB5Mj0iMjYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNSIgeDI9IjcwOSIgeTI9IjIxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjciIHgyPSI3MDkiIHkyPSIxNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIwIiB4Mj0iNzA5IiB5Mj0iMTIwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjcyIiB4Mj0iNzA5IiB5Mj0iNzIiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDM0IDU0LDMwOSAiLz4KPHRleHQgeD0iNDUiIHk9IjMwOSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDMwOSA1NCwzMDkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyNjIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjYyIDU0LDI2MiAiLz4KPHRleHQgeD0iNDUiIHk9IjIxNSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNDAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyMTUgNTQsMjE1ICIvPgo8dGV4dCB4PSI0NSIgeT0iMTY3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo2MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE2NyA1NCwxNjcgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxMjAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjgwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTIwIDU0LDEyMCAiLz4KPHRleHQgeD0iNDUiIHk9IjcyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMDAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw3MiA1NCw3MiAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU1LDMxMCA3MDksMzEwICIvPgo8dGV4dCB4PSI4MiIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQmFyY2Vsb25hCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjgyLDMxMCA4MiwzMTUgIi8+Cjx0ZXh0IHg9IjEzNiIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUGFyaXMgU2FpbnQtR2UKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMTM2LDMxMCAxMzYsMzE1ICIvPgo8dGV4dCB4PSIxOTEiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkNoZWxzZWEgRkNXCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE5MSwzMTAgMTkxLDMxNSAiLz4KPHRleHQgeD0iMjQ1IiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpNYW5jaGVzdGVyIENpdAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyNDUsMzEwIDI0NSwzMTUgIi8+Cjx0ZXh0IHg9IjMwMCIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQXJzZW5hbCBXRkMKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzAwLDMxMCAzMDAsMzE1ICIvPgo8dGV4dCB4PSIzNTQiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkFyc2VuYWwKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzU0LDMxMCAzNTQsMzE1ICIvPgo8dGV4dCB4PSI0MDkiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkJheWVyIExldmVya3VzCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQwOSwzMTAgNDA5LDMxNSAiLz4KPHRleHQgeD0iNDYzIiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpSZWFsIE1hZHJpZAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0NjMsMzEwIDQ2MywzMTUgIi8+Cjx0ZXh0IHg9IjUxOCIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTWFuY2hlc3RlciBVbmkKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTE4LDMxMCA1MTgsMzE1ICIvPgo8dGV4dCB4PSI1NzIiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkF0bMOpdGljbyBNYWRyaQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NzIsMzEwIDU3MiwzMTUgIi8+Cjx0ZXh0IHg9IjYyNyIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQmFyY2Vsb25hIFdGQwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MjcsMzEwIDYyNywzMTUgIi8+Cjx0ZXh0IHg9IjY4MSIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KU2V2aWxsYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2ODEsMzEwIDY4MSwzMTUgIi8+CjxyZWN0IHg9IjYzIiB5PSIxMDIiIHdpZHRoPSIzOCIgaGVpZ2h0PSIyMDciIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxMTciIHk9Ijk3IiB3aWR0aD0iMzgiIGhlaWdodD0iMjEyIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTcyIiB5PSI5NiIgd2lkdGg9IjM4IiBoZWlnaHQ9IjIxMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjIyNiIgeT0iMTAzIiB3aWR0aD0iMzgiIGhlaWdodD0iMjA2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjgxIiB5PSI5NyIgd2lkdGg9IjM4IiBoZWlnaHQ9IjIxMiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjMzNSIgeT0iMTI1IiB3aWR0aD0iMzgiIGhlaWdodD0iMTg0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzkwIiB5PSI4NCIgd2lkdGg9IjM4IiBoZWlnaHQ9IjIyNSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ0NCIgeT0iMTI1IiB3aWR0aD0iMzgiIGhlaWdodD0iMTg0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDk5IiB5PSIxMTMiIHdpZHRoPSIzOCIgaGVpZ2h0PSIxOTYiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1NTMiIHk9IjEzOSIgd2lkdGg9IjM4IiBoZWlnaHQ9IjE3MCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYwOCIgeT0iODAiIHdpZHRoPSIzOCIgaGVpZ2h0PSIyMjkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2NjIiIHk9IjE3MSIgd2lkdGg9IjM4IiBoZWlnaHQ9IjEzOCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+Cjwvc3ZnPg==)

## Findings

In **3,703 matches** with goal timing, the opening goal is worth a lot — but
less than the cliché suggests:

- **First scorer wins 71.2%** of the time; the first _conceder_ wins just
  **11.4%**.
- Timing matters: first goals in minutes 1–30 convert at 68.2%, rising to
  **82.4%** for 61+' openers — a late first goal is nearly a match-winner
  because there's less time to equalise.
- **Best protectors** (min. 15 times scoring first): Juventus Women and AS Roma
  Women at a perfect **100%**, Barcelona Femení 96.6%, Real Madrid Femenino
  95.2%, **Bayer Leverkusen 95.0%** over 40 chances — the unbeaten-machine side
  protects leads like few others.
- **Best recoverers** after conceding first: Manchester City WFC 52.9%, Arsenal
  WFC 45.0%, and **Barcelona (men's) 43.3%** — 55 wins from 127 deficits, the
  best big-sample comeback side in the data.

_Caveat: StatsBomb coverage includes women's competitions — "W" suffixed names
are the women's teams, which skew the small-sample leaderboards._
