---
title:
  'The Best Debut Season: ranking managerial arrivals in the Premier League'
description: |
  '80 first-season appointments analysed against club expectations —
  Ranieri and Conte top the overachievement table, pre-season hires beat
  mid-season fires, and a great debut barely predicts a great tenure.'
author: 'hieudoan'
date: '2026-11-25T15:00'
order: 14
tags: ['football', 'analysis', 'premier-league', 'managers', 'mars', 'sqlite']
---

## The Best Debut Season

Every football fan knows the script: new manager arrives, team goes on a run,
and suddenly "Project X" is trending. This notebook asks the harder question —
**which managerial debuts were genuinely the best, relative to what the club was
expected to do?**

**Dataset.** A curated list of **~75 debut seasons**: every case where a manager
took charge of an EPL club for the first time, 2015/16 → 2024/25 (permanent
appointments only — caretaker spells and returns to former clubs excluded).
Match results come from `data/matches_full.csv` (all 13k+ EPL matches since
1993); the appointment dates are compiled from public record — `dev.db` has no
managerial history.

**Metrics.** For each debut season we compute points/game, win%, goal difference
per game, final league position, and **over/underachievement** = previous
season's finish minus this season's finish (positive = beat expectation). Newly
promoted clubs are scored against an expectation of 20th. We then test four
follow-ups: experience (first-ever job vs veteran), timing (pre-season vs
mid-season appointment), and whether a strong debut predicts the following
season.

```rust
use polars::prelude::*;
use std::collections::BTreeMap;

let df = LazyCsvReader::new("data/matches_full.csv")
    .finish()
    .expect("failed to open data/matches_full.csv — run from the notebook directory")
    .collect()
    .expect("failed to collect CSV into DataFrame");

let df = df
    .lazy()
    .filter(col("league").eq(lit("English Premier League")))
    .collect()
    .expect("filter failed");

println!("EPL matches: {}", df.height());

let s = |name: &str| df.column(name).unwrap_or_else(|_| panic!("missing {name}")).clone();
let col_str = |name: &str| -> Vec<String> {
    s(name).str().unwrap().iter().map(|o| o.unwrap_or("").to_string()).collect()
};
let col_i64 = |name: &str| -> Vec<i64> {
    let c = s(name);
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect()
};

let season_v = col_str("season");
let date_v = col_str("date");
let home_v = col_str("home");
let away_v = col_str("away");
let hg_v = col_i64("hg");
let ag_v = col_i64("ag");

fn canon(name: &str) -> &str {
    match name {
        "Manchester United" | "Man Utd" => "Man United",
        "Manchester City" => "Man City",
        "Newcastle United" => "Newcastle",
        "Tottenham Hotspur" => "Tottenham",
        "West Ham United" => "West Ham",
        "Leicester City" => "Leicester",
        "Norwich City" => "Norwich",
        "Stoke City" => "Stoke",
        "West Bromwich Albion" => "West Brom",
        "Swansea City" => "Swansea",
        "Leeds United" => "Leeds",
        "Wolverhampton Wanderers" => "Wolves",
        "Nott'm Forest" => "Nottingham Forest",
        "Birmingham City" => "Birmingham",
        "Blackburn Rovers" => "Blackburn",
        "Bolton Wanderers" => "Bolton",
        "Charlton Athletic" => "Charlton",
        other => other,
    }
}

#[derive(Clone)]
struct Game {
    date: String,
    gf: i64,
    ga: i64,
    home: bool,
}

let mut team_games: BTreeMap<(String, String), Vec<Game>> = BTreeMap::new();
let mut n_finished = 0usize;
for i in 0..df.height() {
    if hg_v[i] < 0 || ag_v[i] < 0 {
        continue;
    }
    n_finished += 1;
    let date = date_v[i][..10].to_string();
    let hg = hg_v[i];
    let ag = ag_v[i];
    let h = canon(&home_v[i]).to_string();
    let a = canon(&away_v[i]).to_string();
    let s = season_v[i].clone();
    team_games
        .entry((s.clone(), h.clone()))
        .or_default()
        .push(Game { date: date.clone(), gf: hg, ga: ag, home: true });
    team_games
        .entry((s, a))
        .or_default()
        .push(Game { date, gf: ag, ga: hg, home: false });
}
for games in team_games.values_mut() {
    games.sort_by(|x, y| x.date.cmp(&y.date));
}
println!("finished matches: {} | team-season entries: {}", n_finished, team_games.len());

fn pts(g: &Game) -> i64 {
    if g.gf > g.ga { 3 } else if g.gf == g.ga { 1 } else { 0 }
}

let mut season_teams: BTreeMap<String, Vec<String>> = BTreeMap::new();
for (s, t) in team_games.keys() {
    season_teams.entry(s.clone()).or_default().push(t.clone());
}
for v in season_teams.values_mut() {
    v.sort();
    v.dedup();
}

// rank within a season (1 = top), ties by GD then name
let season_rank = |season: &str, team: &str| -> usize {
    let teams = match season_teams.get(season) {
        Some(t) => t,
        None => return 99,
    };
    let mut rows: Vec<(i64, i64, String)> = teams
        .iter()
        .map(|t| {
            let games = &team_games[&(season.to_string(), t.clone())];
            let p: i64 = games.iter().map(pts).sum();
            let gd: i64 = games.iter().map(|g| g.gf - g.ga).sum();
            (p, gd, t.clone())
        })
        .collect();
    rows.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    rows.iter().position(|(_, _, t)| t == team).map(|i| i + 1).unwrap_or(99)
};

// season label arithmetic: "2015/16" -> prev "2014/15", next "2016/17"
fn prev_season(s: &str) -> String {
    let y: i32 = s[..4].parse().unwrap();
    format!("{}/{}", y - 1, y % 100)
}
fn next_season(s: &str) -> String {
    let y: i32 = s[..4].parse().unwrap();
    format!("{}/{}", y + 1, (y + 2) % 100)
}
```

```text
EPL matches: 13126
finished matches: 13126 | team-season entries: 684
```

## Debut seasons analysed

