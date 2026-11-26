---
title: 'The xG luck index: who is fortunate and who is fooling themselves'
description: |
  '7,902 team-match xG rows: Barcelona Femení beats xG by +1.04 per
  match, Croatia/Argentina/Brazil are the unluckiest elite sides, and
  37 teams live permanently above their underlying numbers.'
author: 'hieudoan'
date: '2026-11-28T11:00'
order: 49
tags: ['football', 'analysis', 'xg', 'statsbomb', 'mars', 'sqlite']
---

# The xG luck index: who is fortunate and who is fooling themselves

## The xG luck index: who is fortunate and who is fooling themselves

Every StatsBomb match carries **expected goals** — the probability-weighted
quality of each shot, aggregated per team. This notebook compares what teams
actually scored against what they _should_ have scored, to find the luckiest
winners and the unluckiest losers in the database.

A positive "luck" value means goals exceeded xG — finishing skill, penalty luck,
or fortune. A negative value means chances were created but not converted. Both
regress heavily over large samples, which is exactly what makes the extremes
interesting.

```rust

use polars::prelude::*;
use std::collections::HashMap;

fn col_str(df: &DataFrame, name: &str) -> Vec<String> {
    df.column(name).unwrap().str().unwrap().iter()
        .map(|o| o.unwrap_or("").to_string()).collect()
}
fn col_i64(df: &DataFrame, name: &str) -> Vec<i64> {
    let c = df.column(name).unwrap().clone();
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    match c.dtype() {
        DataType::Int64 => c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect(),
        DataType::Float64 => c.f64().unwrap().iter().map(|o| o.map(|v| v as i64).unwrap_or(-1)).collect(),
        _ => c.str().unwrap().iter().map(|o| o.unwrap_or("").parse().unwrap_or(-1)).collect(),
    }
}
fn col_f64(df: &DataFrame, name: &str) -> Vec<f64> {
    let c = df.column(name).unwrap();
    match c.dtype() {
        DataType::Float64 => c.f64().unwrap().iter().map(|o| o.unwrap_or(0.0)).collect(),
        DataType::Int64 => c.i64().unwrap().iter().map(|o| o.unwrap_or(0) as f64).collect(),
        _ => c.str().unwrap().iter().map(|o| o.unwrap_or("").parse().unwrap_or(0.0)).collect(),
    }
}
fn load(name: &str) -> DataFrame {
    LazyCsvReader::new(&format!("data/{}.csv", name))
        .finish().expect(name).collect().expect("collect")
}
fn d10(s: &str) -> &str { &s[..10.min(s.len())] }
fn days(y: i32, m: i32, d: i32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y } as i64;
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = ((m + 9) % 12) as i64;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}
fn day_of(s: &str) -> i64 {
    let b = d10(s).as_bytes();
    if b.len() < 10 { return -1; }
    let y: i32 = s[0..4].parse().unwrap_or(0);
    let m: i32 = s[5..7].parse().unwrap_or(0);
    let d: i32 = s[8..10].parse().unwrap_or(0);
    days(y, m, d)
}

let mts = load("match_team_stat");
let mat = load("match");
let sea = load("season");
let lg = load("league");
let tm = load("team");

// match id -> (home, away, home_score, away_score, league_name)
let m_id = col_i64(&mat, "id");
let m_h = col_i64(&mat, "home_team_id");
let m_a = col_i64(&mat, "away_team_id");
let m_hs = col_f64(&mat, "home_score");
let m_as = col_f64(&mat, "away_score");
let m_season = col_i64(&mat, "season_id");
let s_id = col_i64(&sea, "id");
let s_lg = col_i64(&sea, "league_id");
let l_id = col_i64(&lg, "id");
let l_name = col_str(&lg, "name");
let mut sea_lg: HashMap<i64,i64> = HashMap::new();
for i in 0..sea.height() { sea_lg.insert(s_id[i], s_lg[i]); }
let mut lg_name: HashMap<i64,String> = HashMap::new();
for i in 0..lg.height() { lg_name.insert(l_id[i], l_name[i].clone()); }
let mut match_ctx: HashMap<i64,(i64,i64,f64,f64,String)> = HashMap::new();
for i in 0..mat.height() {
    let lgid = sea_lg.get(&m_season[i]).cloned().unwrap_or(-1);
    let lname = lg_name.get(&lgid).cloned().unwrap_or_default();
    match_ctx.insert(m_id[i], (m_h[i], m_a[i], m_hs[i], m_as[i], lname));
}
let t_id = col_i64(&tm, "id");
let t_name = col_str(&tm, "name");
let mut tname: HashMap<i64,String> = HashMap::new();
for i in 0..tm.height() { tname.insert(t_id[i], t_name[i].clone()); }

// per-match team xg vs goals
let ms_match = col_i64(&mts, "match_id");
let ms_team = col_i64(&mts, "team_id");
let ms_xg = col_f64(&mts, "expected_goals");

struct TM { tid: i64, mid: i64, goals: f64, xg: f64, league: String }
let mut rows: Vec<TM> = Vec::new();
for i in 0..ms_match.len() {
    if ms_xg[i] <= 0.0 { continue; }
    if let Some(&(h,a,hs,as_,ref ln)) = match_ctx.get(&ms_match[i]) {
        let g = if ms_team[i]==h { hs } else if ms_team[i]==a { as_ } else { continue };
        rows.push(TM{tid:ms_team[i], mid:ms_match[i], goals:g, xg:ms_xg[i], league:ln.clone()});
    }
}
println!("team-match xg rows: {}", rows.len());

// aggregate per team
struct Agg { tid: i64, apps: i64, goals: f64, xg: f64 }
let mut agg: HashMap<i64, Agg> = HashMap::new();
for r in &rows {
    let e = agg.entry(r.tid).or_insert(Agg{tid:r.tid,apps:0,goals:0.0,xg:0.0});
    e.apps += 1; e.goals += r.goals; e.xg += r.xg;
}
let mut teams: Vec<Agg> = agg.into_values().filter(|a| a.apps >= 15).collect();
teams.sort_by(|a,b| ((b.goals-b.xg)/b.apps as f64).partial_cmp(&((a.goals-a.xg)/a.apps as f64)).unwrap());
```

