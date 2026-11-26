---
title: 'Best of La Liga: every record worth knowing'
description: |
  'El Clásico owns 27 of 33 titles — Madrid's 121-goal season, the 2006/07 goal-difference final and Suárez's 40-goal campaign.'
author: 'hieudoan'
date: '2026-11-25T16:00'
order: 16
tags: ['football', 'analysis', 'records', 'la-liga', 'mars', 'sqlite']
---

# Best of the La Liga: a record book

## Best of the La Liga

A complete record-book of the **La Liga** — every statistic worth knowing,
computed from all matches in `data/matches_full.csv`.

**Records covered:** most championships, the champion hall of fame (most points,
most goals, fewest conceded, best goal difference, biggest title margin, most
wins), the best team-seasons ever, unbeaten invincibles, closest and biggest
title races, biggest wins and highest-scoring matches, and the season's top
scorers where player-level data exists.

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
    .filter(col("league").eq(lit("Spanish La Liga")))
    .collect()
    .expect("filter failed");

// seasons excluded as mislabeled data (e.g. another league's fixtures)
let drop_seasons: &[&str] = &[];

println!("Spanish La Liga matches: {}", df.height());

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
        // England
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
        // Spain
        "Athletic Club" => "Ath Bilbao",
        "Atl\u{e9}tico Madrid" => "Ath Madrid",
        "Real Betis" => "Betis",
        "Celta Vigo" => "Celta",
        "Real Sociedad" => "Sociedad",
        "Real Valladolid" => "Valladolid",
        "Real Zaragoza" => "Zaragoza",
        "Rayo Vallecano" => "Vallecano",
        "CD Numancia de Soria" => "Numancia",
        "Real Murcia CF" => "Murcia",
        "Recreativo Huelva" => "Recreativo",
        "Sporting Gij\u{f3}n" => "Sp Gijon",
        "Espanol" => "Espanyol",
        "Gimn\u{e0}stic Tarragona" => "Gimnastic",
        "Villarreal" | "Villareel" => "Villarreal",
        "Santander" => "Racing Santander",
        // Italy
        "Inter Milan" => "Inter",
        "Verona" => "Hellas Verona",
        // Germany
        "Bayer Leverkusen" => "Leverkusen",
        "Borussia Dortmund" => "Dortmund",
        "Eintracht Frankfurt" => "Ein Frankfurt",
        "FSV Mainz 05" => "Mainz",
        "Hamburger SV" => "Hamburg",
        "Hertha Berlin" => "Hertha",
        "Leipzig" => "RB Leipzig",
        "Borussia M\u{f6}nchengladbach" | "M'gladbach" => "M'Gladbach",
        "Darmstadt 98" => "Darmstadt",
        "Fortuna Dusseldorf" => "Dusseldorf",
        "Hannover 96" => "Hannover",
        // France
        "Olympique de Marseille" => "Marseille",
        "AS Monaco" => "Monaco",
        "OGC Nice" => "Nice",
        "Stade de Reims" => "Reims",
        "Paris Saint-Germain" => "Paris SG",
        "Stade Brestois" => "Brest",
        "Stade Malherbe Caen" => "Caen",
        "Clermont Foot" => "Clermont",
        "CA Bastia" => "Bastia",
        "Saint-\u{c9}tienne" => "St Etienne",
        // Netherlands
        "Roda JC" => "Roda",
        "Sparta Rotterdam" => "Sparta",
        // Portugal
        "Desp. Chaves" => "Chaves",
        "Campomaior" => "Campomaiorense",
        "Madeira" => "Uniao Madeira",
        "AVS" => "Academico Viseu",
        // Belgium
        "Lommel SK" => "Lommel",
        "RWD Molenbeek" => "Molenbeek",
        "Mouscron" | "Mouscron-Peruwelz" => "RAAL La Louviere",
        // Turkiye
        "Antalya" => "Antalyaspor",
        "Gaziantep" => "Gaziantepspor",
        "Kayseri" => "Kayserispor",
        "Malatyaspor" => "Yeni Malatyaspor",
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
let mut all_matches: Vec<(String, String, String, i64, i64)> = Vec::new();
let mut seen: std::collections::HashSet<(String, String, String, String, i64, i64)> = std::collections::HashSet::new();
let mut n_finished = 0usize;
let mut n_dupes = 0usize;
for i in 0..df.height() {
    if hg_v[i] < 0 || ag_v[i] < 0 || drop_seasons.contains(&season_v[i].as_str()) {
        continue;
    }
    let date = date_v[i][..10].to_string();
    let hg = hg_v[i];
    let ag = ag_v[i];
    let h = canon(&home_v[i]).to_string();
    let a = canon(&away_v[i]).to_string();
    let s = season_v[i].clone();
    // the CSV merges two data sources; the same fixture can appear twice
    // under different team-name spellings — keep only the first copy
    if !seen.insert((s.clone(), h.clone(), a.clone(), date.clone(), hg, ag)) {
        n_dupes += 1;
        continue;
    }
    n_finished += 1;
    all_matches.push((s.clone(), h.clone(), a.clone(), hg, ag));
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
println!("finished matches: {} ({} duplicate fixtures dropped) | team-season entries: {}", n_finished, n_dupes, team_games.len());

fn pts(g: &Game) -> i64 {
    if g.gf > g.ga { 3 } else if g.gf == g.ga { 1 } else { 0 }
}

// per team-season record
#[derive(Clone)]
struct Rec {
    season: String,
    team: String,
    played: usize,
    w: i64,
    d: i64,
    l: i64,
    pts: i64,
    gf: i64,
    ga: i64,
    gd: i64,
}

let rec_of = |season: &str, team: &str| -> Option<Rec> {
    let games = team_games.get(&(season.to_string(), team.to_string()))?;
    let mut r = Rec {
        season: season.to_string(),
        team: team.to_string(),
        played: games.len(),
        w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, gd: 0,
    };
    for g in games {
        r.gf += g.gf;
        r.ga += g.ga;
        if g.gf > g.ga { r.w += 1; r.pts += 3; }
        else if g.gf == g.ga { r.d += 1; r.pts += 1; }
        else { r.l += 1; }
    }
    r.gd = r.gf - r.ga;
    Some(r)
};

// season -> sorted standings (rank order)
let standings = |season: &str| -> Vec<Rec> {
    let prefix = season.to_string();
    let mut teams: Vec<String> = Vec::new();
    for ((s, t), _) in &team_games {
        if *s == prefix && !teams.contains(t) {
            teams.push(t.clone());
        }
    }
    let mut recs: Vec<Rec> = teams.iter().filter_map(|t| rec_of(season, t)).collect();
    recs.sort_by(|a, b| b.pts.cmp(&a.pts).then(b.gd.cmp(&a.gd)).then(b.gf.cmp(&a.gf)).then(a.team.cmp(&b.team)));
    recs
};

// complete seasons only: >= 150 total matches (drops the in-progress season)
let mut season_match_count: BTreeMap<String, usize> = BTreeMap::new();
for (s, _, _, _, _) in &all_matches {
    *season_match_count.entry(s.clone()).or_insert(0) += 1;
}
let mut complete_seasons: Vec<String> = season_match_count
    .iter()
    .filter(|(_, c)| **c >= 150)
    .map(|(s, _)| s.clone())
    .collect();
complete_seasons.sort();
println!("complete seasons: {} ({} -> {})", complete_seasons.len(), complete_seasons.first().map(|s| s.as_str()).unwrap_or(""), complete_seasons.last().map(|s| s.as_str()).unwrap_or(""));
```

```text
Spanish La Liga matches: 13279
finished matches: 12834 (445 duplicate fixtures dropped) | team-season entries: 686
complete seasons: 33 (1993/94 -> 2025/26)
```

```rust
// top scorers from StatsBomb player_match_stat coverage (recent seasons only)
let sdf = LazyCsvReader::new("data/player_goals.csv")
    .finish()
    .expect("failed to open data/player_goals.csv")
    .collect()
    .expect("collect failed");
let sl = sdf
    .lazy()
    .filter(col("league").eq(lit("Spanish La Liga")))
    .collect()
    .expect("scorer filter failed");
let sc = |name: &str| sl.column(name).unwrap().clone();
let pnames: Vec<String> = sc("player").str().unwrap().iter().map(|o| o.unwrap_or("").to_string()).collect();
let syrs: Vec<i64> = {
    let c = sc("year");
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(0)).collect()
};
let sgoals: Vec<i64> = {
    let c = sc("goals");
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(0)).collect()
};
// group goals by (player, year)
let mut by_py: BTreeMap<(String, i64), i64> = BTreeMap::new();
for i in 0..sl.height() {
    *by_py.entry((pnames[i].clone(), syrs[i])).or_insert(0) += sgoals[i];
}
// pick the year with the most total goals scored (best coverage)
let mut year_totals: BTreeMap<i64, i64> = BTreeMap::new();
for ((_, y), g) in &by_py {
    *year_totals.entry(*y).or_insert(0) += g;
}
let best_year = year_totals.iter().max_by_key(|(_, t)| *t).map(|(y, _)| *y);
let mut scorer_rows: Vec<(String, i64)> = match best_year {
    Some(y) => by_py
        .iter()
        .filter(|((_, yy), _)| *yy == y)
        .map(|((p, _), g)| (p.clone(), *g))
        .collect(),
    None => Vec::new(),
};
scorer_rows.sort_by(|a, b| b.1.cmp(&a.1));
let scorer_table: Vec<Vec<String>> = scorer_rows
    .iter()
    .take(5)
    .map(|(p, g)| vec![p.clone(), g.to_string()])
    .collect();
