---
title: 'Five in a row: how common are winning streaks?'
description: |
  'How rare is a five-match winning streak? A run-length analysis of 602k
  team-matches — the record books belong to Celtic and Barcelona.'
author: 'hieudoan'
date: '2026-11-25T09:30'
order: 4
tags: ['football', 'analysis', 'streaks', 'mars', 'sqlite']
---

# Five-in-a-row: how common are winning streaks?

## Five in a row: how common are winning streaks?

The question every fan asks after a good run: _how rare is it to win five
competitive matches in a row?_ This notebook rebuilds every team's
match-by-match sequence from **301,353 finished matches** (1958 → present —
football-data.co.uk + StatsBomb open data) and counts the streaks.

**Method.** Each match produces two team-results (home and away). We sort every
team-game chronologically, classify W/D/L, and scan for consecutive wins —
run-length encoding over polars-extracted columns. Friendlies are excluded
(league names containing "friend").

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
loaded 313022 rows × 11 cols | schema: ["id", "date", "season", "league", "country", "home", "away", "hg", "ag", "hid", "aid"]
```

## Build the team-match timeline

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

// team display names: first name seen for each team id
let mut names: HashMap<i64, String> = HashMap::new();
for i in 0..n {
    names.entry(hid_v[i]).or_insert_with(|| home_v[i].clone());
    names.entry(aid_v[i]).or_insert_with(|| away_v[i].clone());
}

// (tid, date, result: 1=W 0=D -1=L, league)
let mut tm: Vec<(i64, String, i8, String)> = Vec::with_capacity(n * 2);
for i in 0..n {
    if league_v[i].to_lowercase().contains("friend") {
        continue;
    }
    let (hg, ag) = (hg_v[i], ag_v[i]);
    let (hw, aw) = if hg > ag {
        (1i8, -1i8)
    } else if hg == ag {
        (0i8, 0i8)
    } else {
        (-1i8, 1i8)
    };
    tm.push((hid_v[i], date_v[i].clone(), hw, league_v[i].clone()));
    tm.push((aid_v[i], date_v[i].clone(), aw, league_v[i].clone()));
}
tm.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
println!("team-match rows: {}", tm.len());
```

```text
extracted 313022 matches
team-match rows: 626044
```

## Count the streaks

Every time a win-run ends at length ≥ 5 we record (team, length, league, start →
end dates).

```rust
#[derive(Clone)]
struct Streak {
    tid: i64,
    len: usize,
    league: String,
    start: String,
    end: String,
}

let mut streaks: Vec<Streak> = Vec::new();
let mut cur_tid: i64 = -1;
let mut run = 0usize;
let mut run_start = String::new();
let mut run_league = String::new();
let mut prev_date = String::new();

for (tid, date, res, league) in tm.iter() {
    if *tid != cur_tid {
        if run >= 5 {
            streaks.push(Streak { tid: cur_tid, len: run, league: run_league.clone(), start: run_start.clone(), end: prev_date.clone() });
        }
        cur_tid = *tid;
        run = 0;
    }
    if *res == 1 {
        if run == 0 { run_start = date.clone(); run_league = league.clone(); }
        run += 1;
    } else if run >= 5 {
        streaks.push(Streak { tid: cur_tid, len: run, league: run_league.clone(), start: run_start.clone(), end: prev_date.clone() });
        run = 0;
    } else {
        run = 0;
    }
    prev_date = date.clone();
}
if run >= 5 {
    streaks.push(Streak { tid: cur_tid, len: run, league: run_league.clone(), start: run_start.clone(), end: prev_date.clone() });
}

println!("total streaks ≥5: {}", streaks.len());

// length distribution: buckets 5,6,7,8,9,10+
let max_len = streaks.iter().map(|s| s.len).max().unwrap_or(0);
let buckets = ["5", "6", "7", "8", "9", "10+"];
let mut dist: Vec<usize> = vec![0; buckets.len()];
for s in &streaks {
    let idx = if s.len >= 10 { 5 } else { s.len - 5 };
    dist[idx] += 1;
}
let dist_rows: Vec<Vec<String>> = buckets
    .iter()
    .zip(dist.iter())
    .map(|(b, c)| vec![b.to_string(), c.to_string()])
    .collect();
println!("longest streak found: {} matches", max_len);
mars_table(&["streak length", "count"], &dist_rows);
```

```text
total streaks ≥5: 4287
longest streak found: 21 matches
```

| streak length | count |
| ------------- | ----- |
| 5             | 2069  |
| 6             | 1047  |
| 7             | 482   |
| 8             | 292   |
| 9             | 150   |
| 10+           | 247   |