```text
team-match xg rows: 7902
```

```rust

// (continued) build display rows from sorted teams vec
let hdr = ["team","apps","goals","xG","G−xG/match",""].iter().map(|s|s.to_string()).collect::<Vec<_>>();
let mk = |slice: &Vec<usize>| -> Vec<Vec<String>> { slice.iter().map(|&i| {
    let a = &teams[i];
    vec![
        tname.get(&a.tid).cloned().unwrap_or_default().chars().take(26).collect(),
        a.apps.to_string(),
        format!("{:.1}", a.goals),
        format!("{:.1}", a.xg),
        format!("{:+.2}", (a.goals - a.xg) / a.apps as f64),
        String::new(),
    ]}).collect() };
let top: Vec<usize> = (0..teams.len().min(15)).collect();
let bot: Vec<usize> = (teams.len().saturating_sub(15)..teams.len()).rev().collect();
println!("== luckiest (scored above xG) ==");
mars_table(&hdr, &mk(&top));
println!("== unluckiest (scored below xG) ==");
mars_table(&hdr, &mk(&bot));
```

```text
team-match xg rows: 7902
== luckiest (scored above xG) ==
== unluckiest (scored below xG) ==
```

| team                | apps | goals  | xG     | G−xG/match |     |
| ------------------- | ---- | ------ | ------ | ---------- | --- |
| Barcelona WFC       | 30   | 137.0  | 105.8  | +1.04      |     |
| SC Delhi            | 23   | 47.0   | 32.4   | +0.64      |     |
| Barcelona           | 525  | 1390.0 | 1057.0 | +0.63      |     |
| Juventus W          | 27   | 65.0   | 48.9   | +0.60      |     |
| Roma                | 38   | 83.0   | 61.9   | +0.55      |     |
| Netherlands Women's | 19   | 36.0   | 26.3   | +0.51      |     |
| Arsenal WFC         | 79   | 226.0  | 187.0  | +0.49      |     |
| Paris Saint-Germain | 95   | 241.0  | 196.5  | +0.47      |     |
| Real Madrid CF W    | 30   | 74.0   | 60.9   | +0.44      |     |
| AS Roma W           | 26   | 74.0   | 62.8   | +0.43      |     |
| Manchester City WFC | 80   | 218.0  | 184.1  | +0.42      |     |
| Real Madrid         | 71   | 162.0  | 132.0  | +0.42      |     |
| Napoli              | 42   | 90.0   | 72.3   | +0.42      |     |
| Jamshedpur          | 22   | 43.0   | 34.0   | +0.41      |     |
| Odisha              | 20   | 31.0   | 22.9   | +0.41      |     |