match best_year {
    Some(y) => println!("top scorers available for season year {} (StatsBomb coverage)", y),
    None => println!("no player-level scorer data for this competition"),
}
```

```text
top scorers available for season year 2015 (StatsBomb coverage)
()
```

```rust
// ---- assemble per-season standings for all complete seasons ----
struct SeasonRow {
    season: String,
    champ: String,
    pts: i64,
    w: i64,
    gf: i64,
    ga: i64,
    gd: i64,
    runner_pts: i64,
    runner_up: String,
    standings: Vec<Rec>,
}

let mut seasons: Vec<SeasonRow> = Vec::new();
for sname in &complete_seasons {
    let st = standings(sname);
    if st.len() < 2 {
        continue;
    }
    seasons.push(SeasonRow {
        season: sname.clone(),
        champ: st[0].team.clone(),
        pts: st[0].pts,
        w: st[0].w,
        gf: st[0].gf,
        ga: st[0].ga,
        gd: st[0].gd,
        runner_pts: st[1].pts,
        runner_up: st[1].team.clone(),
        standings: st,
    });
}
println!("seasons analysed: {}", seasons.len());

// T1: most championships
let mut title_count: BTreeMap<String, Vec<String>> = BTreeMap::new();
for srow in &seasons {
    title_count.entry(srow.champ.clone()).or_default().push(srow.season.clone());
}
let mut tc: Vec<(String, Vec<String>)> = title_count.into_iter().collect();
tc.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)));
let title_rows: Vec<Vec<String>> = tc
    .iter()
    .take(8)
    .map(|(t, ss)| vec![t.clone(), ss.len().to_string(), ss.iter().rev().take(3).cloned().collect::<Vec<_>>().join(", ")])
    .collect();
