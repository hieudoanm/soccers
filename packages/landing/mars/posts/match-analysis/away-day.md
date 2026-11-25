# The Away-Day Nightmare

## The Away-Day Nightmare

Is the away shirt really a curse? This notebook splits every team's record into
home and away halves across **301,353 finished matches** and asks three things:
who has the biggest home/away split, which leagues are harshest on visitors, and
whether playing away hurts _scoring_ more than it helps the opponent _scoring_.

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

## Home/away splits per team and per league

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
use std::collections::HashMap;

#[derive(Default, Clone)]
struct Split {
    h_played: u64, h_won: u64, h_drawn: u64, h_gf: i64, h_ga: i64,
    a_played: u64, a_won: u64, a_drawn: u64, a_gf: i64, a_ga: i64,
}

let mut splits: HashMap<i64, Split> = HashMap::new();
let mut names: HashMap<i64, String> = HashMap::new();
// league away stats: played, away wins, away goals for/against
let mut lg: HashMap<String, (u64, u64, i64, i64)> = HashMap::new();
// global home/away goal totals
let (mut gh_h, mut gh_a, mut gg_h, mut gg_a, mut gm) = (0i64, 0i64, 0i64, 0i64, 0u64);

for i in 0..n {
    if league_v[i].to_lowercase().contains("friend") { continue; }
    let (hg, ag) = (hg_v[i], ag_v[i]);
    names.entry(hid_v[i]).or_insert_with(|| home_v[i].clone());
    names.entry(aid_v[i]).or_insert_with(|| away_v[i].clone());
    let h_won = hg > ag;
    let a_won = ag > hg;
    let drew = hg == ag;

    let e = splits.entry(hid_v[i]).or_default();
    e.h_played += 1; e.h_gf += hg; e.h_ga += ag;
    if h_won { e.h_won += 1; } else if drew { e.h_drawn += 1; }

    let e = splits.entry(aid_v[i]).or_default();
    e.a_played += 1; e.a_gf += ag; e.a_ga += hg;
    if a_won { e.a_won += 1; } else if drew { e.a_drawn += 1; }

    let l = lg.entry(league_v[i].clone()).or_insert((0, 0, 0, 0));
    l.0 += 1;
    if a_won { l.1 += 1; }
    l.2 += ag; l.3 += hg;

    gh_h += hg; gh_a += ag; gg_h += ag; gg_a += hg; gm += 1;
}

println!("matches counted: {gm}");
println!("avg goals scored — home {:.2} vs away {:.2}", gh_h as f64 / gm as f64, gh_a as f64 / gm as f64);
println!("avg goals conceded — home {:.2} vs away {:.2}", gg_h as f64 / gm as f64, gg_a as f64 / gm as f64);

// biggest home/away win-rate gaps (min 40 games each side)
let mut gaps: Vec<(&i64, f64, f64, f64, f64)> = Vec::new();
for (tid, s) in &splits {
    if s.h_played >= 40 && s.a_played >= 40 {
        let hw = s.h_won as f64 / s.h_played as f64 * 100.0;
        let aw = s.a_won as f64 / s.a_played as f64 * 100.0;
        gaps.push((tid, hw - aw, hw, aw, (s.h_played + s.a_played) as f64));
    }
}
gaps.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
let gap_rows: Vec<Vec<String>> = gaps
    .iter()
    .take(15)
    .map(|(tid, gap, hw, aw, _)| {
        vec![
            names.get(*tid).cloned().unwrap_or_else(|| tid.to_string()),
            format!("{hw:.1}%"),
            format!("{aw:.1}%"),
            format!("{gap:+.1} pts"),
        ]
    })
    .collect();
mars_table(&["team", "home win%", "away win%", "gap"], &gap_rows);

// leagues hardest on away teams (min 300 matches)
let mut lrows: Vec<(String, f64, f64, f64, u64)> = Vec::new();
for (name, (p, w, gf, ga)) in &lg {
    if *p >= 300 {
        lrows.push((name.clone(), *w as f64 / *p as f64 * 100.0, *gf as f64 / *p as f64, *ga as f64 / *p as f64, *p));
    }
}
lrows.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
let ltable: Vec<Vec<String>> = lrows
    .iter()
    .take(15)
    .map(|(name, aw, gf, ga, p)| vec![name.clone(), format!("{aw:.1}%"), format!("{gf:.2}"), format!("{ga:.2}"), p.to_string()])
    .collect();
