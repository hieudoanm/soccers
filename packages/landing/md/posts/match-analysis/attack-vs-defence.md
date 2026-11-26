---
title: 'Attack vs Defence: does defence win titles?'
description: |
  '33 Premier League seasons tested — the cliché is backwards: attack predicts position better, and titles go to balanced teams.'
author: 'hieudoan'
date: '2026-11-26T02:00'
order: 35
tags: ['football', 'analysis', 'premier-league', 'mars', 'sqlite']
---

# Attack vs Defence: does defence win titles?

## Attack vs Defence: does defence win titles?

The cliché says _"attack wins you games, but defence wins you titles."_ This
notebook tests it properly on **33 completed Premier League seasons (1993/94 →
2025/26)** — every match result from `data/matches_full.csv`, deduplicated
across the two merged data sources.

**Method.** For every team-season we compute goals for (GF), goals against (GA),
the league position, and within-season ranks for attack (GF rank, 1 = most
goals) and defence (GA rank, 1 = fewest conceded). Because ranks are computed
_within_ each season, era differences in scoring environment cancel out. We then
ask:

1. Which rank — attack or defence — correlates more strongly with final
   position, season by season and by era?
2. How often does the league's best attack actually win the title, versus the
   league's best defence?
3. What does the _weakest link_ of each champion look like — the worst defensive
   or attacking rank ever to lift the trophy?
4. Are champions unusually _balanced_, or one-dimensional?

xG is not available for EPL history in this dataset, so the analysis uses actual
goals only — stated as a limitation throughout.

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

// seasons excluded as mislabeled data (e.g. another league's fixtures)
let drop_seasons: &[&str] = &[];

println!("English Premier League matches: {}", df.height());

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
English Premier League matches: 13126
finished matches: 12814 (312 duplicate fixtures dropped) | team-season entries: 684
complete seasons: 33 (1993/94 -> 2025/26)
```

## Within-season ranks and correlations

For each season every team gets three ranks: position (1 = champion), attack
rank (most goals scored), defence rank (fewest goals conceded). We compute the
Spearman correlation (Pearson on rank vectors) between each metric's rank and
final position, per season — then average by era.

```rust

fn pearson(x: &[f64], y: &[f64]) -> f64 {
    let n = x.len() as f64;
    if n < 3.0 { return 0.0; }
    let mx = x.iter().sum::<f64>() / n;
    let my = y.iter().sum::<f64>() / n;
    let mut sxy = 0.0; let mut sxx = 0.0; let mut syy = 0.0;
    for i in 0..x.len() {
        let dx = x[i] - mx; let dy = y[i] - my;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if sxx <= 0.0 || syy <= 0.0 { 0.0 } else { sxy / (sxx * syy).sqrt() }
}

fn era_of(season: &str) -> &'static str {
    let y: i32 = season[..4].parse().unwrap_or(0);
    match y {
        1993..=1999 => "1990s",
        2000..=2009 => "2000s",
        2010..=2019 => "2010s",
        _ => "2020s",
    }
}

struct TeamSeason {
    season: String,
    team: String,
    pos: i64,
    gf_rank: i64,
    ga_rank: i64,
    rank_sum: i64,
    gf: i64,
    ga: i64,
    pts: i64,
    is_champ: bool,
}

let mut team_seasons: Vec<TeamSeason> = Vec::new();
let mut seas_stats: Vec<(String, f64, f64, f64, i64, i64)> = Vec::new(); // season, rho_gf, rho_ga, rho_sum, best_gf_won, best_ga_won

for sname in &complete_seasons {
    let st = standings(sname);
    let n = st.len() as i64;
    if n < 10 { continue; }
    // ranks: position from standings order; gf_rank desc; ga_rank asc
    let mut by_gf: Vec<usize> = (0..st.len()).collect();
    by_gf.sort_by(|&i, &j| st[j].gf.cmp(&st[i].gf).then(st[i].team.cmp(&st[j].team)));
    let mut by_ga: Vec<usize> = (0..st.len()).collect();
    by_ga.sort_by(|&i, &j| st[i].ga.cmp(&st[j].ga).then(st[i].team.cmp(&st[j].team)));
    let mut gf_rank = vec![0i64; st.len()];
    let mut ga_rank = vec![0i64; st.len()];
    for (r, &i) in by_gf.iter().enumerate() { gf_rank[i] = r as i64 + 1; }
    for (r, &i) in by_ga.iter().enumerate() { ga_rank[i] = r as i64 + 1; }

    let mut pos_v = Vec::new(); let mut gf_r_v = Vec::new(); let mut ga_r_v = Vec::new(); let mut sum_v = Vec::new();
    for (i, r) in st.iter().enumerate() {
        let pos = i as i64 + 1;
        pos_v.push(pos as f64);
        gf_r_v.push(gf_rank[i] as f64);
        ga_r_v.push(ga_rank[i] as f64);
        sum_v.push((gf_rank[i] + ga_rank[i]) as f64);
        team_seasons.push(TeamSeason {
            season: sname.clone(), team: r.team.clone(), pos,
            gf_rank: gf_rank[i], ga_rank: ga_rank[i],
            rank_sum: gf_rank[i] + ga_rank[i],
            gf: r.gf, ga: r.ga, pts: r.pts, is_champ: i == 0,
        });
    }
    let rho_gf = pearson(&gf_r_v, &pos_v);
    let rho_ga = pearson(&ga_r_v, &pos_v);
    let rho_sum = pearson(&sum_v, &pos_v);
    let best_gf_won = if gf_rank[0] == 1 { 1 } else { 0 };
    let best_ga_won = if ga_rank[0] == 1 { 1 } else { 0 };
    seas_stats.push((sname.clone(), rho_gf, rho_ga, rho_sum, best_gf_won, best_ga_won));
}

println!("team-seasons: {} | seasons: {}", team_seasons.len(), seas_stats.len());

// era summary
let mut era_rows: Vec<Vec<String>> = Vec::new();
for e in ["1990s", "2000s", "2010s", "2020s"] {
    let rows: Vec<&(String, f64, f64, f64, i64, i64)> = seas_stats.iter().filter(|s| era_of(&s.0) == e).collect();
    if rows.is_empty() { continue; }
    let n = rows.len() as f64;
    let m = |f: &dyn Fn(&(String, f64, f64, f64, i64, i64)) -> f64| rows.iter().map(|r| f(r)).sum::<f64>() / n;
    let gw = rows.iter().map(|r| r.4).sum::<i64>();
    let dw = rows.iter().map(|r| r.5).sum::<i64>();
    era_rows.push(vec![
        e.to_string(),
        rows.len().to_string(),
        format!("{:.2}", m(&|r| r.1)),
        format!("{:.2}", m(&|r| r.2)),
        format!("{:.2}", m(&|r| r.3)),
        format!("{}/{}", gw, rows.len()),
        format!("{}/{}", dw, rows.len()),
    ]);
}
mars_table(&["era", "seasons", "rho attack", "rho defence", "rho balance", "best-GF won", "best-GA won"], &era_rows);
```

```text
team-seasons: 664 | seasons: 33
```

| era   | seasons | rho attack | rho defence | rho balance | best-GF won | best-GA won |
| ----- | ------- | ---------- | ----------- | ----------- | ----------- | ----------- |
| 1990s | 7       | 0.82       | 0.77        | 0.92        | 5/7         | 0/7         |
| 2000s | 10      | 0.85       | 0.87        | 0.94        | 6/10        | 6/10        |
| 2010s | 10      | 0.86       | 0.85        | 0.94        | 6/10        | 4/10        |
| 2020s | 6       | 0.88       | 0.81        | 0.94        | 5/6         | 3/6         |

```rust

