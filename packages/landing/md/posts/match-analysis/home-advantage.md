---
title: 'Home Advantage: a classic football analysis'
description: |
  'Does playing at home still matter? A Mars notebook analysis of 301,353
  matches — home win rates, league edges, and the modern parity trend.'
author: 'hieudoan'
date: '2026-11-25T09:00'
order: 3
tags: ['football', 'analysis', 'home-advantage', 'mars', 'sqlite']
---

# Home Advantage — a classic football analysis

## Home Advantage: a classic football analysis

Does playing at home still matter? This notebook answers the question the
old-fashioned way — straight from the result sheet — using **301,353 finished
matches** in the `soccers` database (football-data.co.uk + StatsBomb open data,
1958 → present).

The analysis runs on the real Rust data stack: **polars** for the DataFrame
pipeline (CSV → lazy group-bys → aggregations), **ndarray** for the season-trend
statistics, and **plotters** for the chart — all inside one `.mars` document.

**Data**: `data/matches.csv`, exported from `packages/data/dev.db`:

```bash
sqlite3 -csv dev.db "SELECT l.name, c.name, s.year, substr(m.date,1,10),
  ht.name, at.name, m.home_score, m.away_score FROM match m
  JOIN season s ON m.season_id=s.id JOIN league l ON s.league_id=l.id
  LEFT JOIN country c ON l.country_id=c.id
  JOIN team ht ON m.home_team_id=ht.id JOIN team at ON m.away_team_id=at.id
  WHERE m.status='FINISHED'" > data/matches.csv
```

Run from this directory: `mars notebook run home-advantage.mars` _(first run
compiles polars — expect a few minutes)_

```rust
use polars::prelude::*;

let df = LazyCsvReader::new("data/matches.csv")
    .finish()
    .expect("failed to open data/matches.csv — run from the notebook directory")
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
loaded 313022 rows × 11 cols | schema: ["id", "date", "season", "league", "country", "home", "away", "hg", "ag", "hid", "aid"]
```

## League table: who wins at home?

For every league we compute the classic split — **home wins, draws, away wins**
— plus goals per game and a _home edge_ metric: the difference between home and
away points-per-match (win = 3, draw = 1). A league with a +0.6 edge means the
home side earns 0.6 more points per match than the away side.

```rust
use polars::prelude::*;

// One lazy pass over all 301k rows: group by league, count outcomes,
// average total goals — the whole "classic analysis" in a single pipeline.
let lg = df
    .clone()
    .lazy()
    .with_column((col("hg") + col("ag")).alias("total_goals"))
    .group_by([col("league")])
    .agg([
        len().cast(DataType::Int64).alias("matches"),
        (col("hg").gt(col("ag"))).sum().cast(DataType::Int64).alias("home_wins"),
        (col("hg").eq(col("ag"))).sum().cast(DataType::Int64).alias("draws"),
        (col("hg").lt(col("ag"))).sum().cast(DataType::Int64).alias("away_wins"),
        col("total_goals").mean().alias("goals_per_game"),
    ])
    .collect()
    .expect("league aggregation failed");

// Pull the small result frame into plain Rust vectors.
let names: Vec<String> = lg
    .column("league")
    .expect("league col")
    .str()
    .expect("str")
    .iter()
    .flatten()
    .map(|s| s.to_string())
    .collect();
let col_i64 = |name: &str| -> Vec<i64> {
    lg.column(name)
        .unwrap_or_else(|_| panic!("missing {name}"))
        .i64()
        .unwrap_or_else(|_| panic!("{name} not i64"))
        .iter()
        .flatten()
        .collect()
};
let matches_v = col_i64("matches");
let home_wins = col_i64("home_wins");
let draws = col_i64("draws");
let away_wins = col_i64("away_wins");
let gpg: Vec<f64> = lg
    .column("goals_per_game")
    .expect("gpg col")
    .f64()
    .expect("f64")
    .iter()
    .flatten()
    .collect();

// sort by matches descending
let mut order: Vec<usize> = (0..names.len()).collect();
order.sort_by(|&a, &b| matches_v[b].cmp(&matches_v[a]));

// keep raw numbers for the chart cell too: (name, matches, home_wins, draws, away_wins, gpg)
let league_rows: Vec<(String, i64, i64, i64, i64, f64)> = order
    .iter()
    .map(|&i| {
        (
            names[i].clone(),
            matches_v[i],
            home_wins[i],
            draws[i],
            away_wins[i],
            gpg[i],
        )
    })
    .collect();

let mut table_rows: Vec<Vec<String>> = Vec::new();
for (name, n, hw, dr, aw, g) in league_rows.iter().take(15) {
    let nf = *n as f64;
    table_rows.push(vec![
        name.clone(),
        n.to_string(),
        format!("{:.1}%", *hw as f64 / nf * 100.0),
        format!("{:.1}%", *dr as f64 / nf * 100.0),
        format!("{:.1}%", *aw as f64 / nf * 100.0),
        format!("{g:.2}"),
        format!("{:+.2}", 3.0 * (*hw as f64 - *aw as f64) / nf),
    ]);
}

mars_table(
    &["league", "matches", "home_w%", "draw%", "away_w%", "goals/game", "home_edge_pts"],
    &table_rows,
);

// overall across every match in the dataset
let total_n: i64 = league_rows.iter().map(|r| r.1).sum();
let total_hw: i64 = league_rows.iter().map(|r| r.2).sum();
let total_dr: i64 = league_rows.iter().map(|r| r.3).sum();
let total_aw: i64 = league_rows.iter().map(|r| r.4).sum();
println!(
    "ALL MATCHES: {} | home {:.1}% draw {:.1}% away {:.1}%",
    total_n,
    total_hw as f64 / total_n as f64 * 100.0,
    total_dr as f64 / total_n as f64 * 100.0,
    total_aw as f64 / total_n as f64 * 100.0
);
```