| team              | apps | goals | xG   | G−xG/match |     |
| ----------------- | ---- | ----- | ---- | ---------- | --- |
| Croatia           | 21   | 32.0  | 43.4 | -0.54      |     |
| France Women's    | 19   | 44.0  | 53.7 | -0.51      |     |
| Argentina         | 22   | 38.0  | 48.5 | -0.48      |     |
| Brazil            | 25   | 52.0  | 63.4 | -0.46      |     |
| Uruguay           | 15   | 21.0  | 26.4 | -0.36      |     |
| Spain             | 21   | 44.0  | 51.5 | -0.36      |     |
| Washington Spirit | 31   | 29.0  | 39.7 | -0.35      |     |
| Sweden Women's    | 23   | 45.0  | 52.8 | -0.34      |     |
| Switzerland       | 18   | 26.0  | 32.0 | -0.33      |     |
| Denmark           | 17   | 18.0  | 23.6 | -0.33      |     |
| Orlando Pride     | 30   | 37.0  | 46.6 | -0.32      |     |
| Germany           | 18   | 29.0  | 34.1 | -0.28      |     |
| Udinese           | 38   | 35.0  | 45.7 | -0.28      |     |
| Houston Dash      | 27   | 23.0  | 30.3 | -0.27      |     |
| Portugal          | 18   | 30.0  | 34.7 | -0.26      |     |

```rust

// biggest single-match over/under performers
let mut diffs: Vec<(f64,i64,i64,String)> = rows.iter()
    .map(|r| (r.goals - r.xg, r.tid, r.mid, r.league.clone())).collect();
diffs.sort_by(|a,b| b.0.partial_cmp(&a.0).unwrap());
// need match scores for context: recompute goals text via match_ctx
let over_rows: Vec<Vec<String>> = diffs.iter().take(15).map(|(d,tid,mid,ln)| {
    let (h,a,hs,as_,_) = match_ctx[mid];
    let (gf, ga) = if *tid==h {(hs,as_)} else {(as_,hs)};
    vec![
        tname.get(tid).cloned().unwrap_or_default().chars().take(24).collect(),
        ln.chars().take(20).collect(),
        format!("{}–{}", gf as i64, ga as i64),
        format!("{:+.2}", d),
    ]}).collect();
mars_table(&["team","league","score","G−xG"], &over_rows);
diffs.sort_by(|a,b| a.0.partial_cmp(&b.0).unwrap());
let under_rows: Vec<Vec<String>> = diffs.iter().take(15).map(|(d,tid,mid,ln)| {
    let (h,a,hs,as_,_) = match_ctx[mid];
    let (gf, ga) = if *tid==h {(hs,as_)} else {(as_,hs)};
    vec![
        tname.get(tid).cloned().unwrap_or_default().chars().take(24).collect(),
        ln.chars().take(20).collect(),
        format!("{}–{}", gf as i64, ga as i64),
        format!("{:+.2}", d),
    ]}).collect();
mars_table(&["team","league","score","G−xG"], &under_rows);

// distribution of per-team luck (G−xG per match)
let labels = ["< −0.20","−0.20..0","0..+0.20","> +0.20"];
let mut buckets = [0usize;4];
for a in &teams {
    let per = (a.goals - a.xg) / a.apps as f64;
    let idx = if per < -0.20 {0} else if per < 0.0 {1} else if per <= 0.20 {2} else {3};
    buckets[idx]+=1;
}
let dist: Vec<Vec<String>> = buckets.iter().enumerate()
    .map(|(i,c)| vec![labels[i].to_string(), c.to_string()]).collect();
mars_table(&["G−xG per match","teams (≥15 apps)"], &dist);
```

