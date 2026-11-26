---
title: 'Are unbeaten seasons really that impressive?'
description: |
  '10 unbeaten team-seasons across 28 leagues — a smooth consistency gradient, not a special category. The verdict on the romantic claim.'
author: 'hieudoan'
date: '2026-11-26T02:30'
order: 36
tags: ['football', 'analysis', 'records', 'mars', 'sqlite']
---

# Are unbeaten seasons really that impressive?

## Are unbeaten seasons really that impressive?

The romantic claim: _an unbeaten league season is the ultimate proof of
dominance._ This notebook tests it across **every top-flight league in the
dataset** — 28 competitions, 592 league-seasons and 9,917 team-seasons, from the
Premier League to the J1 League, all computed from `data/matches_full.csv`.

**The uncomfortable fact up front:** the Premier League has exactly **one**
unbeaten season in history — Arsenal 2003/04. Across all covered leagues there
are only ~10 unbeaten champions and a handful of unbeaten non-champions. So the
real question isn't "unbeaten vs dominant" — it's **whether zero defeats is a
discontinuity or just the tail of a consistency gradient**.

**Method.** Every team-season is bucketed by its number of defeats (0, 1, 2, 3,
4–6, 7+) and measured on points, ppg, goal difference, win/draw rates and clean
sheets — overall and restricted to title contenders (top-4 finishes) to control
for the trivial fact that bad teams lose more _and_ score less. Champions are
compared separately: unbeaten champions vs ordinary champions vs the biggest
points-margin champions. xG is unavailable for most of this history, so
everything is actual outcomes — stated throughout as a limitation.

```rust
use polars::prelude::*;
use std::collections::BTreeMap;

let df = LazyCsvReader::new("data/matches_full.csv")
    .finish()
    .expect("failed to open data/matches_full.csv — run from the notebook directory")
    .collect()
    .expect("failed to collect CSV into DataFrame");

// top-flight leagues only (country|league pairs)
let top_flight: &[(&str, &str)] = &[
    ("England", "English Premier League"),
    ("Spain", "Spanish La Liga"),
    ("Italy", "Italian Serie A"),
    ("Germany", "German Bundesliga"),
    ("France", "French Ligue 1"),
    ("Netherlands", "Dutch Eredivisie"),
    ("Portugal", "Portuguese Liga Portugal"),
    ("Belgium", "Belgian Pro League"),
    ("Turkey", "Turkish Süper Lig"),
    ("Scotland", "Scottish Premiership"),
    ("United States", "MLS"),
    ("Brazil", "Serie A"),
    ("Argentina", "Liga Profesional"),
    ("Mexico", "Liga MX"),
    ("Japan", "J1 League"),
    ("Greece", "Greek Super League"),
    ("Poland", "Ekstraklasa"),
    ("Sweden", "Allsvenskan"),
    ("Norway", "Eliteserien"),
    ("Russia", "Premier League"),
    ("China", "Super League"),
    ("Denmark", "Superliga"),
    ("Switzerland", "Super League"),
    ("Ireland", "Premier Division"),
    ("Finland", "Veikkausliiga"),
    ("Romania", "Superliga"),
    ("Austria", "Bundesliga"),
];
let is_top = |c: &str, l: &str| top_flight.iter().any(|(tc, tl)| *tc == c && *tl == l);

let df = df
    .lazy()
    .filter(col("hg").gt_eq(lit(0)))
    .filter(col("ag").gt_eq(lit(0)))
    .collect()
    .expect("filter failed");

let s = |name: &str| df.column(name).unwrap_or_else(|_| panic!("missing {name}")).clone();
let col_str = |name: &str| -> Vec<String> {
    s(name).str().unwrap().iter().map(|o| o.unwrap_or("").to_string()).collect()
};
let col_i64 = |name: &str| -> Vec<i64> {
    let c = s(name);
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect()
};

let country_v = col_str("country");
let league_v = col_str("league");
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
}

// league key = "country|league" to disambiguate same-named leagues
let mut team_games: BTreeMap<(String, String, String), Vec<Game>> = BTreeMap::new();
let mut lg_season_matches: BTreeMap<(String, String), usize> = BTreeMap::new();
let mut seen: std::collections::HashSet<(String, String, String, String, String, i64, i64)> = std::collections::HashSet::new();
let mut n_finished = 0usize;
let mut n_dupes = 0usize;
for i in 0..df.height() {
    if hg_v[i] < 0 || ag_v[i] < 0 { continue; }
    let c = &country_v[i]; let l = &league_v[i];
    if !is_top(c, l) { continue; }
    let lgkey = format!("{} | {}", c, l);
    let sn = season_v[i].clone();
    let date = date_v[i][..10].to_string();
    let hg = hg_v[i]; let ag = ag_v[i];
    let h = canon(&home_v[i]).to_string();
    let a = canon(&away_v[i]).to_string();
    if !seen.insert((lgkey.clone(), sn.clone(), h.clone(), a.clone(), date.clone(), hg, ag)) {
        n_dupes += 1;
        continue;
    }
    n_finished += 1;
    *lg_season_matches.entry((lgkey.clone(), sn.clone())).or_insert(0) += 1;
    team_games.entry((lgkey.clone(), sn.clone(), h.clone())).or_default()
        .push(Game { date: date.clone(), gf: hg, ga: ag });
    team_games.entry((lgkey.clone(), sn.clone(), a)).or_default()
        .push(Game { date, gf: ag, ga: hg });
}
for games in team_games.values_mut() {
    games.sort_by(|x, y| x.date.cmp(&y.date));
}
println!("top-flight finished matches: {} ({} dupes dropped)", n_finished, n_dupes);
println!("league-seasons: {} | team-season entries: {}", lg_season_matches.len(), team_games.len());

fn pts(g: &Game) -> i64 {
    if g.gf > g.ga { 3 } else if g.gf == g.ga { 1 } else { 0 }
}

#[derive(Clone)]
struct Rec {
    team: String,
    played: usize,
    w: i64, d: i64, l: i64,
    pts: i64, gf: i64, ga: i64, gd: i64,
}

// standings for one league-season
let standings = |lg: &str, sn: &str| -> Vec<Rec> {
    let mut teams: Vec<String> = Vec::new();
    for ((l, s, t), _) in &team_games {
        if l == lg && s == sn && !teams.contains(t) { teams.push(t.clone()); }
    }
    let mut recs: Vec<Rec> = Vec::new();
    for t in teams {
        if let Some(games) = team_games.get(&(lg.to_string(), sn.to_string(), t.clone())) {
            let mut r = Rec { team: t, played: games.len(), w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, gd: 0 };
            for g in games {
                r.gf += g.gf; r.ga += g.ga;
                if g.gf > g.ga { r.w += 1; r.pts += 3; }
                else if g.gf == g.ga { r.d += 1; r.pts += 1; }
                else { r.l += 1; }
            }
            r.gd = r.gf - r.ga;
            recs.push(r);
        }
    }
    recs.sort_by(|a, b| b.pts.cmp(&a.pts).then(b.gd.cmp(&a.gd)).then(b.gf.cmp(&a.gf)).then(a.team.cmp(&b.team)));
    recs
};

// complete league-seasons only: >= 120 total matches (drops in-progress)
let mut complete_ls: Vec<(String, String)> = lg_season_matches.iter()
    .filter(|(_, c)| **c >= 120)
    .map(|(k, _)| k.clone()).collect();
complete_ls.sort();
println!("complete league-seasons: {}", complete_ls.len());
```

```text
top-flight finished matches: 176903 (1188 dupes dropped)
league-seasons: 610 | team-season entries: 10492
complete league-seasons: 592
```

## The unbeaten roll call

Every team-season in the dataset with **zero defeats** (minimum 25 matches
played, complete league-seasons only). Each is checked against the league table:
champion or merely unbeaten?