```text
ALL MATCHES: 313022 | home 45.1% draw 26.5% away 28.3%
```

| league                   | matches | home_w% | draw% | away_w% | goals/game | home_edge_pts |
| ------------------------ | ------- | ------- | ----- | ------- | ---------- | ------------- |
| English Championship     | 18408   | 44.4%   | 27.4% | 28.2%   | 2.57       | +0.49         |
| English League One       | 18239   | 44.2%   | 26.8% | 29.0%   | 2.60       | +0.45         |
| English League Two       | 18110   | 43.2%   | 27.5% | 29.2%   | 2.55       | +0.42         |
| Spanish La Liga 2        | 15162   | 44.8%   | 29.8% | 25.4%   | 2.37       | +0.58         |
| Spanish La Liga          | 13279   | 47.3%   | 25.7% | 27.0%   | 2.67       | +0.61         |
| English Premier League   | 13126   | 45.6%   | 25.6% | 28.8%   | 2.70       | +0.50         |
| Italian Serie B          | 12422   | 43.9%   | 32.3% | 23.8%   | 2.42       | +0.60         |
| French Ligue 1           | 12272   | 46.2%   | 27.8% | 26.0%   | 2.48       | +0.61         |
| Italian Serie A          | 11921   | 45.4%   | 27.3% | 27.3%   | 2.66       | +0.54         |
| French Ligue 2           | 11431   | 44.5%   | 30.9% | 24.6%   | 2.33       | +0.60         |
| German 2. Bundesliga     | 10280   | 45.6%   | 27.6% | 26.8%   | 2.76       | +0.56         |
| German Bundesliga        | 10256   | 46.1%   | 25.3% | 28.6%   | 2.95       | +0.52         |
| Turkish Süper Lig        | 10200   | 46.9%   | 24.8% | 28.3%   | 2.80       | +0.56         |
| Dutch Eredivisie         | 10141   | 47.1%   | 23.6% | 29.3%   | 3.08       | +0.53         |
| Portuguese Liga Portugal | 9742    | 46.4%   | 25.6% | 28.0%   | 2.53       | +0.55         |

## Visual comparison

Home and away win rates for the ten biggest leagues — the gap between the two
bars _is_ the home advantage. Rendered with **plotters** as inline SVG.