```text
team-match xg rows: 7902
== luckiest (scored above xG) ==
== unluckiest (scored below xG) ==
```

| team                | apps | goals  | xG     | G−xG/match |     |
| ------------------- | ---- | ------ | ------ | ---------- | --- |
| Barcelona WFC       | 30   | 137.0  | 105.8  | +1.04      |     |
| SC Delhi            | 23   | 47.0   | 32.4   | +0.64      |     |
| Barcelona           | 525  | 1390.0 | 1057.0 | +0.63      |     |
| Juventus W          | 27   | 65.0   | 48.9   | +0.60      |     |
| Roma                | 38   | 83.0   | 61.9   | +0.55      |     |
| Netherlands Women's | 19   | 36.0   | 26.3   | +0.51      |     |
| Arsenal WFC         | 79   | 226.0  | 187.0  | +0.49      |     |
| Paris Saint-Germain | 95   | 241.0  | 196.5  | +0.47      |     |
| Real Madrid CF W    | 30   | 74.0   | 60.9   | +0.44      |     |
| AS Roma W           | 26   | 74.0   | 62.8   | +0.43      |     |
| Manchester City WFC | 80   | 218.0  | 184.1  | +0.42      |     |
| Real Madrid         | 71   | 162.0  | 132.0  | +0.42      |     |
| Napoli              | 42   | 90.0   | 72.3   | +0.42      |     |
| Jamshedpur          | 22   | 43.0   | 34.0   | +0.41      |     |
| Odisha              | 20   | 31.0   | 22.9   | +0.41      |     |

| team              | apps | goals | xG   | G−xG/match |     |
| ----------------- | ---- | ----- | ---- | ---------- | --- |
| Croatia           | 21   | 32.0  | 43.4 | -0.54      |     |
| France Women's    | 19   | 44.0  | 53.7 | -0.51      |     |
| Argentina         | 22   | 38.0  | 48.5 | -0.48      |     |
| Brazil            | 25   | 52.0  | 63.4 | -0.46      |     |
| Uruguay           | 15   | 21.0  | 26.4 | -0.36      |     |
| Spain             | 21   | 44.0  | 51.5 | -0.36      |     |
| Washington Spirit | 31   | 29.0  | 39.7 | -0.35      |     |
| Sweden Women's    | 23   | 45.0  | 52.8 | -0.34      |     |
| Switzerland       | 18   | 26.0  | 32.0 | -0.33      |     |
| Denmark           | 17   | 18.0  | 23.6 | -0.33      |     |
| Orlando Pride     | 30   | 37.0  | 46.6 | -0.32      |     |
| Germany           | 18   | 29.0  | 34.1 | -0.28      |     |
| Udinese           | 38   | 35.0  | 45.7 | -0.28      |     |
| Houston Dash      | 27   | 23.0  | 30.3 | -0.27      |     |
| Portugal          | 18   | 30.0  | 34.7 | -0.26      |     |