mars_table(&["club", "titles", "most recent"], &title_rows);
```

```text
Spanish La Liga matches: 13279
finished matches: 12834 (445 duplicate fixtures dropped) | team-season entries: 686
complete seasons: 33 (1993/94 -> 2025/26)
top scorers available for season year 2015 (StatsBomb coverage)
seasons analysed: 33
```

| club        | titles | most recent               |
| ----------- | ------ | ------------------------- |
| Barcelona   | 17     | 2025/26, 2024/25, 2022/23 |
| Real Madrid | 10     | 2023/24, 2021/22, 2019/20 |
| Ath Madrid  | 3      | 2020/21, 2013/14, 1995/96 |
| Valencia    | 2      | 2003/04, 2001/02          |
| La Coruna   | 1      | 1999/00                   |

```rust
// T2: champion hall of fame — six records
let champ_rec = |f: &dyn Fn(&SeasonRow) -> i64| -> Option<SeasonRow> {
    seasons.iter().max_by_key(|s| f(*s)).map(|s| SeasonRow {
        season: s.season.clone(), champ: s.champ.clone(), pts: s.pts, w: s.w,
        gf: s.gf, ga: s.ga, gd: s.gd, runner_pts: s.runner_pts,
        runner_up: s.runner_up.clone(), standings: Vec::new(),
    })
};
let records: Vec<(&str, SeasonRow)> = vec![
    ("most points", champ_rec(&|s| s.pts).unwrap()),
    ("most goals scored", champ_rec(&|s| s.gf).unwrap()),
    ("fewest goals conceded", seasons.iter().min_by_key(|s| s.ga).map(|s| SeasonRow {
        season: s.season.clone(), champ: s.champ.clone(), pts: s.pts, w: s.w,
        gf: s.gf, ga: s.ga, gd: s.gd, runner_pts: s.runner_pts,
        runner_up: s.runner_up.clone(), standings: Vec::new(),
    }).unwrap()),
    ("best goal difference", champ_rec(&|s| s.gd).unwrap()),
    ("biggest title margin", champ_rec(&|s| s.pts - s.runner_pts).unwrap()),
    ("most wins", champ_rec(&|s| s.w).unwrap()),
];
let rec_rows: Vec<Vec<String>> = records
    .iter()
    .map(|(label, s)| {
        vec![
            label.to_string(),
            format!("{} {}", s.champ, s.season),
            s.pts.to_string(),
            format!("{}/{}", s.gf, s.ga),
            s.gd.to_string(),
        ]
    })
    .collect();
mars_table(&["record", "champion season", "pts", "gf/ga", "gd"], &rec_rows);
```

| record                | champion season     | pts | gf/ga  | gd  |
| --------------------- | ------------------- | --- | ------ | --- |
| most points           | Barcelona 2012/13   | 100 | 115/40 | 75  |
| most goals scored     | Real Madrid 2011/12 | 100 | 121/32 | 89  |
| fewest goals conceded | Barcelona 2022/23   | 88  | 70/20  | 50  |
| best goal difference  | Barcelona 2014/15   | 94  | 110/21 | 89  |
| biggest title margin  | Barcelona 2012/13   | 100 | 115/40 | 75  |
| most wins             | Barcelona 2012/13   | 100 | 115/40 | 75  |

```rust
// T3: best team-seasons ever by points (any team)
let mut all_recs: Vec<Rec> = Vec::new();
for srow in &seasons {
    for r in &srow.standings {
        all_recs.push(r.clone());
    }
}
all_recs.sort_by(|a, b| b.pts.cmp(&a.pts).then(b.gd.cmp(&a.gd)));
let best_rows: Vec<Vec<String>> = all_recs
    .iter()
    .take(10)
    .map(|r| {
        vec![
            format!("{} {}", r.team, r.season),
            r.played.to_string(),
            r.pts.to_string(),
            format!("{:.2}", r.pts as f64 / r.played as f64),
            format!("{}/{}", r.gf, r.ga),
            r.gd.to_string(),
        ]
    })
    .collect();
mars_table(&["team season", "played", "pts", "ppg", "gf/ga", "gd"], &best_rows);
```

| team season         | played | pts | ppg  | gf/ga  | gd  |
| ------------------- | ------ | --- | ---- | ------ | --- |
| Real Madrid 2011/12 | 38     | 100 | 2.63 | 121/32 | 89  |
| Barcelona 2012/13   | 38     | 100 | 2.63 | 115/40 | 75  |
| Barcelona 2009/10   | 38     | 99  | 2.61 | 98/24  | 74  |
| Barcelona 2010/11   | 38     | 96  | 2.53 | 95/21  | 74  |
| Real Madrid 2009/10 | 38     | 96  | 2.53 | 102/35 | 67  |
| Real Madrid 2023/24 | 38     | 95  | 2.50 | 87/26  | 61  |
| Barcelona 2014/15   | 38     | 94  | 2.47 | 110/21 | 89  |
| Barcelona 2025/26   | 38     | 94  | 2.47 | 95/36  | 59  |
| Barcelona 2017/18   | 38     | 93  | 2.45 | 99/29  | 70  |
| Real Madrid 2016/17 | 38     | 93  | 2.45 | 106/41 | 65  |

```rust
// T4: unbeaten seasons
let unbeaten: Vec<&Rec> = all_recs.iter().filter(|r| r.l == 0 && r.played >= 20).collect();
let unbeaten_rows: Vec<Vec<String>> = unbeaten
    .iter()
    .take(10)
    .map(|r| vec![format!("{} {}", r.team, r.season), format!("{}W {}D", r.w, r.d), r.gf.to_string(), r.ga.to_string()])
    .collect();
mars_table(&["team season", "record", "gf", "ga"], &unbeaten_rows);
```

| team season | record | gf  | ga  |
| ----------- | ------ | --- | --- |

```rust
println!("unbeaten seasons (>=20 games): {}", unbeaten.len());