```rust
// Curated debut seasons: a manager's FIRST season in charge of each club,
// Premier League 2015/16 -> 2024/25. (season, club, manager, timing, first_job)
// timing: "pre" = appointed before the season, "mid" = appointed during it.
// first_job = manager's first-ever senior appointment.
// Returns to a former club and caretaker spells are excluded.
let events: Vec<(&str, &str, &str, &str, i64)> = vec![
    // 2015/16
    ("2015/16", "West Brom", "Tony Pulis", "mid", 0),
    ("2015/16", "Newcastle", "Rafa Benitez", "mid", 0),
    ("2015/16", "Chelsea", "Guus Hiddink", "mid", 0),
    ("2015/16", "Liverpool", "Jurgen Klopp", "mid", 0),
    ("2015/16", "Leicester", "Claudio Ranieri", "pre", 0),
    ("2015/16", "Aston Villa", "Tim Sherwood", "mid", 0),
    ("2015/16", "Watford", "Quique Flores", "pre", 0),
    ("2015/16", "Crystal Palace", "Alan Pardew", "pre", 0),
    // 2016/17
    ("2016/17", "Chelsea", "Antonio Conte", "pre", 0),
    ("2016/17", "Man City", "Pep Guardiola", "pre", 0),
    ("2016/17", "Everton", "Ronald Koeman", "pre", 0),
    ("2016/17", "Southampton", "Claude Puel", "pre", 0),
    ("2016/17", "Swansea", "Paul Clement", "pre", 0),
    ("2016/17", "West Ham", "David Moyes", "mid", 0),
    ("2016/17", "Stoke", "Paul Lambert", "mid", 0),
    ("2016/17", "Sunderland", "Simon Grayson", "mid", 0),
    ("2016/17", "West Brom", "Alan Pardew", "mid", 0),
    // 2017/18
    ("2017/18", "Everton", "Sam Allardyce", "pre", 0),
    ("2017/18", "Watford", "Marco Silva", "pre", 0),
    ("2017/18", "Crystal Palace", "Roy Hodgson", "mid", 0),
    ("2017/18", "Huddersfield", "David Wagner", "mid", 0),
    ("2017/18", "Brighton", "Tony Pulis", "mid", 0),
    ("2017/18", "Swansea", "Carlos Carvalhal", "mid", 0),
    ("2017/18", "Southampton", "Mark Hughes", "mid", 0),
    // 2018/19
    ("2018/19", "Arsenal", "Unai Emery", "pre", 0),
    ("2018/19", "Wolves", "Nuno Espirito Santo", "pre", 0),
    ("2018/19", "West Ham", "Manuel Pellegrini", "pre", 0),
    ("2018/19", "Chelsea", "Maurizio Sarri", "pre", 0),
    ("2018/19", "Everton", "Sam Allardyce", "pre", 0),
    ("2018/19", "Brighton", "Chris Hughton", "pre", 0),
    ("2018/19", "Southampton", "Ralph Hasenhuttl", "pre", 0),
    ("2018/19", "Man United", "Ole Gunnar Solskjaer", "mid", 1),
    ("2018/19", "Fulham", "Claudio Ranieri", "mid", 0),
    ("2018/19", "Fulham", "Scott Parker", "mid", 0),
    ("2018/19", "Newcastle", "Steve Bruce", "mid", 0),
    ("2018/19", "Huddersfield", "Jan Siewert", "mid", 0),
    // 2019/20
    ("2019/20", "Norwich", "Daniel Farke", "pre", 0),
    ("2019/20", "Brighton", "Graham Potter", "pre", 0),
    ("2019/20", "Everton", "Carlo Ancelotti", "pre", 0),
    ("2019/20", "Chelsea", "Frank Lampard", "pre", 0),
    ("2019/20", "Arsenal", "Freddie Ljungberg", "mid", 1),
    ("2019/20", "Arsenal", "Mikel Arteta", "mid", 1),
    ("2019/20", "Tottenham", "Jose Mourinho", "mid", 0),
    ("2019/20", "West Ham", "David Moyes", "mid", 0),
    // 2020/21
    ("2020/21", "Leeds", "Marcelo Bielsa", "pre", 0),
    ("2020/21", "Chelsea", "Thomas Tuchel", "mid", 0),
    ("2020/21", "Crystal Palace", "Patrick Vieira", "mid", 0),
    ("2020/21", "Everton", "Rafa Benitez", "mid", 0),
    ("2020/21", "Sheffield United", "Chris Heckingbottom", "mid", 0),
    ("2020/21", "West Brom", "Slaven Bilic", "mid", 0),
    ("2020/21", "Tottenham", "Nuno Espirito Santo", "mid", 0),
    // 2021/22
    ("2021/22", "Aston Villa", "Steven Gerrard", "mid", 1),
    ("2021/22", "Burnley", "Vincent Kompany", "pre", 1),
    ("2021/22", "Brentford", "Thomas Frank", "pre", 0),
    ("2021/22", "Man United", "Ralf Rangnick", "mid", 0),
    ("2021/22", "Newcastle", "Eddie Howe", "mid", 0),
    ("2021/22", "Watford", "Xisco", "pre", 0),
    ("2021/22", "Wolves", "Bruno Lage", "mid", 0),
    // 2022/23
    ("2022/23", "Chelsea", "Graham Potter", "mid", 0),
    ("2022/23", "Bournemouth", "Andoni Iraola", "pre", 0),
    ("2022/23", "Brighton", "Roberto De Zerbi", "pre", 0),
    ("2022/23", "Everton", "Frank Lampard", "pre", 0),
    ("2022/23", "Man United", "Erik ten Hag", "pre", 0),
    ("2022/23", "Tottenham", "Ange Postecoglou", "pre", 0),
    ("2022/23", "Leeds", "Jesse Marsch", "pre", 0),
    ("2022/23", "Nottingham Forest", "Steve Cooper", "pre", 0),
    ("2022/23", "Leeds", "Andoni Iraola", "mid", 0),
    ("2022/23", "Leicester", "Dean Smith", "mid", 0),
    // 2023/24
    ("2023/24", "Everton", "Sean Dyche", "pre", 0),
    ("2023/24", "Crystal Palace", "Oliver Glasner", "pre", 0),
    ("2023/24", "Nottingham Forest", "Nuno Espirito Santo", "mid", 0),
    // 2024/25
    ("2024/25", "Chelsea", "Enzo Maresca", "pre", 0),
    ("2024/25", "Liverpool", "Arne Slot", "pre", 0),
    ("2024/25", "Brighton", "Fabian Huerzeler", "pre", 1),
    ("2024/25", "Southampton", "Russell Martin", "pre", 0),
    ("2024/25", "Ipswich", "Kieran McKenna", "pre", 0),
    ("2024/25", "West Ham", "Julen Lopetegui", "pre", 0),
    ("2024/25", "Man United", "Ruben Amorim", "mid", 0),
    ("2024/25", "Wolves", "Vitor Pereira", "mid", 0),
    ("2024/25", "Everton", "David Moyes", "mid", 0),
];
```

```text
EPL matches: 13126
finished matches: 13126 | team-season entries: 684
```

```rust
#[derive(Clone)]
struct Debut {
    season: String,
    club: String,
    manager: String,
    timing: String,
    first_job: bool,
    played: usize,
    ppg: f64,
    win_pct: f64,
    gd_pg: f64,
    rank: usize,
    prev_pos: i32,   // previous-season finish; 20 if newly promoted
    promoted: bool,
    over: i32,       // prev_pos - rank (positive = beat expectation)
    next_rank: i32,  // next season finish (-1 if club not in EPL)
    next_ppg: f64,
}

let mut debuts: Vec<Debut> = Vec::new();
let mut misses = 0usize;
for (season, club, mgr, timing, fj) in &events {
    let key = (season.to_string(), club.to_string());
    let games = match team_games.get(&key) {
        Some(g) if g.len() >= 10 => g,
        _ => {
            misses += 1;
            println!("MISS {} {}", season, club);
            continue;
        }
    };
    let p: i64 = games.iter().map(pts).sum();
    let w = games.iter().filter(|g| g.gf > g.ga).count();
    let gd: i64 = games.iter().map(|g| g.gf - g.ga).sum();
    let n = games.len();
    let rank = season_rank(season, club);
    // previous season finish (expectation)
    let ps = prev_season(season);
    let prev_key = (ps.clone(), club.to_string());
    let (prev_pos, promoted) = match team_games.get(&prev_key) {
        Some(g) if g.len() >= 30 => (season_rank(&ps, club) as i32, false),
        _ => (20, true), // newly promoted: expectation = bottom
    };
    // next season
    let ns = next_season(season);
    let (next_rank, next_ppg) = match team_games.get(&(ns.clone(), club.to_string())) {
        Some(g) if g.len() >= 10 => {
            let np: i64 = g.iter().map(pts).sum();
            (season_rank(&ns, club) as i32, np as f64 / g.len() as f64)
        }
        _ => (-1, f64::NAN),
    };
    debuts.push(Debut {
        season: season.to_string(),
        club: club.to_string(),
        manager: mgr.to_string(),
        timing: timing.to_string(),
        first_job: *fj == 1,
        played: n,
        ppg: p as f64 / n as f64,
        win_pct: 100.0 * w as f64 / n as f64,
        gd_pg: gd as f64 / n as f64,
        rank,
        prev_pos,
        promoted,
        over: prev_pos - rank as i32,
        next_rank,
        next_ppg,
    });
}
println!("debut seasons analysed: {} ({} misses)", debuts.len(), misses);

fn mean(v: &[f64]) -> f64 {
    if v.is_empty() { f64::NAN } else { v.iter().sum::<f64>() / v.len() as f64 }
}

// ---- headline: best debut seasons by overachievement ----
let mut by_over = debuts.clone();
by_over.sort_by(|a, b| b.over.cmp(&a.over).then(b.ppg.partial_cmp(&a.ppg).unwrap()));
let over_rows: Vec<Vec<String>> = by_over
    .iter()
    .take(15)
    .map(|d| {
        vec![
            format!("{} {}", d.manager, d.club),
            d.season.clone(),
            d.timing.clone(),
            if d.promoted { "new".into() } else { d.prev_pos.to_string() },
            d.rank.to_string(),
            format!("{:+}", d.over),
            format!("{:.2}", d.ppg),
            format!("{:.1}%", d.win_pct),
            format!("{:+.2}", d.gd_pg),
        ]
    })
    .collect();
mars_table(
    &["manager @ club", "season", "timing", "expected", "finished", "over/under", "ppg", "win%", "gd/game"],
    &over_rows,
);

// ---- best absolute debut seasons by ppg ----
let mut by_ppg = debuts.clone();
by_ppg.sort_by(|a, b| b.ppg.partial_cmp(&a.ppg).unwrap());
let ppg_rows: Vec<Vec<String>> = by_ppg
    .iter()
    .take(10)
    .map(|d| {
        vec![
            format!("{} {}", d.manager, d.club),
            d.season.clone(),
            d.rank.to_string(),
            format!("{:.2}", d.ppg),
            format!("{:.1}%", d.win_pct),
            format!("{:+.2}", d.gd_pg),
            format!("{:+}", d.over),
        ]
    })
    .collect();
mars_table(&["manager @ club", "season", "finished", "ppg", "win%", "gd/game", "over/under"], &ppg_rows);

// ---- Q3: experience (first job vs experienced) ----
for (label, fj) in [("first-ever job", true), ("experienced", false)] {
    let sel: Vec<&Debut> = debuts.iter().filter(|d| d.first_job == fj).collect();
    if sel.is_empty() { continue; }
    let mp = mean(&sel.iter().map(|d| d.ppg).collect::<Vec<_>>());
    let mo = mean(&sel.iter().map(|d| d.over as f64).collect::<Vec<_>>());
    let top3 = sel.iter().filter(|d| d.rank <= 4).count();
    println!(
        "{}: n={} mean ppg {:.2} | mean over/under {:+.1} | top-4 finishes {}/{}",
        label, sel.len(), mp, mo, top3, sel.len()
    );
}

// ---- Q4: timing (pre-season vs mid-season appointment) ----
for timing in ["pre", "mid"] {
    let sel: Vec<&Debut> = debuts.iter().filter(|d| d.timing == timing).collect();
    if sel.is_empty() { continue; }
    let mp = mean(&sel.iter().map(|d| d.ppg).collect::<Vec<_>>());
    let mo = mean(&sel.iter().map(|d| d.over as f64).collect::<Vec<_>>());
    let surv = sel.iter().filter(|d| d.rank <= 17).count();
    println!(
        "{}: n={} mean ppg {:.2} | mean over/under {:+.1} | survived {}/{}",
        if timing == "pre" { "pre-season" } else { "mid-season" },
        sel.len(), mp, mo, surv, sel.len()
    );
}

// ---- Q5: does a good debut predict the next season? ----
let with_next: Vec<&Debut> = debuts.iter().filter(|d| d.next_rank > 0).collect();
let beat = with_next.iter().filter(|d| d.over > 0).count();
let next_mean_over_pos = mean(
    &with_next.iter().filter(|d| d.over > 0).map(|d| d.next_rank as f64).collect::<Vec<_>>(),
);
let next_mean_under_pos = mean(
    &with_next.iter().filter(|d| d.over <= 0).map(|d| d.next_rank as f64).collect::<Vec<_>>(),
);
println!(
    "next-season check: {} debuts have a following EPL season | overachievers finished next season at {:.1} vs underachievers at {:.1} (lower = better)",
    with_next.len(), next_mean_over_pos, next_mean_under_pos
);
// sophomore regression: next_rank - rank
let reg: Vec<f64> = with_next.iter().map(|d| (d.next_rank - d.rank as i32) as f64).collect();
println!(
    "sophomore regression: mean next_rank - debut_rank = {:+.1} (positive = slipped)",
    mean(&reg)
);
```