// champion profile: attack/defence ranks of every title winner
let champs: Vec<&TeamSeason> = team_seasons.iter().filter(|t| t.is_champ).collect();

let mut champ_rows: Vec<Vec<String>> = champs.iter().map(|c| vec![
    c.season.clone(), c.team.clone(),
    format!("{} ({})", c.gf_rank, c.gf),
    format!("{} ({})", c.ga_rank, c.ga),
    c.rank_sum.to_string(),
]).collect();
mars_table(&["season", "champion", "attack rank (gf)", "defence rank (ga)", "rank sum"], &champ_rows);

// extremes: worst defensive / attacking ranks ever to win the title
let worst_def = champs.iter().max_by_key(|c| c.ga_rank).unwrap();
let worst_att = champs.iter().max_by_key(|c| c.gf_rank).unwrap();
let best_def = champs.iter().min_by_key(|c| c.ga_rank).unwrap();
let best_att = champs.iter().min_by_key(|c| c.gf_rank).unwrap();
println!("weakest defence to win: {} {} — GA rank {}, {} goals conceded", worst_def.season, worst_def.team, worst_def.ga_rank, worst_def.ga);
println!("weakest attack to win: {} {} — GF rank {}, {} goals scored", worst_att.season, worst_att.team, worst_att.gf_rank, worst_att.gf);
println!("best defence: {} {} — GA rank {}", best_def.season, best_def.team, best_def.ga_rank);
println!("best attack: {} {} — GF rank {}", best_att.season, best_att.team, best_att.gf_rank);

// balance: champion rank_sum vs expectation
let avg_sum = champs.iter().map(|c| c.rank_sum as f64).sum::<f64>() / champs.len() as f64;
let avg_pos = champs.iter().map(|c| c.pos as f64).sum::<f64>() / champs.len() as f64;
// expected rank_sum for a random team = n+1 (21 for 20 teams, 23 for 22)
let mut exp_sum = 0.0;
for c in &champs {
    let n = team_seasons.iter().filter(|t| t.season == c.season).count() as f64;
    exp_sum += n + 1.0;
}
exp_sum /= champs.len() as f64;
println!("champion avg rank_sum: {:.1} vs random expectation {:.1}", avg_sum, exp_sum);
println!("champions finishing top-4 in BOTH attack and defence: {}/{}", champs.iter().filter(|c| c.gf_rank <= 4 && c.ga_rank <= 4).count(), champs.len());
println!("champions top-2 in BOTH: {}/{}", champs.iter().filter(|c| c.gf_rank <= 2 && c.ga_rank <= 2).count(), champs.len());
println!("champions top-3 in defence: {}/{}", champs.iter().filter(|c| c.ga_rank <= 3).count(), champs.len());
println!("champions top-3 in attack: {}/{}", champs.iter().filter(|c| c.gf_rank <= 3).count(), champs.len());
```

```text
weakest defence to win: 1996/97 Man United — GA rank 7, 44 goals conceded
weakest attack to win: 2008/09 Man United — GF rank 4, 68 goals scored
best defence: 2000/01 Man United — GA rank 1
best attack: 1994/95 Blackburn — GF rank 1
champion avg rank_sum: 3.8 vs random expectation 21.1
champions finishing top-4 in BOTH attack and defence: 30/33
champions top-2 in BOTH: 20/33
champions top-3 in defence: 26/33
champions top-3 in attack: 32/33
```

| season  | champion   | attack rank (gf) | defence rank (ga) | rank sum |
| ------- | ---------- | ---------------- | ----------------- | -------- |
| 1993/94 | Man United | 2 (80)           | 3 (38)            | 5        |
| 1994/95 | Blackburn  | 1 (80)           | 4 (39)            | 5        |
| 1995/96 | Man United | 1 (73)           | 4 (35)            | 5        |
| 1996/97 | Man United | 1 (76)           | 7 (44)            | 8        |
| 1997/98 | Arsenal    | 3 (68)           | 2 (33)            | 5        |
| 1998/99 | Man United | 1 (80)           | 4 (37)            | 5        |
| 1999/00 | Man United | 1 (97)           | 6 (45)            | 7        |
| 2000/01 | Man United | 1 (79)           | 1 (31)            | 2        |
| 2001/02 | Arsenal    | 2 (79)           | 2 (36)            | 4        |
| 2002/03 | Man United | 2 (74)           | 1 (34)            | 3        |
| 2003/04 | Arsenal    | 1 (73)           | 1 (26)            | 2        |
| 2004/05 | Chelsea    | 2 (72)           | 1 (15)            | 3        |
| 2005/06 | Chelsea    | 1 (72)           | 1 (22)            | 2        |
| 2006/07 | Man United | 1 (83)           | 3 (27)            | 4        |
| 2007/08 | Man United | 1 (80)           | 1 (22)            | 2        |
| 2008/09 | Man United | 4 (68)           | 2 (24)            | 6        |
| 2009/10 | Chelsea    | 1 (103)          | 2 (32)            | 3        |
| 2010/11 | Man United | 1 (78)           | 3 (37)            | 4        |
| 2011/12 | Man City   | 1 (93)           | 1 (29)            | 2        |
| 2012/13 | Man United | 1 (86)           | 6 (43)            | 7        |
| 2013/14 | Man City   | 1 (102)          | 2 (37)            | 3        |
| 2014/15 | Chelsea    | 2 (73)           | 1 (32)            | 3        |
| 2015/16 | Leicester  | 3 (68)           | 4 (36)            | 7        |
| 2016/17 | Chelsea    | 2 (85)           | 3 (33)            | 5        |
| 2017/18 | Man City   | 1 (106)          | 1 (27)            | 2        |
| 2018/19 | Man City   | 1 (95)           | 2 (23)            | 3        |
| 2019/20 | Liverpool  | 2 (85)           | 1 (33)            | 3        |
| 2020/21 | Man City   | 1 (83)           | 1 (32)            | 2        |
| 2021/22 | Man City   | 1 (99)           | 2 (26)            | 3        |
| 2022/23 | Man City   | 1 (94)           | 1 (33)            | 2        |
| 2023/24 | Man City   | 1 (96)           | 2 (34)            | 3        |
| 2024/25 | Liverpool  | 1 (86)           | 2 (41)            | 3        |
| 2025/26 | Arsenal    | 2 (71)           | 1 (27)            | 3        |

```rust
// counterfactual detail: every season, who had the best attack / best defence, and who won
let mut cf_rows: Vec<Vec<String>> = Vec::new();
for sname in &complete_seasons {
    let ts: Vec<&TeamSeason> = team_seasons.iter().filter(|t| &t.season == sname).collect();
    if ts.is_empty() { continue; }
    let best_att = ts.iter().min_by_key(|t| t.gf_rank).unwrap();
    let best_def = ts.iter().min_by_key(|t| t.ga_rank).unwrap();
    let champ = ts.iter().find(|t| t.is_champ).unwrap();
    let att_mark = if best_att.team == champ.team { "= champion" } else { "" };
    let def_mark = if best_def.team == champ.team { "= champion" } else { "" };
    cf_rows.push(vec![
        sname.clone(), champ.team.clone(),
        format!("{} (pos {}){}", best_att.team, best_att.pos, att_mark),
        format!("{} (pos {}){}", best_def.team, best_def.pos, def_mark),
    ]);
}
mars_table(&["season", "champion", "best attack", "best defence"], &cf_rows);
```

| season  | champion   | best attack                  | best defence                 |
| ------- | ---------- | ---------------------------- | ---------------------------- |
| 1993/94 | Man United | Newcastle (pos 3)            | Arsenal (pos 4)              |
| 1994/95 | Blackburn  | Blackburn (pos 1)= champion  | Man United (pos 2)           |
| 1995/96 | Man United | Man United (pos 1)= champion | Arsenal (pos 5)              |
| 1996/97 | Man United | Man United (pos 1)= champion | Arsenal (pos 3)              |
| 1997/98 | Arsenal    | Man United (pos 2)           | Man United (pos 2)           |
| 1998/99 | Man United | Man United (pos 1)= champion | Arsenal (pos 2)              |
| 1999/00 | Man United | Man United (pos 1)= champion | Liverpool (pos 4)            |
| 2000/01 | Man United | Man United (pos 1)= champion | Man United (pos 1)= champion |
| 2001/02 | Arsenal    | Man United (pos 3)           | Liverpool (pos 2)            |
| 2002/03 | Man United | Arsenal (pos 2)              | Man United (pos 1)= champion |
| 2003/04 | Arsenal    | Arsenal (pos 1)= champion    | Arsenal (pos 1)= champion    |
| 2004/05 | Chelsea    | Arsenal (pos 2)              | Chelsea (pos 1)= champion    |
| 2005/06 | Chelsea    | Chelsea (pos 1)= champion    | Chelsea (pos 1)= champion    |
| 2006/07 | Man United | Man United (pos 1)= champion | Chelsea (pos 2)              |
| 2007/08 | Man United | Man United (pos 1)= champion | Man United (pos 1)= champion |
| 2008/09 | Man United | Liverpool (pos 2)            | Chelsea (pos 3)              |
| 2009/10 | Chelsea    | Chelsea (pos 1)= champion    | Man United (pos 2)           |
| 2010/11 | Man United | Man United (pos 1)= champion | Chelsea (pos 2)              |
| 2011/12 | Man City   | Man City (pos 1)= champion   | Man City (pos 1)= champion   |
| 2012/13 | Man United | Man United (pos 1)= champion | Man City (pos 2)             |
| 2013/14 | Man City   | Man City (pos 1)= champion   | Chelsea (pos 3)              |
| 2014/15 | Chelsea    | Man City (pos 2)             | Chelsea (pos 1)= champion    |
| 2015/16 | Leicester  | Man City (pos 4)             | Man United (pos 5)           |
| 2016/17 | Chelsea    | Tottenham (pos 2)            | Tottenham (pos 2)            |
| 2017/18 | Man City   | Man City (pos 1)= champion   | Man City (pos 1)= champion   |
| 2018/19 | Man City   | Man City (pos 1)= champion   | Liverpool (pos 2)            |
| 2019/20 | Liverpool  | Man City (pos 2)             | Liverpool (pos 1)= champion  |
| 2020/21 | Man City   | Man City (pos 1)= champion   | Man City (pos 1)= champion   |
| 2021/22 | Man City   | Man City (pos 1)= champion   | Liverpool (pos 2)            |
| 2022/23 | Man City   | Man City (pos 1)= champion   | Man City (pos 1)= champion   |
| 2023/24 | Man City   | Man City (pos 1)= champion   | Arsenal (pos 2)              |
| 2024/25 | Liverpool  | Liverpool (pos 1)= champion  | Arsenal (pos 2)              |
| 2025/26 | Arsenal    | Man City (pos 2)             | Arsenal (pos 1)= champion    |

```rust
// how often did the best attack / best defence miss out entirely (finish outside top 4)?
let mut att_miss4 = 0; let mut def_miss4 = 0; let n_seas = cf_rows.len();
for sname in &complete_seasons {
    let ts: Vec<&TeamSeason> = team_seasons.iter().filter(|t| &t.season == sname).collect();
    if ts.is_empty() { continue; }
    let best_att = ts.iter().min_by_key(|t| t.gf_rank).unwrap();
    let best_def = ts.iter().min_by_key(|t| t.ga_rank).unwrap();
    if best_att.pos > 4 { att_miss4 += 1; }
    if best_def.pos > 4 { def_miss4 += 1; }
}
println!("best attack finished outside top-4: {}/{} seasons", att_miss4, n_seas);
println!("best defence finished outside top-4: {}/{} seasons", def_miss4, n_seas);

