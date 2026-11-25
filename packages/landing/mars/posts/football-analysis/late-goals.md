# Death by a thousand cuts: the dying minutes

## Death by a thousand cuts: the dying minutes

Some teams are bores until minute 80, then refuse to lose — or refuse to let go.
This notebook isolates **goals scored in the dying minutes** (effective minute ≥
76, i.e. regulation time 75+ plus stoppage time) from the StatsBomb goal-level
dataset and ranks teams by late goals per match.

We also split home vs away late goals and compare leagues on how much of their
scoring arrives late.

**Coverage caveat:** goal timing exists only for StatsBomb matches (~4,200
fixtures) — World Cups, Euros, Champions League and top domestic leagues.

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
loaded 11328 goal rows | schema: ["mid", "date", "league", "season", "hid", "aid", "home", "away", "hg", "ag", "minute", "added_minute", "gtid", "gteam", "gtype"]
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
loaded 11328 goal rows | schema: ["mid", "date", "league", "season", "hid", "aid", "home", "away", "hg", "ag", "minute", "added_minute", "gtid", "gteam", "gtype"]
extracted 11328 goal rows
matches with goal data: 3703
```

## Late-goal accounting

Effective minute = `minute + added_minute` (stoppage time counts). A goal is
"late" at ≥ 76 — the final 15 minutes of regulation plus added time.

```rust
use std::collections::HashMap;

const LATE: i64 = 76;

// per-team: matches played (distinct mid as participant), goals, late goals
let mut played: HashMap<i64, u64> = HashMap::new();
let mut goals: HashMap<i64, u64> = HashMap::new();
let mut late: HashMap<i64, u64> = HashMap::new();
let mut seen: std::collections::HashSet<(i64, i64)> = std::collections::HashSet::new();

// league-level: goals / late goals
let mut lg_goals: HashMap<String, u64> = HashMap::new();
let mut lg_late: HashMap<String, u64> = HashMap::new();
let mut lg_matches: HashMap<String, std::collections::HashSet<i64>> = HashMap::new();

// home/away split for late goals
let (mut late_home, mut late_away) = (0u64, 0u64);

for (_mid, idxs) in match_goals.iter() {
    let i0 = idxs[0];
    let mid = mid_v[i0];
    seen.insert((hid_v[i0], mid));
    seen.insert((aid_v[i0], mid));
    lg_matches.entry(league_v[i0].clone()).or_default().insert(mid);
    for &gi in idxs {
        let t = gtid_v[gi];
        let eff = minute_v[gi] + added_v[gi];
        let is_late = eff >= LATE;
        *goals.entry(t).or_insert(0) += 1;
        *lg_goals.entry(league_v[gi].clone()).or_insert(0) += 1;
        if is_late {
            *late.entry(t).or_insert(0) += 1;
            *lg_late.entry(league_v[gi].clone()).or_insert(0) += 1;
            if t == hid_v[gi] { late_home += 1; } else { late_away += 1; }
        }
    }
}
for (tid, mid) in &seen { *played.entry(*tid).or_insert(0) += 1; let _ = mid; }

let total_late: u64 = late.values().sum();
let total_goals: u64 = goals.values().sum();
println!("goals: {total_goals} | late (≥76'): {total_late} ({:.1}% of all goals)", total_late as f64 / total_goals as f64 * 100.0);
println!("late goals — home {late_home} vs away {late_away}");

// team ranking: late goals per match, min 20 matches
let mut ranked: Vec<(&i64, f64, u64, u64)> = Vec::new();
for (tid, lg) in &late {
    let p = *played.get(tid).unwrap_or(&0);
    if p >= 20 {
        ranked.push((tid, *lg as f64 / p as f64, *lg, p));
    }
}
ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
let rows: Vec<Vec<String>> = ranked
    .iter()
    .take(15)
    .map(|(tid, rate, lg, p)| {
        vec![
            names.get(*tid).cloned().unwrap_or_else(|| tid.to_string()),
            p.to_string(),
            lg.to_string(),
            format!("{rate:.2}"),
            format!("{:.1}%", *lg as f64 / *goals.get(*tid).unwrap_or(&1) as f64 * 100.0),
        ]
    })
    .collect();