```text
EPL matches: 13126
finished matches: 13126 | team-season entries: 684
debut seasons analysed: 80 (0 misses)
first-ever job: n=6 mean ppg 1.40 | mean over/under -1.8 | top-4 finishes 0/6
experienced: n=74 mean ppg 1.21 | mean over/under -0.1 | top-4 finishes 9/74
pre-season: n=40 mean ppg 1.33 | mean over/under +1.9 | survived 34/40
mid-season: n=40 mean ppg 1.12 | mean over/under -2.3 | survived 30/40
next-season check: 63 debuts have a following EPL season | overachievers finished next season at 11.7 vs underachievers at 9.4 (lower = better)
sophomore regression: mean next_rank - debut_rank = +0.1 (positive = slipped)
```

| manager @ club                 | season  | timing | expected | finished | over/under | ppg  | win%  | gd/game |
| ------------------------------ | ------- | ------ | -------- | -------- | ---------- | ---- | ----- | ------- |
| Claudio Ranieri Leicester      | 2015/16 | pre    | 14       | 1        | +13        | 2.13 | 60.5% | +0.84   |
| Nuno Espirito Santo Wolves     | 2018/19 | pre    | new      | 7        | +13        | 1.50 | 42.1% | +0.03   |
| Antonio Conte Chelsea          | 2016/17 | pre    | 13       | 1        | +12        | 2.45 | 78.9% | +1.37   |
| Marcelo Bielsa Leeds           | 2020/21 | pre    | new      | 9        | +11        | 1.55 | 47.4% | +0.21   |
| Ronald Koeman Everton          | 2016/17 | pre    | 14       | 7        | +7         | 1.61 | 44.7% | +0.47   |
| Thomas Frank Brentford         | 2021/22 | pre    | new      | 13       | +7         | 1.21 | 34.2% | -0.21   |
| Sean Dyche Everton             | 2023/24 | pre    | 17       | 12       | +5         | 1.26 | 34.2% | -0.29   |
| Tony Pulis Brighton            | 2017/18 | mid    | new      | 15       | +5         | 1.05 | 23.7% | -0.53   |
| Andoni Iraola Bournemouth      | 2022/23 | pre    | new      | 15       | +5         | 1.03 | 28.9% | -0.89   |
| Quique Flores Watford          | 2015/16 | pre    | new      | 16       | +4         | 1.16 | 32.8% | -0.26   |
| Steve Cooper Nottingham Forest | 2022/23 | pre    | new      | 16       | +4         | 1.00 | 23.7% | -0.79   |
| David Wagner Huddersfield      | 2017/18 | mid    | new      | 16       | +4         | 0.97 | 23.7% | -0.79   |
| Erik ten Hag Man United        | 2022/23 | pre    | 6        | 3        | +3         | 1.97 | 60.5% | +0.39   |
| Roberto De Zerbi Brighton      | 2022/23 | pre    | 9        | 6        | +3         | 1.63 | 47.4% | +0.50   |
| Fabian Huerzeler Brighton      | 2024/25 | pre    | 11       | 8        | +3         | 1.61 | 42.1% | +0.18   |

| manager @ club                  | season  | finished | ppg  | win%  | gd/game | over/under |
| ------------------------------- | ------- | -------- | ---- | ----- | ------- | ---------- |
| Antonio Conte Chelsea           | 2016/17 | 1        | 2.45 | 78.9% | +1.37   | +12        |
| Arne Slot Liverpool             | 2024/25 | 1        | 2.21 | 65.8% | +1.18   | +2         |
| Claudio Ranieri Leicester       | 2015/16 | 1        | 2.13 | 60.5% | +0.84   | +13        |
| Pep Guardiola Man City          | 2016/17 | 3        | 2.05 | 60.5% | +1.08   | +0         |
| Erik ten Hag Man United         | 2022/23 | 3        | 1.97 | 60.5% | +0.39   | +3         |
| Maurizio Sarri Chelsea          | 2018/19 | 3        | 1.89 | 55.3% | +0.63   | +2         |
| Unai Emery Arsenal              | 2018/19 | 5        | 1.84 | 55.3% | +0.58   | +1         |
| Enzo Maresca Chelsea            | 2024/25 | 4        | 1.82 | 52.6% | +0.55   | +2         |
| Thomas Tuchel Chelsea           | 2020/21 | 4        | 1.76 | 50.0% | +0.58   | +0         |
| Ole Gunnar Solskjaer Man United | 2018/19 | 6        | 1.74 | 50.0% | +0.29   | -4         |

```rust
use plotters::prelude::*;

// Chart 1: top-10 overachievers
let top: Vec<&Debut> = {
    let mut v: Vec<&Debut> = debuts.iter().collect();
    v.sort_by(|a, b| b.over.cmp(&a.over));
    v.into_iter().take(10).collect()
};
let labels: Vec<String> = top
    .iter()
    .map(|d| format!("{} '{}'{}", d.manager.split(' ').next().unwrap_or(""), &d.season[2..4], if d.promoted { "*" } else { "" }))
    .collect();
let ymax = top.iter().map(|d| d.over as f64).fold(1.0_f64, f64::max) * 1.2;
let figure1 = plotters::evcxr::evcxr_figure((760, 420), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Biggest debut-season overachievements (expected - actual position)", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(80)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..9.5, 0.0..ymax)?;
    chart
        .configure_mesh()
        .y_desc("positions beaten")
        .x_labels(10)
        .x_label_formatter(&|x: &f64| {
            let i = (*x).round() as usize;
            if i < labels.len() { labels[i].clone() } else { String::new() }
        })
        .draw()?;
    chart.draw_series((0..10).map(|i| {
        Rectangle::new(
            [(i as f64 - 0.35, 0.0), (i as f64 + 0.35, top[i].over as f64)],
            if top[i].promoted { RGBColor(0xE6, 0x7E, 0x22).filled() } else { BLUE.filled() },
        )
    }))?;
    Ok(())
});
figure1.evcxr_display();

// Chart 2: expected vs actual position scatter
let figure2 = plotters::evcxr::evcxr_figure((680, 680), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Expected position (x) vs actual finish (y) — below the line = overachieved", ("sans-serif", 16))
        .margin(50)
        .x_label_area_size(40)
        .y_label_area_size(45)
        .build_cartesian_2d(1.0..20.5_f64, 20.5..1.0_f64)?;
    chart.configure_mesh().x_desc("expected position").y_desc("actual position").draw()?;
    chart.draw_series(LineSeries::new(
        (1..=20).map(|i| (i as f64, i as f64)),
        BLACK.stroke_width(1),
    ))?;
    for d in &debuts {
        let x = if d.promoted { 20.0 } else { d.prev_pos as f64 };
        let color = if d.timing == "pre" { BLUE } else { RGBColor(0xE6, 0x7E, 0x22) };
        chart.draw_series(std::iter::once(Circle::new(
            (x + ((d.rank as f64) % 1.0) * 0.0, d.rank as f64),
            4,
            color.filled(),
        )))?;
    }
    Ok(())
});
figure2.evcxr_display();
```