// consistency: champion clean sheets vs league-best, and heavy defeats (3+ conceded in a game)
let mut cs_rows: Vec<Vec<String>> = Vec::new();
for c in champs.iter().take(0) { let _ = c; }
let mut champ_cs_total = 0i64; let mut champ_games = 0i64; let mut champ_heavy = 0i64;
let mut league_cs_best = 0i64;
for sname in &complete_seasons {
    let st = standings(sname);
    let champ_name = &st[0].team;
    let games = team_games.get(&(sname.clone(), champ_name.clone())).cloned().unwrap_or_default();
    let cs = games.iter().filter(|g| g.ga == 0).count() as i64;
    let heavy = games.iter().filter(|g| g.ga >= 3).count() as i64;
    champ_cs_total += cs; champ_games += games.len() as i64; champ_heavy += heavy;
    // league-best clean sheets this season
    let mut best_cs = 0i64;
    for ((s, t), gs) in &team_games {
        if s == sname {
            let c = gs.iter().filter(|g| g.ga == 0).count() as i64;
            if c > best_cs { best_cs = c; }
        }
    }
    if best_cs > league_cs_best { league_cs_best = best_cs; }
    cs_rows.push(vec![sname.clone(), champ_name.clone(), cs.to_string(), games.len().to_string(), heavy.to_string()]);
}
println!("champions' clean sheets: {} in {} games ({:.1}%)", champ_cs_total, champ_games, 100.0 * champ_cs_total as f64 / champ_games as f64);
println!("champions conceded 3+ in a match: {} times total", champ_heavy);
mars_table(&["season", "champion", "clean sheets", "games", "games conceding 3+"], &cs_rows.iter().rev().take(10).cloned().collect::<Vec<_>>());
```

```text
best attack finished outside top-4: 0/33 seasons
best defence finished outside top-4: 2/33 seasons
champions' clean sheets: 554 in 1262 games (43.9%)
champions conceded 3+ in a match: 78 times total
```

| season  | champion  | clean sheets | games | games conceding 3+ |
| ------- | --------- | ------------ | ----- | ------------------ |
| 2025/26 | Arsenal   | 19           | 38    | 1                  |
| 2024/25 | Liverpool | 14           | 38    | 5                  |
| 2023/24 | Man City  | 13           | 38    | 2                  |
| 2022/23 | Man City  | 13           | 38    | 2                  |
| 2021/22 | Man City  | 21           | 38    | 2                  |
| 2020/21 | Man City  | 19           | 38    | 3                  |
| 2019/20 | Liverpool | 15           | 38    | 3                  |
| 2018/19 | Man City  | 20           | 38    | 1                  |
| 2017/18 | Man City  | 18           | 38    | 2                  |
| 2016/17 | Chelsea   | 16           | 38    | 2                  |

## The picture

Two views of the same data: the per-season correlation between attack / defence
rank and final position across 33 seasons, and where each champion sat on the
attack–defence rank plane (rank 1 = best, bottom- left would be the perfect
balance).

```rust
use plotters::prelude::*;

// chart 1: rho_attack vs rho_defence per season
let n_s = seas_stats.len();
let rho_min = seas_stats.iter().map(|s| s.1.min(s.2)).fold(1.0f64, f64::min) - 0.1;
let rho_max = seas_stats.iter().map(|s| s.1.max(s.2)).fold(-1.0f64, f64::max) + 0.1;
let x_labels: Vec<String> = seas_stats.iter().map(|s| s.0[..4].to_string()).collect();
let rho_att: Vec<f64> = seas_stats.iter().map(|s| s.1).collect();
let rho_def: Vec<f64> = seas_stats.iter().map(|s| s.2).collect();