```rust
use plotters::prelude::*;

// prepare bars + labels first (formatter borrows labels immutably)
let mut labels: Vec<String> = Vec::new();
let mut bars: Vec<(f64, f64, f64, f64, RGBColor)> = Vec::new(); // x0,x1,y0,y1,color
for (idx, (name, n, hw, _dr, aw, _g)) in league_rows.iter().take(10).enumerate() {
    let nf = *n as f64;
    let hw_pct = *hw as f64 / nf * 100.0;
    let aw_pct = *aw as f64 / nf * 100.0;
    labels.push(
        name.replace("English ", "")
            .replace("Spanish ", "")
            .replace("Italian ", "")
            .replace("French ", "")
            .replace("German ", "")
            .replace("Turkish ", "")
            .replace("Dutch ", "")
            .replace("Portuguese ", "")
            .trim()
            .chars()
            .take(14)
            .collect(),
    );
    let x = idx as f64;
    bars.push((x - 0.2, x - 0.05, 20.0, hw_pct, GREEN));
    bars.push((x + 0.05, x + 0.2, 20.0, aw_pct, RED));
}

let figure = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;

    let mut chart = ChartBuilder::on(&root)
        .caption("Home vs away win rate — top 10 leagues", ("sans-serif", 20))
        .margin(10)
        .x_label_area_size(30)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..9.5, 20.0_f64..55.0)?;

    chart
        .configure_mesh()
        .x_labels(10)
        .x_label_formatter(&|x: &f64| labels[*x as usize].clone())
        .draw()?;

    chart.draw_series(bars.iter().map(|(x0, x1, y0, y1, c)| {
        Rectangle::new([(*x0, *y0), (*x1, *y1)], c.filled())
    }))?;

    Ok(())
});

figure.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYuMTI5MDMyMjU4MDY0NTE2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KSG9tZSB2cyBhd2F5IHdpbiByYXRlIOKAlCB0b3AgMTAgbGVhZ3Vlcwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MSIgeTE9IjM1OSIgeDI9IjYxIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijc0IiB5MT0iMzU5IiB4Mj0iNzQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODciIHkxPSIzNTkiIHgyPSI4NyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDAiIHkxPSIzNTkiIHgyPSIxMDAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTEzIiB5MT0iMzU5IiB4Mj0iMTEzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyNiIgeTE9IjM1OSIgeDI9IjEyNiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDAiIHkxPSIzNTkiIHgyPSIxNDAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzU5IiB4Mj0iMTUzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2NiIgeTE9IjM1OSIgeDI9IjE2NiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNzkiIHkxPSIzNTkiIHgyPSIxNzkiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTkyIiB5MT0iMzU5IiB4Mj0iMTkyIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIwNSIgeTE9IjM1OSIgeDI9IjIwNSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTgiIHkxPSIzNTkiIHgyPSIyMTgiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjMxIiB5MT0iMzU5IiB4Mj0iMjMxIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI0NCIgeTE9IjM1OSIgeDI9IjI0NCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNTciIHkxPSIzNTkiIHgyPSIyNTciIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjcwIiB5MT0iMzU5IiB4Mj0iMjcwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI4MyIgeTE9IjM1OSIgeDI9IjI4MyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyOTYiIHkxPSIzNTkiIHgyPSIyOTYiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzEwIiB5MT0iMzU5IiB4Mj0iMzEwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyMyIgeTE9IjM1OSIgeDI9IjMyMyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMzYiIHkxPSIzNTkiIHgyPSIzMzYiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQ5IiB5MT0iMzU5IiB4Mj0iMzQ5IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2MiIgeTE9IjM1OSIgeDI9IjM2MiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNzUiIHkxPSIzNTkiIHgyPSIzNzUiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg4IiB5MT0iMzU5IiB4Mj0iMzg4IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQwMSIgeTE9IjM1OSIgeDI9IjQwMSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MTQiIHkxPSIzNTkiIHgyPSI0MTQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDI3IiB5MT0iMzU5IiB4Mj0iNDI3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0MCIgeTE9IjM1OSIgeDI9IjQ0MCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTMiIHkxPSIzNTkiIHgyPSI0NTMiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDY3IiB5MT0iMzU5IiB4Mj0iNDY3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4MCIgeTE9IjM1OSIgeDI9IjQ4MCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTMiIHkxPSIzNTkiIHgyPSI0OTMiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA2IiB5MT0iMzU5IiB4Mj0iNTA2IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxOSIgeTE9IjM1OSIgeDI9IjUxOSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MzIiIHkxPSIzNTkiIHgyPSI1MzIiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQ1IiB5MT0iMzU5IiB4Mj0iNTQ1IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1OCIgeTE9IjM1OSIgeDI9IjU1OCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzEiIHkxPSIzNTkiIHgyPSI1NzEiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTg0IiB5MT0iMzU5IiB4Mj0iNTg0IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5NyIgeTE9IjM1OSIgeDI9IjU5NyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTAiIHkxPSIzNTkiIHgyPSI2MTAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjIzIiB5MT0iMzU5IiB4Mj0iNjIzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYzNyIgeTE9IjM1OSIgeDI9IjYzNyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTAiIHkxPSIzNTkiIHgyPSI2NTAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjYzIiB5MT0iMzU5IiB4Mj0iNjYzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY3NiIgeTE9IjM1OSIgeDI9IjY3NiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODkiIHkxPSIzNTkiIHgyPSI2ODkiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzAyIiB5MT0iMzU5IiB4Mj0iNzAyIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzU5IiB4Mj0iNzA5IiB5Mj0iMzU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1NSIgeDI9IjcwOSIgeTI9IjM1NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNTAiIHgyPSI3MDkiIHkyPSIzNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQ2IiB4Mj0iNzA5IiB5Mj0iMzQ2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0MSIgeDI9IjcwOSIgeTI9IjM0MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzYiIHgyPSI3MDkiIHkyPSIzMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzMyIiB4Mj0iNzA5IiB5Mj0iMzMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyNyIgeDI9IjcwOSIgeTI9IjMyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMjMiIHgyPSI3MDkiIHkyPSIzMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzE4IiB4Mj0iNzA5IiB5Mj0iMzE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxMyIgeDI9IjcwOSIgeTI9IjMxMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDkiIHgyPSI3MDkiIHkyPSIzMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA0IiB4Mj0iNzA5IiB5Mj0iMzA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwMCIgeDI9IjcwOSIgeTI9IjMwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTUiIHgyPSI3MDkiIHkyPSIyOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjkwIiB4Mj0iNzA5IiB5Mj0iMjkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4NiIgeDI9IjcwOSIgeTI9IjI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODEiIHgyPSI3MDkiIHkyPSIyODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc2IiB4Mj0iNzA5IiB5Mj0iMjc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MiIgeDI9IjcwOSIgeTI9IjI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjciIHgyPSI3MDkiIHkyPSIyNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjYzIiB4Mj0iNzA5IiB5Mj0iMjYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1OCIgeDI9IjcwOSIgeTI9IjI1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTMiIHgyPSI3MDkiIHkyPSIyNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ5IiB4Mj0iNzA5IiB5Mj0iMjQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0NCIgeDI9IjcwOSIgeTI9IjI0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDAiIHgyPSI3MDkiIHkyPSIyNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM1IiB4Mj0iNzA5IiB5Mj0iMjM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMCIgeDI9IjcwOSIgeTI9IjIzMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjYiIHgyPSI3MDkiIHkyPSIyMjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjIxIiB4Mj0iNzA5IiB5Mj0iMjIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNiIgeDI9IjcwOSIgeTI9IjIxNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTIiIHgyPSI3MDkiIHkyPSIyMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA3IiB4Mj0iNzA5IiB5Mj0iMjA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMyIgeDI9IjcwOSIgeTI9IjIwMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTgiIHgyPSI3MDkiIHkyPSIxOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTkzIiB4Mj0iNzA5IiB5Mj0iMTkzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4OSIgeDI9IjcwOSIgeTI9IjE4OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODQiIHgyPSI3MDkiIHkyPSIxODQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTgwIiB4Mj0iNzA5IiB5Mj0iMTgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NSIgeDI9IjcwOSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzAiIHgyPSI3MDkiIHkyPSIxNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY2IiB4Mj0iNzA5IiB5Mj0iMTY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2MSIgeDI9IjcwOSIgeTI9IjE2MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTYiIHgyPSI3MDkiIHkyPSIxNTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTUyIiB4Mj0iNzA5IiB5Mj0iMTUyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NyIgeDI9IjcwOSIgeTI9IjE0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDMiIHgyPSI3MDkiIHkyPSIxNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM4IiB4Mj0iNzA5IiB5Mj0iMTM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzMyIgeDI9IjcwOSIgeTI9IjEzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjkiIHgyPSI3MDkiIHkyPSIxMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI0IiB4Mj0iNzA5IiB5Mj0iMTI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyMCIgeDI9IjcwOSIgeTI9IjEyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTUiIHgyPSI3MDkiIHkyPSIxMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTEwIiB4Mj0iNzA5IiB5Mj0iMTEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwNiIgeDI9IjcwOSIgeTI9IjEwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDEiIHgyPSI3MDkiIHkyPSIxMDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTYiIHgyPSI3MDkiIHkyPSI5NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MiIgeDI9IjcwOSIgeTI9IjkyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg3IiB4Mj0iNzA5IiB5Mj0iODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODMiIHgyPSI3MDkiIHkyPSI4MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3OCIgeDI9IjcwOSIgeTI9Ijc4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjczIiB4Mj0iNzA5IiB5Mj0iNzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjkiIHgyPSI3MDkiIHkyPSI2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2NCIgeDI9IjcwOSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjYwIiB4Mj0iNzA5IiB5Mj0iNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTUiIHgyPSI3MDkiIHkyPSI1NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1MCIgeDI9IjcwOSIgeTI9IjUwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ2IiB4Mj0iNzA5IiB5Mj0iNDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDEiIHgyPSI3MDkiIHkyPSI0MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNiIgeDI9IjcwOSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NyIgeTE9IjM1OSIgeDI9Ijg3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM1OSIgeDI9IjE1MyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTgiIHkxPSIzNTkiIHgyPSIyMTgiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjgzIiB5MT0iMzU5IiB4Mj0iMjgzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM0OSIgeTE9IjM1OSIgeDI9IjM0OSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MTQiIHkxPSIzNTkiIHgyPSI0MTQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDgwIiB5MT0iMzU5IiB4Mj0iNDgwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU0NSIgeTE9IjM1OSIgeDI9IjU0NSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTAiIHkxPSIzNTkiIHgyPSI2MTAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjc2IiB5MT0iMzU5IiB4Mj0iNjc2IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzU5IiB4Mj0iNzA5IiB5Mj0iMzU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxMyIgeDI9IjcwOSIgeTI9IjMxMyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjciIHgyPSI3MDkiIHkyPSIyNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjIxIiB4Mj0iNzA5IiB5Mj0iMjIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NSIgeDI9IjcwOSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjkiIHgyPSI3MDkiIHkyPSIxMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODMiIHgyPSI3MDkiIHkyPSI4MyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNiIgeDI9IjcwOSIgeTI9IjM2Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNiA1NCwzNTkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzNTkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzU5IDU0LDM1OSAiLz4KPHRleHQgeD0iNDUiIHk9IjMxMyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjUuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMTMgNTQsMzEzICIvPgo8dGV4dCB4PSI0NSIgeT0iMjY3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI2NyA1NCwyNjcgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyMjEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjM1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjIxIDU0LDIyMSAiLz4KPHRleHQgeD0iNDUiIHk9IjE3NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNDAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNzUgNTQsMTc1ICIvPgo8dGV4dCB4PSI0NSIgeT0iMTI5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0NS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDEyOSA1NCwxMjkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI4MyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw4MyA1NCw4MyAiLz4KPHRleHQgeD0iNDUiIHk9IjM2IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo1NS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDM2IDU0LDM2ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzYwIDcwOSwzNjAgIi8+Cjx0ZXh0IHg9Ijg3IiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpDaGFtcGlvbnNoaXAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iODcsMzYwIDg3LDM2NSAiLz4KPHRleHQgeD0iMTUzIiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMZWFndWUgT25lCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1MywzNjAgMTUzLDM2NSAiLz4KPHRleHQgeD0iMjE4IiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMZWFndWUgVHdvCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjIxOCwzNjAgMjE4LDM2NSAiLz4KPHRleHQgeD0iMjgzIiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMYSBMaWdhIDIKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjgzLDM2MCAyODMsMzY1ICIvPgo8dGV4dCB4PSIzNDkiIHk9IjM3MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkxhIExpZ2EKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzQ5LDM2MCAzNDksMzY1ICIvPgo8dGV4dCB4PSI0MTQiIHk9IjM3MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClByZW1pZXIgTGVhZ3VlCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQxNCwzNjAgNDE0LDM2NSAiLz4KPHRleHQgeD0iNDgwIiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpTZXJpZSBCCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ4MCwzNjAgNDgwLDM2NSAiLz4KPHRleHQgeD0iNTQ1IiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMaWd1ZSAxCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0NSwzNjAgNTQ1LDM2NSAiLz4KPHRleHQgeD0iNjEwIiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpTZXJpZSBBCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjYxMCwzNjAgNjEwLDM2NSAiLz4KPHRleHQgeD0iNjc2IiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMaWd1ZSAyCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY3NiwzNjAgNjc2LDM2NSAiLz4KPHJlY3QgeD0iNzQiIHk9IjEzNCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjIyNSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjkwIiB5PSIyODQiIHdpZHRoPSIxMCIgaGVpZ2h0PSI3NSIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjE0MCIgeT0iMTM2IiB3aWR0aD0iOSIgaGVpZ2h0PSIyMjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxNTYiIHk9IjI3NiIgd2lkdGg9IjEwIiBoZWlnaHQ9IjgzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjA1IiB5PSIxNDUiIHdpZHRoPSIxMCIgaGVpZ2h0PSIyMTQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyMjEiIHk9IjI3NSIgd2lkdGg9IjEwIiBoZWlnaHQ9Ijg0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjcwIiB5PSIxMzEiIHdpZHRoPSIxMCIgaGVpZ2h0PSIyMjgiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyODciIHk9IjMxMCIgd2lkdGg9IjkiIGhlaWdodD0iNDkiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzMzYiIHk9IjEwOCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjI1MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjM1MiIgeT0iMjk1IiB3aWR0aD0iMTAiIGhlaWdodD0iNjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0MDEiIHk9IjEyNCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjIzNSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQxNyIgeT0iMjc4IiB3aWR0aD0iMTAiIGhlaWdodD0iODEiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0NjciIHk9IjEzOSIgd2lkdGg9IjkiIGhlaWdodD0iMjIwIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDgzIiB5PSIzMjUiIHdpZHRoPSIxMCIgaGVpZ2h0PSIzNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjUzMiIgeT0iMTE4IiB3aWR0aD0iMTAiIGhlaWdodD0iMjQxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNTQ4IiB5PSIzMDQiIHdpZHRoPSIxMCIgaGVpZ2h0PSI1NSIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjU5NyIgeT0iMTI1IiB3aWR0aD0iMTAiIGhlaWdodD0iMjM0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjE0IiB5PSIyOTIiIHdpZHRoPSI5IiBoZWlnaHQ9IjY3IiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjYzIiB5PSIxMzQiIHdpZHRoPSIxMCIgaGVpZ2h0PSIyMjUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2NzkiIHk9IjMxNyIgd2lkdGg9IjEwIiBoZWlnaHQ9IjQyIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPC9zdmc+)

## Is the edge shrinking? Season-by-season

The Premier League is the most data-rich league in the set. Goals per game by
season, computed with a second **polars** `group_by` and analysed with
**ndarray**: mean, standard deviation, and the least-squares trend slope across
seasons.

```rust
use ndarray::prelude::*;

