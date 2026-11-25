---
title: 'Giant-killing: teams that beat stronger opponents'
description: |
  'An Elo sweep over 301k matches: upset win rates fall with the rating gap —
  and the best giant-killers are elite teams in down cycles.'
author: 'hieudoan'
date: '2026-11-25T11:00'
order: 7
tags: ['football', 'analysis', 'underdogs', 'elo', 'mars', 'sqlite']
---

## Giant-killing: teams that beat stronger opponents

Who are the ultimate underdogs — sides that consistently beat teams rated higher
than them? This notebook computes **Elo ratings** (K = 20, +65 for home
advantage, initial 1500) chronologically over all **301,353 competitive
matches**, then measures every time a team played below its opponent's rating.

For each underdog match we record the rating gap and the result. Teams are
ranked by _overperformance_: actual upset wins minus the number of upset wins
Elo would have predicted — the pure "giant-killing" edge.

Note: friendlies are excluded; cup and league matches all count.

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

## Elo sweep + underdog accounting

One chronological pass: look up both ratings, score the match, update. Underdog
= lower pre-match rating. We accumulate per-team underdog games, upset
wins/draws, and the sum of Elo-predicted upset-win probabilities.

```rust
use std::collections::HashMap;

const K: f64 = 20.0;
const HOME_ADV: f64 = 65.0;

// chronological order
let mut ord: Vec<usize> = (0..n).collect();
ord.sort_by(|&a, &b| date_v[a].cmp(&date_v[b]).then(a.cmp(&b)));
// drop friendlies from the sweep
ord.retain(|&i| !league_v[i].to_lowercase().contains("friend"));

let mut elo: HashMap<i64, f64> = HashMap::new();
let mut names: HashMap<i64, String> = HashMap::new();
for i in 0..n {
    names.entry(hid_v[i]).or_insert_with(|| home_v[i].clone());
    names.entry(aid_v[i]).or_insert_with(|| away_v[i].clone());
}
#[derive(Default, Clone)]
struct Dog {
    games: u64,
    wins: u64,
    draws: u64,
    exp_wins: f64, // sum of predicted upset-win probability
}
let mut dogs: HashMap<i64, Dog> = HashMap::new();

// gap buckets: (label, lo, hi)
let buckets = [(0.0, 50.0), (50.0, 100.0), (100.0, 150.0), (150.0, 200.0), (200.0, 300.0), (300.0, 1e9)];
let mut bstats: Vec<(u64, u64, u64)> = vec![(0, 0, 0); buckets.len()]; // games, wins, draws

for &i in &ord {
    let (hid, aid) = (hid_v[i], aid_v[i]);
    let rh = *elo.get(&hid).unwrap_or(&1500.0);
    let ra = *elo.get(&aid).unwrap_or(&1500.0);

    // underdog bookkeeping (skip dead heats)
    if (rh - ra).abs() > 1.0 {
        let (dog, fav, dog_is_home, dog_score, fav_score) = if rh < ra {
            (hid, aid, true, hg_v[i], ag_v[i])
        } else {
            (aid, hid, false, ag_v[i], hg_v[i])
        };
        let _ = fav;
        let gap = (rh - ra).abs();
        // predicted win prob for the underdog (logistic on rating diff)
        let p_dog = 1.0 / (1.0 + 10f64.powf(-(ra.min(rh) - ra.max(rh)) / 400.0));
        let won = dog_score > fav_score;
        let drew = dog_score == fav_score;
        let d = dogs.entry(dog).or_default();
        d.games += 1;
        if won { d.wins += 1; } else if drew { d.draws += 1; }
        d.exp_wins += p_dog;
        let bi = buckets.iter().position(|(_, hi)| gap < *hi).unwrap_or(buckets.len() - 1);
        bstats[bi].0 += 1;
        if won { bstats[bi].1 += 1; }
        if drew { bstats[bi].2 += 1; }
        let _ = dog_is_home;
    }

    // Elo update
    let eh = 1.0 / (1.0 + 10f64.powf(-((rh - ra) + HOME_ADV) / 400.0));
    let sh = if hg_v[i] > ag_v[i] { 1.0 } else if hg_v[i] == ag_v[i] { 0.5 } else { 0.0 };
    elo.insert(hid, rh + K * (sh - eh));
    elo.insert(aid, ra + K * ((1.0 - sh) - (1.0 - eh)));
}

println!("Elo sweep complete over {} matches", ord.len());

// overall upset rate by rating gap
let mut rows: Vec<Vec<String>> = Vec::new();
let mut prev_hi = 0.0;
for (idx, (lo, hi)) in buckets.iter().enumerate() {
    let (g, w, d) = bstats[idx];
    let label_hi = *hi;
    if g == 0 { prev_hi = label_hi; continue; }
    let label = if idx == 0 { "0–50".to_string() } else if idx == buckets.len() - 1 { format!("{}+", prev_hi as i64) } else { format!("{}–{}", prev_hi as i64, *hi as i64) };
    rows.push(vec![
        label,
        g.to_string(),
        format!("{:.1}%", w as f64 / g as f64 * 100.0),
        format!("{:.1}%", (w as f64 + 0.5 * d as f64) / g as f64 * 100.0),
    ]);
    prev_hi = label_hi;
}
mars_table(&["Elo gap (under–fav)", "underdog games", "upset win%", "upset pts%"], &rows);

// team overperformance: actual upset wins minus Elo-predicted
let mut over: Vec<(&i64, &Dog)> = dogs.iter().filter(|(_, d)| d.games >= 20).collect();
over.sort_by(|a, b| {
    let oa = a.1.wins as f64 - a.1.exp_wins;
    let ob = b.1.wins as f64 - b.1.exp_wins;
    ob.partial_cmp(&oa).unwrap()
});
let over_rows: Vec<Vec<String>> = over
    .iter()
    .take(15)
    .map(|(tid, d)| {
        vec![
            names.get(*tid).cloned().unwrap_or_else(|| tid.to_string()),
            d.games.to_string(),
            d.wins.to_string(),
            format!("{:.1}%", d.wins as f64 / d.games as f64 * 100.0),
            format!("{:+.1}", d.wins as f64 - d.exp_wins),
        ]
    })
    .collect();
mars_table(&["team", "games as underdog", "upset wins", "upset win%", "vs Elo-expected"], &over_rows);
```