let fig1 = plotters::evcxr::evcxr_figure((820, 420), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Rank-vs-position correlation by season (Spearman rho)", ("sans-serif", 18))
        .margin(15)
        .x_label_area_size(35)
        .y_label_area_size(45)
        .build_cartesian_2d(0.0..(n_s as f64 - 1.0), rho_min..rho_max)?;
    chart.configure_mesh()
        .x_labels(6)
        .x_label_formatter(&|x: &f64| {
            let i = (*x).round() as usize;
            if i < x_labels.len() { x_labels[i].clone() } else { String::new() }
        })
        .draw()?;
    chart.draw_series(LineSeries::new(
        (0..n_s).map(|i| (i as f64, rho_att[i])), &RED,
    ))?;
    chart.draw_series(LineSeries::new(
        (0..n_s).map(|i| (i as f64, rho_def[i])), &BLUE,
    ))?;
    chart.draw_series((0..n_s).map(|i| Circle::new((i as f64, rho_att[i]), 3, RED.filled())))?;
    chart.draw_series((0..n_s).map(|i| Circle::new((i as f64, rho_def[i]), 3, BLUE.filled())))?;
    Ok(())
});
fig1.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODIwIiBoZWlnaHQ9IjQyMCIgdmlld0JveD0iMCAwIDgyMCA0MjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI4MjAiIGhlaWdodD0iNDIwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iNDEwIiB5PSIyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUmFuay12cy1wb3NpdGlvbiBjb3JyZWxhdGlvbiBieSBzZWFzb24gKFNwZWFybWFuIHJobykKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzNjkiIHgyPSI2MCIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI4MyIgeTE9IjM2OSIgeDI9IjgzIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwNiIgeTE9IjM2OSIgeDI9IjEwNiIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMjkiIHkxPSIzNjkiIHgyPSIxMjkiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTUzIiB5MT0iMzY5IiB4Mj0iMTUzIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3NiIgeTE9IjM2OSIgeDI9IjE3NiIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTkiIHkxPSIzNjkiIHgyPSIxOTkiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIyIiB5MT0iMzY5IiB4Mj0iMjIyIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI0NiIgeTE9IjM2OSIgeDI9IjI0NiIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNjkiIHkxPSIzNjkiIHgyPSIyNjkiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjkyIiB5MT0iMzY5IiB4Mj0iMjkyIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMxNSIgeTE9IjM2OSIgeDI9IjMxNSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMzkiIHkxPSIzNjkiIHgyPSIzMzkiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzYyIiB5MT0iMzY5IiB4Mj0iMzYyIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4NSIgeTE9IjM2OSIgeDI9IjM4NSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDgiIHkxPSIzNjkiIHgyPSI0MDgiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDMyIiB5MT0iMzY5IiB4Mj0iNDMyIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ1NSIgeTE9IjM2OSIgeDI9IjQ1NSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NzgiIHkxPSIzNjkiIHgyPSI0NzgiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTAxIiB5MT0iMzY5IiB4Mj0iNTAxIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUyNSIgeTE9IjM2OSIgeDI9IjUyNSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NDgiIHkxPSIzNjkiIHgyPSI1NDgiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTcxIiB5MT0iMzY5IiB4Mj0iNTcxIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5NCIgeTE9IjM2OSIgeDI9IjU5NCIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MTgiIHkxPSIzNjkiIHgyPSI2MTgiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjQxIiB5MT0iMzY5IiB4Mj0iNjQxIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY2NCIgeTE9IjM2OSIgeDI9IjY2NCIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2ODciIHkxPSIzNjkiIHgyPSI2ODciIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzExIiB5MT0iMzY5IiB4Mj0iNzExIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjczNCIgeTE9IjM2OSIgeDI9IjczNCIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3NTciIHkxPSIzNjkiIHgyPSI3NTciIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzgwIiB5MT0iMzY5IiB4Mj0iNzgwIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgwNCIgeTE9IjM2OSIgeDI9IjgwNCIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM2OSIgeDI9IjgwNCIgeTI9IjM2OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzNjYiIHgyPSI4MDQiIHkyPSIzNjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzYzIiB4Mj0iODA0IiB5Mj0iMzYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM2MCIgeDI9IjgwNCIgeTI9IjM2MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzNTYiIHgyPSI4MDQiIHkyPSIzNTYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzUzIiB4Mj0iODA0IiB5Mj0iMzUzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM1MCIgeDI9IjgwNCIgeTI9IjM1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzNDciIHgyPSI4MDQiIHkyPSIzNDciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzQ0IiB4Mj0iODA0IiB5Mj0iMzQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM0MCIgeDI9IjgwNCIgeTI9IjM0MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMzciIHgyPSI4MDQiIHkyPSIzMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzM0IiB4Mj0iODA0IiB5Mj0iMzM0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMzMSIgeDI9IjgwNCIgeTI9IjMzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMjciIHgyPSI4MDQiIHkyPSIzMjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzI0IiB4Mj0iODA0IiB5Mj0iMzI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMyMSIgeDI9IjgwNCIgeTI9IjMyMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMTgiIHgyPSI4MDQiIHkyPSIzMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzE1IiB4Mj0iODA0IiB5Mj0iMzE1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMxMSIgeDI9IjgwNCIgeTI9IjMxMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMDgiIHgyPSI4MDQiIHkyPSIzMDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzA1IiB4Mj0iODA0IiB5Mj0iMzA1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMwMiIgeDI9IjgwNCIgeTI9IjMwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyOTgiIHgyPSI4MDQiIHkyPSIyOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjk1IiB4Mj0iODA0IiB5Mj0iMjk1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI5MiIgeDI9IjgwNCIgeTI9IjI5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyODkiIHgyPSI4MDQiIHkyPSIyODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjg2IiB4Mj0iODA0IiB5Mj0iMjg2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI4MiIgeDI9IjgwNCIgeTI9IjI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNzkiIHgyPSI4MDQiIHkyPSIyNzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjc2IiB4Mj0iODA0IiB5Mj0iMjc2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI3MyIgeDI9IjgwNCIgeTI9IjI3MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNjkiIHgyPSI4MDQiIHkyPSIyNjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjY2IiB4Mj0iODA0IiB5Mj0iMjY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI2MyIgeDI9IjgwNCIgeTI9IjI2MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNjAiIHgyPSI4MDQiIHkyPSIyNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjU3IiB4Mj0iODA0IiB5Mj0iMjU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI1MyIgeDI9IjgwNCIgeTI9IjI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNTAiIHgyPSI4MDQiIHkyPSIyNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjQ3IiB4Mj0iODA0IiB5Mj0iMjQ3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI0NCIgeDI9IjgwNCIgeTI9IjI0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNDAiIHgyPSI4MDQiIHkyPSIyNDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjM3IiB4Mj0iODA0IiB5Mj0iMjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIzNCIgeDI9IjgwNCIgeTI9IjIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMzEiIHgyPSI4MDQiIHkyPSIyMzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjI4IiB4Mj0iODA0IiB5Mj0iMjI4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIyNCIgeDI9IjgwNCIgeTI9IjIyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMjEiIHgyPSI4MDQiIHkyPSIyMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjE4IiB4Mj0iODA0IiB5Mj0iMjE4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIxNSIgeDI9IjgwNCIgeTI9IjIxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMTEiIHgyPSI4MDQiIHkyPSIyMTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjA4IiB4Mj0iODA0IiB5Mj0iMjA4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIwNSIgeDI9IjgwNCIgeTI9IjIwNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMDIiIHgyPSI4MDQiIHkyPSIyMDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTk5IiB4Mj0iODA0IiB5Mj0iMTk5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE5NSIgeDI9IjgwNCIgeTI9IjE5NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxOTIiIHgyPSI4MDQiIHkyPSIxOTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTg5IiB4Mj0iODA0IiB5Mj0iMTg5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE4NiIgeDI9IjgwNCIgeTI9IjE4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxODIiIHgyPSI4MDQiIHkyPSIxODIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTc5IiB4Mj0iODA0IiB5Mj0iMTc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE3NiIgeDI9IjgwNCIgeTI9IjE3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNzMiIHgyPSI4MDQiIHkyPSIxNzMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTcwIiB4Mj0iODA0IiB5Mj0iMTcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE2NiIgeDI9IjgwNCIgeTI9IjE2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNjMiIHgyPSI4MDQiIHkyPSIxNjMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTYwIiB4Mj0iODA0IiB5Mj0iMTYwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE1NyIgeDI9IjgwNCIgeTI9IjE1NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNTMiIHgyPSI4MDQiIHkyPSIxNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTUwIiB4Mj0iODA0IiB5Mj0iMTUwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE0NyIgeDI9IjgwNCIgeTI9IjE0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNDQiIHgyPSI4MDQiIHkyPSIxNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTQxIiB4Mj0iODA0IiB5Mj0iMTQxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEzNyIgeDI9IjgwNCIgeTI9IjEzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMzQiIHgyPSI4MDQiIHkyPSIxMzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTMxIiB4Mj0iODA0IiB5Mj0iMTMxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEyOCIgeDI9IjgwNCIgeTI9IjEyOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMjQiIHgyPSI4MDQiIHkyPSIxMjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTIxIiB4Mj0iODA0IiB5Mj0iMTIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjExOCIgeDI9IjgwNCIgeTI9IjExOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMTUiIHgyPSI4MDQiIHkyPSIxMTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTEyIiB4Mj0iODA0IiB5Mj0iMTEyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEwOCIgeDI9IjgwNCIgeTI9IjEwOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMDUiIHgyPSI4MDQiIHkyPSIxMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTAyIiB4Mj0iODA0IiB5Mj0iMTAyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9Ijk5IiB4Mj0iODA0IiB5Mj0iOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iOTUiIHgyPSI4MDQiIHkyPSI5NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI5MiIgeDI9IjgwNCIgeTI9IjkyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9Ijg5IiB4Mj0iODA0IiB5Mj0iODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iODYiIHgyPSI4MDQiIHkyPSI4NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI4MyIgeDI9IjgwNCIgeTI9IjgzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9Ijc5IiB4Mj0iODA0IiB5Mj0iNzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNzYiIHgyPSI4MDQiIHkyPSI3NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI3MyIgeDI9IjgwNCIgeTI9IjczIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjcwIiB4Mj0iODA0IiB5Mj0iNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNjYiIHgyPSI4MDQiIHkyPSI2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI2MyIgeDI9IjgwNCIgeTI9IjYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjYwIiB4Mj0iODA0IiB5Mj0iNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNTciIHgyPSI4MDQiIHkyPSI1NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI1NCIgeDI9IjgwNCIgeTI9IjU0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjUwIiB4Mj0iODA0IiB5Mj0iNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNDciIHgyPSI4MDQiIHkyPSI0NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI0NCIgeDI9IjgwNCIgeTI9IjQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM2OSIgeDI9IjYwIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI5MiIgeTE9IjM2OSIgeDI9IjI5MiIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjUiIHkxPSIzNjkiIHgyPSI1MjUiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzU3IiB5MT0iMzY5IiB4Mj0iNzU3IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzYzIiB4Mj0iODA0IiB5Mj0iMzYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMzMSIgeDI9IjgwNCIgeTI9IjMzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyOTgiIHgyPSI4MDQiIHkyPSIyOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjY2IiB4Mj0iODA0IiB5Mj0iMjY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIzNCIgeDI9IjgwNCIgeTI9IjIzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMDIiIHgyPSI4MDQiIHkyPSIyMDIiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTcwIiB4Mj0iODA0IiB5Mj0iMTcwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEzNyIgeDI9IjgwNCIgeTI9IjEzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMDUiIHgyPSI4MDQiIHkyPSIxMDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNzMiIHgyPSI4MDQiIHkyPSI3MyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI0MSIgeDI9IjgwNCIgeTI9IjQxIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwzOSA1OSwzNjkgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIzNjMiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuNTUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzYzIDU5LDM2MyAiLz4KPHRleHQgeD0iNTAiIHk9IjMzMSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC42CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDMzMSA1OSwzMzEgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIyOTgiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuNjUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMjk4IDU5LDI5OCAiLz4KPHRleHQgeD0iNTAiIHk9IjI2NiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC43CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDI2NiA1OSwyNjYgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIyMzQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuNzUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMjM0IDU5LDIzNCAiLz4KPHRleHQgeD0iNTAiIHk9IjIwMiIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC44CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDIwMiA1OSwyMDIgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIxNzAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuODUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMTcwIDU5LDE3MCAiLz4KPHRleHQgeD0iNTAiIHk9IjEzNyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC45CjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDEzNyA1OSwxMzcgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIxMDUiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuOTUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMTA1IDU5LDEwNSAiLz4KPHRleHQgeD0iNTAiIHk9IjczIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsNzMgNTksNzMgIi8+Cjx0ZXh0IHg9IjUwIiB5PSI0MSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMS4wNQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCw0MSA1OSw0MSAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjYwLDM3MCA4MDQsMzcwICIvPgo8dGV4dCB4PSI2MCIgeT0iMzgwIiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMTk5Mwo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MCwzNzAgNjAsMzc1ICIvPgo8dGV4dCB4PSIyOTIiIHk9IjM4MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwMDMKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMjkyLDM3MCAyOTIsMzc1ICIvPgo8dGV4dCB4PSI1MjUiIHk9IjM4MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwMTMKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTI1LDM3MCA1MjUsMzc1ICIvPgo8dGV4dCB4PSI3NTciIHk9IjM4MCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjIwMjMKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNzU3LDM3MCA3NTcsMzc1ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjRkYwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjAsMjEyIDgzLDE1NyAxMDYsMTc0IDEyOSwyMTMgMTUzLDE1NiAxNzYsMTc0IDE5OSwyMTUgMjIyLDE0OSAyNDYsMTMxIDI2OSwxNTEgMjkyLDI1MCAzMTUsMjI0IDMzOSwxMjUgMzYyLDEwNyAzODUsMTc3IDQwOCwxOTAgNDMyLDIwMSA0NTUsMjM0IDQ3OCwxOTkgNTAxLDE3NCA1MjUsMTM1IDU0OCwxMTkgNTcxLDE4NiA1OTQsMTIyIDYxOCwxNjQgNjQxLDEzMyA2NjQsMTYzIDY4NywxMDQgNzExLDE0MyA3MzQsMTg4IDc1NywxMjcgNzgwLDE2MSA4MDQsMTc3ICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMEZGIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNjAsMjA3IDgzLDMwNSAxMDYsMTYwIDEyOSwyOTUgMTUzLDIxMyAxNzYsMjExIDE5OSwxNjkgMjIyLDEzMSAyNDYsMjM1IDI2OSwyMTEgMjkyLDEyMiAzMTUsMTYxIDMzOSwxNTkgMzYyLDE5NiAzODUsMTMxIDQwOCwxMTYgNDMyLDEyOCA0NTUsMTU4IDQ3OCwxNDUgNTAxLDE2MyA1MjUsMTQwIDU0OCwyMTEgNTcxLDE2NyA1OTQsMTgyIDYxOCwyNDIgNjQxLDEzMyA2NjQsMTQ4IDY4NywyMDggNzExLDE5OCA3MzQsMTUwIDc1NywyMTMgNzgwLDE1OCA4MDQsMjM4ICIvPgo8Y2lyY2xlIGN4PSI2MCIgY3k9IjIxMiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iODMiIGN5PSIxNTciIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjEwNiIgY3k9IjE3NCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTI5IiBjeT0iMjEzIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxNTMiIGN5PSIxNTYiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE3NiIgY3k9IjE3NCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTk5IiBjeT0iMjE1IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMjIiIGN5PSIxNDkiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjI0NiIgY3k9IjEzMSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjY5IiBjeT0iMTUxIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyOTIiIGN5PSIyNTAiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMxNSIgY3k9IjIyNCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzM5IiBjeT0iMTI1IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzNjIiIGN5PSIxMDciIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjM4NSIgY3k9IjE3NyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDA4IiBjeT0iMTkwIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0MzIiIGN5PSIyMDEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ1NSIgY3k9IjIzNCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDc4IiBjeT0iMTk5IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1MDEiIGN5PSIxNzQiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjUyNSIgY3k9IjEzNSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTQ4IiBjeT0iMTE5IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1NzEiIGN5PSIxODYiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjU5NCIgY3k9IjEyMiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjE4IiBjeT0iMTY0IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2NDEiIGN5PSIxMzMiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjY2NCIgY3k9IjE2MyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjg3IiBjeT0iMTA0IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI3MTEiIGN5PSIxNDMiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjczNCIgY3k9IjE4OCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNzU3IiBjeT0iMTI3IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI3ODAiIGN5PSIxNjEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjgwNCIgY3k9IjE3NyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjAiIGN5PSIyMDciIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjgzIiBjeT0iMzA1IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxMDYiIGN5PSIxNjAiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjEyOSIgY3k9IjI5NSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTUzIiBjeT0iMjEzIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxNzYiIGN5PSIyMTEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjE5OSIgY3k9IjE2OSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjIyIiBjeT0iMTMxIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyNDYiIGN5PSIyMzUiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjI2OSIgY3k9IjIxMSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjkyIiBjeT0iMTIyIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzMTUiIGN5PSIxNjEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjMzOSIgY3k9IjE1OSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMzYyIiBjeT0iMTk2IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIzODUiIGN5PSIxMzEiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQwOCIgY3k9IjExNiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNDMyIiBjeT0iMTI4IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI0NTUiIGN5PSIxNTgiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjQ3OCIgY3k9IjE0NSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTAxIiBjeT0iMTYzIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1MjUiIGN5PSIxNDAiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjU0OCIgY3k9IjIxMSIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNTcxIiBjeT0iMTY3IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI1OTQiIGN5PSIxODIiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjYxOCIgY3k9IjI0MiIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNjQxIiBjeT0iMTMzIiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI2NjQiIGN5PSIxNDgiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9IjY4NyIgY3k9IjIwOCIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNzExIiBjeT0iMTk4IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI3MzQiIGN5PSIxNTAiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijc1NyIgY3k9IjIxMyIgcj0iMyIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iNzgwIiBjeT0iMTU4IiByPSIzIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI4MDQiIGN5PSIyMzgiIHI9IjMiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+Cjwvc3ZnPg==)