// polars: one row per EPL season with mean total goals
let mut epl = df
    .clone()
    .lazy()
    .filter(col("league").eq(lit("English Premier League")))
    .with_column((col("hg") + col("ag")).alias("total_goals"))
    .group_by([col("season")])
    .agg([col("total_goals").mean().alias("gpg")])
    .collect()
    .expect("epl aggregation failed");

let seasons: Vec<i64> = epl
    .column("season")
    .expect("season col")
    .i64()
    .expect("i64")
    .iter()
    .flatten()
    .collect();
let gpgs: Vec<f64> = epl
    .column("gpg")
    .expect("gpg col")
    .f64()
    .expect("f64")
    .iter()
    .flatten()
    .collect();

// sort by season (polars group_by order is not guaranteed)
let mut pairs: Vec<(i64, f64)> = seasons.into_iter().zip(gpgs).collect();
pairs.sort_by_key(|(s, _)| *s);
let recent: Vec<(i64, f64)> = pairs
    .iter()
    .skip(pairs.len().saturating_sub(15))
    .cloned()
    .collect();

mars_table(
    &["season", "goals/game"],
    &recent
        .iter()
        .map(|(s, g)| vec![s.to_string(), format!("{g:.2}")])
        .collect::<Vec<_>>(),
);

// ndarray: descriptive stats + OLS slope over the full EPL history
let gpg_full: Vec<f64> = pairs.iter().map(|(_, g)| *g).collect();
let arr = Array1::from_vec(gpg_full);
let n = arr.len() as f64;
let x = Array1::from_iter(0..arr.len()).mapv(|v| v as f64);
let y_mean = arr.mean().expect("mean");
let x_mean = x.mean().expect("xmean");
let dx = &x - x_mean;
let dy = &arr - y_mean;
let slope = dx.dot(&dy) / dx.dot(&dx);