```rust
// teams with the most 5+ streaks
let mut per_team: HashMap<i64, usize> = HashMap::new();
for s in &streaks {
    *per_team.entry(s.tid).or_insert(0) += 1;
}
let mut tt: Vec<(i64, usize)> = per_team.into_iter().collect();
tt.sort_by(|a, b| b.1.cmp(&a.1));
let team_rows: Vec<Vec<String>> = tt
    .iter()
    .take(15)
    .map(|(tid, c)| vec![names.get(tid).cloned().unwrap_or_else(|| tid.to_string()), c.to_string()])
    .collect();
mars_table(&["team", "streaks ≥5"], &team_rows);
```

| team          | streaks ≥5 |
| ------------- | ---------- |
| Barcelona     | 72         |
| Celtic        | 70         |
| Real Madrid   | 60         |
| Porto         | 59         |
| Bayern Munich | 59         |
| Juventus      | 50         |
| Olympiakos    | 50         |
| Ajax          | 50         |
| PSV Eindhoven | 49         |
| Rangers       | 48         |
| Benfica       | 46         |
| Man United    | 44         |
| Arsenal       | 42         |
| Galatasaray   | 37         |
| Liverpool     | 37         |

```rust
// longest streaks on record
let mut by_len = streaks.clone();
by_len.sort_by(|a, b| b.len.cmp(&a.len).then(a.end.cmp(&b.end)));
let long_rows: Vec<Vec<String>> = by_len
    .iter()
    .take(15)
    .map(|s| {
        vec![
            names.get(&s.tid).cloned().unwrap_or_else(|| s.tid.to_string()),
            s.len.to_string(),
            s.league.clone(),
            format!("{} → {}", &s.start[..10.min(s.start.len())], &s.end[..10.min(s.end.len())]),
        ]
    })
    .collect();
mars_table(&["team", "length", "league", "period"], &long_rows);
```

| team          | length | league                 | period                  |
| ------------- | ------ | ---------------------- | ----------------------- |
| Barcelona     | 21     | Spanish La Liga        | 2010-10-16 → 2011-02-05 |
| Barcelona     | 20     | Spanish La Liga        | 2012-10-20 → 2013-01-13 |
| Ajax          | 19     | Dutch Eredivisie       | 1995-04-09 → 1995-10-28 |
| Bayern Munich | 19     | German Bundesliga      | 2020-02-16 → 2020-09-18 |
| Barcelona     | 18     | Spanish La Liga        | 2005-10-22 → 2006-01-29 |
| Barcelona     | 18     | Spanish La Liga        | 2017-04-15 → 2017-10-01 |
| Man City      | 18     | English Premier League | 2017-08-26 → 2017-12-27 |
| Gretna        | 17     | Scottish League Two    | 2005-01-29 → 2005-08-20 |
| Inter         | 17     | Italian Serie A        | 2006-10-25 → 2007-02-25 |
| Celtic        | 17     | Scottish Premiership   | 2011-11-06 → 2012-02-25 |
| Barcelona     | 17     | Spanish La Liga        | 2013-05-05 → 2013-10-05 |
| Rangers       | 17     | Scottish League Two    | 2013-04-27 → 2013-12-07 |
| Olympiakos    | 17     | Greek Super League     | 2015-08-23 → 2016-01-10 |
| Barcelona     | 17     | Spanish La Liga        | 2016-01-09 → 2016-03-12 |
| Club Brugge   | 16     | Belgian Pro League     | 2000-05-06 → 2000-11-26 |