mars_table(&["league (hardest for away)", "away win%", "away GF/g", "away GA/g", "matches"], &ltable);
```

```text
loaded 301353 rows × 11 cols | schema: ["id", "country", "league", "season", "date", "hid", "aid", "home", "away", "hg", "ag"]
extracted 301353 matches
matches counted: 301353
avg goals scored — home 1.50 vs away 1.14
avg goals conceded — home 1.14 vs away 1.50
```

| team          | home win% | away win% | gap       |
| ------------- | --------- | --------- | --------- |
| Meppen        | 50.6%     | 12.6%     | +37.9 pts |
| Catania       | 50.2%     | 13.2%     | +37.0 pts |
| Panahaiki     | 45.6%     | 8.8%      | +36.8 pts |
| Mulhouse      | 45.2%     | 9.5%      | +35.7 pts |
| Mannheim      | 51.4%     | 15.9%     | +35.5 pts |
| Ponte Preta   | 48.4%     | 13.7%     | +34.7 pts |
| Zwickau       | 45.6%     | 11.8%     | +33.8 pts |
| Reutlingen    | 54.9%     | 21.6%     | +33.3 pts |
| Gutersloh     | 51.0%     | 17.6%     | +33.3 pts |
| Carrarese     | 44.4%     | 11.6%     | +32.8 pts |
| Kallonis      | 42.9%     | 10.2%     | +32.7 pts |
| Ancona        | 46.7%     | 14.8%     | +31.9 pts |
| FC Dallas     | 53.5%     | 21.6%     | +31.8 pts |
| Messina       | 43.9%     | 12.2%     | +31.7 pts |
| Columbus Crew | 56.0%     | 24.5%     | +31.5 pts |

| league (hardest for away) | away win% | away GF/g | away GA/g | matches |
| ------------------------- | --------- | --------- | --------- | ------- |
| Italian Serie B           | 23.8%     | 1.03      | 1.39      | 12422   |
| French Ligue 2            | 24.6%     | 0.98      | 1.35      | 11431   |
| Serie A                   | 24.7%     | 0.98      | 1.43      | 5678    |
| Spanish La Liga 2         | 25.4%     | 1.00      | 1.37      | 15162   |
| MLS                       | 25.6%     | 1.21      | 1.71      | 6335    |
| French Ligue 1            | 26.0%     | 1.03      | 1.45      | 12272   |
| Liga Profesional          | 26.3%     | 0.95      | 1.26      | 5564    |
| German 2. Bundesliga      | 26.8%     | 1.18      | 1.58      | 10280   |
| Greek Super League        | 26.8%     | 1.00      | 1.49      | 8058    |
| Spanish La Liga           | 27.0%     | 1.12      | 1.56      | 13279   |
| Italian Serie A           | 27.3%     | 1.14      | 1.51      | 11921   |
| Portuguese Liga Portugal  | 28.0%     | 1.08      | 1.45      | 9742    |
| English Championship      | 28.2%     | 1.11      | 1.46      | 18408   |
| Turkish Süper Lig         | 28.3%     | 1.20      | 1.60      | 10200   |
| Liga MX                   | 28.4%     | 1.16      | 1.51      | 4808    |

```rust
use plotters::prelude::*;

let mut labels6: Vec<String> = Vec::new();
let mut vals: Vec<f64> = Vec::new();
for (tid, gap, _hw, _aw, _t) in gaps.iter().take(12) {
    labels6.push(names.get(*tid).cloned().unwrap_or_default().chars().take(14).collect());
    vals.push(*gap);
}
let ymax6 = vals.iter().cloned().fold(1.0_f64, f64::max) * 1.2;
let n6 = vals.len();