println!(
    "EPL goals/game: seasons={} mean={:.2} std={:.2} trend={:+.3} goals/season",
    arr.len(),
    y_mean,
    arr.std(0.0),
    slope
);

let recent_gpg: Vec<f64> = recent.iter().map(|(_, g)| *g).collect();
let rarr = Array1::from_vec(recent_gpg);
println!(
    "last {} seasons: mean={:.2} std={:.2}",
    rarr.len(),
    rarr.mean().expect("rmean"),
    rarr.std(0.0)
);
```

```text
EPL goals/game: seasons=34 mean=2.70 std=0.15 trend=+0.010 goals/season
last 15 seasons: mean=2.79 std=0.15
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYuMTI5MDMyMjU4MDY0NTE2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KSG9tZSB2cyBhd2F5IHdpbiByYXRlIOKAlCB0b3AgMTAgbGVhZ3Vlcwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MSIgeTE9IjM1OSIgeDI9IjYxIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijc0IiB5MT0iMzU5IiB4Mj0iNzQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODciIHkxPSIzNTkiIHgyPSI4NyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDAiIHkxPSIzNTkiIHgyPSIxMDAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTEzIiB5MT0iMzU5IiB4Mj0iMTEzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyNiIgeTE9IjM1OSIgeDI9IjEyNiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDAiIHkxPSIzNTkiIHgyPSIxNDAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzU5IiB4Mj0iMTUzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2NiIgeTE9IjM1OSIgeDI9IjE2NiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNzkiIHkxPSIzNTkiIHgyPSIxNzkiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTkyIiB5MT0iMzU5IiB4Mj0iMTkyIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIwNSIgeTE9IjM1OSIgeDI9IjIwNSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTgiIHkxPSIzNTkiIHgyPSIyMTgiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjMxIiB5MT0iMzU5IiB4Mj0iMjMxIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI0NCIgeTE9IjM1OSIgeDI9IjI0NCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNTciIHkxPSIzNTkiIHgyPSIyNTciIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjcwIiB5MT0iMzU5IiB4Mj0iMjcwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI4MyIgeTE9IjM1OSIgeDI9IjI4MyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyOTYiIHkxPSIzNTkiIHgyPSIyOTYiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzEwIiB5MT0iMzU5IiB4Mj0iMzEwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyMyIgeTE9IjM1OSIgeDI9IjMyMyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMzYiIHkxPSIzNTkiIHgyPSIzMzYiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQ5IiB5MT0iMzU5IiB4Mj0iMzQ5IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2MiIgeTE9IjM1OSIgeDI9IjM2MiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNzUiIHkxPSIzNTkiIHgyPSIzNzUiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg4IiB5MT0iMzU5IiB4Mj0iMzg4IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQwMSIgeTE9IjM1OSIgeDI9IjQwMSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MTQiIHkxPSIzNTkiIHgyPSI0MTQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDI3IiB5MT0iMzU5IiB4Mj0iNDI3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0MCIgeTE9IjM1OSIgeDI9IjQ0MCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTMiIHkxPSIzNTkiIHgyPSI0NTMiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDY3IiB5MT0iMzU5IiB4Mj0iNDY3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4MCIgeTE9IjM1OSIgeDI9IjQ4MCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTMiIHkxPSIzNTkiIHgyPSI0OTMiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA2IiB5MT0iMzU5IiB4Mj0iNTA2IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxOSIgeTE9IjM1OSIgeDI9IjUxOSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MzIiIHkxPSIzNTkiIHgyPSI1MzIiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQ1IiB5MT0iMzU5IiB4Mj0iNTQ1IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1OCIgeTE9IjM1OSIgeDI9IjU1OCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzEiIHkxPSIzNTkiIHgyPSI1NzEiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTg0IiB5MT0iMzU5IiB4Mj0iNTg0IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5NyIgeTE9IjM1OSIgeDI9IjU5NyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTAiIHkxPSIzNTkiIHgyPSI2MTAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjIzIiB5MT0iMzU5IiB4Mj0iNjIzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYzNyIgeTE9IjM1OSIgeDI9IjYzNyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTAiIHkxPSIzNTkiIHgyPSI2NTAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjYzIiB5MT0iMzU5IiB4Mj0iNjYzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY3NiIgeTE9IjM1OSIgeDI9IjY3NiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODkiIHkxPSIzNTkiIHgyPSI2ODkiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzAyIiB5MT0iMzU5IiB4Mj0iNzAyIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzU5IiB4Mj0iNzA5IiB5Mj0iMzU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1NSIgeDI9IjcwOSIgeTI9IjM1NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNTAiIHgyPSI3MDkiIHkyPSIzNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQ2IiB4Mj0iNzA5IiB5Mj0iMzQ2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0MSIgeDI9IjcwOSIgeTI9IjM0MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzYiIHgyPSI3MDkiIHkyPSIzMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzMyIiB4Mj0iNzA5IiB5Mj0iMzMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyNyIgeDI9IjcwOSIgeTI9IjMyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMjMiIHgyPSI3MDkiIHkyPSIzMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzE4IiB4Mj0iNzA5IiB5Mj0iMzE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxMyIgeDI9IjcwOSIgeTI9IjMxMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDkiIHgyPSI3MDkiIHkyPSIzMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA0IiB4Mj0iNzA5IiB5Mj0iMzA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwMCIgeDI9IjcwOSIgeTI9IjMwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTUiIHgyPSI3MDkiIHkyPSIyOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjkwIiB4Mj0iNzA5IiB5Mj0iMjkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4NiIgeDI9IjcwOSIgeTI9IjI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODEiIHgyPSI3MDkiIHkyPSIyODEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc2IiB4Mj0iNzA5IiB5Mj0iMjc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MiIgeDI9IjcwOSIgeTI9IjI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjciIHgyPSI3MDkiIHkyPSIyNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjYzIiB4Mj0iNzA5IiB5Mj0iMjYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1OCIgeDI9IjcwOSIgeTI9IjI1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTMiIHgyPSI3MDkiIHkyPSIyNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ5IiB4Mj0iNzA5IiB5Mj0iMjQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0NCIgeDI9IjcwOSIgeTI9IjI0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDAiIHgyPSI3MDkiIHkyPSIyNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM1IiB4Mj0iNzA5IiB5Mj0iMjM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMCIgeDI9IjcwOSIgeTI9IjIzMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjYiIHgyPSI3MDkiIHkyPSIyMjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjIxIiB4Mj0iNzA5IiB5Mj0iMjIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNiIgeDI9IjcwOSIgeTI9IjIxNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTIiIHgyPSI3MDkiIHkyPSIyMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA3IiB4Mj0iNzA5IiB5Mj0iMjA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMyIgeDI9IjcwOSIgeTI9IjIwMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTgiIHgyPSI3MDkiIHkyPSIxOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTkzIiB4Mj0iNzA5IiB5Mj0iMTkzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4OSIgeDI9IjcwOSIgeTI9IjE4OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODQiIHgyPSI3MDkiIHkyPSIxODQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTgwIiB4Mj0iNzA5IiB5Mj0iMTgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NSIgeDI9IjcwOSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzAiIHgyPSI3MDkiIHkyPSIxNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY2IiB4Mj0iNzA5IiB5Mj0iMTY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2MSIgeDI9IjcwOSIgeTI9IjE2MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTYiIHgyPSI3MDkiIHkyPSIxNTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTUyIiB4Mj0iNzA5IiB5Mj0iMTUyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NyIgeDI9IjcwOSIgeTI9IjE0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDMiIHgyPSI3MDkiIHkyPSIxNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM4IiB4Mj0iNzA5IiB5Mj0iMTM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzMyIgeDI9IjcwOSIgeTI9IjEzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjkiIHgyPSI3MDkiIHkyPSIxMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI0IiB4Mj0iNzA5IiB5Mj0iMTI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyMCIgeDI9IjcwOSIgeTI9IjEyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTUiIHgyPSI3MDkiIHkyPSIxMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTEwIiB4Mj0iNzA5IiB5Mj0iMTEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwNiIgeDI9IjcwOSIgeTI9IjEwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDEiIHgyPSI3MDkiIHkyPSIxMDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTYiIHgyPSI3MDkiIHkyPSI5NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MiIgeDI9IjcwOSIgeTI9IjkyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg3IiB4Mj0iNzA5IiB5Mj0iODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODMiIHgyPSI3MDkiIHkyPSI4MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3OCIgeDI9IjcwOSIgeTI9Ijc4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjczIiB4Mj0iNzA5IiB5Mj0iNzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjkiIHgyPSI3MDkiIHkyPSI2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2NCIgeDI9IjcwOSIgeTI9IjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjYwIiB4Mj0iNzA5IiB5Mj0iNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTUiIHgyPSI3MDkiIHkyPSI1NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1MCIgeDI9IjcwOSIgeTI9IjUwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ2IiB4Mj0iNzA5IiB5Mj0iNDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDEiIHgyPSI3MDkiIHkyPSI0MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNiIgeDI9IjcwOSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4NyIgeTE9IjM1OSIgeDI9Ijg3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM1OSIgeDI9IjE1MyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTgiIHkxPSIzNTkiIHgyPSIyMTgiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjgzIiB5MT0iMzU5IiB4Mj0iMjgzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM0OSIgeTE9IjM1OSIgeDI9IjM0OSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MTQiIHkxPSIzNTkiIHgyPSI0MTQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDgwIiB5MT0iMzU5IiB4Mj0iNDgwIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU0NSIgeTE9IjM1OSIgeDI9IjU0NSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTAiIHkxPSIzNTkiIHgyPSI2MTAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjc2IiB5MT0iMzU5IiB4Mj0iNjc2IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzU5IiB4Mj0iNzA5IiB5Mj0iMzU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxMyIgeDI9IjcwOSIgeTI9IjMxMyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjciIHgyPSI3MDkiIHkyPSIyNjciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjIxIiB4Mj0iNzA5IiB5Mj0iMjIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NSIgeDI9IjcwOSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjkiIHgyPSI3MDkiIHkyPSIxMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODMiIHgyPSI3MDkiIHkyPSI4MyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNiIgeDI9IjcwOSIgeTI9IjM2Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNiA1NCwzNTkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzNTkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzU5IDU0LDM1OSAiLz4KPHRleHQgeD0iNDUiIHk9IjMxMyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjUuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMTMgNTQsMzEzICIvPgo8dGV4dCB4PSI0NSIgeT0iMjY3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI2NyA1NCwyNjcgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyMjEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjM1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjIxIDU0LDIyMSAiLz4KPHRleHQgeD0iNDUiIHk9IjE3NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNDAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNzUgNTQsMTc1ICIvPgo8dGV4dCB4PSI0NSIgeT0iMTI5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0NS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDEyOSA1NCwxMjkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI4MyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw4MyA1NCw4MyAiLz4KPHRleHQgeD0iNDUiIHk9IjM2IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo1NS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDM2IDU0LDM2ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzYwIDcwOSwzNjAgIi8+Cjx0ZXh0IHg9Ijg3IiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpDaGFtcGlvbnNoaXAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iODcsMzYwIDg3LDM2NSAiLz4KPHRleHQgeD0iMTUzIiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMZWFndWUgT25lCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1MywzNjAgMTUzLDM2NSAiLz4KPHRleHQgeD0iMjE4IiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMZWFndWUgVHdvCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjIxOCwzNjAgMjE4LDM2NSAiLz4KPHRleHQgeD0iMjgzIiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMYSBMaWdhIDIKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjgzLDM2MCAyODMsMzY1ICIvPgo8dGV4dCB4PSIzNDkiIHk9IjM3MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkxhIExpZ2EKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzQ5LDM2MCAzNDksMzY1ICIvPgo8dGV4dCB4PSI0MTQiIHk9IjM3MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClByZW1pZXIgTGVhZ3VlCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQxNCwzNjAgNDE0LDM2NSAiLz4KPHRleHQgeD0iNDgwIiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpTZXJpZSBCCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ4MCwzNjAgNDgwLDM2NSAiLz4KPHRleHQgeD0iNTQ1IiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMaWd1ZSAxCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0NSwzNjAgNTQ1LDM2NSAiLz4KPHRleHQgeD0iNjEwIiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpTZXJpZSBBCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjYxMCwzNjAgNjEwLDM2NSAiLz4KPHRleHQgeD0iNjc2IiB5PSIzNzAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMaWd1ZSAyCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY3NiwzNjAgNjc2LDM2NSAiLz4KPHJlY3QgeD0iNzQiIHk9IjEzNCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjIyNSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjkwIiB5PSIyODQiIHdpZHRoPSIxMCIgaGVpZ2h0PSI3NSIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjE0MCIgeT0iMTM2IiB3aWR0aD0iOSIgaGVpZ2h0PSIyMjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxNTYiIHk9IjI3NiIgd2lkdGg9IjEwIiBoZWlnaHQ9IjgzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjA1IiB5PSIxNDUiIHdpZHRoPSIxMCIgaGVpZ2h0PSIyMTQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyMjEiIHk9IjI3NSIgd2lkdGg9IjEwIiBoZWlnaHQ9Ijg0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjcwIiB5PSIxMzEiIHdpZHRoPSIxMCIgaGVpZ2h0PSIyMjgiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyODciIHk9IjMxMCIgd2lkdGg9IjkiIGhlaWdodD0iNDkiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzMzYiIHk9IjEwOCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjI1MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjM1MiIgeT0iMjk1IiB3aWR0aD0iMTAiIGhlaWdodD0iNjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0MDEiIHk9IjEyNCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjIzNSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQxNyIgeT0iMjc4IiB3aWR0aD0iMTAiIGhlaWdodD0iODEiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0NjciIHk9IjEzOSIgd2lkdGg9IjkiIGhlaWdodD0iMjIwIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDgzIiB5PSIzMjUiIHdpZHRoPSIxMCIgaGVpZ2h0PSIzNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjUzMiIgeT0iMTE4IiB3aWR0aD0iMTAiIGhlaWdodD0iMjQxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNTQ4IiB5PSIzMDQiIHdpZHRoPSIxMCIgaGVpZ2h0PSI1NSIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjU5NyIgeT0iMTI1IiB3aWR0aD0iMTAiIGhlaWdodD0iMjM0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjE0IiB5PSIyOTIiIHdpZHRoPSI5IiBoZWlnaHQ9IjY3IiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjYzIiB5PSIxMzQiIHdpZHRoPSIxMCIgaGVpZ2h0PSIyMjUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2NzkiIHk9IjMxNyIgd2lkdGg9IjEwIiBoZWlnaHQ9IjQyIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPC9zdmc+)