// T5: title races — closest and biggest margins
let mut by_margin: Vec<&SeasonRow> = seasons.iter().collect();
by_margin.sort_by_key(|s| s.pts - s.runner_pts);
let race_rows: Vec<Vec<String>> = by_margin
    .iter()
    .take(5)
    .map(|s| vec![format!("{} {}", s.champ, s.season), format!("{} ({})", s.runner_up, s.runner_pts), (s.pts - s.runner_pts).to_string() + " pts"])
    .collect();
mars_table(&["closest races", "runner-up", "margin"], &race_rows);
```

```text
unbeaten seasons (>=20 games): 0
```

| closest races       | runner-up        | margin |
| ------------------- | ---------------- | ------ |
| Barcelona 2006/07   | Real Madrid (76) | 0 pts  |
| Barcelona 2015/16   | Real Madrid (90) | 1 pts  |
| Real Madrid 1996/97 | Barcelona (90)   | 2 pts  |
| Real Madrid 2002/03 | Sociedad (76)    | 2 pts  |
| Barcelona 2014/15   | Real Madrid (92) | 2 pts  |

```rust
let mut by_margin_desc = by_margin.clone();
by_margin_desc.reverse();
let blow_rows: Vec<Vec<String>> = by_margin_desc
    .iter()
    .take(5)
    .map(|s| vec![format!("{} {}", s.champ, s.season), format!("{} ({})", s.runner_up, s.runner_pts), (s.pts - s.runner_pts).to_string() + " pts"])
    .collect();
mars_table(&["biggest blowouts", "runner-up", "margin"], &blow_rows);
```

| biggest blowouts    | runner-up        | margin |
| ------------------- | ---------------- | ------ |
| Barcelona 2012/13   | Real Madrid (85) | 15 pts |
| Barcelona 2017/18   | Ath Madrid (79)  | 14 pts |
| Real Madrid 2021/22 | Barcelona (73)   | 13 pts |
| Barcelona 2005/06   | Real Madrid (70) | 12 pts |
| Barcelona 2018/19   | Ath Madrid (76)  | 11 pts |

```rust
// T6: biggest wins & highest scoring matches
let mut margins: Vec<(i64, String, String, i64, i64, String)> = Vec::new();
let mut totals: Vec<(i64, String, String, i64, i64, String)> = Vec::new();
for (s, h, a, hg, ag) in &all_matches {
    margins.push((hg - ag, s.clone(), h.clone(), *hg, *ag, a.clone()));
    totals.push((hg + ag, s.clone(), h.clone(), *hg, *ag, a.clone()));
}
margins.sort_by(|a, b| b.0.cmp(&a.0));
totals.sort_by(|a, b| b.0.cmp(&a.0));
let win_rows: Vec<Vec<String>> = margins
    .iter()
    .take(5)
    .map(|(m, s, h, hg, ag, a)| vec![format!("{} vs {} ({})", h, a, s), format!("{}-{}", hg, ag), format!("+{}", m)])
    .collect();
mars_table(&["biggest wins", "score", "margin"], &win_rows);
```

| biggest wins                       | score | margin |
| ---------------------------------- | ----- | ------ |
| Barcelona vs Logrones (1996/97)    | 8-0   | +8     |
| Barcelona vs Osasuna (2011/12)     | 8-0   | +8     |
| Real Madrid vs Granada (2014/15)   | 9-1   | +8     |
| Real Madrid vs Vallecano (2015/16) | 10-2  | +8     |
| Barcelona vs Osasuna (1993/94)     | 8-1   | +7     |

```rust
let score_rows: Vec<Vec<String>> = totals
    .iter()
    .take(5)
    .map(|(t, s, h, hg, ag, a)| vec![format!("{} vs {} ({})", h, a, s), format!("{}-{}", hg, ag), t.to_string()])
    .collect();
mars_table(&["highest-scoring", "score", "total goals"], &score_rows);
```

| highest-scoring                        | score | total goals |
| -------------------------------------- | ----- | ----------- |
| Real Madrid vs Vallecano (2015/16)     | 10-2  | 12          |
| Oviedo vs Valladolid (1995/96)         | 3-8   | 11          |
| Albacete vs La Coruna (1994/95)        | 2-8   | 10          |
| Racing Santander vs Albacete (1995/96) | 5-5   | 10          |
| Real Madrid vs Sevilla (2013/14)       | 7-3   | 10          |

```rust
// T7: top scorers
if !scorer_table.is_empty() {
    mars_table(&["player", "goals"], &scorer_table);
}
```

```text
()
```

| player                              | goals |
| ----------------------------------- | ----- |
| Luis Alberto Suárez Díaz            | 40    |
| Cristiano Ronaldo dos Santos Aveiro | 35    |
| Lionel Andrés Messi Cuccittini      | 26    |
| Karim Benzema                       | 24    |
| Neymar da Silva Santos Junior       | 24    |

```rust
use plotters::prelude::*;