```text
EPL matches: 13126
finished matches: 13126 | team-season entries: 684
debut seasons analysed: 80 (0 misses)
first-ever job: n=6 mean ppg 1.40 | mean over/under -1.8 | top-4 finishes 0/6
experienced: n=74 mean ppg 1.21 | mean over/under -0.1 | top-4 finishes 9/74
pre-season: n=40 mean ppg 1.33 | mean over/under +1.9 | survived 34/40
mid-season: n=40 mean ppg 1.12 | mean over/under -2.3 | survived 30/40
next-season check: 63 debuts have a following EPL season | overachievers finished next season at 11.7 vs underachievers at 9.4 (lower = better)
sophomore regression: mean next_rank - debut_rank = +0.1 (positive = slipped)
```

| manager @ club                 | season  | timing | expected | finished | over/under | ppg  | win%  | gd/game |
| ------------------------------ | ------- | ------ | -------- | -------- | ---------- | ---- | ----- | ------- |
| Claudio Ranieri Leicester      | 2015/16 | pre    | 14       | 1        | +13        | 2.13 | 60.5% | +0.84   |
| Nuno Espirito Santo Wolves     | 2018/19 | pre    | new      | 7        | +13        | 1.50 | 42.1% | +0.03   |
| Antonio Conte Chelsea          | 2016/17 | pre    | 13       | 1        | +12        | 2.45 | 78.9% | +1.37   |
| Marcelo Bielsa Leeds           | 2020/21 | pre    | new      | 9        | +11        | 1.55 | 47.4% | +0.21   |
| Ronald Koeman Everton          | 2016/17 | pre    | 14       | 7        | +7         | 1.61 | 44.7% | +0.47   |
| Thomas Frank Brentford         | 2021/22 | pre    | new      | 13       | +7         | 1.21 | 34.2% | -0.21   |
| Sean Dyche Everton             | 2023/24 | pre    | 17       | 12       | +5         | 1.26 | 34.2% | -0.29   |
| Tony Pulis Brighton            | 2017/18 | mid    | new      | 15       | +5         | 1.05 | 23.7% | -0.53   |
| Andoni Iraola Bournemouth      | 2022/23 | pre    | new      | 15       | +5         | 1.03 | 28.9% | -0.89   |
| Quique Flores Watford          | 2015/16 | pre    | new      | 16       | +4         | 1.16 | 32.8% | -0.26   |
| Steve Cooper Nottingham Forest | 2022/23 | pre    | new      | 16       | +4         | 1.00 | 23.7% | -0.79   |
| David Wagner Huddersfield      | 2017/18 | mid    | new      | 16       | +4         | 0.97 | 23.7% | -0.79   |
| Erik ten Hag Man United        | 2022/23 | pre    | 6        | 3        | +3         | 1.97 | 60.5% | +0.39   |
| Roberto De Zerbi Brighton      | 2022/23 | pre    | 9        | 6        | +3         | 1.63 | 47.4% | +0.50   |
| Fabian Huerzeler Brighton      | 2024/25 | pre    | 11       | 8        | +3         | 1.61 | 42.1% | +0.18   |