```rust
println!("red = attack rank vs position | blue = defence rank vs position");

// chart 2: champion attack-rank vs defence-rank scatter, coloured by era
let era_color = |e: &str| -> RGBColor {
    match e {
        "1990s" => BLUE,
        "2000s" => GREEN,
        "2010s" => CYAN,
        "2020s" => RED,
        _ => BLACK,
    }
};
let max_rank = champs.iter().map(|c| c.gf_rank.max(c.ga_rank)).max().unwrap_or(22) as f64;
let fig2 = plotters::evcxr::evcxr_figure((560, 560), |root| {
    root.fill(&WHITE)?;
    // y axis reversed: rank 1 (best defence) at top
    let mut chart = ChartBuilder::on(&root)
        .caption("Every Premier League champion: attack rank vs defence rank", ("sans-serif", 16))
        .margin(15)
        .x_label_area_size(40)
        .y_label_area_size(40)
        .build_cartesian_2d(0.5..(max_rank + 0.5), (max_rank + 0.5)..0.5)?;
    chart.configure_mesh()
        .x_desc("attack rank (1 = most goals)")
        .y_desc("defence rank (1 = fewest conceded)")
        .draw()?;
    chart.draw_series(champs.iter().map(|c| {
        Circle::new((c.gf_rank as f64, c.ga_rank as f64), 4, era_color(era_of(&c.season)).filled())
    }))?;
    Ok(())
});
fig2.evcxr_display();
```