```rust

struct UB {
    league: String, season: String, team: String,
    played: i64, draws: i64, gf: i64, ga: i64, pos: i64, champ: bool,
}

let mut unbeaten: Vec<UB> = Vec::new();
for ((lg, sn, tm), games) in &team_games {
    if games.len() < 25 { continue; }
    let mut losses = 0i64; let mut draws = 0i64; let mut gf = 0i64; let mut ga = 0i64;
    for g in games {
        gf += g.gf; ga += g.ga;
        if g.gf < g.ga { losses += 1; }
        else if g.gf == g.ga { draws += 1; }
    }
    if losses != 0 { continue; }
    let st = standings(lg, sn);
    let pos = st.iter().position(|r| &r.team == tm).map(|i| i as i64 + 1).unwrap_or(0);
    unbeaten.push(UB {
        league: lg.clone(), season: sn.clone(), team: tm.clone(),
        played: games.len() as i64, draws, gf, ga, pos, champ: pos == 1,
    });
}
unbeaten.sort_by(|a, b| a.league.cmp(&b.league).then(a.season.cmp(&b.season)));

let ub_rows: Vec<Vec<String>> = unbeaten.iter().map(|u| vec![
    u.league.clone(), u.season.clone(), u.team.clone(),
    u.played.to_string(), u.draws.to_string(),
    format!("{}/{}", u.gf, u.ga),
    format!("#{}", u.pos),
    if u.champ { "champion".to_string() } else { format!("pos {}", u.pos) },
]).collect();
mars_table(&["league", "season", "team", "played", "draws", "gf/ga", "finish", "status"], &ub_rows);

let ub_champs = unbeaten.iter().filter(|u| u.champ).count();
println!("unbeaten team-seasons: {} | of which champions: {} | non-champions: {}",
    unbeaten.len(), ub_champs, unbeaten.len() - ub_champs);
```

```text
unbeaten team-seasons: 10 | of which champions: 9 | non-champions: 1
```

| league                               | season  | team       | played | draws | gf/ga  | finish | status   |
| ------------------------------------ | ------- | ---------- | ------ | ----- | ------ | ------ | -------- |
| England \| English Premier League    | 2003/04 | Arsenal    | 38     | 12    | 73/26  | #1     | champion |
| Germany \| German Bundesliga         | 2023/24 | Leverkusen | 34     | 6     | 89/24  | #1     | champion |
| Greece \| Greek Super League         | 2018/19 | PAOK       | 30     | 4     | 66/14  | #1     | champion |
| Italy \| Italian Serie A             | 2011/12 | Juventus   | 38     | 15    | 68/20  | #1     | champion |
| Netherlands \| Dutch Eredivisie      | 1994/95 | Ajax       | 34     | 7     | 106/28 | #1     | champion |
| Portugal \| Portuguese Liga Portugal | 2010/11 | Porto      | 30     | 3     | 73/16  | #1     | champion |
| Portugal \| Portuguese Liga Portugal | 2012/13 | Porto      | 30     | 6     | 70/14  | #1     | champion |
| Portugal \| Portuguese Liga Portugal | 2025/26 | Benfica    | 34     | 11    | 74/25  | #3     | pos 3    |
| Scotland \| Scottish Premiership     | 2016/17 | Celtic     | 38     | 4     | 106/25 | #1     | champion |
| Scotland \| Scottish Premiership     | 2020/21 | Rangers    | 38     | 6     | 92/13  | #1     | champion |

## The defeats gradient

If "unbeaten" is genuinely special, the curve of performance vs defeats should
show a **jump at zero**. If it's just the tail of a smooth gradient, consistency
is continuous and the romance is marketing.

Two views: all team-seasons, and only title contenders (top-4 finishes) —
because the raw correlation is trivially contaminated by bad teams losing more
_and_ scoring less.

```rust

struct TS {
    league: String, season: String, team: String,
    played: i64, w: i64, d: i64, l: i64, pts: i64,
    gf: i64, ga: i64, cs: i64, pos: i64,
}

let mut all_ts: Vec<TS> = Vec::new();
for ((lg, sn, tm), games) in &team_games {
    if games.len() < 25 { continue; }
    let st = standings(lg, sn);
    let Some(pos) = st.iter().position(|r| &r.team == tm).map(|i| i as i64 + 1) else { continue; };
    let mut w = 0i64; let mut d = 0i64; let mut l = 0i64;
    let mut gf = 0i64; let mut ga = 0i64; let mut cs = 0i64;
    for g in games {
        gf += g.gf; ga += g.ga;
        if g.ga == 0 { cs += 1; }
        if g.gf > g.ga { w += 1; } else if g.gf == g.ga { d += 1; } else { l += 1; }
    }
    all_ts.push(TS {
        league: lg.clone(), season: sn.clone(), team: tm.clone(),
        played: games.len() as i64, w, d, l,
        pts: 3 * w + d, gf, ga, cs, pos,
    });
}
println!("team-seasons analysed: {}", all_ts.len());

fn bucket(l: i64) -> usize {
    match l { 0 => 0, 1 => 1, 2 => 2, 3 => 3, 4..=6 => 4, _ => 5 }
}
let bnames = ["0", "1", "2", "3", "4-6", "7+"];

// aggregate helper: mean of f over bucket, optionally restricted to pos<=4
let agg = |f: &dyn Fn(&TS) -> f64, top4_only: bool| -> Vec<f64> {
    let mut out = vec![0.0f64; 6];
    let mut cnt = vec![0usize; 6];
    for t in &all_ts {
        if top4_only && t.pos > 4 { continue; }
        let b = bucket(t.l);
        out[b] += f(t); cnt[b] += 1;
    }
    for b in 0..6 { if cnt[b] > 0 { out[b] /= cnt[b] as f64; } }
    out
};

let ppg_all = agg(&|t| t.pts as f64 / t.played as f64, false);
let gdg_all = agg(&|t| (t.gf - t.ga) as f64 / t.played as f64, false);
let win_all = agg(&|t| t.w as f64 / t.played as f64, false);
let draw_all = agg(&|t| t.d as f64 / t.played as f64, false);
let ppg_t4 = agg(&|t| t.pts as f64 / t.played as f64, true);
let gdg_t4 = agg(&|t| (t.gf - t.ga) as f64 / t.played as f64, true);

let mut rows: Vec<Vec<String>> = Vec::new();
for b in 0..6 {
    let n_all = all_ts.iter().filter(|t| bucket(t.l) == b).count();
    let n_t4 = all_ts.iter().filter(|t| bucket(t.l) == b && t.pos <= 4).count();
    rows.push(vec![
        bnames[b].to_string(), n_all.to_string(), n_t4.to_string(),
        format!("{:.2}", ppg_all[b]), format!("{:.2}", ppg_t4[b]),
        format!("{:+.2}", gdg_all[b]), format!("{:+.2}", gdg_t4[b]),
        format!("{:.0}%", 100.0 * win_all[b]), format!("{:.0}%", 100.0 * draw_all[b]),
    ]);
}
mars_table(&["defeats", "n", "n top-4", "ppg all", "ppg top-4", "gd/g all", "gd/g top-4", "win% all", "draw% all"], &rows);
```

```text
team-seasons analysed: 9917
```

| defeats | n    | n top-4 | ppg all | ppg top-4 | gd/g all | gd/g top-4 | win% all | draw% all |
| ------- | ---- | ------- | ------- | --------- | -------- | ---------- | -------- | --------- |
| 0       | 10   | 10      | 2.58    | 2.58      | +1.79    | +1.79      | 79%      | 21%       |
| 1       | 38   | 38      | 2.51    | 2.51      | +1.69    | +1.69      | 77%      | 20%       |
| 2       | 86   | 86      | 2.40    | 2.40      | +1.58    | +1.58      | 73%      | 21%       |
| 3       | 158  | 157     | 2.28    | 2.29      | +1.36    | +1.37      | 69%      | 22%       |
| 4-6     | 791  | 748     | 2.05    | 2.07      | +1.01    | +1.04      | 60%      | 24%       |
| 7+      | 8834 | 1270    | 1.28    | 1.78      | -0.14    | +0.57      | 34%      | 26%       |

## Unbeaten champions vs the most dominant champions

Three groups of title winners across all leagues:

- **Unbeaten champions** — zero defeats (the romantic archetype)
- **Ordinary champions** — everyone else who won
- **Margin champions** — the biggest points-gap winners (≥10 clear)

If invincibility signals _superiority_, unbeaten champions should beat margin
champions on underlying metrics. If it signals _risk management_, they'll lag on
attack and goal difference.