let figure = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Home win% minus away win% — the biggest home/away splits", ("sans-serif", 16))
        .margin(10)
        .x_label_area_size(90)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n6 as f64 - 0.5), 0.0_f64..ymax6)?;
    chart.configure_mesh().x_labels(n6).x_label_formatter(&|x: &f64| {
        labels6.get(*x as usize).cloned().unwrap_or_default()
    }).draw()?;
    chart.draw_series((0..n6).map(|i| {
        Rectangle::new([(i as f64 - 0.35, 0.0), (i as f64 + 0.35, vals[i])], BLUE.filled())
    }))?;
    Ok(())
});
figure.evcxr_display();
```

```text
loaded 301353 rows × 11 cols | schema: ["id", "country", "league", "season", "date", "hid", "aid", "home", "away", "hg", "ag"]
extracted 301353 matches
matches counted: 301353
avg goals scored — home 1.50 vs away 1.14
avg goals conceded — home 1.14 vs away 1.50
```

| team          | home win% | away win% | gap       |
| ------------- | --------- | --------- | --------- |
| Meppen        | 50.6%     | 12.6%     | +37.9 pts |
| Catania       | 50.2%     | 13.2%     | +37.0 pts |
| Panahaiki     | 45.6%     | 8.8%      | +36.8 pts |
| Mulhouse      | 45.2%     | 9.5%      | +35.7 pts |
| Mannheim      | 51.4%     | 15.9%     | +35.5 pts |
| Ponte Preta   | 48.4%     | 13.7%     | +34.7 pts |
| Zwickau       | 45.6%     | 11.8%     | +33.8 pts |
| Reutlingen    | 54.9%     | 21.6%     | +33.3 pts |
| Gutersloh     | 51.0%     | 17.6%     | +33.3 pts |
| Carrarese     | 44.4%     | 11.6%     | +32.8 pts |
| Kallonis      | 42.9%     | 10.2%     | +32.7 pts |
| Ancona        | 46.7%     | 14.8%     | +31.9 pts |
| FC Dallas     | 53.5%     | 21.6%     | +31.8 pts |
| Messina       | 43.9%     | 12.2%     | +31.7 pts |
| Columbus Crew | 56.0%     | 24.5%     | +31.5 pts |

| league (hardest for away) | away win% | away GF/g | away GA/g | matches |
| ------------------------- | --------- | --------- | --------- | ------- |
| Italian Serie B           | 23.8%     | 1.03      | 1.39      | 12422   |
| French Ligue 2            | 24.6%     | 0.98      | 1.35      | 11431   |
| Serie A                   | 24.7%     | 0.98      | 1.43      | 5678    |
| Spanish La Liga 2         | 25.4%     | 1.00      | 1.37      | 15162   |
| MLS                       | 25.6%     | 1.21      | 1.71      | 6335    |
| French Ligue 1            | 26.0%     | 1.03      | 1.45      | 12272   |
| Liga Profesional          | 26.3%     | 0.95      | 1.26      | 5564    |
| German 2. Bundesliga      | 26.8%     | 1.18      | 1.58      | 10280   |
| Greek Super League        | 26.8%     | 1.00      | 1.49      | 8058    |
| Spanish La Liga           | 27.0%     | 1.12      | 1.56      | 13279   |
| Italian Serie A           | 27.3%     | 1.14      | 1.51      | 11921   |
| Portuguese Liga Portugal  | 28.0%     | 1.08      | 1.45      | 9742    |
| English Championship      | 28.2%     | 1.11      | 1.46      | 18408   |
| Turkish Süper Lig         | 28.3%     | 1.20      | 1.60      | 10200   |
| Liga MX                   | 28.4%     | 1.16      | 1.51      | 4808    |

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIuOTAzMjI1ODA2NDUxNjE0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KSG9tZSB3aW4lIG1pbnVzIGF3YXkgd2luJSDigJQgdGhlIGJpZ2dlc3QgaG9tZS9hd2F5IHNwbGl0cwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI5OSIgeDI9IjYwIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcxIiB5MT0iMjk5IiB4Mj0iNzEiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODIiIHkxPSIyOTkiIHgyPSI4MiIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5MyIgeTE9IjI5OSIgeDI9IjkzIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwNCIgeTE9IjI5OSIgeDI9IjEwNCIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMTQiIHkxPSIyOTkiIHgyPSIxMTQiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTI1IiB5MT0iMjk5IiB4Mj0iMTI1IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEzNiIgeTE9IjI5OSIgeDI9IjEzNiIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDciIHkxPSIyOTkiIHgyPSIxNDciIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTU4IiB5MT0iMjk5IiB4Mj0iMTU4IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2OSIgeTE9IjI5OSIgeDI9IjE2OSIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODAiIHkxPSIyOTkiIHgyPSIxODAiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTkxIiB5MT0iMjk5IiB4Mj0iMTkxIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIwMiIgeTE9IjI5OSIgeDI9IjIwMiIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTMiIHkxPSIyOTkiIHgyPSIyMTMiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIzIiB5MT0iMjk5IiB4Mj0iMjIzIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzNCIgeTE9IjI5OSIgeDI9IjIzNCIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDUiIHkxPSIyOTkiIHgyPSIyNDUiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU2IiB5MT0iMjk5IiB4Mj0iMjU2IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI2NyIgeTE9IjI5OSIgeDI9IjI2NyIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzgiIHkxPSIyOTkiIHgyPSIyNzgiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjg5IiB5MT0iMjk5IiB4Mj0iMjg5IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwMCIgeTE9IjI5OSIgeDI9IjMwMCIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTEiIHkxPSIyOTkiIHgyPSIzMTEiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzIyIiB5MT0iMjk5IiB4Mj0iMzIyIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMzMiIgeTE9IjI5OSIgeDI9IjMzMiIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNDMiIHkxPSIyOTkiIHgyPSIzNDMiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzU0IiB5MT0iMjk5IiB4Mj0iMzU0IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2NSIgeTE9IjI5OSIgeDI9IjM2NSIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNzYiIHkxPSIyOTkiIHgyPSIzNzYiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg3IiB5MT0iMjk5IiB4Mj0iMzg3IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM5OCIgeTE9IjI5OSIgeDI9IjM5OCIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDkiIHkxPSIyOTkiIHgyPSI0MDkiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDIwIiB5MT0iMjk5IiB4Mj0iNDIwIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzMSIgeTE9IjI5OSIgeDI9IjQzMSIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NDEiIHkxPSIyOTkiIHgyPSI0NDEiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDUyIiB5MT0iMjk5IiB4Mj0iNDUyIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2MyIgeTE9IjI5OSIgeDI9IjQ2MyIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NzQiIHkxPSIyOTkiIHgyPSI0NzQiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDg1IiB5MT0iMjk5IiB4Mj0iNDg1IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ5NiIgeTE9IjI5OSIgeDI9IjQ5NiIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDciIHkxPSIyOTkiIHgyPSI1MDciIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTE4IiB5MT0iMjk5IiB4Mj0iNTE4IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUyOSIgeTE9IjI5OSIgeDI9IjUyOSIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDAiIHkxPSIyOTkiIHgyPSI1NDAiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUwIiB5MT0iMjk5IiB4Mj0iNTUwIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2MSIgeTE9IjI5OSIgeDI9IjU2MSIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzIiIHkxPSIyOTkiIHgyPSI1NzIiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTgzIiB5MT0iMjk5IiB4Mj0iNTgzIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5NCIgeTE9IjI5OSIgeDI9IjU5NCIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MDUiIHkxPSIyOTkiIHgyPSI2MDUiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjE2IiB5MT0iMjk5IiB4Mj0iNjE2IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyNyIgeTE9IjI5OSIgeDI9IjYyNyIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MzgiIHkxPSIyOTkiIHgyPSI2MzgiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQ5IiB5MT0iMjk5IiB4Mj0iNjQ5IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1OSIgeTE9IjI5OSIgeDI9IjY1OSIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NzAiIHkxPSIyOTkiIHgyPSI2NzAiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgxIiB5MT0iMjk5IiB4Mj0iNjgxIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY5MiIgeTE9IjI5OSIgeDI9IjY5MiIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MDMiIHkxPSIyOTkiIHgyPSI3MDMiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTkiIHgyPSI3MDkiIHkyPSIyOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjk3IiB4Mj0iNzA5IiB5Mj0iMjk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5NCIgeDI9IjcwOSIgeTI9IjI5NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTEiIHgyPSI3MDkiIHkyPSIyOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg4IiB4Mj0iNzA5IiB5Mj0iMjg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4NSIgeDI9IjcwOSIgeTI9IjI4NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODIiIHgyPSI3MDkiIHkyPSIyODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc5IiB4Mj0iNzA5IiB5Mj0iMjc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3NiIgeDI9IjcwOSIgeTI9IjI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzMiIHgyPSI3MDkiIHkyPSIyNzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjcwIiB4Mj0iNzA5IiB5Mj0iMjcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2NyIgeDI9IjcwOSIgeTI9IjI2NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjQiIHgyPSI3MDkiIHkyPSIyNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjYxIiB4Mj0iNzA5IiB5Mj0iMjYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1OCIgeDI9IjcwOSIgeTI9IjI1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTYiIHgyPSI3MDkiIHkyPSIyNTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjUzIiB4Mj0iNzA5IiB5Mj0iMjUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1MCIgeDI9IjcwOSIgeTI9IjI1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDciIHgyPSI3MDkiIHkyPSIyNDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ0IiB4Mj0iNzA5IiB5Mj0iMjQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0MSIgeDI9IjcwOSIgeTI9IjI0MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzgiIHgyPSI3MDkiIHkyPSIyMzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM1IiB4Mj0iNzA5IiB5Mj0iMjM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMiIgeDI9IjcwOSIgeTI9IjIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjkiIHgyPSI3MDkiIHkyPSIyMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI2IiB4Mj0iNzA5IiB5Mj0iMjI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyMyIgeDI9IjcwOSIgeTI9IjIyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjAiIHgyPSI3MDkiIHkyPSIyMjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE3IiB4Mj0iNzA5IiB5Mj0iMjE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNCIgeDI9IjcwOSIgeTI9IjIxNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTIiIHgyPSI3MDkiIHkyPSIyMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA5IiB4Mj0iNzA5IiB5Mj0iMjA5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwNiIgeDI9IjcwOSIgeTI9IjIwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDMiIHgyPSI3MDkiIHkyPSIyMDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjAwIiB4Mj0iNzA5IiB5Mj0iMjAwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5NyIgeDI9IjcwOSIgeTI9IjE5NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTQiIHgyPSI3MDkiIHkyPSIxOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTkxIiB4Mj0iNzA5IiB5Mj0iMTkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4OCIgeDI9IjcwOSIgeTI9IjE4OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODUiIHgyPSI3MDkiIHkyPSIxODUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTgyIiB4Mj0iNzA5IiB5Mj0iMTgyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3OSIgeDI9IjcwOSIgeTI9IjE3OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzYiIHgyPSI3MDkiIHkyPSIxNzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTczIiB4Mj0iNzA5IiB5Mj0iMTczIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3MCIgeDI9IjcwOSIgeTI9IjE3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjgiIHgyPSI3MDkiIHkyPSIxNjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY1IiB4Mj0iNzA5IiB5Mj0iMTY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2MiIgeDI9IjcwOSIgeTI9IjE2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTkiIHgyPSI3MDkiIHkyPSIxNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTU2IiB4Mj0iNzA5IiB5Mj0iMTU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1MyIgeDI9IjcwOSIgeTI9IjE1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTAiIHgyPSI3MDkiIHkyPSIxNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ3IiB4Mj0iNzA5IiB5Mj0iMTQ3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NCIgeDI9IjcwOSIgeTI9IjE0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDEiIHgyPSI3MDkiIHkyPSIxNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM4IiB4Mj0iNzA5IiB5Mj0iMTM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzNSIgeDI9IjcwOSIgeTI9IjEzNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzIiIHgyPSI3MDkiIHkyPSIxMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI5IiB4Mj0iNzA5IiB5Mj0iMTI5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyNiIgeDI9IjcwOSIgeTI9IjEyNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjQiIHgyPSI3MDkiIHkyPSIxMjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIxIiB4Mj0iNzA5IiB5Mj0iMTIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExOCIgeDI9IjcwOSIgeTI9IjExOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTUiIHgyPSI3MDkiIHkyPSIxMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTEyIiB4Mj0iNzA5IiB5Mj0iMTEyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwOSIgeDI9IjcwOSIgeTI9IjEwOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDYiIHgyPSI3MDkiIHkyPSIxMDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTAzIiB4Mj0iNzA5IiB5Mj0iMTAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwMCIgeDI9IjcwOSIgeTI9IjEwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NyIgeDI9IjcwOSIgeTI9Ijk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijk0IiB4Mj0iNzA5IiB5Mj0iOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTEiIHgyPSI3MDkiIHkyPSI5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4OCIgeDI9IjcwOSIgeTI9Ijg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg1IiB4Mj0iNzA5IiB5Mj0iODUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODIiIHgyPSI3MDkiIHkyPSI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MCIgeDI9IjcwOSIgeTI9IjgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc3IiB4Mj0iNzA5IiB5Mj0iNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzQiIHgyPSI3MDkiIHkyPSI3NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3MSIgeDI9IjcwOSIgeTI9IjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY4IiB4Mj0iNzA5IiB5Mj0iNjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjUiIHgyPSI3MDkiIHkyPSI2NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2MiIgeDI9IjcwOSIgeTI9IjYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU5IiB4Mj0iNzA5IiB5Mj0iNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTYiIHgyPSI3MDkiIHkyPSI1NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1MyIgeDI9IjcwOSIgeTI9IjUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjUwIiB4Mj0iNzA5IiB5Mj0iNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDciIHgyPSI3MDkiIHkyPSI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0NCIgeDI9IjcwOSIgeTI9IjQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQxIiB4Mj0iNzA5IiB5Mj0iNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzgiIHgyPSI3MDkiIHkyPSIzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNiIgeDI9IjcwOSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMzIiB4Mj0iNzA5IiB5Mj0iMzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iMjk5IiB4Mj0iODIiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTM2IiB5MT0iMjk5IiB4Mj0iMTM2IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5MSIgeTE9IjI5OSIgeDI9IjE5MSIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDUiIHkxPSIyOTkiIHgyPSIyNDUiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzAwIiB5MT0iMjk5IiB4Mj0iMzAwIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1NCIgeTE9IjI5OSIgeDI9IjM1NCIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDkiIHkxPSIyOTkiIHgyPSI0MDkiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDYzIiB5MT0iMjk5IiB4Mj0iNDYzIiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxOCIgeTE9IjI5OSIgeDI9IjUxOCIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzIiIHkxPSIyOTkiIHgyPSI1NzIiIHkyPSIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjI3IiB5MT0iMjk5IiB4Mj0iNjI3IiB5Mj0iMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjI5OSIgeDI9IjY4MSIgeTI9IjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5OSIgeDI9IjcwOSIgeTI9IjI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzAiIHgyPSI3MDkiIHkyPSIyNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQxIiB4Mj0iNzA5IiB5Mj0iMjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxMiIgeDI9IjcwOSIgeTI9IjIxMiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODIiIHgyPSI3MDkiIHkyPSIxODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTUzIiB4Mj0iNzA5IiB5Mj0iMTUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyNCIgeDI9IjcwOSIgeTI9IjEyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NCIgeDI9IjcwOSIgeTI9Ijk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY1IiB4Mj0iNzA5IiB5Mj0iNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzYiIHgyPSI3MDkiIHkyPSIzNiIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzIgNTQsMjk5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjk5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjk5IDU0LDI5OSAiLz4KPHRleHQgeD0iNDUiIHk9IjI3MCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI3MCA1NCwyNzAgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyNDEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjQxIDU0LDI0MSAiLz4KPHRleHQgeD0iNDUiIHk9IjIxMiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTUuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyMTIgNTQsMjEyICIvPgo8dGV4dCB4PSI0NSIgeT0iMTgyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE4MiA1NCwxODIgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxNTMiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjI1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTUzIDU0LDE1MyAiLz4KPHRleHQgeD0iNDUiIHk9IjEyNCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMzAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxMjQgNTQsMTI0ICIvPgo8dGV4dCB4PSI0NSIgeT0iOTQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjM1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksOTQgNTQsOTQgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI2NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNDAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw2NSA1NCw2NSAiLz4KPHRleHQgeD0iNDUiIHk9IjM2IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0NS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDM2IDU0LDM2ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzAwIDcwOSwzMDAgIi8+Cjx0ZXh0IHg9IjgyIiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpNZXBwZW4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iODIsMzAwIDgyLDMwNSAiLz4KPHRleHQgeD0iMTM2IiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpDYXRhbmlhCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjEzNiwzMDAgMTM2LDMwNSAiLz4KPHRleHQgeD0iMTkxIiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpQYW5haGFpa2kKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMTkxLDMwMCAxOTEsMzA1ICIvPgo8dGV4dCB4PSIyNDUiIHk9IjMxMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ck11bGhvdXNlCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjI0NSwzMDAgMjQ1LDMwNSAiLz4KPHRleHQgeD0iMzAwIiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpNYW5uaGVpbQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIzMDAsMzAwIDMwMCwzMDUgIi8+Cjx0ZXh0IHg9IjM1NCIgeT0iMzEwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUG9udGUgUHJldGEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzU0LDMwMCAzNTQsMzA1ICIvPgo8dGV4dCB4PSI0MDkiIHk9IjMxMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Clp3aWNrYXUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDA5LDMwMCA0MDksMzA1ICIvPgo8dGV4dCB4PSI0NjMiIHk9IjMxMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClJldXRsaW5nZW4KPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDYzLDMwMCA0NjMsMzA1ICIvPgo8dGV4dCB4PSI1MTgiIHk9IjMxMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ckd1dGVyc2xvaAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1MTgsMzAwIDUxOCwzMDUgIi8+Cjx0ZXh0IHg9IjU3MiIgeT0iMzEwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2FycmFyZXNlCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU3MiwzMDAgNTcyLDMwNSAiLz4KPHRleHQgeD0iNjI3IiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpLYWxsb25pcwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MjcsMzAwIDYyNywzMDUgIi8+Cjx0ZXh0IHg9IjY4MSIgeT0iMzEwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQW5jb25hCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY4MSwzMDAgNjgxLDMwNSAiLz4KPHJlY3QgeD0iNjMiIHk9Ijc3IiB3aWR0aD0iMzgiIGhlaWdodD0iMjIyIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTE3IiB5PSI4MyIgd2lkdGg9IjM4IiBoZWlnaHQ9IjIxNiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjE3MiIgeT0iODQiIHdpZHRoPSIzOCIgaGVpZ2h0PSIyMTUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyMjYiIHk9IjkwIiB3aWR0aD0iMzgiIGhlaWdodD0iMjA5IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMjgxIiB5PSI5MSIgd2lkdGg9IjM4IiBoZWlnaHQ9IjIwOCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjMzNSIgeT0iOTYiIHdpZHRoPSIzOCIgaGVpZ2h0PSIyMDMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzOTAiIHk9IjEwMSIgd2lkdGg9IjM4IiBoZWlnaHQ9IjE5OCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ0NCIgeT0iMTA0IiB3aWR0aD0iMzgiIGhlaWdodD0iMTk1IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDk5IiB5PSIxMDQiIHdpZHRoPSIzOCIgaGVpZ2h0PSIxOTUiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1NTMiIHk9IjEwNyIgd2lkdGg9IjM4IiBoZWlnaHQ9IjE5MiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYwOCIgeT0iMTA4IiB3aWR0aD0iMzgiIGhlaWdodD0iMTkxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjYyIiB5PSIxMTMiIHdpZHRoPSIzOCIgaGVpZ2h0PSIxODYiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

## Findings

Across **301,353 matches**, the away-day penalty is real and mostly a _scoring_
problem:

- Teams score **1.50 goals/game at home vs 1.14 away** — a 24% collapse in
  output. Goals conceded mirror it exactly (1.14 home vs 1.50 away).
- **Biggest home/away win-rate gaps** (min. 40 games each side): **Meppen +37.9
  pts** (50.6% home vs 12.6% away), Catania +37.0, Panahaiki +36.8 — mostly
  smaller-league sides where home advantage is amplified by travel, pitch size
  and partisan crowds.
- **Hardest leagues for visitors:** Italian Serie B (23.8% away wins), French
  Ligue 2 (24.6%), Serie A (24.7%), La Liga 2 (25.4%). The "big five" leagues
  all sit under 28% — away wins are simply rare.

The honest takeaway: almost every team is worse away — the question is whether
the _gap_ is abnormally large. For Meppen-class teams the home shirt is worth ~4
extra wins per 10 games.