```text
loaded 301353 rows × 11 cols | schema: ["id", "country", "league", "season", "date", "hid", "aid", "home", "away", "hg", "ag"]
extracted 301353 matches
Elo sweep complete over 301353 matches
```

| Elo gap (under–fav) | underdog games | upset win% | upset pts% |
| ------------------- | -------------- | ---------- | ---------- |
| 0–50                | 122678         | 32.8%      | 47.1%      |
| 50–100              | 84443          | 28.1%      | 41.9%      |
| 100–150             | 44951          | 23.2%      | 36.0%      |
| 150–200             | 22066          | 18.6%      | 29.9%      |
| 200–300             | 17491          | 12.8%      | 22.2%      |
| 300+                | 5629           | 6.9%       | 13.8%      |

| team                 | games as underdog | upset wins | upset win% | vs Elo-expected |
| -------------------- | ----------------- | ---------- | ---------- | --------------- |
| Bayer Leverkusen     | 23                | 13         | 56.5%      | +5.6            |
| Manchester City      | 24                | 12         | 50.0%      | +4.5            |
| West Ham United      | 23                | 12         | 52.2%      | +4.4            |
| Manchester United    | 25                | 10         | 40.0%      | +2.7            |
| Athletic Club Bilbao | 20                | 11         | 55.0%      | +2.6            |
| Barcelona            | 57                | 28         | 49.1%      | +2.5            |
| Tottenham Hotspur    | 24                | 10         | 41.7%      | +2.4            |
| Real Sociedad        | 44                | 13         | 29.5%      | +2.3            |
| Rakow                | 45                | 21         | 46.7%      | +1.9            |
| Chengdu Rongcheng    | 37                | 18         | 48.6%      | +1.8            |
| OGC Nice             | 27                | 12         | 44.4%      | +1.6            |
| Stade Malherbe Caen  | 28                | 13         | 46.4%      | +1.6            |
| Inter Milan          | 25                | 10         | 40.0%      | +1.6            |
| Elversberg           | 44                | 19         | 43.2%      | +1.5            |
| Yokohama F. Marinos  | 125               | 55         | 44.0%      | +1.4            |