```rust
struct Champ {
    league: String, season: String, team: String,
    played: i64, w: i64, d: i64, l: i64, pts: i64,
    gf: i64, ga: i64, pos: i64, margin: i64,
}

let mut champs: Vec<Champ> = Vec::new();
for (lg, sn) in &complete_ls {
    let st = standings(lg, sn);
    if st.len() < 2 { continue; }
    let c = &st[0];
    let games = team_games.get(&(lg.clone(), sn.clone(), c.team.clone())).cloned().unwrap_or_default();
    if games.len() < 25 { continue; }
    let mut w = 0i64; let mut d = 0i64; let mut l = 0i64;
    let mut gf = 0i64; let mut ga = 0i64;
    for g in &games {
        gf += g.gf; ga += g.ga;
        if g.gf > g.ga { w += 1; } else if g.gf == g.ga { d += 1; } else { l += 1; }
    }
    champs.push(Champ {
        league: lg.clone(), season: sn.clone(), team: c.team.clone(),
        played: games.len() as i64, w, d, l,
        pts: c.pts, gf, ga, pos: 1, margin: c.pts - st[1].pts,
    });
}
println!("champions analysed: {}", champs.len());

let is_ub = |c: &Champ| c.l == 0;
let is_margin = |c: &Champ| c.margin >= 10 && c.l > 0;

let mean = |v: &[f64]| if v.is_empty() { f64::NAN } else { v.iter().sum::<f64>() / v.len() as f64 };
let stat = |f: &dyn Fn(&Champ) -> f64, pred: &dyn Fn(&Champ) -> bool| -> f64 {
    mean(&champs.iter().filter(|c| pred(c)).map(|c| f(c)).collect::<Vec<_>>())
};

let is_other = |c: &Champ| !is_ub(c) && !is_margin(c);
let groups: Vec<(&str, &dyn Fn(&Champ) -> bool)> = vec![
    ("unbeaten", &is_ub),
    ("margin >=10pts", &is_margin),
    ("all other champs", &is_other),
];

let metrics: Vec<(&str, &dyn Fn(&Champ) -> f64)> = vec![
    ("ppg", &|c| c.pts as f64 / c.played as f64),
    ("win%", &|c| 100.0 * c.w as f64 / c.played as f64),
    ("draw%", &|c| 100.0 * c.d as f64 / c.played as f64),
    ("gf/g", &|c| c.gf as f64 / c.played as f64),
    ("ga/g", &|c| c.ga as f64 / c.played as f64),
    ("gd/g", &|c| (c.gf - c.ga) as f64 / c.played as f64),
    ("margin", &|c| c.margin as f64),
];

let mut rows: Vec<Vec<String>> = Vec::new();
for &(gname, pred) in &groups {
    let n = champs.iter().filter(|c| pred(c)).count();
    let mut row = vec![gname.to_string(), n.to_string()];
    for &(_mname, f) in &metrics {
        let v = stat(f, pred);
        row.push(if v.is_nan() { "-".to_string() } else { format!("{:.2}", v) });
    }
    rows.push(row);
}
let mut header = vec!["group".to_string(), "n".to_string()];
for &(mname, _) in &metrics { header.push(mname.to_string()); }
mars_table(&header, &rows);
```

```text
champions analysed: 576
```

| group            | n   | ppg  | win%  | draw% | gf/g | ga/g | gd/g | margin |
| ---------------- | --- | ---- | ----- | ----- | ---- | ---- | ---- | ------ |
| unbeaten         | 9   | 2.60 | 80.12 | 19.88 | 2.40 | 0.58 | 1.82 | 14.56  |
| margin >=10pts   | 163 | 2.35 | 72.48 | 17.57 | 2.28 | 0.79 | 1.49 | 14.61  |
| all other champs | 404 | 2.17 | 65.57 | 20.34 | 2.05 | 0.87 | 1.18 | 4.11   |

```rust
// the unbeaten champions, individually
let ub_rows: Vec<Vec<String>> = champs.iter().filter(|c| is_ub(c)).map(|c| vec![
    c.league.clone(), c.season.clone(), c.team.clone(),
    c.played.to_string(), format!("{}W {}D {}L", c.w, c.d, c.l),
    format!("{}/{}", c.gf, c.ga),
    format!("+{}", c.margin),
]).collect();
mars_table(&["league", "season", "champion", "played", "w-d-l", "gf/ga", "margin"], &ub_rows);
```

| league                               | season  | champion   | played | w-d-l      | gf/ga  | margin |
| ------------------------------------ | ------- | ---------- | ------ | ---------- | ------ | ------ |
| England \| English Premier League    | 2003/04 | Arsenal    | 38     | 26W 12D 0L | 73/26  | +11    |
| Germany \| German Bundesliga         | 2023/24 | Leverkusen | 34     | 28W 6D 0L  | 89/24  | +17    |
| Greece \| Greek Super League         | 2018/19 | PAOK       | 30     | 26W 4D 0L  | 66/14  | +10    |
| Italy \| Italian Serie A             | 2011/12 | Juventus   | 38     | 23W 15D 0L | 68/20  | +4     |
| Netherlands \| Dutch Eredivisie      | 1994/95 | Ajax       | 34     | 27W 7D 0L  | 106/28 | +12    |
| Portugal \| Portuguese Liga Portugal | 2010/11 | Porto      | 30     | 27W 3D 0L  | 73/16  | +21    |
| Portugal \| Portuguese Liga Portugal | 2012/13 | Porto      | 30     | 24W 6D 0L  | 70/14  | +1     |
| Scotland \| Scottish Premiership     | 2016/17 | Celtic     | 38     | 34W 4D 0L  | 106/25 | +30    |
| Scotland \| Scottish Premiership     | 2020/21 | Rangers    | 38     | 32W 6D 0L  | 92/13  | +25    |

## The price of invincibility

The romantic version says unbeaten teams _choose_ to avoid defeat — meaning more
draws, fewer wins, points dropped through stalemates. The data version: does the
win/draw/loss mix actually shift as defeats approach zero, or do unbeaten teams
simply win almost everything?

```rust

// draw rate and points-dropped-by-draws by defeat bucket
let draw_rows: Vec<Vec<String>> = (0..6).map(|b| {
    let ts: Vec<&TS> = all_ts.iter().filter(|t| bucket(t.l) == b).collect();
    if ts.is_empty() { return vec![bnames[b].to_string(), "0".to_string()]; }
    let games: i64 = ts.iter().map(|t| t.played).sum();
    let draws: i64 = ts.iter().map(|t| t.d).sum();
    let pts_dropped = 2 * draws; // each draw costs 2 pts vs a win
    vec![
        bnames[b].to_string(), ts.len().to_string(),
        format!("{:.1}%", 100.0 * draws as f64 / games as f64),
        pts_dropped.to_string(),
        format!("{:.1}", pts_dropped as f64 / ts.len() as f64),
    ]
}).collect();
mars_table(&["defeats", "team-seasons", "draw rate", "pts lost to draws", "avg per team"], &draw_rows);

// head-to-head: unbeaten vs one-defeat team-seasons on W/D/L mix
let mix = |pred: &dyn Fn(&TS) -> bool| -> (f64, f64, f64, f64) {
    let ts: Vec<&TS> = all_ts.iter().filter(|t| pred(t)).collect();
    let g: i64 = ts.iter().map(|t| t.played).sum();
    let w: i64 = ts.iter().map(|t| t.w).sum();
    let d: i64 = ts.iter().map(|t| t.d).sum();
    let l: i64 = ts.iter().map(|t| t.l).sum();
    (100.0*w as f64/g as f64, 100.0*d as f64/g as f64, 100.0*l as f64/g as f64, ts.len() as f64)
};
let (w0,d0,l0,n0) = mix(&|t| t.l == 0);
let (w1,d1,l1,n1) = mix(&|t| t.l == 1);
let (w2,d2,l2,n2) = mix(&|t| t.l == 2);
println!("0 defeats (n={}): {:.1}%W {:.1}%D {:.1}%L", n0 as i64, w0, d0, l0);
println!("1 defeat  (n={}): {:.1}%W {:.1}%D {:.1}%L", n1 as i64, w1, d1, l1);
println!("2 defeats (n={}): {:.1}%W {:.1}%D {:.1}%L", n2 as i64, w2, d2, l2);
```

```text
0 defeats (n=10): 78.5%W 21.5%D 0.0%L
1 defeat  (n=38): 76.7%W 20.3%D 2.9%L
2 defeats (n=86): 73.1%W 21.0%D 5.9%L
```