```text
red = attack rank vs position | blue = defence rank vs position
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTYwIiBoZWlnaHQ9IjU2MCIgdmlld0JveD0iMCAwIDU2MCA1NjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI1NjAiIGhlaWdodD0iNTYwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMjgwIiB5PSIyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTIuOTAzMjI1ODA2NDUxNjE0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KRXZlcnkgUHJlbWllciBMZWFndWUgY2hhbXBpb246IGF0dGFjayByYW5rIHZzIGRlZmVuY2UgcmFuawo8L3RleHQ+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjUwNCIgeDI9IjU1IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYxIiB5MT0iNTA0IiB4Mj0iNjEiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjgiIHkxPSI1MDQiIHgyPSI2OCIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI3NSIgeTE9IjUwNCIgeDI9Ijc1IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjgyIiB5MT0iNTA0IiB4Mj0iODIiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iODkiIHkxPSI1MDQiIHgyPSI4OSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI5NiIgeTE9IjUwNCIgeDI9Ijk2IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEwMyIgeTE9IjUwNCIgeDI9IjEwMyIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMTAiIHkxPSI1MDQiIHgyPSIxMTAiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTE3IiB5MT0iNTA0IiB4Mj0iMTE3IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjEyNCIgeTE9IjUwNCIgeDI9IjEyNCIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMzEiIHkxPSI1MDQiIHgyPSIxMzEiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTM4IiB5MT0iNTA0IiB4Mj0iMTM4IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE0NSIgeTE9IjUwNCIgeDI9IjE0NSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNTIiIHkxPSI1MDQiIHgyPSIxNTIiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTU5IiB5MT0iNTA0IiB4Mj0iMTU5IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2NiIgeTE9IjUwNCIgeDI9IjE2NiIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxNzMiIHkxPSI1MDQiIHgyPSIxNzMiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTgwIiB5MT0iNTA0IiB4Mj0iMTgwIiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE4NyIgeTE9IjUwNCIgeDI9IjE4NyIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxOTQiIHkxPSI1MDQiIHgyPSIxOTQiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjAxIiB5MT0iNTA0IiB4Mj0iMjAxIiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIwOCIgeTE9IjUwNCIgeDI9IjIwOCIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTUiIHkxPSI1MDQiIHgyPSIyMTUiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjIyIiB5MT0iNTA0IiB4Mj0iMjIyIiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIyOSIgeTE9IjUwNCIgeDI9IjIyOSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMzYiIHkxPSI1MDQiIHgyPSIyMzYiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjQzIiB5MT0iNTA0IiB4Mj0iMjQzIiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI1MCIgeTE9IjUwNCIgeDI9IjI1MCIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNTciIHkxPSI1MDQiIHgyPSIyNTciIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjY0IiB5MT0iNTA0IiB4Mj0iMjY0IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI3MSIgeTE9IjUwNCIgeDI9IjI3MSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNzgiIHkxPSI1MDQiIHgyPSIyNzgiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjg1IiB5MT0iNTA0IiB4Mj0iMjg1IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI5MiIgeTE9IjUwNCIgeDI9IjI5MiIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyOTkiIHkxPSI1MDQiIHgyPSIyOTkiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzA2IiB5MT0iNTA0IiB4Mj0iMzA2IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMxMyIgeTE9IjUwNCIgeDI9IjMxMyIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjAiIHkxPSI1MDQiIHgyPSIzMjAiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzI3IiB5MT0iNTA0IiB4Mj0iMzI3IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMzNCIgeTE9IjUwNCIgeDI9IjMzNCIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNDEiIHkxPSI1MDQiIHgyPSIzNDEiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQ4IiB5MT0iNTA0IiB4Mj0iMzQ4IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM1NSIgeTE9IjUwNCIgeDI9IjM1NSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzNjIiIHkxPSI1MDQiIHgyPSIzNjIiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzY5IiB5MT0iNTA0IiB4Mj0iMzY5IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM3NiIgeTE9IjUwNCIgeDI9IjM3NiIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzODMiIHkxPSI1MDQiIHgyPSIzODMiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzkwIiB5MT0iNTA0IiB4Mj0iMzkwIiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM5NyIgeTE9IjUwNCIgeDI9IjM5NyIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MDQiIHkxPSI1MDQiIHgyPSI0MDQiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDExIiB5MT0iNTA0IiB4Mj0iNDExIiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQxOCIgeTE9IjUwNCIgeDI9IjQxOCIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MjUiIHkxPSI1MDQiIHgyPSI0MjUiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDMyIiB5MT0iNTA0IiB4Mj0iNDMyIiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzOSIgeTE9IjUwNCIgeDI9IjQzOSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NDYiIHkxPSI1MDQiIHgyPSI0NDYiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDUzIiB5MT0iNTA0IiB4Mj0iNDUzIiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ2MCIgeTE9IjUwNCIgeDI9IjQ2MCIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NjciIHkxPSI1MDQiIHgyPSI0NjciIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDc0IiB5MT0iNTA0IiB4Mj0iNDc0IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4MSIgeTE9IjUwNCIgeDI9IjQ4MSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0ODgiIHkxPSI1MDQiIHgyPSI0ODgiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDk1IiB5MT0iNTA0IiB4Mj0iNDk1IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwMiIgeTE9IjUwNCIgeDI9IjUwMiIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDkiIHkxPSI1MDQiIHgyPSI1MDkiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTE2IiB5MT0iNTA0IiB4Mj0iNTE2IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUyMyIgeTE9IjUwNCIgeDI9IjUyMyIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MzAiIHkxPSI1MDQiIHgyPSI1MzAiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTM3IiB5MT0iNTA0IiB4Mj0iNTM3IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU0NCIgeTE9IjUwNCIgeDI9IjU0NCIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM3IiB4Mj0iNTQ0IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDQiIHgyPSI1NDQiIHkyPSI0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI1MSIgeDI9IjU0NCIgeTI9IjUxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjU4IiB4Mj0iNTQ0IiB5Mj0iNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNjQiIHgyPSI1NDQiIHkyPSI2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3MSIgeDI9IjU0NCIgeTI9IjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijc4IiB4Mj0iNTQ0IiB5Mj0iNzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iODQiIHgyPSI1NDQiIHkyPSI4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI5MSIgeDI9IjU0NCIgeTI9IjkxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9Ijk4IiB4Mj0iNTQ0IiB5Mj0iOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTA0IiB4Mj0iNTQ0IiB5Mj0iMTA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjExMSIgeDI9IjU0NCIgeTI9IjExMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMTgiIHgyPSI1NDQiIHkyPSIxMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTI0IiB4Mj0iNTQ0IiB5Mj0iMTI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzMSIgeDI9IjU0NCIgeTI9IjEzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxMzgiIHgyPSI1NDQiIHkyPSIxMzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTQ0IiB4Mj0iNTQ0IiB5Mj0iMTQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE1MSIgeDI9IjU0NCIgeTI9IjE1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNTgiIHgyPSI1NDQiIHkyPSIxNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTY0IiB4Mj0iNTQ0IiB5Mj0iMTY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE3MSIgeDI9IjU0NCIgeTI9IjE3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxNzgiIHgyPSI1NDQiIHkyPSIxNzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMTg0IiB4Mj0iNTQ0IiB5Mj0iMTg0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjE5MSIgeDI9IjU0NCIgeTI9IjE5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIxOTgiIHgyPSI1NDQiIHkyPSIxOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjA0IiB4Mj0iNTQ0IiB5Mj0iMjA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIxMSIgeDI9IjU0NCIgeTI9IjIxMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMTgiIHgyPSI1NDQiIHkyPSIyMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjI0IiB4Mj0iNTQ0IiB5Mj0iMjI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjIzMSIgeDI9IjU0NCIgeTI9IjIzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMzgiIHgyPSI1NDQiIHkyPSIyMzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjQ0IiB4Mj0iNTQ0IiB5Mj0iMjQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI1MSIgeDI9IjU0NCIgeTI9IjI1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNTgiIHgyPSI1NDQiIHkyPSIyNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjY0IiB4Mj0iNTQ0IiB5Mj0iMjY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI3MSIgeDI9IjU0NCIgeTI9IjI3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyNzgiIHgyPSI1NDQiIHkyPSIyNzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjg0IiB4Mj0iNTQ0IiB5Mj0iMjg0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjI5MSIgeDI9IjU0NCIgeTI9IjI5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyOTgiIHgyPSI1NDQiIHkyPSIyOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzA0IiB4Mj0iNTQ0IiB5Mj0iMzA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMxMSIgeDI9IjU0NCIgeTI9IjMxMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMTgiIHgyPSI1NDQiIHkyPSIzMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzI0IiB4Mj0iNTQ0IiB5Mj0iMzI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMzMSIgeDI9IjU0NCIgeTI9IjMzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzMzgiIHgyPSI1NDQiIHkyPSIzMzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzQ0IiB4Mj0iNTQ0IiB5Mj0iMzQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM1MSIgeDI9IjU0NCIgeTI9IjM1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNTgiIHgyPSI1NDQiIHkyPSIzNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzY0IiB4Mj0iNTQ0IiB5Mj0iMzY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM3MSIgeDI9IjU0NCIgeTI9IjM3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzNzgiIHgyPSI1NDQiIHkyPSIzNzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMzg0IiB4Mj0iNTQ0IiB5Mj0iMzg0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjM5MSIgeDI9IjU0NCIgeTI9IjM5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIzOTgiIHgyPSI1NDQiIHkyPSIzOTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDA0IiB4Mj0iNTQ0IiB5Mj0iNDA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQxMSIgeDI9IjU0NCIgeTI9IjQxMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MTgiIHgyPSI1NDQiIHkyPSI0MTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDI0IiB4Mj0iNTQ0IiB5Mj0iNDI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQzMSIgeDI9IjU0NCIgeTI9IjQzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MzgiIHgyPSI1NDQiIHkyPSI0MzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDQ0IiB4Mj0iNTQ0IiB5Mj0iNDQ0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ1MSIgeDI9IjU0NCIgeTI9IjQ1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0NTgiIHgyPSI1NDQiIHkyPSI0NTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDY0IiB4Mj0iNTQ0IiB5Mj0iNDY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ3MSIgeDI9IjU0NCIgeTI9IjQ3MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0NzgiIHgyPSI1NDQiIHkyPSI0NzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDg0IiB4Mj0iNTQ0IiB5Mj0iNDg0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjQ5MSIgeDI9IjU0NCIgeTI9IjQ5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0OTgiIHgyPSI1NDQiIHkyPSI0OTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNTA0IiB4Mj0iNTQ0IiB5Mj0iNTA0Ii8+Cjx0ZXh0IHg9IjE1IiB5PSIyNzEiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiIHRyYW5zZm9ybT0icm90YXRlKDI3MCwgMTUsIDI3MSkiPgpkZWZlbmNlIHJhbmsgKDEgPSBmZXdlc3QgY29uY2VkZWQpCjwvdGV4dD4KPHRleHQgeD0iMzAwIiB5PSI1NDUiIGR5PSItMC41ZXgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgphdHRhY2sgcmFuayAoMSA9IG1vc3QgZ29hbHMpCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9Ijg5IiB5MT0iNTA0IiB4Mj0iODkiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTU5IiB5MT0iNTA0IiB4Mj0iMTU5IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIyOSIgeTE9IjUwNCIgeDI9IjIyOSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyOTkiIHkxPSI1MDQiIHgyPSIyOTkiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzY5IiB5MT0iNTA0IiB4Mj0iMzY5IiB5Mj0iMzciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzOSIgeTE9IjUwNCIgeDI9IjQzOSIgeTI9IjM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MDkiIHkxPSI1MDQiIHgyPSI1MDkiIHkyPSIzNyIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI3MSIgeDI9IjU0NCIgeTI9IjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjEzOCIgeDI9IjU0NCIgeTI9IjEzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSIyMDQiIHgyPSI1NDQiIHkyPSIyMDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iMjcxIiB4Mj0iNTQ0IiB5Mj0iMjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NSIgeTE9IjMzOCIgeDI9IjU0NCIgeTI9IjMzOCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUiIHkxPSI0MDQiIHgyPSI1NDQiIHkyPSI0MDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU1IiB5MT0iNDcxIiB4Mj0iNTQ0IiB5Mj0iNDcxIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNyA1NCw1MDQgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI3MSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDcxIDU0LDcxICIvPgo8dGV4dCB4PSI0NSIgeT0iMTM4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMTM4IDU0LDEzOCAiLz4KPHRleHQgeD0iNDUiIHk9IjIwNCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMy4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDIwNCA1NCwyMDQgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSIyNzEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjQuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSwyNzEgNTQsMjcxICIvPgo8dGV4dCB4PSI0NSIgeT0iMzM4IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNDksMzM4IDU0LDMzOCAiLz4KPHRleHQgeD0iNDUiIHk9IjQwNCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNi4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ5LDQwNCA1NCw0MDQgIi8+Cjx0ZXh0IHg9IjQ1IiB5PSI0NzEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjcuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0OSw0NzEgNTQsNDcxICIvPgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTUsNTA1IDU0NCw1MDUgIi8+Cjx0ZXh0IHg9Ijg5IiB5PSI1MTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iODksNTA1IDg5LDUxMCAiLz4KPHRleHQgeD0iMTU5IiB5PSI1MTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMTU5LDUwNSAxNTksNTEwICIvPgo8dGV4dCB4PSIyMjkiIHk9IjUxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjMuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSIyMjksNTA1IDIyOSw1MTAgIi8+Cjx0ZXh0IHg9IjI5OSIgeT0iNTE1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjI5OSw1MDUgMjk5LDUxMCAiLz4KPHRleHQgeD0iMzY5IiB5PSI1MTUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo1LjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzY5LDUwNSAzNjksNTEwICIvPgo8dGV4dCB4PSI0MzkiIHk9IjUxNSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjYuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI0MzksNTA1IDQzOSw1MTAgIi8+Cjx0ZXh0IHg9IjUwOSIgeT0iNTE1IiBkeT0iMC43NmVtIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNy4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjUwOSw1MDUgNTA5LDUxMCAiLz4KPGNpcmNsZSBjeD0iMTU5IiBjeT0iMjA0IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI4OSIgY3k9IjI3MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iODkiIGN5PSIyNzEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iNDcxIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyMjkiIGN5PSIxMzgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iMjcxIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMEZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI4OSIgY3k9IjQwNCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDBGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iODkiIGN5PSI3MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTU5IiBjeT0iMTM4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxNTkiIGN5PSI3MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iODkiIGN5PSI3MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkYwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTU5IiBjeT0iNzEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iNzEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iMjA0IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI4OSIgY3k9IjcxIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIyOTkiIGN5PSIxMzgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iMTM4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRjAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI4OSIgY3k9IjIwNCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkZGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iODkiIGN5PSI3MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkZGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iODkiIGN5PSI0MDQiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iMTM4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRkZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxNTkiIGN5PSI3MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkZGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMjI5IiBjeT0iMjcxIiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRkZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxNTkiIGN5PSIyMDQiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iNzEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMEZGRkYiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iMTM4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDBGRkZGIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSIxNTkiIGN5PSI3MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwRkZGRiIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iODkiIGN5PSI3MSIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iODkiIGN5PSIxMzgiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iNzEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+CjxjaXJjbGUgY3g9Ijg5IiBjeT0iMTM4IiByPSI0IiBvcGFjaXR5PSIxIiBmaWxsPSIjRkYwMDAwIiBzdHJva2U9Im5vbmUiIHN0cm9rZS13aWR0aD0iMSIvPgo8Y2lyY2xlIGN4PSI4OSIgY3k9IjEzOCIgcj0iNCIgb3BhY2l0eT0iMSIgZmlsbD0iI0ZGMDAwMCIgc3Ryb2tlPSJub25lIiBzdHJva2Utd2lkdGg9IjEiLz4KPGNpcmNsZSBjeD0iMTU5IiBjeT0iNzEiIHI9IjQiIG9wYWNpdHk9IjEiIGZpbGw9IiNGRjAwMDAiIHN0cm9rZT0ibm9uZSIgc3Ryb2tlLXdpZHRoPSIxIi8+Cjwvc3ZnPg==)

## What the data says

The cliché does not survive 33 seasons of Premier League football — if anything,
it points the wrong way.

**1. Attack predicts position slightly better than defence — and the gap is
growing.** Mean within-season Spearman ρ between metric rank and final position:
attack 0.82 (1990s) → 0.88 (2020s); defence 0.77 → 0.87 → 0.81. In the 2020s the
defensive signal is the _weakest_ it has ever been.

**2. The best attack always delivers; the best defence sometimes doesn't.** The
league's top scorer finished outside the top 4 in **0 of 33 seasons**. The
league's best defence did it twice — most spectacularly Manchester United
2015/16, best defence in the league and fifth place.

**3. For the title specifically, attack wins more often.** The best attack
lifted the trophy in 22/33 seasons (67%); the best defence in only 13/33 (39%).
In the 1990s the best defence won _zero_ titles — Arsenal's great back lines
kept finishing behind United's attacks.

**4. But champions are defined by balance, not either/or.** The average
champion's combined attack+defence rank sum is **3.8** against a random
expectation of 21.1. 30 of 33 champions finished top-4 in _both_ dimensions; 20
of 33 were top-2 in both. The balance metric correlates with position at ρ ≈
0.92–0.94 every era — stronger than either component alone.

**5. The title-winners' profiles.** 32 of 33 champions were top-3 attacks; only
26 of 33 were top-3 defences. The weakest defence ever to win: Manchester United
1996/97 (GA rank 7, 44 conceded). The weakest attack: Manchester United 2008/09
(GF rank 4 — still 68 goals). Modern champions keep elite clean sheets too —
Arsenal 2025/26 kept 19, City 2021/22 kept 21 — but they were also top-2
attacks.

**Verdict.** "Defence wins titles" is not supported: titles go to _balanced_
teams, and when forced to pick a single predictor, attacking output is
marginally stronger for both position and the trophy in the modern era. Caveats:
goal ranks proxy underlying quality (xG is not available for EPL history here),
correlations are not causation, and United's 13 titles flatten every average —
the pattern holds within the City/Liverpool/Arsenal era too.

_Source: 12,814 deduplicated EPL results, 1993/94 → 2025/26._