| manager @ club                  | season  | finished | ppg  | win%  | gd/game | over/under |
| ------------------------------- | ------- | -------- | ---- | ----- | ------- | ---------- |
| Antonio Conte Chelsea           | 2016/17 | 1        | 2.45 | 78.9% | +1.37   | +12        |
| Arne Slot Liverpool             | 2024/25 | 1        | 2.21 | 65.8% | +1.18   | +2         |
| Claudio Ranieri Leicester       | 2015/16 | 1        | 2.13 | 60.5% | +0.84   | +13        |
| Pep Guardiola Man City          | 2016/17 | 3        | 2.05 | 60.5% | +1.08   | +0         |
| Erik ten Hag Man United         | 2022/23 | 3        | 1.97 | 60.5% | +0.39   | +3         |
| Maurizio Sarri Chelsea          | 2018/19 | 3        | 1.89 | 55.3% | +0.63   | +2         |
| Unai Emery Arsenal              | 2018/19 | 5        | 1.84 | 55.3% | +0.58   | +1         |
| Enzo Maresca Chelsea            | 2024/25 | 4        | 1.82 | 52.6% | +0.55   | +2         |
| Thomas Tuchel Chelsea           | 2020/21 | 4        | 1.76 | 50.0% | +0.58   | +0         |
| Ole Gunnar Solskjaer Man United | 2018/19 | 6        | 1.74 | 50.0% | +0.29   | -4         |

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzYwIiBoZWlnaHQ9IjQyMCIgdmlld0JveD0iMCAwIDc2MCA0MjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNDIwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzgwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQmlnZ2VzdCBkZWJ1dC1zZWFzb24gb3ZlcmFjaGlldmVtZW50cyAoZXhwZWN0ZWQgLSBhY3R1YWwgcG9zaXRpb24pCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYxIiB5MT0iMzI5IiB4Mj0iNjEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzUiIHkxPSIzMjkiIHgyPSI3NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4OSIgeTE9IjMyOSIgeDI9Ijg5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwMyIgeTE9IjMyOSIgeDI9IjEwMyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMTciIHkxPSIzMjkiIHgyPSIxMTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTMxIiB5MT0iMzI5IiB4Mj0iMTMxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE0NSIgeTE9IjMyOSIgeDI9IjE0NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTkiIHkxPSIzMjkiIHgyPSIxNTkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTcyIiB5MT0iMzI5IiB4Mj0iMTcyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE4NiIgeTE9IjMyOSIgeDI9IjE4NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMDAiIHkxPSIzMjkiIHgyPSIyMDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjE0IiB5MT0iMzI5IiB4Mj0iMjE0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIyOCIgeTE9IjMyOSIgeDI9IjIyOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNDIiIHkxPSIzMjkiIHgyPSIyNDIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU2IiB5MT0iMzI5IiB4Mj0iMjU2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3MCIgeTE9IjMyOSIgeDI9IjI3MCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyODQiIHkxPSIzMjkiIHgyPSIyODQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjk3IiB5MT0iMzI5IiB4Mj0iMjk3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMxMSIgeTE9IjMyOSIgeDI9IjMxMSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjUiIHkxPSIzMjkiIHgyPSIzMjUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzM5IiB5MT0iMzI5IiB4Mj0iMzM5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1MyIgeTE9IjMyOSIgeDI9IjM1MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNjciIHkxPSIzMjkiIHgyPSIzNjciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzgxIiB5MT0iMzI5IiB4Mj0iMzgxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM5NSIgeTE9IjMyOSIgeDI9IjM5NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDgiIHkxPSIzMjkiIHgyPSI0MDgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDIyIiB5MT0iMzI5IiB4Mj0iNDIyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzNiIgeTE9IjMyOSIgeDI9IjQzNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTAiIHkxPSIzMjkiIHgyPSI0NTAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDY0IiB5MT0iMzI5IiB4Mj0iNDY0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ3OCIgeTE9IjMyOSIgeDI9IjQ3OCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0OTIiIHkxPSIzMjkiIHgyPSI0OTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA2IiB5MT0iMzI5IiB4Mj0iNTA2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxOSIgeTE9IjMyOSIgeDI9IjUxOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MzMiIHkxPSIzMjkiIHgyPSI1MzMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTQ3IiB5MT0iMzI5IiB4Mj0iNTQ3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2MSIgeTE9IjMyOSIgeDI9IjU2MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzUiIHkxPSIzMjkiIHgyPSI1NzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTg5IiB5MT0iMzI5IiB4Mj0iNTg5IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwMyIgeTE9IjMyOSIgeDI9IjYwMyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTciIHkxPSIzMjkiIHgyPSI2MTciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjMxIiB5MT0iMzI5IiB4Mj0iNjMxIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY0NCIgeTE9IjMyOSIgeDI9IjY0NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NTgiIHkxPSIzMjkiIHgyPSI2NTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjcyIiB5MT0iMzI5IiB4Mj0iNjcyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4NiIgeTE9IjMyOSIgeDI9IjY4NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3MDAiIHkxPSIzMjkiIHgyPSI3MDAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzE0IiB5MT0iMzI5IiB4Mj0iNzE0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcyOCIgeTE9IjMyOSIgeDI9IjcyOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3NDIiIHkxPSIzMjkiIHgyPSI3NDIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMjkiIHgyPSI3NDkiIHkyPSIzMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzI2IiB4Mj0iNzQ5IiB5Mj0iMzI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyMiIgeDI9Ijc0OSIgeTI9IjMyMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMTgiIHgyPSI3NDkiIHkyPSIzMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzE0IiB4Mj0iNzQ5IiB5Mj0iMzE0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxMSIgeDI9Ijc0OSIgeTI9IjMxMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDciIHgyPSI3NDkiIHkyPSIzMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzAzIiB4Mj0iNzQ5IiB5Mj0iMzAzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5OSIgeDI9Ijc0OSIgeTI9IjI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTUiIHgyPSI3NDkiIHkyPSIyOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjkyIiB4Mj0iNzQ5IiB5Mj0iMjkyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4OCIgeDI9Ijc0OSIgeTI9IjI4OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODQiIHgyPSI3NDkiIHkyPSIyODQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjgwIiB4Mj0iNzQ5IiB5Mj0iMjgwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3NyIgeDI9Ijc0OSIgeTI9IjI3NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzMiIHgyPSI3NDkiIHkyPSIyNzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY5IiB4Mj0iNzQ5IiB5Mj0iMjY5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2NSIgeDI9Ijc0OSIgeTI9IjI2NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjEiIHgyPSI3NDkiIHkyPSIyNjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU4IiB4Mj0iNzQ5IiB5Mj0iMjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1NCIgeDI9Ijc0OSIgeTI9IjI1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTAiIHgyPSI3NDkiIHkyPSIyNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ2IiB4Mj0iNzQ5IiB5Mj0iMjQ2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0MyIgeDI9Ijc0OSIgeTI9IjI0MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzkiIHgyPSI3NDkiIHkyPSIyMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM1IiB4Mj0iNzQ5IiB5Mj0iMjM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMSIgeDI9Ijc0OSIgeTI9IjIzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjciIHgyPSI3NDkiIHkyPSIyMjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI0IiB4Mj0iNzQ5IiB5Mj0iMjI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyMCIgeDI9Ijc0OSIgeTI9IjIyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTYiIHgyPSI3NDkiIHkyPSIyMTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjEyIiB4Mj0iNzQ5IiB5Mj0iMjEyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwOCIgeDI9Ijc0OSIgeTI9IjIwOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDUiIHgyPSI3NDkiIHkyPSIyMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjAxIiB4Mj0iNzQ5IiB5Mj0iMjAxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5NyIgeDI9Ijc0OSIgeTI9IjE5NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTMiIHgyPSI3NDkiIHkyPSIxOTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTkwIiB4Mj0iNzQ5IiB5Mj0iMTkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4NiIgeDI9Ijc0OSIgeTI9IjE4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODIiIHgyPSI3NDkiIHkyPSIxODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTc4IiB4Mj0iNzQ5IiB5Mj0iMTc4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NCIgeDI9Ijc0OSIgeTI9IjE3NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzEiIHgyPSI3NDkiIHkyPSIxNzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY3IiB4Mj0iNzQ5IiB5Mj0iMTY3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2MyIgeDI9Ijc0OSIgeTI9IjE2MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTkiIHgyPSI3NDkiIHkyPSIxNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTU2IiB4Mj0iNzQ5IiB5Mj0iMTU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1MiIgeDI9Ijc0OSIgeTI9IjE1MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDgiIHgyPSI3NDkiIHkyPSIxNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ0IiB4Mj0iNzQ5IiB5Mj0iMTQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0MCIgeDI9Ijc0OSIgeTI9IjE0MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzciIHgyPSI3NDkiIHkyPSIxMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTMzIiB4Mj0iNzQ5IiB5Mj0iMTMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyOSIgeDI9Ijc0OSIgeTI9IjEyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjUiIHgyPSI3NDkiIHkyPSIxMjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIxIiB4Mj0iNzQ5IiB5Mj0iMTIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExOCIgeDI9Ijc0OSIgeTI9IjExOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTQiIHgyPSI3NDkiIHkyPSIxMTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTEwIiB4Mj0iNzQ5IiB5Mj0iMTEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwNiIgeDI9Ijc0OSIgeTI9IjEwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDMiIHgyPSI3NDkiIHkyPSIxMDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTkiIHgyPSI3NDkiIHkyPSI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NSIgeDI9Ijc0OSIgeTI9Ijk1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjkxIiB4Mj0iNzQ5IiB5Mj0iOTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODciIHgyPSI3NDkiIHkyPSI4NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4NCIgeDI9Ijc0OSIgeTI9Ijg0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjgwIiB4Mj0iNzQ5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzYiIHgyPSI3NDkiIHkyPSI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3MiIgeDI9Ijc0OSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY5IiB4Mj0iNzQ5IiB5Mj0iNjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjUiIHgyPSI3NDkiIHkyPSI2NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2MSIgeDI9Ijc0OSIgeTI9IjYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU3IiB4Mj0iNzQ5IiB5Mj0iNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTMiIHgyPSI3NDkiIHkyPSI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1MCIgeDI9Ijc0OSIgeTI9IjUwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ2IiB4Mj0iNzQ5IiB5Mj0iNDYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDIiIHgyPSI3NDkiIHkyPSI0MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzOCIgeDI9Ijc0OSIgeTI9IjM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0IiB4Mj0iNzQ5IiB5Mj0iMzQiLz4KPHRleHQgeD0iMTAiIHk9IjE4MiIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCIgdHJhbnNmb3JtPSJyb3RhdGUoMjcwLCAxMCwgMTgyKSI+CnBvc2l0aW9ucyBiZWF0ZW4KPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODkiIHkxPSIzMjkiIHgyPSI4OSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTkiIHkxPSIzMjkiIHgyPSIxNTkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjI4IiB5MT0iMzI5IiB4Mj0iMjI4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI5NyIgeTE9IjMyOSIgeDI9IjI5NyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNjciIHkxPSIzMjkiIHgyPSIzNjciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDM2IiB5MT0iMzI5IiB4Mj0iNDM2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwNiIgeTE9IjMyOSIgeDI9IjUwNiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzUiIHkxPSIzMjkiIHgyPSI1NzUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQ0IiB5MT0iMzI5IiB4Mj0iNjQ0IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcxNCIgeTE9IjMyOSIgeDI9IjcxNCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyOSIgeDI9Ijc0OSIgeTI9IjMyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTIiIHgyPSI3NDkiIHkyPSIyOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU0IiB4Mj0iNzQ5IiB5Mj0iMjU0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNiIgeDI9Ijc0OSIgeTI9IjIxNiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzgiIHgyPSI3NDkiIHkyPSIxNzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQwIiB4Mj0iNzQ5IiB5Mj0iMTQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwMyIgeDI9Ijc0OSIgeTI9IjEwMyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2NSIgeDI9Ijc0OSIgeTI9IjY1Ii8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNCA1NCwzMjkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzMjkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMjkgNTQsMzI5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjkyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjkyIDU0LDI5MiAiLz4KPHRleHQgeD0iNDUiIHk9IjI1NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI1NCA1NCwyNTQgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyMTYiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyMTYgNTQsMjE2ICIvPgo8dGV4dCB4PSI0NSIgeT0iMTc4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo4LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTc4IDU0LDE3OCAiLz4KPHRleHQgeD0iNDUiIHk9IjE0MCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNDAgNTQsMTQwICIvPgo8dGV4dCB4PSI0NSIgeT0iMTAzIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMi4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDEwMyA1NCwxMDMgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI2NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTQuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw2NSA1NCw2NSAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU1LDMzMCA3NDksMzMwICIvPgo8dGV4dCB4PSI4OSIgeT0iMzQwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2xhdWRpbyAmYXBvczsxNSZhcG9zOwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4OSwzMzAgODksMzM1ICIvPgo8dGV4dCB4PSIxNTkiIHk9IjM0MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+Ck51bm8gJmFwb3M7MTgmYXBvczsqCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE1OSwzMzAgMTU5LDMzNSAiLz4KPHRleHQgeD0iMjI4IiB5PSIzNDAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpBbnRvbmlvICZhcG9zOzE2JmFwb3M7CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjIyOCwzMzAgMjI4LDMzNSAiLz4KPHRleHQgeD0iMjk3IiB5PSIzNDAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpNYXJjZWxvICZhcG9zOzIwJmFwb3M7Kgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyOTcsMzMwIDI5NywzMzUgIi8+Cjx0ZXh0IHg9IjM2NyIgeT0iMzQwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUm9uYWxkICZhcG9zOzE2JmFwb3M7CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM2NywzMzAgMzY3LDMzNSAiLz4KPHRleHQgeD0iNDM2IiB5PSIzNDAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpUaG9tYXMgJmFwb3M7MjEmYXBvczsqCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQzNiwzMzAgNDM2LDMzNSAiLz4KPHRleHQgeD0iNTA2IiB5PSIzNDAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpUb255ICZhcG9zOzE3JmFwb3M7Kgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1MDYsMzMwIDUwNiwzMzUgIi8+Cjx0ZXh0IHg9IjU3NSIgeT0iMzQwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQW5kb25pICZhcG9zOzIyJmFwb3M7Kgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NzUsMzMwIDU3NSwzMzUgIi8+Cjx0ZXh0IHg9IjY0NCIgeT0iMzQwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KU2VhbiAmYXBvczsyMyZhcG9zOwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2NDQsMzMwIDY0NCwzMzUgIi8+Cjx0ZXh0IHg9IjcxNCIgeT0iMzQwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUXVpcXVlICZhcG9zOzE1JmFwb3M7Kgo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI3MTQsMzMwIDcxNCwzMzUgIi8+CjxyZWN0IHg9IjY1IiB5PSI4NCIgd2lkdGg9IjQ4IiBoZWlnaHQ9IjI0NSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjEzNCIgeT0iODQiIHdpZHRoPSI0OSIgaGVpZ2h0PSIyNDUiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyMDQiIHk9IjEwMyIgd2lkdGg9IjQ4IiBoZWlnaHQ9IjIyNiIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjI3MyIgeT0iMTIxIiB3aWR0aD0iNDkiIGhlaWdodD0iMjA4IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iMzQzIiB5PSIxOTciIHdpZHRoPSI0OCIgaGVpZ2h0PSIxMzIiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0MTIiIHk9IjE5NyIgd2lkdGg9IjQ4IiBoZWlnaHQ9IjEzMiIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjQ4MSIgeT0iMjM1IiB3aWR0aD0iNDkiIGhlaWdodD0iOTQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI1NTEiIHk9IjIzNSIgd2lkdGg9IjQ4IiBoZWlnaHQ9Ijk0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNjIwIiB5PSIyMzUiIHdpZHRoPSI0OSIgaGVpZ2h0PSI5NCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjY5MCIgeT0iMjU0IiB3aWR0aD0iNDgiIGhlaWdodD0iNzUiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIvPgo8L3N2Zz4=)

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjgwIiBoZWlnaHQ9IjY4MCIgdmlld0JveD0iMCAwIDY4MCA2ODAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI2ODAiIGhlaWdodD0iNjgwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzQwIiB5PSI1NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIuOTAzMjI1ODA2NDUxNjE0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KRXhwZWN0ZWQgcG9zaXRpb24gKHgpIHZzIGFjdHVhbCBmaW5pc2ggKHkpIOKAlCBiZWxvdyB0aGUgbGluZSA9IG92ZXJhY2hpZXZlZAo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjU4OSIgeDI9Ijk1IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwMCIgeTE9IjU4OSIgeDI9IjEwMCIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMDUiIHkxPSI1ODkiIHgyPSIxMDUiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTExIiB5MT0iNTg5IiB4Mj0iMTExIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjExNiIgeTE9IjU4OSIgeDI9IjExNiIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMjIiIHkxPSI1ODkiIHgyPSIxMjIiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTI3IiB5MT0iNTg5IiB4Mj0iMTI3IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEzMyIgeTE9IjU4OSIgeDI9IjEzMyIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMzgiIHkxPSI1ODkiIHgyPSIxMzgiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTQ0IiB5MT0iNTg5IiB4Mj0iMTQ0IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE0OSIgeTE9IjU4OSIgeDI9IjE0OSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTUiIHkxPSI1ODkiIHgyPSIxNTUiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTYwIiB5MT0iNTg5IiB4Mj0iMTYwIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2NiIgeTE9IjU4OSIgeDI9IjE2NiIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNzEiIHkxPSI1ODkiIHgyPSIxNzEiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTc3IiB5MT0iNTg5IiB4Mj0iMTc3IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE4MiIgeTE9IjU4OSIgeDI9IjE4MiIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODgiIHkxPSI1ODkiIHgyPSIxODgiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTkzIiB5MT0iNTg5IiB4Mj0iMTkzIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE5OSIgeTE9IjU4OSIgeDI9IjE5OSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMDQiIHkxPSI1ODkiIHgyPSIyMDQiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjEwIiB5MT0iNTg5IiB4Mj0iMjEwIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIxNSIgeTE9IjU4OSIgeDI9IjIxNSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMjAiIHkxPSI1ODkiIHgyPSIyMjAiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjI2IiB5MT0iNTg5IiB4Mj0iMjI2IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzMSIgeTE9IjU4OSIgeDI9IjIzMSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMzciIHkxPSI1ODkiIHgyPSIyMzciIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjQyIiB5MT0iNTg5IiB4Mj0iMjQyIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI0OCIgeTE9IjU4OSIgeDI9IjI0OCIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNTMiIHkxPSI1ODkiIHgyPSIyNTMiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjU5IiB5MT0iNTg5IiB4Mj0iMjU5IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI2NCIgeTE9IjU4OSIgeDI9IjI2NCIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzAiIHkxPSI1ODkiIHgyPSIyNzAiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjc1IiB5MT0iNTg5IiB4Mj0iMjc1IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI4MSIgeTE9IjU4OSIgeDI9IjI4MSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyODYiIHkxPSI1ODkiIHgyPSIyODYiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjkyIiB5MT0iNTg5IiB4Mj0iMjkyIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI5NyIgeTE9IjU4OSIgeDI9IjI5NyIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMDMiIHkxPSI1ODkiIHgyPSIzMDMiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzA4IiB5MT0iNTg5IiB4Mj0iMzA4IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMxNCIgeTE9IjU4OSIgeDI9IjMxNCIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTkiIHkxPSI1ODkiIHgyPSIzMTkiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI1IiB5MT0iNTg5IiB4Mj0iMzI1IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMzMCIgeTE9IjU4OSIgeDI9IjMzMCIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMzUiIHkxPSI1ODkiIHgyPSIzMzUiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQxIiB5MT0iNTg5IiB4Mj0iMzQxIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM0NiIgeTE9IjU4OSIgeDI9IjM0NiIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNTIiIHkxPSI1ODkiIHgyPSIzNTIiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzU3IiB5MT0iNTg5IiB4Mj0iMzU3IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2MyIgeTE9IjU4OSIgeDI9IjM2MyIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNjgiIHkxPSI1ODkiIHgyPSIzNjgiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzc0IiB5MT0iNTg5IiB4Mj0iMzc0IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM3OSIgeTE9IjU4OSIgeDI9IjM3OSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODUiIHkxPSI1ODkiIHgyPSIzODUiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzkwIiB5MT0iNTg5IiB4Mj0iMzkwIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM5NiIgeTE9IjU4OSIgeDI9IjM5NiIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDEiIHkxPSI1ODkiIHgyPSI0MDEiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDA3IiB5MT0iNTg5IiB4Mj0iNDA3IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQxMiIgeTE9IjU4OSIgeDI9IjQxMiIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MTgiIHkxPSI1ODkiIHgyPSI0MTgiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDIzIiB5MT0iNTg5IiB4Mj0iNDIzIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQyOSIgeTE9IjU4OSIgeDI9IjQyOSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzQiIHkxPSI1ODkiIHgyPSI0MzQiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDQwIiB5MT0iNTg5IiB4Mj0iNDQwIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ0NSIgeTE9IjU4OSIgeDI9IjQ0NSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTEiIHkxPSI1ODkiIHgyPSI0NTEiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDU2IiB5MT0iNTg5IiB4Mj0iNDU2IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2MSIgeTE9IjU4OSIgeDI9IjQ2MSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NjciIHkxPSI1ODkiIHgyPSI0NjciIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDcyIiB5MT0iNTg5IiB4Mj0iNDcyIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ3OCIgeTE9IjU4OSIgeDI9IjQ3OCIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0ODMiIHkxPSI1ODkiIHgyPSI0ODMiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDg5IiB5MT0iNTg5IiB4Mj0iNDg5IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ5NCIgeTE9IjU4OSIgeDI9IjQ5NCIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDAiIHkxPSI1ODkiIHgyPSI1MDAiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTA1IiB5MT0iNTg5IiB4Mj0iNTA1IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxMSIgeTE9IjU4OSIgeDI9IjUxMSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MTYiIHkxPSI1ODkiIHgyPSI1MTYiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTIyIiB5MT0iNTg5IiB4Mj0iNTIyIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUyNyIgeTE9IjU4OSIgeDI9IjUyNyIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MzMiIHkxPSI1ODkiIHgyPSI1MzMiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTM4IiB5MT0iNTg5IiB4Mj0iNTM4IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU0NCIgeTE9IjU4OSIgeDI9IjU0NCIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDkiIHkxPSI1ODkiIHgyPSI1NDkiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTU1IiB5MT0iNTg5IiB4Mj0iNTU1IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2MCIgeTE9IjU4OSIgeDI9IjU2MCIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjYiIHkxPSI1ODkiIHgyPSI1NjYiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTcxIiB5MT0iNTg5IiB4Mj0iNTcxIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU3NiIgeTE9IjU4OSIgeDI9IjU3NiIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1ODIiIHkxPSI1ODkiIHgyPSI1ODIiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTg3IiB5MT0iNTg5IiB4Mj0iNTg3IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5MyIgeTE9IjU4OSIgeDI9IjU5MyIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1OTgiIHkxPSI1ODkiIHgyPSI1OTgiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjA0IiB5MT0iNTg5IiB4Mj0iNjA0IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwOSIgeTE9IjU4OSIgeDI9IjYwOSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTUiIHkxPSI1ODkiIHgyPSI2MTUiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjIwIiB5MT0iNTg5IiB4Mj0iNjIwIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYyNiIgeTE9IjU4OSIgeDI9IjYyNiIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjcyIiB4Mj0iNjI5IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNzgiIHgyPSI2MjkiIHkyPSI3OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI4MyIgeDI9IjYyOSIgeTI9IjgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9Ijg4IiB4Mj0iNjI5IiB5Mj0iODgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iOTQiIHgyPSI2MjkiIHkyPSI5NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI5OSIgeDI9IjYyOSIgeTI9Ijk5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjEwNCIgeDI9IjYyOSIgeTI9IjEwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIxMTAiIHgyPSI2MjkiIHkyPSIxMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMTE1IiB4Mj0iNjI5IiB5Mj0iMTE1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjEyMCIgeDI9IjYyOSIgeTI9IjEyMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIxMjYiIHgyPSI2MjkiIHkyPSIxMjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMTMxIiB4Mj0iNjI5IiB5Mj0iMTMxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjEzNiIgeDI9IjYyOSIgeTI9IjEzNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIxNDEiIHgyPSI2MjkiIHkyPSIxNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMTQ3IiB4Mj0iNjI5IiB5Mj0iMTQ3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjE1MiIgeDI9IjYyOSIgeTI9IjE1MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIxNTciIHgyPSI2MjkiIHkyPSIxNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMTYzIiB4Mj0iNjI5IiB5Mj0iMTYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjE2OCIgeDI9IjYyOSIgeTI9IjE2OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIxNzMiIHgyPSI2MjkiIHkyPSIxNzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMTc5IiB4Mj0iNjI5IiB5Mj0iMTc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjE4NCIgeDI9IjYyOSIgeTI9IjE4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIxODkiIHgyPSI2MjkiIHkyPSIxODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMTk0IiB4Mj0iNjI5IiB5Mj0iMTk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjIwMCIgeDI9IjYyOSIgeTI9IjIwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIyMDUiIHgyPSI2MjkiIHkyPSIyMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMjEwIiB4Mj0iNjI5IiB5Mj0iMjEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjIxNiIgeDI9IjYyOSIgeTI9IjIxNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIyMjEiIHgyPSI2MjkiIHkyPSIyMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMjI2IiB4Mj0iNjI5IiB5Mj0iMjI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjIzMiIgeDI9IjYyOSIgeTI9IjIzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIyMzciIHgyPSI2MjkiIHkyPSIyMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMjQyIiB4Mj0iNjI5IiB5Mj0iMjQyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjI0NyIgeDI9IjYyOSIgeTI9IjI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIyNTMiIHgyPSI2MjkiIHkyPSIyNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMjU4IiB4Mj0iNjI5IiB5Mj0iMjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjI2MyIgeDI9IjYyOSIgeTI9IjI2MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIyNjkiIHgyPSI2MjkiIHkyPSIyNjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMjc0IiB4Mj0iNjI5IiB5Mj0iMjc0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjI3OSIgeDI9IjYyOSIgeTI9IjI3OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIyODUiIHgyPSI2MjkiIHkyPSIyODUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMjkwIiB4Mj0iNjI5IiB5Mj0iMjkwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjI5NSIgeDI9IjYyOSIgeTI9IjI5NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIzMDEiIHgyPSI2MjkiIHkyPSIzMDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMzA2IiB4Mj0iNjI5IiB5Mj0iMzA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjMxMSIgeDI9IjYyOSIgeTI9IjMxMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIzMTYiIHgyPSI2MjkiIHkyPSIzMTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMzIyIiB4Mj0iNjI5IiB5Mj0iMzIyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjMyNyIgeDI9IjYyOSIgeTI9IjMyNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIzMzIiIHgyPSI2MjkiIHkyPSIzMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMzM4IiB4Mj0iNjI5IiB5Mj0iMzM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjM0MyIgeDI9IjYyOSIgeTI9IjM0MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIzNDgiIHgyPSI2MjkiIHkyPSIzNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMzU0IiB4Mj0iNjI5IiB5Mj0iMzU0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjM1OSIgeDI9IjYyOSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIzNjQiIHgyPSI2MjkiIHkyPSIzNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMzY5IiB4Mj0iNjI5IiB5Mj0iMzY5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjM3NSIgeDI9IjYyOSIgeTI9IjM3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIzODAiIHgyPSI2MjkiIHkyPSIzODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMzg1IiB4Mj0iNjI5IiB5Mj0iMzg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjM5MSIgeDI9IjYyOSIgeTI9IjM5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIzOTYiIHgyPSI2MjkiIHkyPSIzOTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNDAxIiB4Mj0iNjI5IiB5Mj0iNDAxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjQwNyIgeDI9IjYyOSIgeTI9IjQwNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI0MTIiIHgyPSI2MjkiIHkyPSI0MTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNDE3IiB4Mj0iNjI5IiB5Mj0iNDE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjQyMiIgeDI9IjYyOSIgeTI9IjQyMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI0MjgiIHgyPSI2MjkiIHkyPSI0MjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNDMzIiB4Mj0iNjI5IiB5Mj0iNDMzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjQzOCIgeDI9IjYyOSIgeTI9IjQzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI0NDQiIHgyPSI2MjkiIHkyPSI0NDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNDQ5IiB4Mj0iNjI5IiB5Mj0iNDQ5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjQ1NCIgeDI9IjYyOSIgeTI9IjQ1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI0NjAiIHgyPSI2MjkiIHkyPSI0NjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNDY1IiB4Mj0iNjI5IiB5Mj0iNDY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjQ3MCIgeDI9IjYyOSIgeTI9IjQ3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI0NzUiIHgyPSI2MjkiIHkyPSI0NzUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNDgxIiB4Mj0iNjI5IiB5Mj0iNDgxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjQ4NiIgeDI9IjYyOSIgeTI9IjQ4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI0OTEiIHgyPSI2MjkiIHkyPSI0OTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNDk3IiB4Mj0iNjI5IiB5Mj0iNDk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjUwMiIgeDI9IjYyOSIgeTI9IjUwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI1MDciIHgyPSI2MjkiIHkyPSI1MDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNTEzIiB4Mj0iNjI5IiB5Mj0iNTEzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjUxOCIgeDI9IjYyOSIgeTI9IjUxOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI1MjMiIHgyPSI2MjkiIHkyPSI1MjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNTI5IiB4Mj0iNjI5IiB5Mj0iNTI5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjUzNCIgeDI9IjYyOSIgeTI9IjUzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI1MzkiIHgyPSI2MjkiIHkyPSI1MzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNTQ0IiB4Mj0iNjI5IiB5Mj0iNTQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjU1MCIgeDI9IjYyOSIgeTI9IjU1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI1NTUiIHgyPSI2MjkiIHkyPSI1NTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNTYwIiB4Mj0iNjI5IiB5Mj0iNTYwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjU2NiIgeDI9IjYyOSIgeTI9IjU2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI1NzEiIHgyPSI2MjkiIHkyPSI1NzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNTc2IiB4Mj0iNjI5IiB5Mj0iNTc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjU4MiIgeDI9IjYyOSIgeTI9IjU4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI1ODciIHgyPSI2MjkiIHkyPSI1ODciLz4KPHRleHQgeD0iNTAiIHk9IjMzMSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCIgdHJhbnNmb3JtPSJyb3RhdGUoMjcwLCA1MCwgMzMxKSI+CmFjdHVhbCBwb3NpdGlvbgo8L3RleHQ+Cjx0ZXh0IHg9IjM2MiIgeT0iNjMwIiBkeT0iLTAuNWV4IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KZXhwZWN0ZWQgcG9zaXRpb24KPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTIyIiB5MT0iNTg5IiB4Mj0iMTIyIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3NyIgeTE9IjU4OSIgeDI9IjE3NyIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMzEiIHkxPSI1ODkiIHgyPSIyMzEiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjg2IiB5MT0iNTg5IiB4Mj0iMjg2IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM0MSIgeTE9IjU4OSIgeDI9IjM0MSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTYiIHkxPSI1ODkiIHgyPSIzOTYiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDUxIiB5MT0iNTg5IiB4Mj0iNDUxIiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwNSIgeTE9IjU4OSIgeDI9IjUwNSIgeTI9IjcyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NjAiIHkxPSI1ODkiIHgyPSI1NjAiIHkyPSI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjE1IiB5MT0iNTg5IiB4Mj0iNjE1IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iOTkiIHgyPSI2MjkiIHkyPSI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIxNTIiIHgyPSI2MjkiIHkyPSIxNTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMjA1IiB4Mj0iNjI5IiB5Mj0iMjA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjI1OCIgeDI9IjYyOSIgeTI9IjI1OCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSIzMTEiIHgyPSI2MjkiIHkyPSIzMTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iMzY0IiB4Mj0iNjI5IiB5Mj0iMzY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjQxNyIgeDI9IjYyOSIgeTI9IjQxNyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTUiIHkxPSI0NzAiIHgyPSI2MjkiIHkyPSI0NzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijk1IiB5MT0iNTIzIiB4Mj0iNjI5IiB5Mj0iNTIzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NSIgeTE9IjU3NiIgeDI9IjYyOSIgeTI9IjU3NiIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iOTQsNzIgOTQsNTg5ICIvPgo8dGV4dCB4PSI4NSIgeT0iOTkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4OSw5OSA5NCw5OSAiLz4KPHRleHQgeD0iODUiIHk9IjE1MiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijg5LDE1MiA5NCwxNTIgIi8+Cjx0ZXh0IHg9Ijg1IiB5PSIyMDUiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4OSwyMDUgOTQsMjA1ICIvPgo8dGV4dCB4PSI4NSIgeT0iMjU4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo4LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iODksMjU4IDk0LDI1OCAiLz4KPHRleHQgeD0iODUiIHk9IjMxMSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4OSwzMTEgOTQsMzExICIvPgo8dGV4dCB4PSI4NSIgeT0iMzY0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMi4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijg5LDM2NCA5NCwzNjQgIi8+Cjx0ZXh0IHg9Ijg1IiB5PSI0MTciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjE0LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iODksNDE3IDk0LDQxNyAiLz4KPHRleHQgeD0iODUiIHk9IjQ3MCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTYuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI4OSw0NzAgOTQsNDcwICIvPgo8dGV4dCB4PSI4NSIgeT0iNTIzIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxOC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijg5LDUyMyA5NCw1MjMgIi8+Cjx0ZXh0IHg9Ijg1IiB5PSI1NzYiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iODksNTc2IDk0LDU3NiAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9Ijk1LDU5MCA2MjksNTkwICIvPgo8dGV4dCB4PSIxMjIiIHk9IjYwMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxMjIsNTkwIDEyMiw1OTUgIi8+Cjx0ZXh0IHg9IjE3NyIgeT0iNjAwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjE3Nyw1OTAgMTc3LDU5NSAiLz4KPHRleHQgeD0iMjMxIiB5PSI2MDAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo2LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjMxLDU5MCAyMzEsNTk1ICIvPgo8dGV4dCB4PSIyODYiIHk9IjYwMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjguMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyODYsNTkwIDI4Niw1OTUgIi8+Cjx0ZXh0IHg9IjM0MSIgeT0iNjAwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIzNDEsNTkwIDM0MSw1OTUgIi8+Cjx0ZXh0IHg9IjM5NiIgeT0iNjAwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTIuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIzOTYsNTkwIDM5Niw1OTUgIi8+Cjx0ZXh0IHg9IjQ1MSIgeT0iNjAwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTQuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0NTEsNTkwIDQ1MSw1OTUgIi8+Cjx0ZXh0IHg9IjUwNSIgeT0iNjAwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTYuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1MDUsNTkwIDUwNSw1OTUgIi8+Cjx0ZXh0IHg9IjU2MCIgeT0iNjAwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTguMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NjAsNTkwIDU2MCw1OTUgIi8+Cjx0ZXh0IHg9IjYxNSIgeT0iNjAwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MTUsNTkwIDYxNSw1OTUgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI5NSw3MiAxMjIsOTkgMTQ5LDEyNiAxNzcsMTUyIDIwNCwxNzkgMjMxLDIwNSAyNTksMjMyIDI4NiwyNTggMzE0LDI4NSAzNDEsMzExIDM2OCwzMzggMzk2LDM2NCA0MjMsMzkxIDQ1MSw0MTcgNDc4LDQ0NCA1MDUsNDcwIDUzMyw0OTcgNTYwLDUyMyA1ODcsNTUwIDYxNSw1NzYgIi8+CjxjaXJjbGUgY3g9IjQyMyIgY3k9IjMzOCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDc4IiBjeT0iMzY0IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI5NSIgY3k9IjM5MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjMxIiBjeT0iMzExIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0NTEiIGN5PSI3MiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTMzIiBjeT0iNTc2IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTUiIGN5PSI0NzAiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM0MSIgY3k9IjQ5NyIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDIzIiBjeT0iNzIiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE0OSIgY3k9IjEyNiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDUxIiBjeT0iMjMyIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyODYiIGN5PSIyNTgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMxNCIgY3k9IjQ0NCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjA0IiBjeT0iMzM4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyNTkiIGN5PSIzOTEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjU4NyIgY3k9IjU3NiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzY4IiBjeT0iMzExIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyNTkiIGN5PSIyNTgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjUzMyIgY3k9IjQxNyIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDUxIiBjeT0iMzM4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTUiIGN5PSI0NzAiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjYxNSIgY3k9IjQ0NCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDc4IiBjeT0iNTIzIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyODYiIGN5PSI0OTciIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjIzMSIgY3k9IjE3OSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjE1IiBjeT0iMjMyIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0MjMiIGN5PSIzMTEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjIwNCIgY3k9IjEyNiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjg2IiBjeT0iMjU4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0NzgiIGN5PSI0OTciIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjUzMyIgY3k9IjQ3MCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTIyIiBjeT0iMjA1IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTUiIGN5PSI1NTAiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjYxNSIgY3k9IjU1MCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzQxIiBjeT0iMzkxIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1MDUiIGN5PSI1NzYiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjYxNSIgY3k9IjU3NiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTMzIiBjeT0iNDQ0IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyODYiIGN5PSIzNjQiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE0OSIgY3k9IjE1MiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjA0IiBjeT0iMjU4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMDQiIGN5PSIyNTgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE3NyIgY3k9IjIwNSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzQxIiBjeT0iNDcwIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTUiIGN5PSIyODUiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE3NyIgY3k9IjE1MiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDUxIiBjeT0iNDE3IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzOTYiIGN5PSIzMTEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMxNCIgY3k9IjU3NiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjE1IiBjeT0iNTUwIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMzEiIGN5PSIyMzIiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM2OCIgY3k9IjQxNyIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTMzIiBjeT0iNTIzIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTUiIGN5PSIzOTEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjEyMiIgY3k9IjIwNSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzk2IiBjeT0iMzM4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTUiIGN5PSI1NTAiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQyMyIgY3k9IjMxMSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTQ5IiBjeT0iMzY0IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTUiIGN5PSI0NDQiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMxNCIgY3k9IjIwNSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTA1IiBjeT0iNDk3IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMzEiIGN5PSIxMjYiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE3NyIgY3k9IjI1OCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTMzIiBjeT0iNTUwIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTUiIGN5PSI0NzAiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjUzMyIgY3k9IjU1MCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjg2IiBjeT0iNTIzIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1MzMiIGN5PSIzNjQiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM2OCIgY3k9IjMxMSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTA1IiBjeT0iNDk3IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMzEiIGN5PSIxNTIiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE0OSIgY3k9IjcyIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzNjgiIGN5PSIyNTgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjYxNSIgY3k9IjU3NiIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjE1IiBjeT0iNTUwIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzMTQiIGN5PSI0MTciIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjI4NiIgY3k9IjQ0NCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0U2N0UyMiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDc4IiBjeT0iNDcwIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRTY3RTIyIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzOTYiIGN5PSIzOTEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNFNjdFMjIiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+Cjwvc3ZnPg==)