```rust
use plotters::prelude::*;

let mut labels4: Vec<String> = Vec::new();
let mut upset: Vec<f64> = Vec::new();
let mut prev = 0.0;
for (idx, (_lo, hi)) in buckets.iter().enumerate() {
    let (g, w, _d) = bstats[idx];
    if g == 0 { continue; }
    labels4.push(if idx == 0 { "0-50".into() } else if idx == buckets.len() - 1 { format!("{}+", prev as i64) } else { format!("{}-{}", prev as i64, *hi as i64) });
    upset.push(w as f64 / g as f64 * 100.0);
    prev = *hi;
}
let ymax4 = upset.iter().cloned().fold(1.0_f64, f64::max) * 1.25;
let n4 = upset.len();

let figure = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Underdog win rate by Elo rating gap", ("sans-serif", 20))
        .margin(10)
        .x_label_area_size(40)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n4 as f64 - 0.5), 0.0_f64..ymax4)?;
    chart.configure_mesh().x_labels(n4).x_label_formatter(&|x: &f64| {
        labels4.get(*x as usize).cloned().unwrap_or_default()
    }).draw()?;
    chart.draw_series((0..n4).map(|i| {
        Rectangle::new([(i as f64 - 0.35, 0.0), (i as f64 + 0.35, upset[i])], RGBColor(230, 126, 34).filled())
    }))?;
    Ok(())
});
figure.evcxr_display();
```

```text
loaded 301353 rows × 11 cols | schema: ["id", "country", "league", "season", "date", "hid", "aid", "home", "away", "hg", "ag"]
extracted 301353 matches
Elo sweep complete over 301353 matches
```

| Elo gap (under–fav) | underdog games | upset win% | upset pts% |
| ------------------- | -------------- | ---------- | ---------- |
| 0–50                | 122678         | 32.8%      | 47.1%      |
| 50–100              | 84443          | 28.1%      | 41.9%      |
| 100–150             | 44951          | 23.2%      | 36.0%      |
| 150–200             | 22066          | 18.6%      | 29.9%      |
| 200–300             | 17491          | 12.8%      | 22.2%      |
| 300+                | 5629           | 6.9%       | 13.8%      |