| team                  | league               | score | G−xG  |
| --------------------- | -------------------- | ----- | ----- |
| United States Women's | Women's World Cup    | 13–0  | +7.05 |
| Hoffenheim W          | Frauen Bundesliga    | 9–0   | +5.84 |
| Arsenal WFC           | FA Women's Super Lea | 11–1  | +5.24 |
| Real Madrid           | Spanish La Liga      | 7–1   | +5.08 |
| Barcelona WFC         | Liga F               | 8–0   | +4.95 |
| Real Madrid           | Spanish La Liga      | 10–2  | +4.86 |
| Real Madrid CF W      | Liga F               | 7–1   | +4.54 |
| Odisha                | Indian Super league  | 6–4   | +4.47 |
| Levante UD Femenino   | Liga F               | 7–0   | +4.43 |
| Barcelona             | Spanish La Liga      | 8–0   | +4.38 |
| Arsenal WFC           | FA Women's Super Lea | 7–0   | +4.32 |
| Barcelona WFC         | Liga F               | 8–0   | +4.27 |
| Manchester City WFC   | FA Women's Super Lea | 8–1   | +4.25 |
| Costa Adeje Tenerife  | Liga F               | 5–0   | +4.25 |
| Spain                 | FIFA World Cup       | 7–0   | +4.24 |

| team                  | league               | score | G−xG  |
| --------------------- | -------------------- | ----- | ----- |
| Australia Women's     | Women's World Cup    | 0–0   | -9.78 |
| France Women's        | Women's World Cup    | 0–0   | -9.50 |
| Congo DR              | African Cup of Natio | 1–1   | -7.63 |
| Egypt                 | African Cup of Natio | 1–1   | -7.42 |
| Congo DR              | African Cup of Natio | 0–0   | -7.17 |
| United States Women's | Women's World Cup    | 0–0   | -6.82 |
| France Women's        | UEFA Women's Euro    | 1–1   | -6.41 |
| Bayern Munich         | Champions League     | 1–1   | -6.40 |
| Sweden Women's        | Women's World Cup    | 0–0   | -5.99 |
| Spain                 | UEFA Euro            | 1–1   | -5.93 |
| South Africa          | African Cup of Natio | 0–0   | -5.75 |
| Germany Women's       | UEFA Women's Euro    | 1–1   | -5.63 |
| Real Madrid           | Champions League     | 1–1   | -5.50 |
| Cape Verde Islands    | African Cup of Natio | 0–0   | -5.43 |
| England Women's       | UEFA Women's Euro    | 2–2   | -5.40 |

| G−xG per match | teams (≥15 apps) |
| -------------- | ---------------- |
| < −0.20        | 19               |
| −0.20..0       | 47               |
| 0..+0.20       | 72               |
| > +0.20        | 37               |

## Findings

Across 7,902 team-match xG rows, luck distributes roughly normally — but the
extremes are wild:

- **Barcelona Femení is the luckiest side in the data**: +1.04 goals above xG
  _per match_ over 30 apps. The men's Barcelona (+0.63/match over 525 apps) is
  the most extreme among clubs with big samples.
- **The unluckiest are national teams**: Croatia (−0.54/match), Argentina
  (−0.48), Brazil (−0.46), Spain (−0.36) — the sport's elite keep creating
  chances their finishing doesn't cash.
- Single-match outliers: USA Women put **7.05 goals above xG** in a 13–0 rout;
  Real Madrid produced +5.08 and +4.86 xG overperformance in two La Liga
  blowouts (7–1, 10–2).
- Distribution: 37 teams beat xG by >+0.20/match, 19 fell short by
  > −0.20, and 72 sat in the neutral band — most sides regress to the mean,
  > which is why the extremes are the story.

Caveats: xG exists only for StatsBomb competitions (~24 tournaments), so "luck"
partly reflects opposition quality and competition mix; women's football is
over-represented at the top because several women's leagues are in the open
data; penalties and late-game chaos inflate single-match outliers.