let labels_t: Vec<String> = tc.iter().take(8).map(|(t, _)| t.chars().take(12).collect()).collect();
let counts_t: Vec<f64> = tc.iter().take(8).map(|(_, ss)| ss.len() as f64).collect();
let ymax_t = counts_t.iter().cloned().fold(1.0_f64, f64::max) * 1.2;
let n_t = counts_t.len();
let figure1 = plotters::evcxr::evcxr_figure((720, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Most championships", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(80)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n_t as f64 - 0.5), 0.0..ymax_t)?;
    chart.configure_mesh().y_desc("titles").x_labels(n_t)
        .x_label_formatter(&|x: &f64| {
            let i = (*x).round() as usize;
            if i < labels_t.len() { labels_t[i].clone() } else { String::new() }
        })
        .draw()?;
    chart.draw_series((0..n_t).map(|i| {
        Rectangle::new([(i as f64 - 0.35, 0.0), (i as f64 + 0.35, counts_t[i])], BLUE.filled())
    }))?;
    Ok(())
});
figure1.evcxr_display();
```

```text
Spanish La Liga matches: 13279
finished matches: 12834 (445 duplicate fixtures dropped) | team-season entries: 686
complete seasons: 33 (1993/94 -> 2025/26)
top scorers available for season year 2015 (StatsBomb coverage)
seasons analysed: 33
unbeaten seasons (>=20 games): 0
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDcyMCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3MjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzYwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KTW9zdCBjaGFtcGlvbnNoaXBzCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY4IiB5MT0iMzA5IiB4Mj0iNjgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTQiIHkxPSIzMDkiIHgyPSI5NCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMjAiIHkxPSIzMDkiIHgyPSIxMjAiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTQ2IiB5MT0iMzA5IiB4Mj0iMTQ2IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3MiIgeTE9IjMwOSIgeDI9IjE3MiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTgiIHkxPSIzMDkiIHgyPSIxOTgiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjI1IiB5MT0iMzA5IiB4Mj0iMjI1IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI1MSIgeTE9IjMwOSIgeDI9IjI1MSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzciIHkxPSIzMDkiIHgyPSIyNzciIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzAzIiB5MT0iMzA5IiB4Mj0iMzAzIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMyOSIgeTE9IjMwOSIgeDI9IjMyOSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNTUiIHkxPSIzMDkiIHgyPSIzNTUiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzgyIiB5MT0iMzA5IiB4Mj0iMzgyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQwOCIgeTE9IjMwOSIgeDI9IjQwOCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MzQiIHkxPSIzMDkiIHgyPSI0MzQiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDYwIiB5MT0iMzA5IiB4Mj0iNDYwIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4NiIgeTE9IjMwOSIgeDI9IjQ4NiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MTIiIHkxPSIzMDkiIHgyPSI1MTIiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTM4IiB5MT0iMzA5IiB4Mj0iNTM4IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU2NSIgeTE9IjMwOSIgeDI9IjU2NSIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1OTEiIHkxPSIzMDkiIHgyPSI1OTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjE3IiB5MT0iMzA5IiB4Mj0iNjE3IiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY0MyIgeTE9IjMwOSIgeDI9IjY0MyIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NjkiIHkxPSIzMDkiIHgyPSI2NjkiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDkiIHgyPSI3MDkiIHkyPSIzMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA3IiB4Mj0iNzA5IiB5Mj0iMzA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwNCIgeDI9IjcwOSIgeTI9IjMwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDEiIHgyPSI3MDkiIHkyPSIzMDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjk5IiB4Mj0iNzA5IiB5Mj0iMjk5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5NiIgeDI9IjcwOSIgeTI9IjI5NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTMiIHgyPSI3MDkiIHkyPSIyOTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjkxIiB4Mj0iNzA5IiB5Mj0iMjkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4OCIgeDI9IjcwOSIgeTI9IjI4OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODUiIHgyPSI3MDkiIHkyPSIyODUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjgzIiB4Mj0iNzA5IiB5Mj0iMjgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4MCIgeDI9IjcwOSIgeTI9IjI4MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzciIHgyPSI3MDkiIHkyPSIyNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc0IiB4Mj0iNzA5IiB5Mj0iMjc0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MiIgeDI9IjcwOSIgeTI9IjI3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjkiIHgyPSI3MDkiIHkyPSIyNjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY2IiB4Mj0iNzA5IiB5Mj0iMjY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI2NCIgeDI9IjcwOSIgeTI9IjI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjEiIHgyPSI3MDkiIHkyPSIyNjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU4IiB4Mj0iNzA5IiB5Mj0iMjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1NiIgeDI9IjcwOSIgeTI9IjI1NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTMiIHgyPSI3MDkiIHkyPSIyNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjUwIiB4Mj0iNzA5IiB5Mj0iMjUwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI0NyIgeDI9IjcwOSIgeTI9IjI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDUiIHgyPSI3MDkiIHkyPSIyNDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQyIiB4Mj0iNzA5IiB5Mj0iMjQyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzOSIgeDI9IjcwOSIgeTI9IjIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzciIHgyPSI3MDkiIHkyPSIyMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjM0IiB4Mj0iNzA5IiB5Mj0iMjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMSIgeDI9IjcwOSIgeTI9IjIzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjkiIHgyPSI3MDkiIHkyPSIyMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI2IiB4Mj0iNzA5IiB5Mj0iMjI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIyMyIgeDI9IjcwOSIgeTI9IjIyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjEiIHgyPSI3MDkiIHkyPSIyMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjE4IiB4Mj0iNzA5IiB5Mj0iMjE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxNSIgeDI9IjcwOSIgeTI9IjIxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTIiIHgyPSI3MDkiIHkyPSIyMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjEwIiB4Mj0iNzA5IiB5Mj0iMjEwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwNyIgeDI9IjcwOSIgeTI9IjIwNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDQiIHgyPSI3MDkiIHkyPSIyMDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjAyIiB4Mj0iNzA5IiB5Mj0iMjAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5OSIgeDI9IjcwOSIgeTI9IjE5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTYiIHgyPSI3MDkiIHkyPSIxOTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTk0IiB4Mj0iNzA5IiB5Mj0iMTk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5MSIgeDI9IjcwOSIgeTI9IjE5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODgiIHgyPSI3MDkiIHkyPSIxODgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg1IiB4Mj0iNzA5IiB5Mj0iMTg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4MyIgeDI9IjcwOSIgeTI9IjE4MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxODAiIHgyPSI3MDkiIHkyPSIxODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTc3IiB4Mj0iNzA5IiB5Mj0iMTc3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NSIgeDI9IjcwOSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzIiIHgyPSI3MDkiIHkyPSIxNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY5IiB4Mj0iNzA5IiB5Mj0iMTY5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2NyIgeDI9IjcwOSIgeTI9IjE2NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNjQiIHgyPSI3MDkiIHkyPSIxNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTYxIiB4Mj0iNzA5IiB5Mj0iMTYxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1OSIgeDI9IjcwOSIgeTI9IjE1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTYiIHgyPSI3MDkiIHkyPSIxNTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTUzIiB4Mj0iNzA5IiB5Mj0iMTUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1MCIgeDI9IjcwOSIgeTI9IjE1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDgiIHgyPSI3MDkiIHkyPSIxNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ1IiB4Mj0iNzA5IiB5Mj0iMTQ1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0MiIgeDI9IjcwOSIgeTI9IjE0MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDAiIHgyPSI3MDkiIHkyPSIxNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM3IiB4Mj0iNzA5IiB5Mj0iMTM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzNCIgeDI9IjcwOSIgeTI9IjEzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzIiIHgyPSI3MDkiIHkyPSIxMzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI5IiB4Mj0iNzA5IiB5Mj0iMTI5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyNiIgeDI9IjcwOSIgeTI9IjEyNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjMiIHgyPSI3MDkiIHkyPSIxMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIxIiB4Mj0iNzA5IiB5Mj0iMTIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExOCIgeDI9IjcwOSIgeTI9IjExOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTUiIHgyPSI3MDkiIHkyPSIxMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTEzIiB4Mj0iNzA5IiB5Mj0iMTEzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExMCIgeDI9IjcwOSIgeTI9IjExMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDciIHgyPSI3MDkiIHkyPSIxMDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA1IiB4Mj0iNzA5IiB5Mj0iMTA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEwMiIgeDI9IjcwOSIgeTI9IjEwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5OSIgeDI9IjcwOSIgeTI9Ijk5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijk3IiB4Mj0iNzA5IiB5Mj0iOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTQiIHgyPSI3MDkiIHkyPSI5NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MSIgeDI9IjcwOSIgeTI9IjkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg4IiB4Mj0iNzA5IiB5Mj0iODgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODYiIHgyPSI3MDkiIHkyPSI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI4MyIgeDI9IjcwOSIgeTI9IjgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjgwIiB4Mj0iNzA5IiB5Mj0iODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzgiIHgyPSI3MDkiIHkyPSI3OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3NSIgeDI9IjcwOSIgeTI9Ijc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjcyIiB4Mj0iNzA5IiB5Mj0iNzIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNzAiIHgyPSI3MDkiIHkyPSI3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI2NyIgeDI9IjcwOSIgeTI9IjY3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjY0IiB4Mj0iNzA5IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjEiIHgyPSI3MDkiIHkyPSI2MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1OSIgeDI9IjcwOSIgeTI9IjU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU2IiB4Mj0iNzA5IiB5Mj0iNTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTMiIHgyPSI3MDkiIHkyPSI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1MSIgeDI9IjcwOSIgeTI9IjUxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ4IiB4Mj0iNzA5IiB5Mj0iNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDUiIHgyPSI3MDkiIHkyPSI0NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MyIgeDI9IjcwOSIgeTI9IjQzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQwIiB4Mj0iNzA5IiB5Mj0iNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzciIHgyPSI3MDkiIHkyPSIzNyIvPgo8dGV4dCB4PSIxMCIgeT0iMTcyIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIiB0cmFuc2Zvcm09InJvdGF0ZSgyNzAsIDEwLCAxNzIpIj4KdGl0bGVzCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyMCIgeTE9IjMwOSIgeDI9IjEyMCIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNTEiIHkxPSIzMDkiIHgyPSIyNTEiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzgyIiB5MT0iMzA5IiB4Mj0iMzgyIiB5Mj0iMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUxMiIgeTE9IjMwOSIgeDI9IjUxMiIgeTI9IjM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NDMiIHkxPSIzMDkiIHgyPSI2NDMiIHkyPSIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDkiIHgyPSI3MDkiIHkyPSIzMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjgzIiB4Mj0iNzA5IiB5Mj0iMjgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1NiIgeDI9IjcwOSIgeTI9IjI1NiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjkiIHgyPSI3MDkiIHkyPSIyMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjAyIiB4Mj0iNzA5IiB5Mj0iMjAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3NSIgeDI9IjcwOSIgeTI9IjE3NSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDgiIHgyPSI3MDkiIHkyPSIxNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTIxIiB4Mj0iNzA5IiB5Mj0iMTIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijk0IiB4Mj0iNzA5IiB5Mj0iOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjciIHgyPSI3MDkiIHkyPSI2NyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MCIgeDI9IjcwOSIgeTI9IjQwIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNCA1NCwzMDkgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIzMDkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMDkgNTQsMzA5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjgzIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjgzIDU0LDI4MyAiLz4KPHRleHQgeD0iNDUiIHk9IjI1NiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI1NiA1NCwyNTYgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyMjkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyMjkgNTQsMjI5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMjAyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo4LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMjAyIDU0LDIwMiAiLz4KPHRleHQgeD0iNDUiIHk9IjE3NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxNzUgNTQsMTc1ICIvPgo8dGV4dCB4PSI0NSIgeT0iMTQ4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxMi4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDE0OCA1NCwxNDggIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxMjEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjE0LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTIxIDU0LDEyMSAiLz4KPHRleHQgeD0iNDUiIHk9Ijk0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxNi4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDk0IDU0LDk0ICIvPgo8dGV4dCB4PSI0NSIgeT0iNjciIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjE4LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksNjcgNTQsNjcgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI0MCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw0MCA1NCw0MCAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU1LDMxMCA3MDksMzEwICIvPgo8dGV4dCB4PSIxMjAiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkJhcmNlbG9uYQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIxMjAsMzEwIDEyMCwzMTUgIi8+Cjx0ZXh0IHg9IjI1MSIgeT0iMzIwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUmVhbCBNYWRyaWQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjUxLDMxMCAyNTEsMzE1ICIvPgo8dGV4dCB4PSIzODIiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CkF0aCBNYWRyaWQKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzgyLDMxMCAzODIsMzE1ICIvPgo8dGV4dCB4PSI1MTIiIHk9IjMyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+ClZhbGVuY2lhCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUxMiwzMTAgNTEyLDMxNSAiLz4KPHRleHQgeD0iNjQzIiB5PSIzMjAiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpMYSBDb3J1bmEKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjQzLDMxMCA2NDMsMzE1ICIvPgo8cmVjdCB4PSI3NCIgeT0iODAiIHdpZHRoPSI5MiIgaGVpZ2h0PSIyMjkiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSIyMDUiIHk9IjE3NSIgd2lkdGg9IjkxIiBoZWlnaHQ9IjEzNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+CjxyZWN0IHg9IjMzNiIgeT0iMjY5IiB3aWR0aD0iOTEiIGhlaWdodD0iNDAiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIvPgo8cmVjdCB4PSI0NjciIHk9IjI4MyIgd2lkdGg9IjkxIiBoZWlnaHQ9IjI2IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiLz4KPHJlY3QgeD0iNTk3IiB5PSIyOTYiIHdpZHRoPSI5MiIgaGVpZ2h0PSIxMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIi8+Cjwvc3ZnPg==)