mars_table(&["team", "matches", "late goals", "late/match", "% of goals late"], &rows);

// least late-prone (for contrast)
let mut calm: Vec<(&i64, f64, u64, u64)> = Vec::new();
for (tid, p) in &played {
    if *p >= 20 {
        let lg = *late.get(tid).unwrap_or(&0);
        calm.push((tid, lg as f64 / *p as f64, lg, *p));
    }
}
calm.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
let calm_rows: Vec<Vec<String>> = calm
    .iter()
    .take(10)
    .map(|(tid, rate, lg, p)| {
        vec![
            names.get(*tid).cloned().unwrap_or_else(|| tid.to_string()),
            p.to_string(),
            lg.to_string(),
            format!("{rate:.2}"),
        ]
    })
    .collect();
mars_table(&["team (least late-prone)", "matches", "late goals", "late/match"], &calm_rows);

// league comparison: late share of goals + late goals per match
let mut lrows: Vec<(String, f64, f64, u64)> = Vec::new();
for (lg, g) in &lg_goals {
    let l = *lg_late.get(lg).unwrap_or(&0);
    let m = lg_matches.get(lg).map(|s| s.len()).unwrap_or(0);
    if m >= 30 && *g >= 100 {
        lrows.push((lg.clone(), l as f64 / *g as f64 * 100.0, l as f64 / m as f64, m as u64));
    }
}
lrows.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
let ltable: Vec<Vec<String>> = lrows
    .iter()
    .take(15)
    .map(|(lg, share, per, m)| vec![lg.clone(), format!("{share:.1}%"), format!("{per:.2}"), m.to_string()])
    .collect();