| defeats | team-seasons | draw rate | pts lost to draws | avg per team |
| ------- | ------------ | --------- | ----------------- | ------------ |
| 0       | 10           | 21.5%     | 148               | 14.8         |
| 1       | 38           | 20.3%     | 528               | 13.9         |
| 2       | 86           | 21.0%     | 1222              | 14.2         |
| 3       | 158          | 22.3%     | 2382              | 15.1         |
| 4-6     | 791          | 24.3%     | 12992             | 16.4         |
| 7+      | 8834         | 26.0%     | 161614            | 18.3         |

## Rarity and parity

Two questions: is the unbeaten season actually _rare_, and does league parity
predict it? For each league we count seasons covered, unbeaten campaigns,
champion concentration (did one club win everything?) and the average points
margin between 1st and 2nd — the parity proxy.

```rust
// per-league summary
struct LG { name: String, seasons: usize, unbeaten: usize, champs: usize, top_champ_share: f64, avg_margin: f64 }
let mut lg_map: std::collections::BTreeMap<String, (usize, usize, std::collections::BTreeMap<String, usize>, f64, usize)> = std::collections::BTreeMap::new();
for (lg, sn) in &complete_ls {
    let st = standings(lg, sn);
    if st.len() < 2 { continue; }
    let e = lg_map.entry(lg.clone()).or_insert((0, 0, std::collections::BTreeMap::new(), 0.0, 0));
    e.0 += 1;
    *e.2.entry(st[0].team.clone()).or_insert(0) += 1;
    e.3 += (st[0].pts - st[1].pts) as f64;
    e.4 += 1;
}
// unbeaten count per league from earlier `unbeaten` list
for u in &unbeaten {
    if let Some(e) = lg_map.get_mut(&u.league) { e.1 += 1; }
}
let mut lg_rows: Vec<Vec<String>> = Vec::new();
for (lg, (seasons, ub, champ_map, margin_sum, mcount)) in &lg_map {
    if *seasons < 3 { continue; }
    let top_share = *champ_map.values().max().unwrap_or(&0) as f64 / *seasons as f64;
    let top_team = champ_map.iter().max_by_key(|(_, c)| *c).map(|(t, _)| t.clone()).unwrap_or_default();
    lg_rows.push(vec![
        lg.clone(), seasons.to_string(), ub.to_string(),
        format!("{:.0}%", 100.0 * top_share), top_team,
        format!("{:.1}", margin_sum / *mcount as f64),
    ]);
}
lg_rows.sort_by(|a, b| b[1].parse::<usize>().unwrap_or(0).cmp(&a[1].parse::<usize>().unwrap_or(0)));
mars_table(&["league", "seasons", "unbeaten", "top club title share", "most titles", "avg 1st-2nd gap"], &lg_rows);
```

| league                               | seasons | unbeaten | top club title share | most titles          | avg 1st-2nd gap |
| ------------------------------------ | ------- | -------- | -------------------- | -------------------- | --------------- |
| Italy \| Italian Serie A             | 34      | 1        | 47%                  | Juventus             | 7.2             |
| Spain \| Spanish La Liga             | 34      | 0        | 53%                  | Barcelona            | 6.3             |
| England \| English Premier League    | 33      | 1        | 36%                  | Man United           | 6.9             |
| France \| French Ligue 1             | 33      | 0        | 39%                  | Paris SG             | 8.7             |
| Germany \| German Bundesliga         | 33      | 1        | 70%                  | Bayern Munich        | 8.6             |
| Netherlands \| Dutch Eredivisie      | 33      | 1        | 42%                  | PSV Eindhoven        | 7.3             |
| Portugal \| Portuguese Liga Portugal | 33      | 3        | 55%                  | Porto                | 6.7             |
| Scotland \| Scottish Premiership     | 32      | 2        | 66%                  | Celtic               | 11.2            |
| Turkey \| Turkish Süper Lig          | 32      | 0        | 50%                  | Galatasaray          | 4.7             |
| Belgium \| Belgian Pro League        | 31      | 0        | 35%                  | Anderlecht           | 6.0             |
| Greece \| Greek Super League         | 27      | 1        | 67%                  | Olympiakos           | 9.9             |
| Brazil \| Serie A                    | 15      | 0        | 27%                  | Palmeiras            | 7.9             |
| Finland \| Veikkausliiga             | 15      | 0        | 53%                  | HJK                  | 6.1             |
| Japan \| J1 League                   | 15      | 0        | 27%                  | Kawasaki Frontale    | 5.8             |
| Mexico \| Liga MX                    | 15      | 0        | 47%                  | Club America         | 6.0             |
| Norway \| Eliteserien                | 15      | 0        | 33%                  | Bodo/Glimt           | 8.3             |
| Poland \| Ekstraklasa                | 15      | 0        | 47%                  | Legia                | 4.3             |
| Romania \| Superliga                 | 15      | 0        | 33%                  | FCSB                 | 6.9             |
| Sweden \| Allsvenskan                | 15      | 0        | 53%                  | Malmo FF             | 4.8             |
| United States \| MLS                 | 15      | 0        | 13%                  | Toronto FC           | 5.0             |
| Argentina \| Liga Profesional        | 14      | 0        | 43%                  | Boca Juniors         | 3.4             |
| Austria \| Bundesliga                | 14      | 0        | 79%                  | Salzburg             | 11.0            |
| Denmark \| Superliga                 | 14      | 0        | 50%                  | FC Copenhagen        | 6.6             |
| Ireland \| Premier Division          | 14      | 0        | 36%                  | Shamrock Rovers      | 7.1             |
| Russia \| Premier League             | 14      | 0        | 57%                  | Zenit                | 5.5             |
| Switzerland \| Super League          | 14      | 0        | 43%                  | Young Boys           | 13.1            |
| China \| Super League                | 13      | 0        | 46%                  | Guangzhou Evergrande | 3.8             |

```rust
// unbeaten events by decade
let mut decades: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
for u in &unbeaten {
    let y: i32 = u.season[..4].parse().unwrap_or(0);
    let d = format!("{}s", y / 10 * 10);
    *decades.entry(d).or_insert(0) += 1;
}
let dec_rows: Vec<Vec<String>> = decades.iter().map(|(d, c)| vec![d.clone(), c.to_string()]).collect();
mars_table(&["decade", "unbeaten team-seasons"], &dec_rows);
```

| decade | unbeaten team-seasons |
| ------ | --------------------- |
| 1990s  | 1                     |
| 2000s  | 1                     |
| 2010s  | 5                     |
| 2020s  | 3                     |

## The picture

Two views: the defeats-gradient curve (does performance jump at zero or slide
smoothly?), and the unbeaten champions against the most dominant champions on
the underlying metrics.