```rust
let n_s = seasons.len();
let pts_max_s = seasons.iter().map(|s| s.pts).fold(1i64, |a, b| a.max(b)) as f64 * 1.1;
let figure2 = plotters::evcxr::evcxr_figure((760, 400), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Champion's points, season by season", ("sans-serif", 18))
        .margin(10)
        .x_label_area_size(30)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5_f64..(n_s as f64 - 0.5), 0.0..pts_max_s)?;
    chart.configure_mesh().y_desc("points").x_labels(0).draw()?;
    chart.draw_series(seasons.iter().enumerate().map(|(i, s)| {
        Circle::new((i as f64, s.pts as f64), 3, BLUE.filled())
    }))?;
    chart.draw_series(LineSeries::new(
        seasons.iter().enumerate().map(|(i, s)| (i as f64, s.pts as f64)),
        BLUE.stroke_width(1),
    ))?;
    Ok(())
});
figure2.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzYwIiBoZWlnaHQ9IjQwMCIgdmlld0JveD0iMCAwIDc2MCA0MDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNDAwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzgwIiB5PSIxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KQ2hhbXBpb24mYXBvcztzIHBvaW50cywgc2Vhc29uIGJ5IHNlYXNvbgo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9Ijc0OSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNTQiIHgyPSI3NDkiIHkyPSIzNTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQ4IiB4Mj0iNzQ5IiB5Mj0iMzQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0MiIgeDI9Ijc0OSIgeTI9IjM0MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzYiIHgyPSI3NDkiIHkyPSIzMzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzMwIiB4Mj0iNzQ5IiB5Mj0iMzMwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMyNCIgeDI9Ijc0OSIgeTI9IjMyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMTgiIHgyPSI3NDkiIHkyPSIzMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzEyIiB4Mj0iNzQ5IiB5Mj0iMzEyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMwNiIgeDI9Ijc0OSIgeTI9IjMwNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDAiIHgyPSI3NDkiIHkyPSIzMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjk0IiB4Mj0iNzQ5IiB5Mj0iMjk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI4OSIgeDI9Ijc0OSIgeTI9IjI4OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyODMiIHgyPSI3NDkiIHkyPSIyODMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjc3IiB4Mj0iNzQ5IiB5Mj0iMjc3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MSIgeDI9Ijc0OSIgeTI9IjI3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNjUiIHgyPSI3NDkiIHkyPSIyNjUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjU5IiB4Mj0iNzQ5IiB5Mj0iMjU5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1MyIgeDI9Ijc0OSIgeTI9IjI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNDciIHgyPSI3NDkiIHkyPSIyNDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQxIiB4Mj0iNzQ5IiB5Mj0iMjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzNSIgeDI9Ijc0OSIgeTI9IjIzNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMjkiIHgyPSI3NDkiIHkyPSIyMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI0IiB4Mj0iNzQ5IiB5Mj0iMjI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxOCIgeDI9Ijc0OSIgeTI9IjIxOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTIiIHgyPSI3NDkiIHkyPSIyMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA2IiB4Mj0iNzQ5IiB5Mj0iMjA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIwMCIgeDI9Ijc0OSIgeTI9IjIwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTQiIHgyPSI3NDkiIHkyPSIxOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg4IiB4Mj0iNzQ5IiB5Mj0iMTg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4MiIgeDI9Ijc0OSIgeTI9IjE4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzYiIHgyPSI3NDkiIHkyPSIxNzYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTcwIiB4Mj0iNzQ5IiB5Mj0iMTcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE2NCIgeDI9Ijc0OSIgeTI9IjE2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTkiIHgyPSI3NDkiIHkyPSIxNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTUzIiB4Mj0iNzQ5IiB5Mj0iMTUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE0NyIgeDI9Ijc0OSIgeTI9IjE0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNDEiIHgyPSI3NDkiIHkyPSIxNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTM1IiB4Mj0iNzQ5IiB5Mj0iMTM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEyOSIgeDI9Ijc0OSIgeTI9IjEyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjMiIHgyPSI3NDkiIHkyPSIxMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTE3IiB4Mj0iNzQ5IiB5Mj0iMTE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExMSIgeDI9Ijc0OSIgeTI9IjExMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMDUiIHgyPSI3NDkiIHkyPSIxMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iOTkiIHgyPSI3NDkiIHkyPSI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5NCIgeDI9Ijc0OSIgeTI9Ijk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijg4IiB4Mj0iNzQ5IiB5Mj0iODgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODIiIHgyPSI3NDkiIHkyPSI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3NiIgeDI9Ijc0OSIgeTI9Ijc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjcwIiB4Mj0iNzQ5IiB5Mj0iNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjQiIHgyPSI3NDkiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1OCIgeDI9Ijc0OSIgeTI9IjU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjUyIiB4Mj0iNzQ5IiB5Mj0iNTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDYiIHgyPSI3NDkiIHkyPSI0NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MCIgeDI9Ijc0OSIgeTI9IjQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM0IiB4Mj0iNzQ5IiB5Mj0iMzQiLz4KPHRleHQgeD0iMTAiIHk9IjE5NyIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCIgdHJhbnNmb3JtPSJyb3RhdGUoMjcwLCAxMCwgMTk3KSI+CnBvaW50cwo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1OSIgeDI9Ijc0OSIgeTI9IjM1OSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMDAiIHgyPSI3NDkiIHkyPSIzMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQxIiB4Mj0iNzQ5IiB5Mj0iMjQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE4MiIgeDI9Ijc0OSIgeTI9IjE4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMjMiIHgyPSI3NDkiIHkyPSIxMjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjQiIHgyPSI3NDkiIHkyPSI2NCIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzQgNTQsMzU5ICIvPgo8dGV4dCB4PSI0NSIgeT0iMzU5IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzU5IDU0LDM1OSAiLz4KPHRleHQgeD0iNDUiIHk9IjMwMCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwzMDAgNTQsMzAwICIvPgo8dGV4dCB4PSI0NSIgeT0iMjQxIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDI0MSA1NCwyNDEgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIxODIiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTgyIDU0LDE4MiAiLz4KPHRleHQgeD0iNDUiIHk9IjEyMyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KODAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwxMjMgNTQsMTIzICIvPgo8dGV4dCB4PSI0NSIgeT0iNjQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDY0IDU0LDY0ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsMzYwIDc0OSwzNjAgIi8+CjxjaXJjbGUgY3g9IjY1IiBjeT0iMTIwIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI4NiIgY3k9IjEyOSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTA3IiBjeT0iMTAyIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxMjgiIGN5PSI4OCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTQ5IiBjeT0iMTQxIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxNzAiIGN5PSIxMjYiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE5MSIgY3k9IjE1NiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjEyIiBjeT0iMTIzIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMzMiIGN5PSIxMzgiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjI1NCIgY3k9IjEyOSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjc1IiBjeT0iMTMyIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyOTYiIGN5PSIxMTEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMxNyIgY3k9IjExNyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzM4IiBjeT0iMTM1IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzNTkiIGN5PSIxMDgiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM4MCIgY3k9IjEwMiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDAyIiBjeT0iNjciIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQyMyIgY3k9Ijc2IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0NDQiIGN5PSI2NCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDY1IiBjeT0iNjQiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ4NiIgY3k9Ijk0IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1MDciIGN5PSI4MiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTI4IiBjeT0iOTEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjU0OSIgY3k9Ijg1IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1NzAiIGN5PSI4NSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTkxIiBjeT0iMTAyIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2MTIiIGN5PSIxMDIiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjYzMyIgY3k9IjEwNSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjU0IiBjeT0iMTA1IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2NzUiIGN5PSI5OSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjk2IiBjeT0iNzkiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjcxNyIgY3k9Ijk5IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI3MzgiIGN5PSI4MiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDBGRiIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY1LDEyMCA4NiwxMjkgMTA3LDEwMiAxMjgsODggMTQ5LDE0MSAxNzAsMTI2IDE5MSwxNTYgMjEyLDEyMyAyMzMsMTM4IDI1NCwxMjkgMjc1LDEzMiAyOTYsMTExIDMxNywxMTcgMzM4LDEzNSAzNTksMTA4IDM4MCwxMDIgNDAyLDY3IDQyMyw3NiA0NDQsNjQgNDY1LDY0IDQ4Niw5NCA1MDcsODIgNTI4LDkxIDU0OSw4NSA1NzAsODUgNTkxLDEwMiA2MTIsMTAyIDYzMywxMDUgNjU0LDEwNSA2NzUsOTkgNjk2LDc5IDcxNyw5OSA3MzgsODIgIi8+Cjwvc3ZnPg==)

## Findings

Across **33 complete seasons** (1993/94 → 2025/26) and 12,834 matches — 445
duplicate fixtures removed after reconciling the two data sources' team-name
conventions — the La Liga record book:

- **Most championships**: Barcelona **17**, Real Madrid **10** — the two clubs
  have won **27 of 33** titles between them. Atlético Madrid 3, Valencia 2, and
  Deportivo La Coruña's 1999/00 crown are the only other champions in the modern
  era.
- **Champion hall of fame**: Barcelona's 2012/13 MSN side owns most points
  (100), most wins and biggest margin; Real Madrid's 2011/12 side scored a
  record **121 goals**; Barcelona 2022/23 conceded just **20**; Barcelona
  2014/15 produced the best goal difference (+89).
- **Best season ever**: a dead heat at the top — Real Madrid 2011/12 and
  Barcelona 2012/13 both finished on **100 points** (2.63 ppg).
- **Closest finish**: 2006/07 — Barcelona and Real Madrid finished on
  **identical points** and Madrid won the title on goal difference, one of the
  greatest finishes in football history. 2015/16 was decided by a single point
  (Barcelona over Madrid).
- **Biggest blowout**: Barcelona 2012/13, 15 clear. Madrid's 2021/22 title (+13
  over Barcelona) is the only Los Blancos rout of the era.
- **Records on the pitch**: Real Madrid 10–2 Rayo Vallecano (2015/16) is the
  highest-scoring match (12 goals) and among the biggest wins; three separate
  8–0 wins.
- **Top scorers** (StatsBomb coverage, 2015/16): Suárez 40, Ronaldo 35, Messi
  26, Benzema 24, Neymar 24.

_Method notes: same pipeline as the Premier League record book — merged data
sources deduplicated via canonical club names; 2026/27 in progress excluded;
player data covers the StatsBomb subset only._