| team                 | games as underdog | upset wins | upset win% | vs Elo-expected |
| -------------------- | ----------------- | ---------- | ---------- | --------------- |
| Bayer Leverkusen     | 23                | 13         | 56.5%      | +5.6            |
| Manchester City      | 24                | 12         | 50.0%      | +4.5            |
| West Ham United      | 23                | 12         | 52.2%      | +4.4            |
| Manchester United    | 25                | 10         | 40.0%      | +2.7            |
| Athletic Club Bilbao | 20                | 11         | 55.0%      | +2.6            |
| Barcelona            | 57                | 28         | 49.1%      | +2.5            |
| Tottenham Hotspur    | 24                | 10         | 41.7%      | +2.4            |
| Real Sociedad        | 44                | 13         | 29.5%      | +2.3            |
| Rakow                | 45                | 21         | 46.7%      | +1.9            |
| Chengdu Rongcheng    | 37                | 18         | 48.6%      | +1.8            |
| OGC Nice             | 27                | 12         | 44.4%      | +1.6            |
| Stade Malherbe Caen  | 28                | 13         | 46.4%      | +1.6            |
| Inter Milan          | 25                | 10         | 40.0%      | +1.6            |
| Elversberg           | 44                | 19         | 43.2%      | +1.5            |
| Yokohama F. Marinos  | 125               | 55         | 44.0%      | +1.4            |

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYuMTI5MDMyMjU4MDY0NTE2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KVW5kZXJkb2cgd2luIHJhdGUgYnkgRWxvIHJhdGluZyBnYXAKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjUiIHkxPSIzNDkiIHgyPSI2NSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NyIgeTE9IjM0OSIgeDI9Ijg3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwOSIgeTE9IjM0OSIgeDI9IjEwOSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMzEiIHkxPSIzNDkiIHgyPSIxMzEiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzQ5IiB4Mj0iMTUzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3NCIgeTE9IjM0OSIgeDI9IjE3NCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTYiIHkxPSIzNDkiIHgyPSIxOTYiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjE4IiB5MT0iMzQ5IiB4Mj0iMjE4IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI0MCIgeTE9IjM0OSIgeDI9IjI0MCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNjIiIHkxPSIzNDkiIHgyPSIyNjIiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjgzIiB5MT0iMzQ5IiB4Mj0iMjgzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwNSIgeTE9IjM0OSIgeDI9IjMwNSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjciIHkxPSIzNDkiIHgyPSIzMjciIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQ5IiB5MT0iMzQ5IiB4Mj0iMzQ5IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM3MSIgeTE9IjM0OSIgeDI9IjM3MSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTIiIHkxPSIzNDkiIHgyPSIzOTIiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDE0IiB5MT0iMzQ5IiB4Mj0iNDE0IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzNiIgeTE9IjM0OSIgeDI9IjQzNiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTgiIHkxPSIzNDkiIHgyPSI0NTgiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDgwIiB5MT0iMzQ5IiB4Mj0iNDgwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwMSIgeTE9IjM0OSIgeDI9IjUwMSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjMiIHkxPSIzNDkiIHgyPSI1MjMiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQ1IiB5MT0iMzQ5IiB4Mj0iNTQ1IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2NyIgeTE9IjM0OSIgeDI9IjU2NyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1ODkiIHkxPSIzNDkiIHgyPSI1ODkiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjEwIiB5MT0iMzQ5IiB4Mj0iNjEwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYzMiIgeTE9IjM0OSIgeDI9IjYzMiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTQiIHkxPSIzNDkiIHgyPSI2NTQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjc2IiB5MT0iMzQ5IiB4Mj0iNjc2IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQ5IiB4Mj0iNzA5IiB5Mj0iMzQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0NiIgeDI9IjcwOSIgeTI9IjM0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNDIiIHgyPSI3MDkiIHkyPSIzNDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzM4IiB4Mj0iNzA5IiB5Mj0iMzM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMzNCIgeDI9IjcwOSIgeTI9IjMzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzAiIHgyPSI3MDkiIHkyPSIzMzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzI3IiB4Mj0iNzA5IiB5Mj0iMzI3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyMyIgeDI9IjcwOSIgeTI9IjMyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMTkiIHgyPSI3MDkiIHkyPSIzMTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzE1IiB4Mj0iNzA5IiB5Mj0iMzE1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxMSIgeDI9IjcwOSIgeTI9IjMxMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDciIHgyPSI3MDkiIHkyPSIzMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA0IiB4Mj0iNzA5IiB5Mj0iMzA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwMCIgeDI9IjcwOSIgeTI9IjMwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTYiIHgyPSI3MDkiIHkyPSIyOTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjkyIiB4Mj0iNzA5IiB5Mj0iMjkyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4OCIgeDI9IjcwOSIgeTI9IjI4OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODUiIHgyPSI3MDkiIHkyPSIyODUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjgxIiB4Mj0iNzA5IiB5Mj0iMjgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3NyIgeDI9IjcwOSIgeTI9IjI3NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzMiIHgyPSI3MDkiIHkyPSIyNzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY5IiB4Mj0iNzA5IiB5Mj0iMjY5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2NSIgeDI9IjcwOSIgeTI9IjI2NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjIiIHgyPSI3MDkiIHkyPSIyNjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU4IiB4Mj0iNzA5IiB5Mj0iMjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1NCIgeDI9IjcwOSIgeTI9IjI1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTAiIHgyPSI3MDkiIHkyPSIyNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ2IiB4Mj0iNzA5IiB5Mj0iMjQ2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0MiIgeDI9IjcwOSIgeTI9IjI0MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzkiIHgyPSI3MDkiIHkyPSIyMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM1IiB4Mj0iNzA5IiB5Mj0iMjM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMSIgeDI9IjcwOSIgeTI9IjIzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjciIHgyPSI3MDkiIHkyPSIyMjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjIzIiB4Mj0iNzA5IiB5Mj0iMjIzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyMCIgeDI9IjcwOSIgeTI9IjIyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTYiIHgyPSI3MDkiIHkyPSIyMTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjEyIiB4Mj0iNzA5IiB5Mj0iMjEyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwOCIgeDI9IjcwOSIgeTI9IjIwOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDQiIHgyPSI3MDkiIHkyPSIyMDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjAwIiB4Mj0iNzA5IiB5Mj0iMjAwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5NyIgeDI9IjcwOSIgeTI9IjE5NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTMiIHgyPSI3MDkiIHkyPSIxOTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg5IiB4Mj0iNzA5IiB5Mj0iMTg5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4NSIgeDI9IjcwOSIgeTI9IjE4NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODEiIHgyPSI3MDkiIHkyPSIxODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTc4IiB4Mj0iNzA5IiB5Mj0iMTc4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NCIgeDI9IjcwOSIgeTI9IjE3NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzAiIHgyPSI3MDkiIHkyPSIxNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY2IiB4Mj0iNzA5IiB5Mj0iMTY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2MiIgeDI9IjcwOSIgeTI9IjE2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTgiIHgyPSI3MDkiIHkyPSIxNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTU1IiB4Mj0iNzA5IiB5Mj0iMTU1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1MSIgeDI9IjcwOSIgeTI9IjE1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDciIHgyPSI3MDkiIHkyPSIxNDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQzIiB4Mj0iNzA5IiB5Mj0iMTQzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzOSIgeDI9IjcwOSIgeTI9IjEzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzUiIHgyPSI3MDkiIHkyPSIxMzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTMyIiB4Mj0iNzA5IiB5Mj0iMTMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyOCIgeDI9IjcwOSIgeTI9IjEyOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjQiIHgyPSI3MDkiIHkyPSIxMjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIwIiB4Mj0iNzA5IiB5Mj0iMTIwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExNiIgeDI9IjcwOSIgeTI9IjExNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTMiIHgyPSI3MDkiIHkyPSIxMTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA5IiB4Mj0iNzA5IiB5Mj0iMTA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwNSIgeDI9IjcwOSIgeTI9IjEwNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDEiIHgyPSI3MDkiIHkyPSIxMDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTciIHgyPSI3MDkiIHkyPSI5NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MyIgeDI9IjcwOSIgeTI9IjkzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjkwIiB4Mj0iNzA5IiB5Mj0iOTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODYiIHgyPSI3MDkiIHkyPSI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MiIgeDI9IjcwOSIgeTI9IjgyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc4IiB4Mj0iNzA5IiB5Mj0iNzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzQiIHgyPSI3MDkiIHkyPSI3NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3MCIgeDI9IjcwOSIgeTI9IjcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY3IiB4Mj0iNzA5IiB5Mj0iNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjMiIHgyPSI3MDkiIHkyPSI2MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1OSIgeDI9IjcwOSIgeTI9IjU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU1IiB4Mj0iNzA5IiB5Mj0iNTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTEiIHgyPSI3MDkiIHkyPSI1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0OCIgeDI9IjcwOSIgeTI9IjQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ0IiB4Mj0iNzA5IiB5Mj0iNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDAiIHgyPSI3MDkiIHkyPSI0MCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTA5IiB5MT0iMzQ5IiB4Mj0iMTA5IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxOCIgeTE9IjM0OSIgeDI9IjIxOCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjciIHkxPSIzNDkiIHgyPSIzMjciIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDM2IiB5MT0iMzQ5IiB4Mj0iNDM2IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU0NSIgeTE9IjM0OSIgeDI9IjU0NSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTQiIHkxPSIzNDkiIHgyPSI2NTQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNDkiIHgyPSI3MDkiIHkyPSIzNDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzExIiB4Mj0iNzA5IiB5Mj0iMzExIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MyIgeDI9IjcwOSIgeTI9IjI3MyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzUiIHgyPSI3MDkiIHkyPSIyMzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTk3IiB4Mj0iNzA5IiB5Mj0iMTk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1OCIgeDI9IjcwOSIgeTI9IjE1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjAiIHgyPSI3MDkiIHkyPSIxMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODIiIHgyPSI3MDkiIHkyPSI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0NCIgeDI9IjcwOSIgeTI9IjQ0Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNiA1NCwzNDkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzNDkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzNDkgNTQsMzQ5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMzExIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzExIDU0LDMxMSAiLz4KPHRleHQgeD0iNDUiIHk9IjI3MyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyNzMgNTQsMjczICIvPgo8dGV4dCB4PSI0NSIgeT0iMjM1IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDIzNSA1NCwyMzUgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxOTciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTk3IDU0LDE5NyAiLz4KPHRleHQgeD0iNDUiIHk9IjE1OCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjUuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNTggNTQsMTU4ICIvPgo8dGV4dCB4PSI0NSIgeT0iMTIwIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDEyMCA1NCwxMjAgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI4MiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMzUuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw4MiA1NCw4MiAiLz4KPHRleHQgeD0iNDUiIHk9IjQ0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDQ0IDU0LDQ0ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzUwIDcwOSwzNTAgIi8+Cjx0ZXh0IHg9IjEwOSIgeT0iMzYwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC01MAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxMDksMzUwIDEwOSwzNTUgIi8+Cjx0ZXh0IHg9IjIxOCIgeT0iMzYwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNTAtMTAwCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjIxOCwzNTAgMjE4LDM1NSAiLz4KPHRleHQgeD0iMzI3IiB5PSIzNjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMDAtMTUwCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjMyNywzNTAgMzI3LDM1NSAiLz4KPHRleHQgeD0iNDM2IiB5PSIzNjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxNTAtMjAwCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQzNiwzNTAgNDM2LDM1NSAiLz4KPHRleHQgeD0iNTQ1IiB5PSIzNjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMDAtMzAwCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0NSwzNTAgNTQ1LDM1NSAiLz4KPHRleHQgeD0iNjU0IiB5PSIzNjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozMDArCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY1NCwzNTAgNjU0LDM1NSAiLz4KPHJlY3QgeD0iNzEiIHk9Ijk5IiB3aWR0aD0iNzYiIGhlaWdodD0iMjUwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTgwIiB5PSIxMzUiIHdpZHRoPSI3NiIgaGVpZ2h0PSIyMTQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyODkiIHk9IjE3MiIgd2lkdGg9Ijc2IiBoZWlnaHQ9IjE3NyIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjM5OCIgeT0iMjA3IiB3aWR0aD0iNzYiIGhlaWdodD0iMTQyIiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNTA3IiB5PSIyNTIiIHdpZHRoPSI3NiIgaGVpZ2h0PSI5NyIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYxNiIgeT0iMjk3IiB3aWR0aD0iNzYiIGhlaWdodD0iNTIiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