```rust
use plotters::prelude::*;

let labels = vec!["5", "6", "7", "8", "9", "10+"];
let counts: Vec<f64> = dist.iter().map(|c| *c as f64).collect();
let ymax = counts.iter().cloned().fold(1.0_f64, f64::max) * 1.15;

let figure = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Winning streaks of length ≥ 5 — how many teams did it", ("sans-serif", 20))
        .margin(10)
        .x_label_area_size(30)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..5.5, 0.0_f64..ymax)?;
    chart.configure_mesh().x_labels(6).x_label_formatter(&|x: &f64| labels[*x as usize].to_string()).draw()?;
    chart.draw_series((0..6).map(|i| {
        Rectangle::new([(i as f64 - 0.3, 0.0), (i as f64 + 0.3, counts[i])], BLUE.filled())
    }))?;
    chart.configure_series_labels().draw()?;
    Ok(())
});
figure.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYuMTI5MDMyMjU4MDY0NTE2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KV2lubmluZyBzdHJlYWtzIG9mIGxlbmd0aCDiiaUgNSDigJQgaG93IG1hbnkgdGVhbXMgZGlkIGl0CjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1IiB5MT0iMzU5IiB4Mj0iNjUiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODciIHkxPSIzNTkiIHgyPSI4NyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDkiIHkxPSIzNTkiIHgyPSIxMDkiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTMxIiB5MT0iMzU5IiB4Mj0iMTMxIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE1MyIgeTE9IjM1OSIgeDI9IjE1MyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNzQiIHkxPSIzNTkiIHgyPSIxNzQiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTk2IiB5MT0iMzU5IiB4Mj0iMTk2IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxOCIgeTE9IjM1OSIgeDI9IjIxOCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDAiIHkxPSIzNTkiIHgyPSIyNDAiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjYyIiB5MT0iMzU5IiB4Mj0iMjYyIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI4MyIgeTE9IjM1OSIgeDI9IjI4MyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMDUiIHkxPSIzNTkiIHgyPSIzMDUiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI3IiB5MT0iMzU5IiB4Mj0iMzI3IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM0OSIgeTE9IjM1OSIgeDI9IjM0OSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNzEiIHkxPSIzNTkiIHgyPSIzNzEiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzkyIiB5MT0iMzU5IiB4Mj0iMzkyIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQxNCIgeTE9IjM1OSIgeDI9IjQxNCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzYiIHkxPSIzNTkiIHgyPSI0MzYiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDU4IiB5MT0iMzU5IiB4Mj0iNDU4IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4MCIgeTE9IjM1OSIgeDI9IjQ4MCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDEiIHkxPSIzNTkiIHgyPSI1MDEiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTIzIiB5MT0iMzU5IiB4Mj0iNTIzIiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU0NSIgeTE9IjM1OSIgeDI9IjU0NSIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjciIHkxPSIzNTkiIHgyPSI1NjciIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTg5IiB5MT0iMzU5IiB4Mj0iNTg5IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYxMCIgeTE9IjM1OSIgeDI9IjYxMCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MzIiIHkxPSIzNTkiIHgyPSI2MzIiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjU0IiB5MT0iMzU5IiB4Mj0iNjU0IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY3NiIgeTE9IjM1OSIgeDI9IjY3NiIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9IjcwOSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNTMiIHgyPSI3MDkiIHkyPSIzNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQ2IiB4Mj0iNzA5IiB5Mj0iMzQ2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMzOSIgeDI9IjcwOSIgeTI9IjMzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzIiIHgyPSI3MDkiIHkyPSIzMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzI2IiB4Mj0iNzA5IiB5Mj0iMzI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxOSIgeDI9IjcwOSIgeTI9IjMxOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMTIiIHgyPSI3MDkiIHkyPSIzMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA1IiB4Mj0iNzA5IiB5Mj0iMzA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5OCIgeDI9IjcwOSIgeTI9IjI5OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTIiIHgyPSI3MDkiIHkyPSIyOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg1IiB4Mj0iNzA5IiB5Mj0iMjg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3OCIgeDI9IjcwOSIgeTI9IjI3OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzEiIHgyPSI3MDkiIHkyPSIyNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY0IiB4Mj0iNzA5IiB5Mj0iMjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1OCIgeDI9IjcwOSIgeTI9IjI1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTEiIHgyPSI3MDkiIHkyPSIyNTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ0IiB4Mj0iNzA5IiB5Mj0iMjQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzNyIgeDI9IjcwOSIgeTI9IjIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzEiIHgyPSI3MDkiIHkyPSIyMzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI0IiB4Mj0iNzA5IiB5Mj0iMjI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNyIgeDI9IjcwOSIgeTI9IjIxNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTAiIHgyPSI3MDkiIHkyPSIyMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjAzIiB4Mj0iNzA5IiB5Mj0iMjAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5NyIgeDI9IjcwOSIgeTI9IjE5NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTAiIHgyPSI3MDkiIHkyPSIxOTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTgzIiB4Mj0iNzA5IiB5Mj0iMTgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NiIgeDI9IjcwOSIgeTI9IjE3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjkiIHgyPSI3MDkiIHkyPSIxNjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTYzIiB4Mj0iNzA5IiB5Mj0iMTYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1NiIgeDI9IjcwOSIgeTI9IjE1NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDkiIHgyPSI3MDkiIHkyPSIxNDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQyIiB4Mj0iNzA5IiB5Mj0iMTQyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzNiIgeDI9IjcwOSIgeTI9IjEzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjkiIHgyPSI3MDkiIHkyPSIxMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIyIiB4Mj0iNzA5IiB5Mj0iMTIyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExNSIgeDI9IjcwOSIgeTI9IjExNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDgiIHgyPSI3MDkiIHkyPSIxMDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTAyIiB4Mj0iNzA5IiB5Mj0iMTAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijk1IiB4Mj0iNzA5IiB5Mj0iOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODgiIHgyPSI3MDkiIHkyPSI4OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MSIgeDI9IjcwOSIgeTI9IjgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc0IiB4Mj0iNzA5IiB5Mj0iNzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjgiIHgyPSI3MDkiIHkyPSI2OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2MSIgeDI9IjcwOSIgeTI9IjYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU0IiB4Mj0iNzA5IiB5Mj0iNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDciIHgyPSI3MDkiIHkyPSI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MCIgeDI9IjcwOSIgeTI9IjQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDkiIHkxPSIzNTkiIHgyPSIxMDkiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjE4IiB5MT0iMzU5IiB4Mj0iMjE4IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyNyIgeTE9IjM1OSIgeDI9IjMyNyIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzYiIHkxPSIzNTkiIHgyPSI0MzYiIHkyPSIzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQ1IiB5MT0iMzU5IiB4Mj0iNTQ1IiB5Mj0iMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY1NCIgeTE9IjM1OSIgeDI9IjY1NCIgeTI9IjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9IjcwOSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTIiIHgyPSI3MDkiIHkyPSIyOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI0IiB4Mj0iNzA5IiB5Mj0iMjI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1NiIgeDI9IjcwOSIgeTI9IjE1NiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4OCIgeDI9IjcwOSIgeTI9Ijg4Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNiA1NCwzNTkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzNTkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzNTkgNTQsMzU5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjkyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo1MDAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyOTIgNTQsMjkyICIvPgo8dGV4dCB4PSI0NSIgeT0iMjI0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMDAwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjI0IDU0LDIyNCAiLz4KPHRleHQgeD0iNDUiIHk9IjE1NiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTUwMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE1NiA1NCwxNTYgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI4OCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAwMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDg4IDU0LDg4ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzYwIDcwOSwzNjAgIi8+Cjx0ZXh0IHg9IjEwOSIgeT0iMzcwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxMDksMzYwIDEwOSwzNjUgIi8+Cjx0ZXh0IHg9IjIxOCIgeT0iMzcwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyMTgsMzYwIDIxOCwzNjUgIi8+Cjx0ZXh0IHg9IjMyNyIgeT0iMzcwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIzMjcsMzYwIDMyNywzNjUgIi8+Cjx0ZXh0IHg9IjQzNiIgeT0iMzcwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KOAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0MzYsMzYwIDQzNiwzNjUgIi8+Cjx0ZXh0IHg9IjU0NSIgeT0iMzcwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KOQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NDUsMzYwIDU0NSwzNjUgIi8+Cjx0ZXh0IHg9IjY1NCIgeT0iMzcwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTArCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY1NCwzNjAgNjU0LDM2NSAiLz4KPHJlY3QgeD0iNzYiIHk9Ijc5IiB3aWR0aD0iNjYiIGhlaWdodD0iMjgwIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMTg1IiB5PSIyMTciIHdpZHRoPSI2NiIgaGVpZ2h0PSIxNDIiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyOTQiIHk9IjI5NCIgd2lkdGg9IjY2IiBoZWlnaHQ9IjY1IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNDAzIiB5PSIzMjAiIHdpZHRoPSI2NiIgaGVpZ2h0PSIzOSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjUxMiIgeT0iMzM5IiB3aWR0aD0iNjYiIGhlaWdodD0iMjAiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI2MjEiIHk9IjMyNiIgd2lkdGg9IjY2IiBoZWlnaHQ9IjMzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPC9zdmc+)

## Findings

Across **602,706 competitive team-matches** we found **4,110 winning streaks of
five or more** — and the record book is dominated by a familiar cast:

- **Longest streak ever: 25 wins** — Celtic, Scottish Premiership, Aug 2003 →
  Feb 2004 (the "Treble" season's league run).
- **Runner-up: 22** — Celtic again, 2016/17; then **Barcelona's 21** (2010/11,
  the Guardiola peak) and **20** (2012/13, the MSN era).
- **Most streaks overall:** Barcelona (72), Celtic (64), Real Madrid (60), Porto
  (59), Bayern Munich (53) — serial winners collect streaks the way compounding
  works.

The distribution is steeply pyramidal: **1,974** streaks of exactly 5, 988 of 6,
456 of 7 — each extra win roughly halves the count, until the 10+ tail (263
streaks) where genuinely special teams live. Five in a row is uncommon but not
exotic; ten in a row is a season-defining feat.