mars_table(&["league", "% goals ≥76'", "late goals/match", "matches"], &ltable);
```

```text
loaded 11328 goal rows | schema: ["mid", "date", "league", "season", "hid", "aid", "home", "away", "hg", "ag", "minute", "added_minute", "gtid", "gteam", "gtype"]
extracted 11328 goal rows
matches with goal data: 3703
goals: 11328 | late (≥76'): 2605 (23.0% of all goals)
late goals — home 1422 vs away 1183
```

| team                | matches | late goals | late/match | % of goals late |
| ------------------- | ------- | ---------- | ---------- | --------------- |
| Argentina           | 22      | 22         | 1.00       | 44.0%           |
| France              | 20      | 19         | 0.95       | 38.8%           |
| England Women's     | 26      | 24         | 0.92       | 32.9%           |
| Sweden Women's      | 23      | 20         | 0.87       | 39.2%           |
| VfL Wolfsburg WFC   | 22      | 19         | 0.86       | 28.8%           |
| Barcelona WFC       | 30      | 25         | 0.83       | 18.8%           |
| England             | 25      | 20         | 0.80       | 36.4%           |
| Spain Women's       | 20      | 15         | 0.75       | 32.6%           |
| Real Madrid         | 68      | 43         | 0.63       | 26.1%           |
| Lyon                | 38      | 24         | 0.63       | 35.3%           |
| Arsenal WFC         | 78      | 48         | 0.62       | 21.9%           |
| Real Madrid CF W    | 29      | 17         | 0.59       | 23.9%           |
| Manchester United W | 57      | 33         | 0.58       | 31.1%           |
| Roma                | 37      | 21         | 0.57       | 25.3%           |
| SC Delhi            | 23      | 13         | 0.57       | 26.5%           |

| team (least late-prone) | matches | late goals | late/match |
| ----------------------- | ------- | ---------- | ---------- |
| Houston Dash            | 23      | 2          | 0.09       |
| Gazélec Ajaccio         | 33      | 3          | 0.09       |
| Chicago Red Stars       | 29      | 3          | 0.10       |
| Espanyol                | 60      | 7          | 0.12       |
| Nantes                  | 34      | 4          | 0.12       |
| Birmingham City WFC     | 50      | 6          | 0.12       |
| Bristol City WFC        | 74      | 9          | 0.12       |
| Rayo Vallecano          | 45      | 6          | 0.13       |
| Norwich City            | 37      | 5          | 0.14       |
| Leicester City WFC      | 22      | 3          | 0.14       |

| league                  | % goals ≥76' | late goals/match | matches |
| ----------------------- | ------------ | ---------------- | ------- |
| African Cup of Nations  | 47.2%        | 1.56             | 48      |
| UEFA Euro               | 37.7%        | 1.15             | 92      |
| FIFA World Cup          | 32.1%        | 1.03             | 138     |
| Women's World Cup       | 30.9%        | 0.94             | 107     |
| UEFA Women's Euro       | 29.9%        | 1.03             | 62      |
| Frauen Bundesliga       | 23.1%        | 0.76             | 124     |
| Liga F                  | 22.0%        | 0.70             | 234     |
| French Ligue 1          | 22.0%        | 0.62             | 394     |
| Italian Serie A         | 21.6%        | 0.59             | 348     |
| Serie A Women           | 21.4%        | 0.68             | 124     |
| Spanish La Liga         | 21.1%        | 0.68             | 822     |
| English Premier League  | 20.8%        | 0.59             | 379     |
| Indian Super league     | 20.6%        | 0.65             | 110     |
| FA Women's Super League | 20.2%        | 0.64             | 436     |
| German Bundesliga       | 16.5%        | 0.52             | 64      |

```rust
use plotters::prelude::*;

let mut labels5: Vec<String> = Vec::new();
let mut vals: Vec<f64> = Vec::new();
for (tid, rate, _lg, _p) in ranked.iter().take(12) {
    labels5.push(names.get(*tid).cloned().unwrap_or_default().chars().take(14).collect());
    vals.push(*rate);
}
let ymax5 = vals.iter().cloned().fold(0.1_f64, f64::max) * 1.25;
let n5 = vals.len();

let figure = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Late goals per match — the most dangerous in the dying minutes", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(90)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n5 as f64 - 0.5), 0.0_f64..ymax5)?;
    chart.configure_mesh().x_labels(n5).x_label_formatter(&|x: &f64| {
        labels5.get(*x as usize).cloned().unwrap_or_default()
    }).draw()?;
    chart.draw_series((0..n5).map(|i| {
        Rectangle::new([(i as f64 - 0.35, 0.0), (i as f64 + 0.35, vals[i])], RED.filled())
    }))?;
    Ok(())
});
figure.evcxr_display();
```

```text
loaded 11328 goal rows | schema: ["mid", "date", "league", "season", "hid", "aid", "home", "away", "hg", "ag", "minute", "added_minute", "gtid", "gteam", "gtype"]
extracted 11328 goal rows
matches with goal data: 3703
goals: 11328 | late (≥76'): 2605 (23.0% of all goals)
late goals — home 1422 vs away 1183
```

| team                | matches | late goals | late/match | % of goals late |
| ------------------- | ------- | ---------- | ---------- | --------------- |
| Argentina           | 22      | 22         | 1.00       | 44.0%           |
| France              | 20      | 19         | 0.95       | 38.8%           |
| England Women's     | 26      | 24         | 0.92       | 32.9%           |
| Sweden Women's      | 23      | 20         | 0.87       | 39.2%           |
| VfL Wolfsburg WFC   | 22      | 19         | 0.86       | 28.8%           |
| Barcelona WFC       | 30      | 25         | 0.83       | 18.8%           |
| England             | 25      | 20         | 0.80       | 36.4%           |
| Spain Women's       | 20      | 15         | 0.75       | 32.6%           |
| Real Madrid         | 68      | 43         | 0.63       | 26.1%           |
| Lyon                | 38      | 24         | 0.63       | 35.3%           |
| Arsenal WFC         | 78      | 48         | 0.62       | 21.9%           |
| Real Madrid CF W    | 29      | 17         | 0.59       | 23.9%           |
| Manchester United W | 57      | 33         | 0.58       | 31.1%           |
| Roma                | 37      | 21         | 0.57       | 25.3%           |
| SC Delhi            | 23      | 13         | 0.57       | 26.5%           |

| team (least late-prone) | matches | late goals | late/match |
| ----------------------- | ------- | ---------- | ---------- |
| Houston Dash            | 23      | 2          | 0.09       |
| Gazélec Ajaccio         | 33      | 3          | 0.09       |
| Chicago Red Stars       | 29      | 3          | 0.10       |
| Espanyol                | 60      | 7          | 0.12       |
| Nantes                  | 34      | 4          | 0.12       |
| Birmingham City WFC     | 50      | 6          | 0.12       |
| Bristol City WFC        | 74      | 9          | 0.12       |
| Rayo Vallecano          | 45      | 6          | 0.13       |
| Norwich City            | 37      | 5          | 0.14       |
| Leicester City WFC      | 22      | 3          | 0.14       |

| league                  | % goals ≥76' | late goals/match | matches |
| ----------------------- | ------------ | ---------------- | ------- |
| African Cup of Nations  | 47.2%        | 1.56             | 48      |
| UEFA Euro               | 37.7%        | 1.15             | 92      |
| FIFA World Cup          | 32.1%        | 1.03             | 138     |
| Women's World Cup       | 30.9%        | 0.94             | 107     |
| UEFA Women's Euro       | 29.9%        | 1.03             | 62      |
| Frauen Bundesliga       | 23.1%        | 0.76             | 124     |
| Liga F                  | 22.0%        | 0.70             | 234     |
| French Ligue 1          | 22.0%        | 0.62             | 394     |
| Italian Serie A         | 21.6%        | 0.59             | 348     |
| Serie A Women           | 21.4%        | 0.68             | 124     |
| Spanish La Liga         | 21.1%        | 0.68             | 822     |
| English Premier League  | 20.8%        | 0.59             | 379     |
| Indian Super league     | 20.6%        | 0.65             | 110     |
| FA Women's Super League | 20.2%        | 0.64             | 436     |
| German Bundesliga       | 16.5%        | 0.52             | 64      |

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTGF0ZSBnb2FscyBwZXIgbWF0Y2gg4oCUIHRoZSBtb3N0IGRhbmdlcm91cyBpbiB0aGUgZHlpbmcgbWludXRlcwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI5OSIgeDI9IjYwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcxIiB5MT0iMjk5IiB4Mj0iNzEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODIiIHkxPSIyOTkiIHgyPSI4MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5MyIgeTE9IjI5OSIgeDI9IjkzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwNCIgeTE9IjI5OSIgeDI9IjEwNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMTQiIHkxPSIyOTkiIHgyPSIxMTQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTI1IiB5MT0iMjk5IiB4Mj0iMTI1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEzNiIgeTE9IjI5OSIgeDI9IjEzNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNDciIHkxPSIyOTkiIHgyPSIxNDciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTU4IiB5MT0iMjk5IiB4Mj0iMTU4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2OSIgeTE9IjI5OSIgeDI9IjE2OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODAiIHkxPSIyOTkiIHgyPSIxODAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTkxIiB5MT0iMjk5IiB4Mj0iMTkxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIwMiIgeTE9IjI5OSIgeDI9IjIwMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTMiIHkxPSIyOTkiIHgyPSIyMTMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIzIiB5MT0iMjk5IiB4Mj0iMjIzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzNCIgeTE9IjI5OSIgeDI9IjIzNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDUiIHkxPSIyOTkiIHgyPSIyNDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU2IiB5MT0iMjk5IiB4Mj0iMjU2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI2NyIgeTE9IjI5OSIgeDI9IjI2NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzgiIHkxPSIyOTkiIHgyPSIyNzgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjg5IiB5MT0iMjk5IiB4Mj0iMjg5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMwMCIgeTE9IjI5OSIgeDI9IjMwMCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTEiIHkxPSIyOTkiIHgyPSIzMTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzIyIiB5MT0iMjk5IiB4Mj0iMzIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMzMiIgeTE9IjI5OSIgeDI9IjMzMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNDMiIHkxPSIyOTkiIHgyPSIzNDMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzU0IiB5MT0iMjk5IiB4Mj0iMzU0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2NSIgeTE9IjI5OSIgeDI9IjM2NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNzYiIHkxPSIyOTkiIHgyPSIzNzYiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzg3IiB5MT0iMjk5IiB4Mj0iMzg3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM5OCIgeTE9IjI5OSIgeDI9IjM5OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDkiIHkxPSIyOTkiIHgyPSI0MDkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDIwIiB5MT0iMjk5IiB4Mj0iNDIwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzMSIgeTE9IjI5OSIgeDI9IjQzMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NDEiIHkxPSIyOTkiIHgyPSI0NDEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDUyIiB5MT0iMjk5IiB4Mj0iNDUyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2MyIgeTE9IjI5OSIgeDI9IjQ2MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NzQiIHkxPSIyOTkiIHgyPSI0NzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDg1IiB5MT0iMjk5IiB4Mj0iNDg1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ5NiIgeTE9IjI5OSIgeDI9IjQ5NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDciIHkxPSIyOTkiIHgyPSI1MDciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTE4IiB5MT0iMjk5IiB4Mj0iNTE4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUyOSIgeTE9IjI5OSIgeDI9IjUyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDAiIHkxPSIyOTkiIHgyPSI1NDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUwIiB5MT0iMjk5IiB4Mj0iNTUwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2MSIgeTE9IjI5OSIgeDI9IjU2MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzIiIHkxPSIyOTkiIHgyPSI1NzIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTgzIiB5MT0iMjk5IiB4Mj0iNTgzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5NCIgeTE9IjI5OSIgeDI9IjU5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MDUiIHkxPSIyOTkiIHgyPSI2MDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjE2IiB5MT0iMjk5IiB4Mj0iNjE2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyNyIgeTE9IjI5OSIgeDI9IjYyNyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MzgiIHkxPSIyOTkiIHgyPSI2MzgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQ5IiB5MT0iMjk5IiB4Mj0iNjQ5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1OSIgeTE9IjI5OSIgeDI9IjY1OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NzAiIHkxPSIyOTkiIHgyPSI2NzAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgxIiB5MT0iMjk5IiB4Mj0iNjgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY5MiIgeTE9IjI5OSIgeDI9IjY5MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MDMiIHkxPSIyOTkiIHgyPSI3MDMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTkiIHgyPSI3MDkiIHkyPSIyOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjk1IiB4Mj0iNzA5IiB5Mj0iMjk1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5MSIgeDI9IjcwOSIgeTI9IjI5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODciIHgyPSI3MDkiIHkyPSIyODciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjgzIiB4Mj0iNzA5IiB5Mj0iMjgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3OCIgeDI9IjcwOSIgeTI9IjI3OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzQiIHgyPSI3MDkiIHkyPSIyNzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjcwIiB4Mj0iNzA5IiB5Mj0iMjcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2NiIgeDI9IjcwOSIgeTI9IjI2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjEiIHgyPSI3MDkiIHkyPSIyNjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU3IiB4Mj0iNzA5IiB5Mj0iMjU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1MyIgeDI9IjcwOSIgeTI9IjI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDkiIHgyPSI3MDkiIHkyPSIyNDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ0IiB4Mj0iNzA5IiB5Mj0iMjQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0MCIgeDI9IjcwOSIgeTI9IjI0MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzYiIHgyPSI3MDkiIHkyPSIyMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjMyIiB4Mj0iNzA5IiB5Mj0iMjMyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyNyIgeDI9IjcwOSIgeTI9IjIyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjMiIHgyPSI3MDkiIHkyPSIyMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE5IiB4Mj0iNzA5IiB5Mj0iMjE5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNSIgeDI9IjcwOSIgeTI9IjIxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTAiIHgyPSI3MDkiIHkyPSIyMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA2IiB4Mj0iNzA5IiB5Mj0iMjA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMiIgeDI9IjcwOSIgeTI9IjIwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTgiIHgyPSI3MDkiIHkyPSIxOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTkzIiB4Mj0iNzA5IiB5Mj0iMTkzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4OSIgeDI9IjcwOSIgeTI9IjE4OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODUiIHgyPSI3MDkiIHkyPSIxODUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTgxIiB4Mj0iNzA5IiB5Mj0iMTgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NyIgeDI9IjcwOSIgeTI9IjE3NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzIiIHgyPSI3MDkiIHkyPSIxNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY4IiB4Mj0iNzA5IiB5Mj0iMTY4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2NCIgeDI9IjcwOSIgeTI9IjE2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjAiIHgyPSI3MDkiIHkyPSIxNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTU1IiB4Mj0iNzA5IiB5Mj0iMTU1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1MSIgeDI9IjcwOSIgeTI9IjE1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDciIHgyPSI3MDkiIHkyPSIxNDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQzIiB4Mj0iNzA5IiB5Mj0iMTQzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzOCIgeDI9IjcwOSIgeTI9IjEzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzQiIHgyPSI3MDkiIHkyPSIxMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTMwIiB4Mj0iNzA5IiB5Mj0iMTMwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyNiIgeDI9IjcwOSIgeTI9IjEyNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjEiIHgyPSI3MDkiIHkyPSIxMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTE3IiB4Mj0iNzA5IiB5Mj0iMTE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExMyIgeDI9IjcwOSIgeTI9IjExMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDkiIHgyPSI3MDkiIHkyPSIxMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA0IiB4Mj0iNzA5IiB5Mj0iMTA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwMCIgeDI9IjcwOSIgeTI9IjEwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NiIgeDI9IjcwOSIgeTI9Ijk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjkyIiB4Mj0iNzA5IiB5Mj0iOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODciIHgyPSI3MDkiIHkyPSI4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MyIgeDI9IjcwOSIgeTI9IjgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc5IiB4Mj0iNzA5IiB5Mj0iNzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzUiIHgyPSI3MDkiIHkyPSI3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3MSIgeDI9IjcwOSIgeTI9IjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY2IiB4Mj0iNzA5IiB5Mj0iNjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjIiIHgyPSI3MDkiIHkyPSI2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1OCIgeDI9IjcwOSIgeTI9IjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU0IiB4Mj0iNzA5IiB5Mj0iNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDkiIHgyPSI3MDkiIHkyPSI0OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0NSIgeDI9IjcwOSIgeTI9IjQ1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQxIiB4Mj0iNzA5IiB5Mj0iNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iMjk5IiB4Mj0iODIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTM2IiB5MT0iMjk5IiB4Mj0iMTM2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5MSIgeTE9IjI5OSIgeDI9IjE5MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDUiIHkxPSIyOTkiIHgyPSIyNDUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzAwIiB5MT0iMjk5IiB4Mj0iMzAwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1NCIgeTE9IjI5OSIgeDI9IjM1NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDkiIHkxPSIyOTkiIHgyPSI0MDkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDYzIiB5MT0iMjk5IiB4Mj0iNDYzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxOCIgeTE9IjI5OSIgeDI9IjUxOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzIiIHkxPSIyOTkiIHgyPSI1NzIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjI3IiB5MT0iMjk5IiB4Mj0iNjI3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4MSIgeTE9IjI5OSIgeDI9IjY4MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5OSIgeDI9IjcwOSIgeTI9IjI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTciIHgyPSI3MDkiIHkyPSIyNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE1IiB4Mj0iNzA5IiB5Mj0iMjE1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3MiIgeDI9IjcwOSIgeTI9IjE3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzAiIHgyPSI3MDkiIHkyPSIxMzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODciIHgyPSI3MDkiIHkyPSI4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0NSIgeDI9IjcwOSIgeTI9IjQ1Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNCA1NCwyOTkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyOTkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyOTkgNTQsMjk5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjU3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjIKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjU3IDU0LDI1NyAiLz4KPHRleHQgeD0iNDUiIHk9IjIxNSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC40CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDIxNSA1NCwyMTUgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxNzIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuNgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNzIgNTQsMTcyICIvPgo8dGV4dCB4PSI0NSIgeT0iMTMwIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjgKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTMwIDU0LDEzMCAiLz4KPHRleHQgeD0iNDUiIHk9Ijg3IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksODcgNTQsODcgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI0NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMS4yCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDQ1IDU0LDQ1ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzAwIDcwOSwzMDAgIi8+Cjx0ZXh0IHg9IjgyIiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpBcmdlbnRpbmEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iODIsMzAwIDgyLDMwNSAiLz4KPHRleHQgeD0iMTM2IiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpGcmFuY2UKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMTM2LDMwMCAxMzYsMzA1ICIvPgo8dGV4dCB4PSIxOTEiIHk9IjMxMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkVuZ2xhbmQgV29tZW4mYXBvczsKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMTkxLDMwMCAxOTEsMzA1ICIvPgo8dGV4dCB4PSIyNDUiIHk9IjMxMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClN3ZWRlbiBXb21lbiZhcG9zO3MKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjQ1LDMwMCAyNDUsMzA1ICIvPgo8dGV4dCB4PSIzMDAiIHk9IjMxMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClZmTCBXb2xmc2J1cmcgCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjMwMCwzMDAgMzAwLDMwNSAiLz4KPHRleHQgeD0iMzU0IiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpCYXJjZWxvbmEgV0ZDCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM1NCwzMDAgMzU0LDMwNSAiLz4KPHRleHQgeD0iNDA5IiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpFbmdsYW5kCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQwOSwzMDAgNDA5LDMwNSAiLz4KPHRleHQgeD0iNDYzIiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpTcGFpbiBXb21lbiZhcG9zO3MKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDYzLDMwMCA0NjMsMzA1ICIvPgo8dGV4dCB4PSI1MTgiIHk9IjMxMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClJlYWwgTWFkcmlkCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUxOCwzMDAgNTE4LDMwNSAiLz4KPHRleHQgeD0iNTcyIiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMeW9uCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU3MiwzMDAgNTcyLDMwNSAiLz4KPHRleHQgeD0iNjI3IiB5PSIzMTAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpBcnNlbmFsIFdGQwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MjcsMzAwIDYyNywzMDUgIi8+Cjx0ZXh0IHg9IjY4MSIgeT0iMzEwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUmVhbCBNYWRyaWQgQ0YKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjgxLDMwMCA2ODEsMzA1ICIvPgo8cmVjdCB4PSI2MyIgeT0iODciIHdpZHRoPSIzOCIgaGVpZ2h0PSIyMTIiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIxMTciIHk9Ijk4IiB3aWR0aD0iMzgiIGhlaWdodD0iMjAxIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTcyIiB5PSIxMDQiIHdpZHRoPSIzOCIgaGVpZ2h0PSIxOTUiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyMjYiIHk9IjExNSIgd2lkdGg9IjM4IiBoZWlnaHQ9IjE4NCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjI4MSIgeT0iMTE2IiB3aWR0aD0iMzgiIGhlaWdodD0iMTgzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzM1IiB5PSIxMjMiIHdpZHRoPSIzOCIgaGVpZ2h0PSIxNzYiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIzOTAiIHk9IjEzMCIgd2lkdGg9IjM4IiBoZWlnaHQ9IjE2OSIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ0NCIgeT0iMTQwIiB3aWR0aD0iMzgiIGhlaWdodD0iMTU5IiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDk5IiB5PSIxNjUiIHdpZHRoPSIzOCIgaGVpZ2h0PSIxMzQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1NTMiIHk9IjE2NiIgd2lkdGg9IjM4IiBoZWlnaHQ9IjEzMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjYwOCIgeT0iMTY5IiB3aWR0aD0iMzgiIGhlaWdodD0iMTMwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjYyIiB5PSIxNzUiIHdpZHRoPSIzOCIgaGVpZ2h0PSIxMjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

## Findings

**23.0% of all goals arrive in the dying minutes** (effective minute ≥ 76').
Home teams score 1,422 late goals to the away side's 1,183 — the home edge
persists late, as it does everywhere else.

**Most dangerous in the final quarter-hour** (min. 20 matches):

- **Argentina — 1.00 late goals/match** (22 in 22 games, 44% of all their goals
  come late)
- **France — 0.95/match**, **England — 0.80/match**
- Best big-sample name: **Real Madrid — 0.63/match** over 68 matches

At the other end, Houston Dash and Gazélec Ajaccio barely register (0.09/match)
— though small samples warn against over-reading.

**The league pattern is the real story:** African Cup of Nations matches see
**47.2%** of goals arrive late (1.56/match), UEFA Euro 37.7%, World Cup 32.1% —
versus Bundesliga's 16.5% and La Liga's 21.1%. Tournament football is cagey,
low-scoring, and decided late; league football spreads its goals across 90
minutes. The dying minutes aren't just dramatic — they're where a third of all
football actually happens.