## Findings

The Elo sweep over **301,353 matches** confirms the obvious and reveals the
interesting: **upset win rate falls monotonically with the rating gap** — from
32.8% when teams are near-equals to just 6.9% when the underdog is 300+ Elo
points worse.

| Elo gap | Underdog games | Upset win% |
| ------- | -------------- | ---------- |
| 0–50    | 122,678        | 32.8%      |
| 50–100  | 84,443         | 28.1%      |
| 100–150 | 44,951         | 23.2%      |
| 150–200 | 22,066         | 18.6%      |
| 200–300 | 17,491         | 12.8%      |
| 300+    | 5,629          | 6.9%       |

But the real giants aren't the minnows — they're **elite teams in their down
cycles**. Ranking by _overperformance vs Elo expectation_ (min. 20 games as
underdog):

- **Bayer Leverkusen +5.6** — 13 upset wins vs ~7.4 expected
- **Manchester City +4.5**, **West Ham United +4.4**
- **Manchester United +2.7**, **Athletic Bilbao +2.6**, **Barcelona +2.5**

These are teams that were temporarily "weaker" on paper — new signings,
injuries, a rebuild year — and repeatedly proved the ratings wrong. True minnows
almost never crack the top-15: beating a team 300 Elo better happens just 6.9%
of the time, full stop.