## Findings

Across **80 curated debut seasons** (a manager's first spell in charge of each
club, EPL 2015/16 → 2024/25, permanent appointments only):

### 1. Who had the best debut season?

By pure results, **Antonio Conte's Chelsea 2016/17** is the standard: **2.45
ppg, 78.9% wins, +1.37 gd/game, title** — the best debut season in the dataset
on every absolute metric. **Arne Slot's Liverpool 2024/25** (2.21 ppg,
champions) is the other standout. By over/under achievement, **Claudio Ranieri's
Leicester 2015/16** (+13: expected ~14th, won the title) edges **Nuno's Wolves
2018/19** (+13: newly promoted, finished 7th) and **Conte (+12)**.

### 2. Who overachieved the most?

The overachievement table is dominated by two patterns: **title-chasing
miracles** (Ranieri +13, Conte +12) and **promoted-club surprises** — Wolves
+13, Bielsa's Leeds +11, Brentford +7. But note the caveat: for newly promoted
clubs "expected" is conservatively set to 20th, so _surviving comfortably_
already counts as a big overachievement.

### 3. Does previous experience matter?

**Not really — first-timers actually score higher on ppg.** The six first-ever
appointments (Smith, Solskjaer, Ljungberg, Arteta, Gerrard, Kompany, Hürzeler)
averaged **1.40 ppg** vs 1.21 for veterans — though they were all hired by clubs
with money to spend, and none finished top-4 (0/6 vs 9/74 for veterans). Small
sample, but the "new manager bump" hits rookies and veterans alike.

### 4. Does appointment timing matter?

**Decisively — pre-season appointments are far better.**

| Timing     | n   | mean ppg | mean over/under | survived    |
| ---------- | --- | -------- | --------------- | ----------- |
| Pre-season | 40  | **1.33** | **+1.9**        | 34/40 (85%) |
| Mid-season | 40  | 1.12     | **-2.3**        | 30/40 (75%) |

This isn't causal — mid-season appointments happen _because_ things are already
going wrong (hence negative over/under: they inherit a bad situation). But it
does mean the "new manager bounce" measured on mid-season changes is fighting
uphill; managers given a full preseason prepare actually outperform expectation
by ~2 places on average.

### 5. Does a good debut predict quality?

**Weakly at best.** Of the 63 debuts with a following EPL season, overachievers
finished the next season at **11.7** vs underachievers at **9.4** — i.e., the
teams that "overperformed" actually regressed slightly more on average. Mean
sophomore regression is only **+0.1 places**, essentially noise. Great debuts
(Klopp, Guardiola, Arteta) do tend to become great tenures — but the debut
season itself is a poor predictor; most overachievers settle back toward their
level.