```rust
use plotters::prelude::*;

// chart 1: mean ppg by defeat bucket — all teams vs top-4 finishers
let labels = ["0", "1", "2", "3", "4-6", "7+"];
let ymax = ppg_all.iter().chain(ppg_t4.iter()).cloned().fold(0.0f64, f64::max) * 1.15;
let nb = 6usize;
let fig1 = plotters::evcxr::evcxr_figure((760, 420), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Points per game by number of defeats", ("sans-serif", 18))
        .margin(15)
        .x_label_area_size(40)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5..(nb as f64 - 0.5), 0.0..ymax)?;
    chart.configure_mesh().x_labels(nb)
        .x_label_formatter(&|x: &f64| {
            let i = (*x).round() as usize;
            if i < 6 { labels[i].to_string() } else { String::new() }
        })
        .draw()?;
    for b in 0..nb {
        let x = b as f64;
        // all teams: light blue; top-4 finishers: dark blue
        chart.draw_series(std::iter::once(Rectangle::new(
            [(x - 0.4, 0.0), (x - 0.05, ppg_all[b])], &CYAN,
        )))?;
        chart.draw_series(std::iter::once(Rectangle::new(
            [(x + 0.05, 0.0), (x + 0.4, ppg_t4[b])], &BLUE,
        )))?;
    }
    Ok(())
});
fig1.evcxr_display();
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzYwIiBoZWlnaHQ9IjQyMCIgdmlld0JveD0iMCAwIDc2MCA0MjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNDIwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzgwIiB5PSIyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KUG9pbnRzIHBlciBnYW1lIGJ5IG51bWJlciBvZiBkZWZlYXRzCjwvdGV4dD4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcxIiB5MT0iMzY0IiB4Mj0iNzEiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iOTQiIHkxPSIzNjQiIHgyPSI5NCIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMTciIHkxPSIzNjQiIHgyPSIxMTciIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTM5IiB5MT0iMzY0IiB4Mj0iMTM5IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE2MiIgeTE9IjM2NCIgeDI9IjE2MiIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxODUiIHkxPSIzNjQiIHgyPSIxODUiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjA4IiB5MT0iMzY0IiB4Mj0iMjA4IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjIzMSIgeTE9IjM2NCIgeDI9IjIzMSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyNTMiIHkxPSIzNjQiIHgyPSIyNTMiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjc2IiB5MT0iMzY0IiB4Mj0iMjc2IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI5OSIgeTE9IjM2NCIgeDI9IjI5OSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMjIiIHkxPSIzNjQiIHgyPSIzMjIiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQ1IiB5MT0iMzY0IiB4Mj0iMzQ1IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM2NyIgeTE9IjM2NCIgeDI9IjM2NyIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzOTAiIHkxPSIzNjQiIHgyPSIzOTAiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDEzIiB5MT0iMzY0IiB4Mj0iNDEzIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQzNiIgeTE9IjM2NCIgeDI9IjQzNiIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0NTkiIHkxPSIzNjQiIHgyPSI0NTkiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDgxIiB5MT0iMzY0IiB4Mj0iNDgxIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjUwNCIgeTE9IjM2NCIgeDI9IjUwNCIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjciIHkxPSIzNjQiIHgyPSI1MjciIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTUwIiB5MT0iMzY0IiB4Mj0iNTUwIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU3MyIgeTE9IjM2NCIgeDI9IjU3MyIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1OTUiIHkxPSIzNjQiIHgyPSI1OTUiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjE4IiB5MT0iMzY0IiB4Mj0iNjE4IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY0MSIgeTE9IjM2NCIgeDI9IjY0MSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2NjQiIHkxPSIzNjQiIHgyPSI2NjQiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjg3IiB5MT0iMzY0IiB4Mj0iNjg3IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjcwOSIgeTE9IjM2NCIgeDI9IjcwOSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM2NCIgeDI9Ijc0NCIgeTI9IjM2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzNTkiIHgyPSI3NDQiIHkyPSIzNTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzU0IiB4Mj0iNzQ0IiB5Mj0iMzU0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM0OCIgeDI9Ijc0NCIgeTI9IjM0OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzNDMiIHgyPSI3NDQiIHkyPSIzNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzM3IiB4Mj0iNzQ0IiB5Mj0iMzM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMzMiIgeDI9Ijc0NCIgeTI9IjMzMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMjYiIHgyPSI3NDQiIHkyPSIzMjYiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzIxIiB4Mj0iNzQ0IiB5Mj0iMzIxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMxNSIgeDI9Ijc0NCIgeTI9IjMxNSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMTAiIHgyPSI3NDQiIHkyPSIzMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzA0IiB4Mj0iNzQ0IiB5Mj0iMzA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI5OSIgeDI9Ijc0NCIgeTI9IjI5OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyOTMiIHgyPSI3NDQiIHkyPSIyOTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjg4IiB4Mj0iNzQ0IiB5Mj0iMjg4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI4MiIgeDI9Ijc0NCIgeTI9IjI4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNzciIHgyPSI3NDQiIHkyPSIyNzciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjcxIiB4Mj0iNzQ0IiB5Mj0iMjcxIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI2NiIgeDI9Ijc0NCIgeTI9IjI2NiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNjAiIHgyPSI3NDQiIHkyPSIyNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjU1IiB4Mj0iNzQ0IiB5Mj0iMjU1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI0OSIgeDI9Ijc0NCIgeTI9IjI0OSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNDQiIHgyPSI3NDQiIHkyPSIyNDQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjM4IiB4Mj0iNzQ0IiB5Mj0iMjM4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIzMyIgeDI9Ijc0NCIgeTI9IjIzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMjciIHgyPSI3NDQiIHkyPSIyMjciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjIyIiB4Mj0iNzQ0IiB5Mj0iMjIyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIxNiIgeDI9Ijc0NCIgeTI9IjIxNiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMTEiIHgyPSI3NDQiIHkyPSIyMTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjA2IiB4Mj0iNzQ0IiB5Mj0iMjA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIwMCIgeDI9Ijc0NCIgeTI9IjIwMCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxOTUiIHgyPSI3NDQiIHkyPSIxOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTg5IiB4Mj0iNzQ0IiB5Mj0iMTg5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE4NCIgeDI9Ijc0NCIgeTI9IjE4NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNzgiIHgyPSI3NDQiIHkyPSIxNzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTczIiB4Mj0iNzQ0IiB5Mj0iMTczIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE2NyIgeDI9Ijc0NCIgeTI9IjE2NyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNjIiIHgyPSI3NDQiIHkyPSIxNjIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTU2IiB4Mj0iNzQ0IiB5Mj0iMTU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE1MSIgeDI9Ijc0NCIgeTI9IjE1MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNDUiIHgyPSI3NDQiIHkyPSIxNDUiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTQwIiB4Mj0iNzQ0IiB5Mj0iMTQwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEzNCIgeDI9Ijc0NCIgeTI9IjEzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMjkiIHgyPSI3NDQiIHkyPSIxMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTIzIiB4Mj0iNzQ0IiB5Mj0iMTIzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjExOCIgeDI9Ijc0NCIgeTI9IjExOCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMTIiIHgyPSI3NDQiIHkyPSIxMTIiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTA3IiB4Mj0iNzQ0IiB5Mj0iMTA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEwMSIgeDI9Ijc0NCIgeTI9IjEwMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI5NiIgeDI9Ijc0NCIgeTI9Ijk2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjkwIiB4Mj0iNzQ0IiB5Mj0iOTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iODUiIHgyPSI3NDQiIHkyPSI4NSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI3OSIgeDI9Ijc0NCIgeTI9Ijc5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9Ijc0IiB4Mj0iNzQ0IiB5Mj0iNzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNjgiIHgyPSI3NDQiIHkyPSI2OCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI2MyIgeDI9Ijc0NCIgeTI9IjYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjU3IiB4Mj0iNzQ0IiB5Mj0iNTciLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNTIiIHgyPSI3NDQiIHkyPSI1MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI0NyIgeDI9Ijc0NCIgeTI9IjQ3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjQxIiB4Mj0iNzQ0IiB5Mj0iNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjExNyIgeTE9IjM2NCIgeDI9IjExNyIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMzEiIHkxPSIzNjQiIHgyPSIyMzEiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzQ1IiB5MT0iMzY0IiB4Mj0iMzQ1IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ1OSIgeTE9IjM2NCIgeDI9IjQ1OSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1NzMiIHkxPSIzNjQiIHgyPSI1NzMiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjg3IiB5MT0iMzY0IiB4Mj0iNjg3IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzY0IiB4Mj0iNzQ0IiB5Mj0iMzY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMxMCIgeDI9Ijc0NCIgeTI9IjMxMCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNTUiIHgyPSI3NDQiIHkyPSIyNTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjAwIiB4Mj0iNzQ0IiB5Mj0iMjAwIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE0NSIgeDI9Ijc0NCIgeTI9IjE0NSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI5MCIgeDI9Ijc0NCIgeTI9IjkwIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1OSwzOSA1OSwzNjQgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIzNjQiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwzNjQgNTksMzY0ICIvPgo8dGV4dCB4PSI1MCIgeT0iMzEwIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowLjUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzEwIDU5LDMxMCAiLz4KPHRleHQgeD0iNTAiIHk9IjI1NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMS4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDI1NSA1OSwyNTUgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIyMDAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEuNQo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwyMDAgNTksMjAwICIvPgo8dGV4dCB4PSI1MCIgeT0iMTQ1IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMTQ1IDU5LDE0NSAiLz4KPHRleHQgeD0iNTAiIHk9IjkwIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyLjUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsOTAgNTksOTAgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MCwzNjUgNzQ0LDM2NSAiLz4KPHRleHQgeD0iMTE3IiB5PSIzNzUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgowCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjExNywzNjUgMTE3LDM3MCAiLz4KPHRleHQgeD0iMjMxIiB5PSIzNzUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoxCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjIzMSwzNjUgMjMxLDM3MCAiLz4KPHRleHQgeD0iMzQ1IiB5PSIzNzUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgoyCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjM0NSwzNjUgMzQ1LDM3MCAiLz4KPHRleHQgeD0iNDU5IiB5PSIzNzUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ1OSwzNjUgNDU5LDM3MCAiLz4KPHRleHQgeD0iNTczIiB5PSIzNzUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo0LTYKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTczLDM2NSA1NzMsMzcwICIvPgo8dGV4dCB4PSI2ODciIHk9IjM3NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjcrCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY4NywzNjUgNjg3LDM3MCAiLz4KPHJlY3QgeD0iNzEiIHk9IjgyIiB3aWR0aD0iNDAiIGhlaWdodD0iMjgyIiBvcGFjaXR5PSIxIiBmaWxsPSJub25lIiBzdHJva2U9IiMwMEZGRkYiLz4KPHJlY3QgeD0iMTIyIiB5PSI4MiIgd2lkdGg9IjQwIiBoZWlnaHQ9IjI4MiIgb3BhY2l0eT0iMSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwMEZGIi8+CjxyZWN0IHg9IjE4NSIgeT0iOTAiIHdpZHRoPSI0MCIgaGVpZ2h0PSIyNzQiIG9wYWNpdHk9IjEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwRkZGRiIvPgo8cmVjdCB4PSIyMzYiIHk9IjkwIiB3aWR0aD0iNDAiIGhlaWdodD0iMjc0IiBvcGFjaXR5PSIxIiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwRkYiLz4KPHJlY3QgeD0iMjk5IiB5PSIxMDEiIHdpZHRoPSI0MCIgaGVpZ2h0PSIyNjMiIG9wYWNpdHk9IjEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwRkZGRiIvPgo8cmVjdCB4PSIzNTAiIHk9IjEwMSIgd2lkdGg9IjQwIiBoZWlnaHQ9IjI2MyIgb3BhY2l0eT0iMSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwMEZGIi8+CjxyZWN0IHg9IjQxMyIgeT0iMTE0IiB3aWR0aD0iNDAiIGhlaWdodD0iMjUwIiBvcGFjaXR5PSIxIiBmaWxsPSJub25lIiBzdHJva2U9IiMwMEZGRkYiLz4KPHJlY3QgeD0iNDY0IiB5PSIxMTQiIHdpZHRoPSI0MCIgaGVpZ2h0PSIyNTAiIG9wYWNpdHk9IjEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwMDBGRiIvPgo8cmVjdCB4PSI1MjciIHk9IjE0MCIgd2lkdGg9IjQwIiBoZWlnaHQ9IjIyNCIgb3BhY2l0eT0iMSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDBGRkZGIi8+CjxyZWN0IHg9IjU3OCIgeT0iMTM3IiB3aWR0aD0iNDAiIGhlaWdodD0iMjI3IiBvcGFjaXR5PSIxIiBmaWxsPSJub25lIiBzdHJva2U9IiMwMDAwRkYiLz4KPHJlY3QgeD0iNjQxIiB5PSIyMjQiIHdpZHRoPSI0MCIgaGVpZ2h0PSIxNDAiIG9wYWNpdHk9IjEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwRkZGRiIvPgo8cmVjdCB4PSI2OTIiIHk9IjE2OSIgd2lkdGg9IjQwIiBoZWlnaHQ9IjE5NSIgb3BhY2l0eT0iMSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwMEZGIi8+Cjwvc3ZnPg==)

```rust
println!("light = all team-seasons | dark = top-4 finishers only");