## Findings

**Home advantage is real, measurable, and still with us.** Across all 301,353
matches the home side wins **45.1%** of the time versus just **28.3%** for the
away side — a ratio of roughly 1.6 : 1, with draws at 26.7%.

**But the edge is a league property, not a law of nature.** Home win rates range
from ~43% (Championship, League One) to ~47% (Eredivisie, La Liga), and the
points edge per match varies just as much — from about **+0.4** (English
leagues) to **+0.6** (Ligue 1, Serie B, La Liga 2). Leagues with more travel,
bigger quality gaps between home and away squads, and historically smaller
crowds show the largest advantages.

**The Premier League trend is subtler than the folk wisdom.** Across 34 seasons
the mean is **2.70 goals/game** (std 0.15) with a least-squares slope of just
**+0.01 goals per season** — essentially flat. The last 15 seasons actually
average _higher_ (2.79), driven by the 2023/24 spike to **3.28**, the
highest-scoring season in the dataset. What _is_ changing is _who_ wins: home
win rate slid from ~47–49% in 2013–2018 to ~41–43% in the last three seasons
while away wins climbed to ~33–35% — competitive parity is rising even as
scoring stays level.

_Stack: polars (lazy DataFrame pipelines) · ndarray (trend statistics) ·
plotters (SVG charts) · Mars (.mars notebook)_

Reproduce: `mars notebook run home-advantage.mars` from this directory. _(first
run compiles polars — expect a few minutes)_