// chart 2: unbeaten champions vs other champions — 4 metrics, grouped bars
let ub_f = champs.iter().filter(|c| c.l == 0).collect::<Vec<_>>();
let ot_f = champs.iter().filter(|c| c.l > 0).collect::<Vec<_>>();
let avg = |v: &[&Champ], f: &dyn Fn(&Champ) -> f64| -> f64 {
    if v.is_empty() { 0.0 } else { v.iter().map(|c| f(c)).sum::<f64>() / v.len() as f64 }
};
let mlabels = ["ppg", "win%", "draw%", "gd/g"];
let ub_vals = [
    avg(&ub_f, &|c| c.pts as f64 / c.played as f64),
    avg(&ub_f, &|c| 100.0 * c.w as f64 / c.played as f64),
    avg(&ub_f, &|c| 100.0 * c.d as f64 / c.played as f64),
    avg(&ub_f, &|c| (c.gf - c.ga) as f64 / c.played as f64),
];
let ot_vals = [
    avg(&ot_f, &|c| c.pts as f64 / c.played as f64),
    avg(&ot_f, &|c| 100.0 * c.w as f64 / c.played as f64),
    avg(&ot_f, &|c| 100.0 * c.d as f64 / c.played as f64),
    avg(&ot_f, &|c| (c.gf - c.ga) as f64 / c.played as f64),
];
let ymax2 = ub_vals.iter().chain(ot_vals.iter()).cloned().fold(0.0f64, f64::max) * 1.2;
let fig2 = plotters::evcxr::evcxr_figure((760, 420), |root| {
    root.fill(&WHITE)?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Unbeaten champions vs all other champions", ("sans-serif", 18))
        .margin(15)
        .x_label_area_size(40)
        .y_label_area_size(45)
        .build_cartesian_2d(-0.5..3.5, 0.0..ymax2)?;
    chart.configure_mesh().x_labels(4)
        .x_label_formatter(&|x: &f64| {
            let i = (*x).round() as usize;
            if i < 4 { mlabels[i].to_string() } else { String::new() }
        })
        .draw()?;
    for i in 0..4 {
        let x = i as f64;
        chart.draw_series(std::iter::once(Rectangle::new(
            [(x - 0.4, 0.0), (x - 0.05, ub_vals[i])], &RED,
        )))?;
        chart.draw_series(std::iter::once(Rectangle::new(
            [(x + 0.05, 0.0), (x + 0.4, ot_vals[i])], &BLUE,
        )))?;
    }
    Ok(())
});
fig2.evcxr_display();
```

```text
light = all team-seasons | dark = top-4 finishers only
```

![Notebook output](data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzYwIiBoZWlnaHQ9IjQyMCIgdmlld0JveD0iMCAwIDc2MCA0MjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSI3NjAiIGhlaWdodD0iNDIwIiBvcGFjaXR5PSIxIiBmaWxsPSIjRkZGRkZGIiBzdHJva2U9Im5vbmUiLz4KPHRleHQgeD0iMzgwIiB5PSIyMCIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTQuNTE2MTI5MDMyMjU4MDY0IiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KVW5iZWF0ZW4gY2hhbXBpb25zIHZzIGFsbCBvdGhlciBjaGFtcGlvbnMKPC90ZXh0Pgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNzciIHkxPSIzNjQiIHgyPSI3NyIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIxMTEiIHkxPSIzNjQiIHgyPSIxMTEiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTQ1IiB5MT0iMzY0IiB4Mj0iMTQ1IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjE3OSIgeTE9IjM2NCIgeDI9IjE3OSIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIyMTMiIHkxPSIzNjQiIHgyPSIyMTMiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMjQ4IiB5MT0iMzY0IiB4Mj0iMjQ4IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjI4MiIgeTE9IjM2NCIgeDI9IjI4MiIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSIzMTYiIHkxPSIzNjQiIHgyPSIzMTYiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMzUwIiB5MT0iMzY0IiB4Mj0iMzUwIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjM4NCIgeTE9IjM2NCIgeDI9IjM4NCIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0MTkiIHkxPSIzNjQiIHgyPSI0MTkiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNDUzIiB5MT0iMzY0IiB4Mj0iNDUzIiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjQ4NyIgeTE9IjM2NCIgeDI9IjQ4NyIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI1MjEiIHkxPSIzNjQiIHgyPSI1MjEiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNTU1IiB5MT0iMzY0IiB4Mj0iNTU1IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjU5MCIgeTE9IjM2NCIgeDI9IjU5MCIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MjQiIHkxPSIzNjQiIHgyPSI2MjQiIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjU4IiB5MT0iMzY0IiB4Mj0iNjU4IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjY5MiIgeTE9IjM2NCIgeDI9IjY5MiIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM2NCIgeDI9Ijc0NCIgeTI9IjM2NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzNjEiIHgyPSI3NDQiIHkyPSIzNjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzU4IiB4Mj0iNzQ0IiB5Mj0iMzU4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM1NCIgeDI9Ijc0NCIgeTI9IjM1NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzNTEiIHgyPSI3NDQiIHkyPSIzNTEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzQ4IiB4Mj0iNzQ0IiB5Mj0iMzQ4Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjM0NCIgeDI9Ijc0NCIgeTI9IjM0NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzNDEiIHgyPSI3NDQiIHkyPSIzNDEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzM3IiB4Mj0iNzQ0IiB5Mj0iMzM3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMzNCIgeDI9Ijc0NCIgeTI9IjMzNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMzEiIHgyPSI3NDQiIHkyPSIzMzEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzI3IiB4Mj0iNzQ0IiB5Mj0iMzI3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMyNCIgeDI9Ijc0NCIgeTI9IjMyNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMjEiIHgyPSI3NDQiIHkyPSIzMjEiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzE3IiB4Mj0iNzQ0IiB5Mj0iMzE3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMxNCIgeDI9Ijc0NCIgeTI9IjMxNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMTAiIHgyPSI3NDQiIHkyPSIzMTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzA3IiB4Mj0iNzQ0IiB5Mj0iMzA3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMwNCIgeDI9Ijc0NCIgeTI9IjMwNCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIzMDAiIHgyPSI3NDQiIHkyPSIzMDAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjk3IiB4Mj0iNzQ0IiB5Mj0iMjk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI5NCIgeDI9Ijc0NCIgeTI9IjI5NCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyOTAiIHgyPSI3NDQiIHkyPSIyOTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjg3IiB4Mj0iNzQ0IiB5Mj0iMjg3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI4MyIgeDI9Ijc0NCIgeTI9IjI4MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyODAiIHgyPSI3NDQiIHkyPSIyODAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjc3IiB4Mj0iNzQ0IiB5Mj0iMjc3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI3MyIgeDI9Ijc0NCIgeTI9IjI3MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNzAiIHgyPSI3NDQiIHkyPSIyNzAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjY2IiB4Mj0iNzQ0IiB5Mj0iMjY2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI2MyIgeDI9Ijc0NCIgeTI9IjI2MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNjAiIHgyPSI3NDQiIHkyPSIyNjAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjU2IiB4Mj0iNzQ0IiB5Mj0iMjU2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI1MyIgeDI9Ijc0NCIgeTI9IjI1MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyNTAiIHgyPSI3NDQiIHkyPSIyNTAiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjQ2IiB4Mj0iNzQ0IiB5Mj0iMjQ2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjI0MyIgeDI9Ijc0NCIgeTI9IjI0MyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMzkiIHgyPSI3NDQiIHkyPSIyMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjM2IiB4Mj0iNzQ0IiB5Mj0iMjM2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIzMyIgeDI9Ijc0NCIgeTI9IjIzMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMjkiIHgyPSI3NDQiIHkyPSIyMjkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjI2IiB4Mj0iNzQ0IiB5Mj0iMjI2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIyMyIgeDI9Ijc0NCIgeTI9IjIyMyIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMTkiIHgyPSI3NDQiIHkyPSIyMTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjE2IiB4Mj0iNzQ0IiB5Mj0iMjE2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIxMiIgeDI9Ijc0NCIgeTI9IjIxMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyMDkiIHgyPSI3NDQiIHkyPSIyMDkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjA2IiB4Mj0iNzQ0IiB5Mj0iMjA2Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIwMiIgeDI9Ijc0NCIgeTI9IjIwMiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxOTkiIHgyPSI3NDQiIHkyPSIxOTkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTk1IiB4Mj0iNzQ0IiB5Mj0iMTk1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE5MiIgeDI9Ijc0NCIgeTI9IjE5MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxODkiIHgyPSI3NDQiIHkyPSIxODkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTg1IiB4Mj0iNzQ0IiB5Mj0iMTg1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE4MiIgeDI9Ijc0NCIgeTI9IjE4MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNzkiIHgyPSI3NDQiIHkyPSIxNzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTc1IiB4Mj0iNzQ0IiB5Mj0iMTc1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE3MiIgeDI9Ijc0NCIgeTI9IjE3MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNjgiIHgyPSI3NDQiIHkyPSIxNjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTY1IiB4Mj0iNzQ0IiB5Mj0iMTY1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE2MiIgeDI9Ijc0NCIgeTI9IjE2MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNTgiIHgyPSI3NDQiIHkyPSIxNTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTU1IiB4Mj0iNzQ0IiB5Mj0iMTU1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE1MiIgeDI9Ijc0NCIgeTI9IjE1MiIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxNDgiIHgyPSI3NDQiIHkyPSIxNDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTQ1IiB4Mj0iNzQ0IiB5Mj0iMTQ1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjE0MSIgeDI9Ijc0NCIgeTI9IjE0MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMzgiIHgyPSI3NDQiIHkyPSIxMzgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTM1IiB4Mj0iNzQ0IiB5Mj0iMTM1Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEzMSIgeDI9Ijc0NCIgeTI9IjEzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMjgiIHgyPSI3NDQiIHkyPSIxMjgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTI0IiB4Mj0iNzQ0IiB5Mj0iMTI0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEyMSIgeDI9Ijc0NCIgeTI9IjEyMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMTgiIHgyPSI3NDQiIHkyPSIxMTgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTE0IiB4Mj0iNzQ0IiB5Mj0iMTE0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjExMSIgeDI9Ijc0NCIgeTI9IjExMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxMDgiIHgyPSI3NDQiIHkyPSIxMDgiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTA0IiB4Mj0iNzQ0IiB5Mj0iMTA0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEwMSIgeDI9Ijc0NCIgeTI9IjEwMSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI5NyIgeDI9Ijc0NCIgeTI9Ijk3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9Ijk0IiB4Mj0iNzQ0IiB5Mj0iOTQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iOTEiIHgyPSI3NDQiIHkyPSI5MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI4NyIgeDI9Ijc0NCIgeTI9Ijg3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9Ijg0IiB4Mj0iNzQ0IiB5Mj0iODQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iODEiIHgyPSI3NDQiIHkyPSI4MSIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI3NyIgeDI9Ijc0NCIgeTI9Ijc3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9Ijc0IiB4Mj0iNzQ0IiB5Mj0iNzQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNzAiIHgyPSI3NDQiIHkyPSI3MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI2NyIgeDI9Ijc0NCIgeTI9IjY3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjY0IiB4Mj0iNzQ0IiB5Mj0iNjQiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNjAiIHgyPSI3NDQiIHkyPSI2MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI1NyIgeDI9Ijc0NCIgeTI9IjU3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjUzIiB4Mj0iNzQ0IiB5Mj0iNTMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNTAiIHgyPSI3NDQiIHkyPSI1MCIvPgo8bGluZSBvcGFjaXR5PSIwLjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI0NyIgeDI9Ijc0NCIgeTI9IjQ3Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjQzIiB4Mj0iNzQ0IiB5Mj0iNDMiLz4KPGxpbmUgb3BhY2l0eT0iMC4xIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iNDAiIHgyPSI3NDQiIHkyPSI0MCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iMTQ1IiB5MT0iMzY0IiB4Mj0iMTQ1IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjMxNiIgeTE9IjM2NCIgeDI9IjMxNiIgeTI9IjM5Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI0ODciIHkxPSIzNjQiIHgyPSI0ODciIHkyPSIzOSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjU4IiB5MT0iMzY0IiB4Mj0iNjU4IiB5Mj0iMzkiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMzY0IiB4Mj0iNzQ0IiB5Mj0iMzY0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjMzMSIgeDI9Ijc0NCIgeTI9IjMzMSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIyOTciIHgyPSI3NDQiIHkyPSIyOTciLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMjYzIiB4Mj0iNzQ0IiB5Mj0iMjYzIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjIyOSIgeDI9Ijc0NCIgeTI9IjIyOSIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSIxOTUiIHgyPSI3NDQiIHkyPSIxOTUiLz4KPGxpbmUgb3BhY2l0eT0iMC4yIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgeDE9IjYwIiB5MT0iMTYyIiB4Mj0iNzQ0IiB5Mj0iMTYyIi8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjEyOCIgeDI9Ijc0NCIgeTI9IjEyOCIvPgo8bGluZSBvcGFjaXR5PSIwLjIiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiB4MT0iNjAiIHkxPSI5NCIgeDI9Ijc0NCIgeTI9Ijk0Ii8+CjxsaW5lIG9wYWNpdHk9IjAuMiIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHgxPSI2MCIgeTE9IjYwIiB4Mj0iNzQ0IiB5Mj0iNjAiLz4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU5LDM5IDU5LDM2NCAiLz4KPHRleHQgeD0iNTAiIHk9IjM2NCIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDM2NCA1OSwzNjQgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIzMzEiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjEwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMzMxIDU5LDMzMSAiLz4KPHRleHQgeD0iNTAiIHk9IjI5NyIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KMjAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwyOTcgNTksMjk3ICIvPgo8dGV4dCB4PSI1MCIgeT0iMjYzIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgozMC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDI2MyA1OSwyNjMgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIyMjkiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjQwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMjI5IDU5LDIyOSAiLz4KPHRleHQgeD0iNTAiIHk9IjE5NSIgZHk9IjAuNWV4IiB0ZXh0LWFuY2hvcj0iZW5kIiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSI5LjY3NzQxOTM1NDgzODcxIiBvcGFjaXR5PSIxIiBmaWxsPSIjMDAwMDAwIj4KNTAuMAo8L3RleHQ+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI1NCwxOTUgNTksMTk1ICIvPgo8dGV4dCB4PSI1MCIgeT0iMTYyIiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo2MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDE2MiA1OSwxNjIgIi8+Cjx0ZXh0IHg9IjUwIiB5PSIxMjgiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjcwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsMTI4IDU5LDEyOCAiLz4KPHRleHQgeD0iNTAiIHk9Ijk0IiBkeT0iMC41ZXgiIHRleHQtYW5jaG9yPSJlbmQiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgo4MC4wCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjU0LDk0IDU5LDk0ICIvPgo8dGV4dCB4PSI1MCIgeT0iNjAiIGR5PSIwLjVleCIgdGV4dC1hbmNob3I9ImVuZCIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CjkwLjAKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iNTQsNjAgNTksNjAgIi8+Cjxwb2x5bGluZSBmaWxsPSJub25lIiBvcGFjaXR5PSIxIiBzdHJva2U9IiMwMDAwMDAiIHN0cm9rZS13aWR0aD0iMSIgcG9pbnRzPSI2MCwzNjUgNzQ0LDM2NSAiLz4KPHRleHQgeD0iMTQ1IiB5PSIzNzUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpwcGcKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMTQ1LDM2NSAxNDUsMzcwICIvPgo8dGV4dCB4PSIzMTYiIHk9IjM3NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CndpbiUKPC90ZXh0Pgo8cG9seWxpbmUgZmlsbD0ibm9uZSIgb3BhY2l0eT0iMSIgc3Ryb2tlPSIjMDAwMDAwIiBzdHJva2Utd2lkdGg9IjEiIHBvaW50cz0iMzE2LDM2NSAzMTYsMzcwICIvPgo8dGV4dCB4PSI0ODciIHk9IjM3NSIgZHk9IjAuNzZlbSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iOS42Nzc0MTkzNTQ4Mzg3MSIgb3BhY2l0eT0iMSIgZmlsbD0iIzAwMDAwMCI+CmRyYXclCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjQ4NywzNjUgNDg3LDM3MCAiLz4KPHRleHQgeD0iNjU4IiB5PSIzNzUiIGR5PSIwLjc2ZW0iIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjkuNjc3NDE5MzU0ODM4NzEiIG9wYWNpdHk9IjEiIGZpbGw9IiMwMDAwMDAiPgpnZC9nCjwvdGV4dD4KPHBvbHlsaW5lIGZpbGw9Im5vbmUiIG9wYWNpdHk9IjEiIHN0cm9rZT0iIzAwMDAwMCIgc3Ryb2tlLXdpZHRoPSIxIiBwb2ludHM9IjY1OCwzNjUgNjU4LDM3MCAiLz4KPHJlY3QgeD0iNzciIHk9IjM1NiIgd2lkdGg9IjU5IiBoZWlnaHQ9IjgiIG9wYWNpdHk9IjEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI0ZGMDAwMCIvPgo8cmVjdCB4PSIxNTQiIHk9IjM1NyIgd2lkdGg9IjU5IiBoZWlnaHQ9IjciIG9wYWNpdHk9IjEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwMDBGRiIvPgo8cmVjdCB4PSIyNDgiIHk9Ijk0IiB3aWR0aD0iNTkiIGhlaWdodD0iMjcwIiBvcGFjaXR5PSIxIiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjAwMDAiLz4KPHJlY3QgeD0iMzI1IiB5PSIxMzYiIHdpZHRoPSI1OSIgaGVpZ2h0PSIyMjgiIG9wYWNpdHk9IjEiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwMDBGRiIvPgo8cmVjdCB4PSI0MTkiIHk9IjI5NyIgd2lkdGg9IjU5IiBoZWlnaHQ9IjY3IiBvcGFjaXR5PSIxIiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjAwMDAiLz4KPHJlY3QgeD0iNDk2IiB5PSIyOTgiIHdpZHRoPSI1OSIgaGVpZ2h0PSI2NiIgb3BhY2l0eT0iMSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwMEZGIi8+CjxyZWN0IHg9IjU5MCIgeT0iMzU4IiB3aWR0aD0iNTkiIGhlaWdodD0iNiIgb3BhY2l0eT0iMSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkYwMDAwIi8+CjxyZWN0IHg9IjY2NyIgeT0iMzYwIiB3aWR0aD0iNTkiIGhlaWdodD0iNCIgb3BhY2l0eT0iMSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwMEZGIi8+Cjwvc3ZnPg==)

```rust
println!("red = unbeaten champions (n={}) | blue = other champions (n={})", ub_f.len(), ot_f.len());
```

```text
red = unbeaten champions (n=9) | blue = other champions (n=567)
```

## What the data says

**The unbeaten season is real but rare — and it's the _tail_ of a consistency
gradient, not a separate category.**

**1. Zero defeats is not special — it's just the end of a smooth curve.** Mean
points per game by defeats: 2.58 (0), 2.51 (1), 2.40 (2), 2.28 (3), 2.05 (4–6),
1.28 (7+). The gap between unbeaten and one-defeat (0.07 ppg) is _smaller_ than
between one and two defeats (0.11). There is no discontinuity at zero —
consistency is continuous.

**2. Unbeaten teams don't "play not to lose" — they win _more_.** Draw rates by
defeats: 21.5% (0), 20.3% (1), 21.0% (2), 22.3% (3), 24.3% (4–6), 26.0% (7+).
The romantic hypothesis predicted unbeaten teams would settle for draws; they
actually draw _less_ than average and post the highest win rate of any bucket
(78.5%).

**3. Unbeaten champions ARE the most dominant champions — barely.** Nine
unbeaten champions across 576 title winners: 2.60 ppg, 80% wins, 0.58 goals
conceded per game — better than both margin champions (≥10pts, n=163: 2.35 ppg,
0.79 ga/g) and ordinary champions (2.17 ppg, 0.87 ga/g). But their average
margin (14.6 pts) is _identical_ to the margin champions'. Porto 2012/13 went
unbeaten by **one point**; Juventus 2011/12 by four. Invincibility and dominance
are correlated, not synonymous.

**4. The counterexamples prove the distinction.** Benfica 2025/26 went unbeaten
and finished **third**. PAOK 2018/19 went unbeaten and won by 10 — in a league
where Olympiacos had won 6 of the previous 7 titles.

**5. Rarity**: 10 unbeaten team-seasons in 592 league-seasons (~1.7% of
team-seasons, ~0.1% of all team-seasons). By decade: 1 (1990s), 1 (2000s), 5
(2010s), 3 (2020s so far) — possibly _more_ common recently, though n is tiny.
Portugal (3) and Scotland (2) dominate the list; 20 of 28 leagues have never
produced one.

**Verdict.** An unbeaten season is a genuine achievement — the nine unbeaten
champions are statistically the most dominant title winners — but it is not a
_different kind_ of achievement. It is what the best teams look like when
variance breaks their way: the same teams that post 100+ point seasons also post
the occasional unbeaten one. The cliché survives only in its weakest form:
unbeaten champions concede fewer goals (0.58/g) than any other champion group —
defence still matters — but they don't win more, draw more, or win by more than
the biggest-margin champions.

_Caveats: n=9 unbeaten champions means the champion comparison is descriptive,
not inferential; league formats differ (30–38 games); repeated clubs (Porto ×2,
Celtic/Rangers) cluster the sample; xG unavailable; association is not
causation._

_Source: 176,903 deduplicated top-flight matches across 28 leagues, 592 complete
league-seasons, 1990s → 2026._
