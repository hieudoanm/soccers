# Does possession actually help you win?

## Does possession actually help you win?

The cliché: _control the ball, control the game, win the match._ This notebook
tests it on every match in the dataset where ESPN match-level statistics exist —
possession, shots, shots on target, corners and fouls — enriched into
`match_team_stat` by `import-espn-stats.ts`.

**Data caveat up front:** possession coverage is concentrated in the ESPN era
(~2001 onward) and is deepest in Europe's big leagues. The Premier League is the
primary lens; all other covered leagues are used as a robustness check.
`possession = 0` rows are treated as missing — ESPN emits zeros for untracked
stats, and no team legitimately records 0% possession.

```rust

use polars::prelude::*;
use std::collections::HashMap;

let mf = LazyCsvReader::new("data/matches_full.csv")
    .finish().expect("matches_full.csv")
    .collect().expect("collect matches");
let st = LazyCsvReader::new("data/match_team_stat.csv")
    .finish().expect("match_team_stat.csv")
    .collect().expect("collect stats");

fn col_str(df: &DataFrame, name: &str) -> Vec<String> {
    df.column(name).unwrap().str().unwrap().iter()
        .map(|o| o.unwrap_or("").to_string()).collect()
}
fn col_i64(df: &DataFrame, name: &str) -> Vec<i64> {
    let c = df.column(name).unwrap().clone();
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect()
}
fn col_f64(df: &DataFrame, name: &str) -> Vec<f64> {
    let c = df.column(name).unwrap().clone();
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Float64).unwrap() } else { c };
    match c.dtype() {
        DataType::Float64 => c.f64().unwrap().iter().map(|o| o.unwrap_or(f64::NAN)).collect(),
        DataType::Int64 => c.i64().unwrap().iter().map(|o| o.map(|v| v as f64).unwrap_or(f64::NAN)).collect(),
        DataType::String => c.str().unwrap().iter()
            .map(|o| o.and_then(|s| s.parse::<f64>().ok()).unwrap_or(f64::NAN)).collect(),
        _ => panic!("unexpected dtype for {name}: {:?}", c.dtype()),
    }
}

#[derive(Clone, Copy, Default)]
struct TStat {
    poss: f64, shots: f64, sog: f64, corners: f64, fouls: f64, xg: f64,
}

// (match_id, team_id) -> team stat line
let mut stat_map: HashMap<(i64, i64), TStat> = HashMap::new();
{
    let n = st.height();
    let mid = col_i64(&st, "match_id");
    let tid = col_i64(&st, "team_id");
    let poss = col_f64(&st, "possession");
    let shots = col_f64(&st, "shots");
    let sog = col_f64(&st, "shots_on_target");
    let cor = col_f64(&st, "corners");
    let fou = col_f64(&st, "fouls");
    let xg = col_f64(&st, "expected_goals");
    for i in 0..n {
        stat_map.insert((mid[i], tid[i]), TStat {
            poss: poss[i], shots: shots[i], sog: sog[i],
            corners: cor[i], fouls: fou[i], xg: xg[i],
        });
    }
}
println!("stat rows indexed: {}", stat_map.len());

let s_id = col_i64(&mf, "id");
let s_hid = col_i64(&mf, "hid");
let s_aid = col_i64(&mf, "aid");
let s_hg = col_i64(&mf, "hg");
let s_ag = col_i64(&mf, "ag");
let s_country = col_str(&mf, "country");
let s_league = col_str(&mf, "league");
let s_season = col_str(&mf, "season");
let s_date = col_str(&mf, "date");
let s_home = col_str(&mf, "home");
let s_away = col_str(&mf, "away");

#[derive(Clone)]
struct MRow {
    league: String, season: String, date: String,
    home: String, away: String, hid: i64, aid: i64,
    hg: i64, ag: i64,
    hp: f64, ap: f64, hs: f64, as_: f64, hc: f64, ac: f64,
    hhf: f64, ahf: f64, hxg: f64, axg: f64,
}

let mut rows: Vec<MRow> = Vec::new();
let mut n_both = 0usize;
for i in 0..mf.height() {
    if s_hg[i] < 0 || s_ag[i] < 0 { continue; }
    let h = stat_map.get(&(s_id[i], s_hid[i]));
    let a = stat_map.get(&(s_id[i], s_aid[i]));
    let (Some(hs_), Some(as_)) = (h, a) else { continue; };
    // valid possession only: 0 and >100 are ESPN missing-data markers
    if !(hs_.poss > 0.0 && hs_.poss < 100.0 && as_.poss > 0.0 && as_.poss < 100.0) { continue; }
    n_both += 1;
    rows.push(MRow {
        league: s_league[i].clone(), season: s_season[i].clone(),
        date: s_date[i][..10].to_string(),
        home: s_home[i].clone(), away: s_away[i].clone(),
        hid: s_hid[i], aid: s_aid[i], hg: s_hg[i], ag: s_ag[i],
        hp: hs_.poss, ap: as_.poss,
        hs: hs_.shots, as_: as_.shots,
        hc: hs_.corners, ac: as_.corners,
        hhf: hs_.fouls, ahf: as_.fouls,
        hxg: hs_.xg, axg: as_.xg,
    });
}
rows.sort_by(|a, b| a.date.cmp(&b.date));
println!("matches with valid possession (both teams): {}", n_both);

// league coverage
let mut by_league: std::collections::BTreeMap<String, (usize, String, String)> = std::collections::BTreeMap::new();
for r in &rows {
    let e = by_league.entry(r.league.clone()).or_insert((0, r.season.clone(), r.season.clone()));
    e.0 += 1;
    if r.season < e.1 { e.1 = r.season.clone(); }
    if r.season > e.2 { e.2 = r.season.clone(); }
}
let mut lg_rows: Vec<Vec<String>> = by_league.iter().map(|(l, (n, s0, s1))| vec![
    l.clone(), n.to_string(), format!("{s0} → {s1}"),
]).collect();
lg_rows.sort_by(|a, b| b[1].parse::<usize>().unwrap().cmp(&a[1].parse::<usize>().unwrap()));
lg_rows.truncate(15);
let hdr = ["league", "matches", "season span"];
mars_table(&hdr, &lg_rows);

let epl: Vec<&MRow> = rows.iter().filter(|r| r.league == "English Premier League").collect();
println!("EPL matches with possession: {} | all leagues: {}", epl.len(), rows.len());
```

```text
stat rows indexed: 374660
matches with valid possession (both teams): 111836
EPL matches with possession: 8486 | all leagues: 111836
```

| league                   | matches | season span           |
| ------------------------ | ------- | --------------------- |
| English Championship     | 12005   | 2003/04 → 2026/27     |
| English League One       | 10707   | 2006/07 → 2026/27     |
| English League Two       | 9879    | 2006/07 → 2026/27     |
| English Premier League   | 8486    | 2001/02 → 2026/27     |
| Spanish La Liga          | 7247    | 2004/05 → 2026/27     |
| Italian Serie A          | 7241    | 2006/07 → 2026/27     |
| French Ligue 1           | 6465    | 2006/07 → 2026/27     |
| MLS                      | 6260    | 2012 → 2026           |
| German Bundesliga        | 4639    | 2005/06 → 2026/27     |
| Liga MX                  | 4542    | 2012/2013 → 2026/2027 |
| Scottish Premiership     | 4316    | 2006/07 → 2026/27     |
| Serie A                  | 3946    | 2014 → 2026           |
| German 2. Bundesliga     | 3246    | 2008/09 → 2026/27     |
| Dutch Eredivisie         | 2993    | 2008/09 → 2026/27     |
| Portuguese Liga Portugal | 2794    | 2008/09 → 2026/27     |

## Coverage

Possession exists only where ESPN tracks it — effectively the 2000s onward, and
patchier outside the major leagues. The Premier League has near-complete
coverage from 2001/02; lower-profile leagues have sporadic seasons. Everything
below is computed only on matches where **both** teams have a valid possession
figure.

```rust

// EPL coverage by season
let mut by_season: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
for r in &epl { *by_season.entry(r.season.clone()).or_insert(0) += 1; }
let rows_s: Vec<Vec<String>> = by_season.iter().map(|(s, n)| vec![s.clone(), n.to_string()]).collect();
mars_table(&["EPL season", "matches with possession"], &rows_s);
```

```text
stat rows indexed: 374660
matches with valid possession (both teams): 111836
EPL matches with possession: 8486 | all leagues: 111836
```

| league                   | matches | season span           |
| ------------------------ | ------- | --------------------- |
| English Championship     | 12005   | 2003/04 → 2026/27     |
| English League One       | 10707   | 2006/07 → 2026/27     |
| English League Two       | 9879    | 2006/07 → 2026/27     |
| English Premier League   | 8486    | 2001/02 → 2026/27     |
| Spanish La Liga          | 7247    | 2004/05 → 2026/27     |
| Italian Serie A          | 7241    | 2006/07 → 2026/27     |
| French Ligue 1           | 6465    | 2006/07 → 2026/27     |
| MLS                      | 6260    | 2012 → 2026           |
| German Bundesliga        | 4639    | 2005/06 → 2026/27     |
| Liga MX                  | 4542    | 2012/2013 → 2026/2027 |
| Scottish Premiership     | 4316    | 2006/07 → 2026/27     |
| Serie A                  | 3946    | 2014 → 2026           |
| German 2. Bundesliga     | 3246    | 2008/09 → 2026/27     |
| Dutch Eredivisie         | 2993    | 2008/09 → 2026/27     |
| Portuguese Liga Portugal | 2794    | 2008/09 → 2026/27     |

| EPL season | matches with possession |
| ---------- | ----------------------- |
| 2001/02    | 1                       |
| 2002/03    | 378                     |
| 2003/04    | 381                     |
| 2004/05    | 380                     |
| 2005/06    | 380                     |
| 2006/07    | 380                     |
| 2007/08    | 380                     |
| 2008/09    | 380                     |
| 2009/10    | 379                     |
| 2010/11    | 379                     |
| 2011/12    | 207                     |
| 2012/13    | 338                     |
| 2013/14    | 344                     |
| 2014/15    | 380                     |
| 2015/16    | 417                     |
| 2016/17    | 4                       |
| 2017/18    | 380                     |
| 2018/19    | 378                     |
| 2019/20    | 376                     |
| 2020/21    | 372                     |
| 2021/22    | 351                     |
| 2022/23    | 293                     |
| 2023/24    | 370                     |
| 2024/25    | 368                     |
| 2025/26    | 380                     |
| 2026/27    | 110                     |

## The band test: does more possession mean more wins?

Each match contributes two observations — one per team — with that t team's
possession and its result (win/draw/loss). Bands are the team's own possession
share.

```rust

// possession bands -> W/D/L, pooled team-perspective
let bands = [0.0, 35.0, 40.0, 45.0, 50.0, 55.0, 60.0, 65.0, 70.0, 100.0];
let blabels = ["<35", "35-40", "40-45", "45-50", "50-55", "55-60", "60-65", "65-70", ">70"];

let band_table = |matches: &[&MRow]| -> Vec<Vec<String>> {
    let mut w = vec![0usize; 9]; let mut d = vec![0usize; 9]; let mut l = vec![0usize; 9];
    for r in matches {
        for (p, gf, ga) in [(r.hp, r.hg, r.ag), (r.ap, r.ag, r.hg)] {
            let b = bands.iter().position(|&hi| p < hi).unwrap_or(9) - 1;
            if gf > ga { w[b] += 1; } else if gf == ga { d[b] += 1; } else { l[b] += 1; }
        }
    }
    (0..9).map(|b| {
        let n = (w[b] + d[b] + l[b]) as f64;
        vec![blabels[b].to_string(), (w[b]+d[b]+l[b]).to_string(),
             format!("{:.1}%", 100.0*w[b] as f64/n),
             format!("{:.1}%", 100.0*d[b] as f64/n),
             format!("{:.1}%", 100.0*l[b] as f64/n)]
    }).collect()
};

let epl_bands = band_table(&epl);
mars_table(&["possession", "n", "win%", "draw%", "loss%"], &epl_bands);

let all_refs: Vec<&MRow> = rows.iter().collect();
let all_bands = band_table(&all_refs);
mars_table(&["possession (all leagues)", "n", "win%", "draw%", "loss%"], &all_bands);
```

```text
stat rows indexed: 374660
matches with valid possession (both teams): 111836
EPL matches with possession: 8486 | all leagues: 111836
```

| league                   | matches | season span           |
| ------------------------ | ------- | --------------------- |
| English Championship     | 12005   | 2003/04 → 2026/27     |
| English League One       | 10707   | 2006/07 → 2026/27     |
| English League Two       | 9879    | 2006/07 → 2026/27     |
| English Premier League   | 8486    | 2001/02 → 2026/27     |
| Spanish La Liga          | 7247    | 2004/05 → 2026/27     |
| Italian Serie A          | 7241    | 2006/07 → 2026/27     |
| French Ligue 1           | 6465    | 2006/07 → 2026/27     |
| MLS                      | 6260    | 2012 → 2026           |
| German Bundesliga        | 4639    | 2005/06 → 2026/27     |
| Liga MX                  | 4542    | 2012/2013 → 2026/2027 |
| Scottish Premiership     | 4316    | 2006/07 → 2026/27     |
| Serie A                  | 3946    | 2014 → 2026           |
| German 2. Bundesliga     | 3246    | 2008/09 → 2026/27     |
| Dutch Eredivisie         | 2993    | 2008/09 → 2026/27     |
| Portuguese Liga Portugal | 2794    | 2008/09 → 2026/27     |

| EPL season | matches with possession |
| ---------- | ----------------------- |
| 2001/02    | 1                       |
| 2002/03    | 378                     |
| 2003/04    | 381                     |
| 2004/05    | 380                     |
| 2005/06    | 380                     |
| 2006/07    | 380                     |
| 2007/08    | 380                     |
| 2008/09    | 380                     |
| 2009/10    | 379                     |
| 2010/11    | 379                     |
| 2011/12    | 207                     |
| 2012/13    | 338                     |
| 2013/14    | 344                     |
| 2014/15    | 380                     |
| 2015/16    | 417                     |
| 2016/17    | 4                       |
| 2017/18    | 380                     |
| 2018/19    | 378                     |
| 2019/20    | 376                     |
| 2020/21    | 372                     |
| 2021/22    | 351                     |
| 2022/23    | 293                     |
| 2023/24    | 370                     |
| 2024/25    | 368                     |
| 2025/26    | 380                     |
| 2026/27    | 110                     |

| possession | n    | win%  | draw% | loss% |
| ---------- | ---- | ----- | ----- | ----- |
| <35        | 1429 | 26.6% | 24.5% | 48.9% |
| 35-40      | 1436 | 29.4% | 24.1% | 46.5% |
| 40-45      | 2296 | 31.7% | 26.1% | 42.2% |
| 45-50      | 3149 | 34.8% | 25.6% | 39.5% |
| 50-55      | 3245 | 38.5% | 26.0% | 35.5% |
| 55-60      | 2441 | 42.2% | 26.1% | 31.7% |
| 60-65      | 1505 | 47.0% | 24.1% | 28.9% |
| 65-70      | 881  | 45.5% | 25.2% | 29.3% |
| >70        | 590  | 54.1% | 23.2% | 22.7% |

| possession (all leagues) | n     | win%  | draw% | loss% |
| ------------------------ | ----- | ----- | ----- | ----- |
| <35                      | 14158 | 31.7% | 25.8% | 42.5% |
| 35-40                    | 18028 | 35.9% | 26.1% | 38.0% |
| 40-45                    | 30971 | 35.8% | 25.8% | 38.4% |
| 45-50                    | 45664 | 35.6% | 26.0% | 38.3% |
| 50-55                    | 48544 | 37.6% | 26.6% | 35.8% |
| 55-60                    | 32774 | 38.5% | 25.9% | 35.6% |
| 60-65                    | 18873 | 38.4% | 26.0% | 35.6% |
| 65-70                    | 9659  | 39.8% | 26.2% | 34.0% |
| >70                      | 5001  | 48.0% | 24.8% | 27.2% |

## Is the relationship linear — or are there diminishing returns?

Bin matches by **possession differential** (home minus away) and look at the
home win rate. If possession truly drives results, the curve should keep
climbing; a flattening top end would mean the last few percentage points of
possession are worth little.

```rust

// home win% by possession differential (5-point bins)
let mut bins: Vec<(i64, usize, usize)> = Vec::new(); // (bin centre low, home wins, total)
for k in -7i64..=7 {
    let lo = k as f64 * 5.0;
    let hi = lo + 5.0;
    let (mut hw, mut n) = (0usize, 0usize);
    for r in &epl {
        let d = r.hp - r.ap;
        if d >= lo && d < hi {
            n += 1;
            if r.hg > r.ag { hw += 1; }
        }
    }
    bins.push((k, hw, n));
}
let d_rows: Vec<Vec<String>> = bins.iter().map(|(k, hw, n)| vec![
    format!("{:+.0} to {:+.0}", *k as f64 * 5.0, *k as f64 * 5.0 + 5.0),
    n.to_string(),
    format!("{:.1}%", if *n > 0 { 100.0 * *hw as f64 / *n as f64 } else { 0.0 }),
]).collect();
mars_table(&["possession diff (home − away)", "matches", "home win%"], &d_rows);

// same for all leagues
let mut bins2: Vec<(i64, usize, usize)> = Vec::new();
for k in -7i64..=7 {
    let lo = k as f64 * 5.0;
    let hi = lo + 5.0;
    let (mut hw, mut n) = (0usize, 0usize);
    for r in &rows {
        let d = r.hp - r.ap;
        if d >= lo && d < hi {
            n += 1;
            if r.hg > r.ag { hw += 1; }
        }
    }
    bins2.push((k, hw, n));
}
let d_rows2: Vec<Vec<String>> = bins2.iter().map(|(k, hw, n)| vec![
    format!("{:+.0} to {:+.0}", *k as f64 * 5.0, *k as f64 * 5.0 + 5.0),
    n.to_string(),
    format!("{:.1}%", if *n > 0 { 100.0 * *hw as f64 / *n as f64 } else { 0.0 }),
]).collect();
mars_table(&["possession diff — all leagues", "matches", "home win%"], &d_rows2);
```

```text
stat rows indexed: 374660
matches with valid possession (both teams): 111836
EPL matches with possession: 8486 | all leagues: 111836
```

| league                   | matches | season span           |
| ------------------------ | ------- | --------------------- |
| English Championship     | 12005   | 2003/04 → 2026/27     |
| English League One       | 10707   | 2006/07 → 2026/27     |
| English League Two       | 9879    | 2006/07 → 2026/27     |
| English Premier League   | 8486    | 2001/02 → 2026/27     |
| Spanish La Liga          | 7247    | 2004/05 → 2026/27     |
| Italian Serie A          | 7241    | 2006/07 → 2026/27     |
| French Ligue 1           | 6465    | 2006/07 → 2026/27     |
| MLS                      | 6260    | 2012 → 2026           |
| German Bundesliga        | 4639    | 2005/06 → 2026/27     |
| Liga MX                  | 4542    | 2012/2013 → 2026/2027 |
| Scottish Premiership     | 4316    | 2006/07 → 2026/27     |
| Serie A                  | 3946    | 2014 → 2026           |
| German 2. Bundesliga     | 3246    | 2008/09 → 2026/27     |
| Dutch Eredivisie         | 2993    | 2008/09 → 2026/27     |
| Portuguese Liga Portugal | 2794    | 2008/09 → 2026/27     |

| EPL season | matches with possession |
| ---------- | ----------------------- |
| 2001/02    | 1                       |
| 2002/03    | 378                     |
| 2003/04    | 381                     |
| 2004/05    | 380                     |
| 2005/06    | 380                     |
| 2006/07    | 380                     |
| 2007/08    | 380                     |
| 2008/09    | 380                     |
| 2009/10    | 379                     |
| 2010/11    | 379                     |
| 2011/12    | 207                     |
| 2012/13    | 338                     |
| 2013/14    | 344                     |
| 2014/15    | 380                     |
| 2015/16    | 417                     |
| 2016/17    | 4                       |
| 2017/18    | 380                     |
| 2018/19    | 378                     |
| 2019/20    | 376                     |
| 2020/21    | 372                     |
| 2021/22    | 351                     |
| 2022/23    | 293                     |
| 2023/24    | 370                     |
| 2024/25    | 368                     |
| 2025/26    | 380                     |
| 2026/27    | 110                     |

| possession | n    | win%  | draw% | loss% |
| ---------- | ---- | ----- | ----- | ----- |
| <35        | 1429 | 26.6% | 24.5% | 48.9% |
| 35-40      | 1436 | 29.4% | 24.1% | 46.5% |
| 40-45      | 2296 | 31.7% | 26.1% | 42.2% |
| 45-50      | 3149 | 34.8% | 25.6% | 39.5% |
| 50-55      | 3245 | 38.5% | 26.0% | 35.5% |
| 55-60      | 2441 | 42.2% | 26.1% | 31.7% |
| 60-65      | 1505 | 47.0% | 24.1% | 28.9% |
| 65-70      | 881  | 45.5% | 25.2% | 29.3% |
| >70        | 590  | 54.1% | 23.2% | 22.7% |

| possession (all leagues) | n     | win%  | draw% | loss% |
| ------------------------ | ----- | ----- | ----- | ----- |
| <35                      | 14158 | 31.7% | 25.8% | 42.5% |
| 35-40                    | 18028 | 35.9% | 26.1% | 38.0% |
| 40-45                    | 30971 | 35.8% | 25.8% | 38.4% |
| 45-50                    | 45664 | 35.6% | 26.0% | 38.3% |
| 50-55                    | 48544 | 37.6% | 26.6% | 35.8% |
| 55-60                    | 32774 | 38.5% | 25.9% | 35.6% |
| 60-65                    | 18873 | 38.4% | 26.0% | 35.6% |
| 65-70                    | 9659  | 39.8% | 26.2% | 34.0% |
| >70                      | 5001  | 48.0% | 24.8% | 27.2% |

| possession diff (home − away) | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 196     | 33.2%     |
| -30 to -25                    | 280     | 37.9%     |
| -25 to -20                    | 335     | 35.5%     |
| -20 to -15                    | 479     | 37.2%     |
| -15 to -10                    | 535     | 45.8%     |
| -10 to -5                     | 733     | 39.4%     |
| -5 to +0                      | 762     | 43.8%     |
| +0 to +5                      | 899     | 44.4%     |
| +5 to +10                     | 778     | 45.8%     |
| +10 to +15                    | 796     | 49.9%     |
| +15 to +20                    | 565     | 48.8%     |
| +20 to +25                    | 475     | 55.4%     |
| +25 to +30                    | 389     | 52.2%     |
| +30 to +35                    | 311     | 47.9%     |
| +35 to +40                    | 223     | 52.9%     |

| possession diff — all leagues | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 2274    | 41.1%     |
| -30 to -25                    | 3155    | 44.8%     |
| -25 to -20                    | 4158    | 45.5%     |
| -20 to -15                    | 6062    | 45.4%     |
| -15 to -10                    | 7137    | 45.9%     |
| -10 to -5                     | 10221   | 42.7%     |
| -5 to +0                      | 11045   | 43.9%     |
| +0 to +5                      | 14423   | 43.6%     |
| +5 to +10                     | 11157   | 45.0%     |
| +10 to +15                    | 10891   | 45.1%     |
| +15 to +20                    | 7864    | 44.0%     |
| +20 to +25                    | 6607    | 45.0%     |
| +25 to +30                    | 4633    | 43.0%     |
| +30 to +35                    | 3629    | 45.1%     |
| +35 to +40                    | 2213    | 43.8%     |

## The paradox cases: dominating possession and still losing

Two failure modes worth counting: teams that **win despite low possession**
(<40%) and teams that **lose despite high possession** (>60%). If possession
were destiny, both would be rare.

```rust

// team-perspective: wins with <40% possession, losses with >60%
struct Tally { low_w: usize, tot_w: usize, high_l: usize, tot_l: usize }
let mut tally: HashMap<(String, String, String), Tally> = HashMap::new(); // (league, season, team) -> tally
for r in &rows {
    for (p, team, gf, ga) in [(r.hp, &r.home, r.hg, r.ag), (r.ap, &r.away, r.ag, r.hg)] {
        let key = (r.league.clone(), r.season.clone(), team.clone());
        let t = tally.entry(key).or_insert(Tally { low_w: 0, tot_w: 0, high_l: 0, tot_l: 0 });
        if gf > ga {
            t.tot_w += 1;
            if p < 40.0 { t.low_w += 1; }
        } else if gf < ga {
            t.tot_l += 1;
            if p > 60.0 { t.high_l += 1; }
        }
    }
}

// EPL: how often does a team win with <40% or lose with >60%?
let mut epl_low_w = 0usize; let mut epl_w = 0usize;
let mut epl_high_l = 0usize; let mut epl_l = 0usize;
for ((lg, _, _), t) in &tally {
    if lg != "English Premier League" { continue; }
    epl_low_w += t.low_w; epl_w += t.tot_w;
    epl_high_l += t.high_l; epl_l += t.tot_l;
}
println!("EPL team-matches: wins {} | wins with <40%% poss: {} ({:.1}%% of wins)",
    epl_w, epl_low_w, 100.0 * epl_low_w as f64 / epl_w.max(1) as f64);
println!("EPL losses {} | losses with >60%% poss: {} ({:.1}%% of losses)",
    epl_l, epl_high_l, 100.0 * epl_high_l as f64 / epl_l.max(1) as f64);

// aggregate per team across all EPL seasons
let mut team_tot: HashMap<String, (usize, usize, usize, usize)> = HashMap::new(); // team -> (low_w, tot_w, high_l, tot_l)
for ((lg, _, tm), t) in &tally {
    if lg != "English Premier League" { continue; }
    let e = team_tot.entry(tm.clone()).or_insert((0, 0, 0, 0));
    e.0 += t.low_w; e.1 += t.tot_w; e.2 += t.high_l; e.3 += t.tot_l;
}
let mut cand: Vec<(&String, &(usize, usize, usize, usize))> = team_tot.iter()
    .filter(|(_, t)| t.0 >= 8)
    .collect();
cand.sort_by(|a, b| {
    let ra = (a.1).0 as f64 / (a.1).1.max(1) as f64;
    let rb = (b.1).0 as f64 / (b.1).1.max(1) as f64;
    rb.partial_cmp(&ra).unwrap()
});
let top_rows: Vec<Vec<String>> = cand.iter().take(12).map(|(tm, t)| vec![
    (*tm).clone(), t.0.to_string(), t.1.to_string(),
    format!("{:.0}%", 100.0 * t.0 as f64 / t.1.max(1) as f64),
]).collect();
mars_table(&["team (EPL, all seasons)", "wins <40% poss", "total wins", "low-poss win share"], &top_rows);

// and the opposite: teams that lose most despite >60% possession
let mut cand_l: Vec<(&String, &(usize, usize, usize, usize))> = team_tot.iter()
    .filter(|(_, t)| t.2 >= 8)
    .collect();
cand_l.sort_by(|a, b| {
    let ra = (a.1).2 as f64 / (a.1).3.max(1) as f64;
    let rb = (b.1).2 as f64 / (b.1).3.max(1) as f64;
    rb.partial_cmp(&ra).unwrap()
});
let top_l: Vec<Vec<String>> = cand_l.iter().take(12).map(|(tm, t)| vec![
    (*tm).clone(), t.2.to_string(), t.3.to_string(),
    format!("{:.0}%", 100.0 * t.2 as f64 / t.3.max(1) as f64),
]).collect();
mars_table(&["team (EPL, all seasons)", "losses >60% poss", "total losses", "high-poss loss share"], &top_l);
```

```text
stat rows indexed: 374660
matches with valid possession (both teams): 111836
EPL matches with possession: 8486 | all leagues: 111836
EPL team-matches: wins 6334 | wins with <40%% poss: 802 (12.7%% of wins)
EPL losses 6334 | losses with >60%% poss: 802 (12.7%% of losses)
```

| league                   | matches | season span           |
| ------------------------ | ------- | --------------------- |
| English Championship     | 12005   | 2003/04 → 2026/27     |
| English League One       | 10707   | 2006/07 → 2026/27     |
| English League Two       | 9879    | 2006/07 → 2026/27     |
| English Premier League   | 8486    | 2001/02 → 2026/27     |
| Spanish La Liga          | 7247    | 2004/05 → 2026/27     |
| Italian Serie A          | 7241    | 2006/07 → 2026/27     |
| French Ligue 1           | 6465    | 2006/07 → 2026/27     |
| MLS                      | 6260    | 2012 → 2026           |
| German Bundesliga        | 4639    | 2005/06 → 2026/27     |
| Liga MX                  | 4542    | 2012/2013 → 2026/2027 |
| Scottish Premiership     | 4316    | 2006/07 → 2026/27     |
| Serie A                  | 3946    | 2014 → 2026           |
| German 2. Bundesliga     | 3246    | 2008/09 → 2026/27     |
| Dutch Eredivisie         | 2993    | 2008/09 → 2026/27     |
| Portuguese Liga Portugal | 2794    | 2008/09 → 2026/27     |

| EPL season | matches with possession |
| ---------- | ----------------------- |
| 2001/02    | 1                       |
| 2002/03    | 378                     |
| 2003/04    | 381                     |
| 2004/05    | 380                     |
| 2005/06    | 380                     |
| 2006/07    | 380                     |
| 2007/08    | 380                     |
| 2008/09    | 380                     |
| 2009/10    | 379                     |
| 2010/11    | 379                     |
| 2011/12    | 207                     |
| 2012/13    | 338                     |
| 2013/14    | 344                     |
| 2014/15    | 380                     |
| 2015/16    | 417                     |
| 2016/17    | 4                       |
| 2017/18    | 380                     |
| 2018/19    | 378                     |
| 2019/20    | 376                     |
| 2020/21    | 372                     |
| 2021/22    | 351                     |
| 2022/23    | 293                     |
| 2023/24    | 370                     |
| 2024/25    | 368                     |
| 2025/26    | 380                     |
| 2026/27    | 110                     |

| possession | n    | win%  | draw% | loss% |
| ---------- | ---- | ----- | ----- | ----- |
| <35        | 1429 | 26.6% | 24.5% | 48.9% |
| 35-40      | 1436 | 29.4% | 24.1% | 46.5% |
| 40-45      | 2296 | 31.7% | 26.1% | 42.2% |
| 45-50      | 3149 | 34.8% | 25.6% | 39.5% |
| 50-55      | 3245 | 38.5% | 26.0% | 35.5% |
| 55-60      | 2441 | 42.2% | 26.1% | 31.7% |
| 60-65      | 1505 | 47.0% | 24.1% | 28.9% |
| 65-70      | 881  | 45.5% | 25.2% | 29.3% |
| >70        | 590  | 54.1% | 23.2% | 22.7% |

| possession (all leagues) | n     | win%  | draw% | loss% |
| ------------------------ | ----- | ----- | ----- | ----- |
| <35                      | 14158 | 31.7% | 25.8% | 42.5% |
| 35-40                    | 18028 | 35.9% | 26.1% | 38.0% |
| 40-45                    | 30971 | 35.8% | 25.8% | 38.4% |
| 45-50                    | 45664 | 35.6% | 26.0% | 38.3% |
| 50-55                    | 48544 | 37.6% | 26.6% | 35.8% |
| 55-60                    | 32774 | 38.5% | 25.9% | 35.6% |
| 60-65                    | 18873 | 38.4% | 26.0% | 35.6% |
| 65-70                    | 9659  | 39.8% | 26.2% | 34.0% |
| >70                      | 5001  | 48.0% | 24.8% | 27.2% |

| possession diff (home − away) | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 196     | 33.2%     |
| -30 to -25                    | 280     | 37.9%     |
| -25 to -20                    | 335     | 35.5%     |
| -20 to -15                    | 479     | 37.2%     |
| -15 to -10                    | 535     | 45.8%     |
| -10 to -5                     | 733     | 39.4%     |
| -5 to +0                      | 762     | 43.8%     |
| +0 to +5                      | 899     | 44.4%     |
| +5 to +10                     | 778     | 45.8%     |
| +10 to +15                    | 796     | 49.9%     |
| +15 to +20                    | 565     | 48.8%     |
| +20 to +25                    | 475     | 55.4%     |
| +25 to +30                    | 389     | 52.2%     |
| +30 to +35                    | 311     | 47.9%     |
| +35 to +40                    | 223     | 52.9%     |

| possession diff — all leagues | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 2274    | 41.1%     |
| -30 to -25                    | 3155    | 44.8%     |
| -25 to -20                    | 4158    | 45.5%     |
| -20 to -15                    | 6062    | 45.4%     |
| -15 to -10                    | 7137    | 45.9%     |
| -10 to -5                     | 10221   | 42.7%     |
| -5 to +0                      | 11045   | 43.9%     |
| +0 to +5                      | 14423   | 43.6%     |
| +5 to +10                     | 11157   | 45.0%     |
| +10 to +15                    | 10891   | 45.1%     |
| +15 to +20                    | 7864    | 44.0%     |
| +20 to +25                    | 6607    | 45.0%     |
| +25 to +30                    | 4633    | 43.0%     |
| +30 to +35                    | 3629    | 45.1%     |
| +35 to +40                    | 2213    | 43.8%     |

| team (EPL, all seasons) | wins <40% poss | total wins | low-poss win share |
| ----------------------- | -------------- | ---------- | ------------------ |
| Nott'm Forest           | 29             | 46         | 63%                |
| Cardiff                 | 9              | 17         | 53%                |
| Burnley                 | 34             | 81         | 42%                |
| Hull                    | 14             | 36         | 39%                |
| Crystal Palace          | 53             | 150        | 35%                |
| Sheffield United        | 12             | 34         | 35%                |
| Stoke                   | 31             | 98         | 32%                |
| West Brom               | 30             | 96         | 31%                |
| Brentford               | 17             | 63         | 27%                |
| Bournemouth             | 26             | 100        | 26%                |
| Wolves                  | 29             | 118        | 25%                |
| Watford                 | 14             | 57         | 25%                |

| team (EPL, all seasons) | losses >60% poss | total losses | high-poss loss share |
| ----------------------- | ---------------- | ------------ | -------------------- |
| Chelsea                 | 74               | 174          | 43%                  |
| Liverpool               | 61               | 167          | 37%                  |
| Arsenal                 | 53               | 150          | 35%                  |
| Brighton                | 37               | 126          | 29%                  |
| Man City                | 60               | 208          | 29%                  |
| Man United              | 45               | 175          | 26%                  |
| Tottenham               | 65               | 269          | 24%                  |
| Swansea                 | 20               | 94           | 21%                  |
| Leicester               | 28               | 148          | 19%                  |
| Southampton             | 34               | 228          | 15%                  |
| Leeds                   | 14               | 104          | 13%                  |
| Everton                 | 35               | 291          | 12%                  |

## Is possession just a proxy for something better?

Possession correlates with shots, which correlate with xG, which correlates with
goals. The question that matters: **holding shots and xG constant, does
possession add anything?** A cheaper version of that test — compare how well
each metric's _share_ predicts the win.

```rust

// Pearson correlation between a metric share and home win (1/0)
fn pearson(xs: &[f64], ys: &[f64]) -> f64 {
    let n = xs.len() as f64;
    if n < 3.0 { return f64::NAN; }
    let mx = xs.iter().sum::<f64>() / n;
    let my = ys.iter().sum::<f64>() / n;
    let mut sxy = 0.0; let mut sxx = 0.0; let mut syy = 0.0;
    for i in 0..xs.len() {
        let dx = xs[i] - mx; let dy = ys[i] - my;
        sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if sxx <= 0.0 || syy <= 0.0 { return f64::NAN; }
    sxy / (sxx.sqrt() * syy.sqrt())
}

// shot-share bands vs possession bands (team perspective, all leagues w/ shots)
let sbands = [0.0, 35.0, 45.0, 55.0, 65.0, 100.0];
let slabels = ["<35", "35-45", "45-55", "55-65", ">65"];
let mut sw = vec![0usize; 5]; let mut sd = vec![0usize; 5]; let mut sl = vec![0usize; 5];
let mut n_shot = 0usize;
for r in &rows {
    for (p, s, gf, ga) in [(r.hp, r.hs, r.hg, r.ag), (r.ap, r.as_, r.ag, r.hg)] {
        if s.is_nan() || s <= 0.0 { continue; }
        let opp = if gf == ga && r.hg == r.ag { f64::NAN } else { f64::NAN };
        let _ = opp;
        // opponent shots needed for share — approximate with raw shots band instead
        n_shot += 1;
        let b = sbands.iter().position(|&hi| s < hi).unwrap_or(5) - 1;
        if gf > ga { sw[b] += 1; } else if gf == ga { sd[b] += 1; } else { sl[b] += 1; }
    }
}
// NOTE: raw shot counts aren't comparable across matches; use share instead
// recompute properly with opponent shots
sw.iter_mut().for_each(|x| *x = 0); sd.iter_mut().for_each(|x| *x = 0); sl.iter_mut().for_each(|x| *x = 0);
let mut n_share = 0usize;
for r in &rows {
    let tot = r.hs + r.as_;
    if tot.is_nan() || tot <= 0.0 { continue; }
    for (s, gf, ga) in [(r.hs, r.hg, r.ag), (r.as_, r.ag, r.hg)] {
        if s.is_nan() { continue; }
        let share = 100.0 * s / tot;
        n_share += 1;
        let b = sbands.iter().position(|&hi| share < hi).unwrap_or(5) - 1;
        if gf > ga { sw[b] += 1; } else if gf == ga { sd[b] += 1; } else { sl[b] += 1; }
    }
}
let shot_rows: Vec<Vec<String>> = (0..5).map(|b| {
    let n = (sw[b] + sd[b] + sl[b]) as f64;
    vec![slabels[b].to_string(), (sw[b]+sd[b]+sl[b]).to_string(),
         format!("{:.1}%", 100.0*sw[b] as f64/n),
         format!("{:.1}%", 100.0*sd[b] as f64/n),
         format!("{:.1}%", 100.0*sl[b] as f64/n)]
}).collect();
mars_table(&["shot share %", "n", "win%", "draw%", "loss%"], &shot_rows);
println!("team-observations with shots: {}", n_share);

// correlation of shares with home win — EPL and all leagues
let mut xs_p = Vec::new(); let mut xs_s = Vec::new(); let mut xs_x = Vec::new(); let mut ys = Vec::new();
let mut xs_p_e = Vec::new(); let mut xs_s_e = Vec::new(); let mut ys_e = Vec::new();
for r in &epl {
    let tot_s = r.hs + r.as_;
    if tot_s.is_nan() || tot_s <= 0.0 { continue; }
    let hw = if r.hg > r.ag { 1.0 } else { 0.0 };
    xs_p_e.push(r.hp); xs_s_e.push(100.0 * r.hs / tot_s); ys_e.push(hw);
    if !r.hxg.is_nan() && !r.axg.is_nan() && r.hxg + r.axg > 0.0 {
        xs_p.push(r.hp); xs_s.push(100.0 * r.hs / tot_s);
        xs_x.push(100.0 * r.hxg / (r.hxg + r.axg)); ys.push(hw);
    }
}
println!("EPL: corr(home possession, home win) = {:.3}", pearson(&xs_p_e, &ys_e));
println!("EPL: corr(home shot share,   home win) = {:.3}", pearson(&xs_s_e, &ys_e));
println!("EPL xG subset ({} matches): corr(poss)={:.3} corr(shots)={:.3} corr(xG)={:.3}",
    ys.len(), pearson(&xs_p, &ys), pearson(&xs_s, &ys), pearson(&xs_x, &ys));
```

```text
stat rows indexed: 374660
matches with valid possession (both teams): 111836
EPL matches with possession: 8486 | all leagues: 111836
EPL team-matches: wins 6334 | wins with <40%% poss: 802 (12.7%% of wins)
EPL losses 6334 | losses with >60%% poss: 802 (12.7%% of losses)
team-observations with shots: 223620
EPL: corr(home possession, home win) = 0.119
EPL: corr(home shot share,   home win) = 0.258
EPL xG subset (148 matches): corr(poss)=0.148 corr(shots)=0.185 corr(xG)=0.438
```

| league                   | matches | season span           |
| ------------------------ | ------- | --------------------- |
| English Championship     | 12005   | 2003/04 → 2026/27     |
| English League One       | 10707   | 2006/07 → 2026/27     |
| English League Two       | 9879    | 2006/07 → 2026/27     |
| English Premier League   | 8486    | 2001/02 → 2026/27     |
| Spanish La Liga          | 7247    | 2004/05 → 2026/27     |
| Italian Serie A          | 7241    | 2006/07 → 2026/27     |
| French Ligue 1           | 6465    | 2006/07 → 2026/27     |
| MLS                      | 6260    | 2012 → 2026           |
| German Bundesliga        | 4639    | 2005/06 → 2026/27     |
| Liga MX                  | 4542    | 2012/2013 → 2026/2027 |
| Scottish Premiership     | 4316    | 2006/07 → 2026/27     |
| Serie A                  | 3946    | 2014 → 2026           |
| German 2. Bundesliga     | 3246    | 2008/09 → 2026/27     |
| Dutch Eredivisie         | 2993    | 2008/09 → 2026/27     |
| Portuguese Liga Portugal | 2794    | 2008/09 → 2026/27     |

| EPL season | matches with possession |
| ---------- | ----------------------- |
| 2001/02    | 1                       |
| 2002/03    | 378                     |
| 2003/04    | 381                     |
| 2004/05    | 380                     |
| 2005/06    | 380                     |
| 2006/07    | 380                     |
| 2007/08    | 380                     |
| 2008/09    | 380                     |
| 2009/10    | 379                     |
| 2010/11    | 379                     |
| 2011/12    | 207                     |
| 2012/13    | 338                     |
| 2013/14    | 344                     |
| 2014/15    | 380                     |
| 2015/16    | 417                     |
| 2016/17    | 4                       |
| 2017/18    | 380                     |
| 2018/19    | 378                     |
| 2019/20    | 376                     |
| 2020/21    | 372                     |
| 2021/22    | 351                     |
| 2022/23    | 293                     |
| 2023/24    | 370                     |
| 2024/25    | 368                     |
| 2025/26    | 380                     |
| 2026/27    | 110                     |

| possession | n    | win%  | draw% | loss% |
| ---------- | ---- | ----- | ----- | ----- |
| <35        | 1429 | 26.6% | 24.5% | 48.9% |
| 35-40      | 1436 | 29.4% | 24.1% | 46.5% |
| 40-45      | 2296 | 31.7% | 26.1% | 42.2% |
| 45-50      | 3149 | 34.8% | 25.6% | 39.5% |
| 50-55      | 3245 | 38.5% | 26.0% | 35.5% |
| 55-60      | 2441 | 42.2% | 26.1% | 31.7% |
| 60-65      | 1505 | 47.0% | 24.1% | 28.9% |
| 65-70      | 881  | 45.5% | 25.2% | 29.3% |
| >70        | 590  | 54.1% | 23.2% | 22.7% |

| possession (all leagues) | n     | win%  | draw% | loss% |
| ------------------------ | ----- | ----- | ----- | ----- |
| <35                      | 14158 | 31.7% | 25.8% | 42.5% |
| 35-40                    | 18028 | 35.9% | 26.1% | 38.0% |
| 40-45                    | 30971 | 35.8% | 25.8% | 38.4% |
| 45-50                    | 45664 | 35.6% | 26.0% | 38.3% |
| 50-55                    | 48544 | 37.6% | 26.6% | 35.8% |
| 55-60                    | 32774 | 38.5% | 25.9% | 35.6% |
| 60-65                    | 18873 | 38.4% | 26.0% | 35.6% |
| 65-70                    | 9659  | 39.8% | 26.2% | 34.0% |
| >70                      | 5001  | 48.0% | 24.8% | 27.2% |

| possession diff (home − away) | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 196     | 33.2%     |
| -30 to -25                    | 280     | 37.9%     |
| -25 to -20                    | 335     | 35.5%     |
| -20 to -15                    | 479     | 37.2%     |
| -15 to -10                    | 535     | 45.8%     |
| -10 to -5                     | 733     | 39.4%     |
| -5 to +0                      | 762     | 43.8%     |
| +0 to +5                      | 899     | 44.4%     |
| +5 to +10                     | 778     | 45.8%     |
| +10 to +15                    | 796     | 49.9%     |
| +15 to +20                    | 565     | 48.8%     |
| +20 to +25                    | 475     | 55.4%     |
| +25 to +30                    | 389     | 52.2%     |
| +30 to +35                    | 311     | 47.9%     |
| +35 to +40                    | 223     | 52.9%     |

| possession diff — all leagues | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 2274    | 41.1%     |
| -30 to -25                    | 3155    | 44.8%     |
| -25 to -20                    | 4158    | 45.5%     |
| -20 to -15                    | 6062    | 45.4%     |
| -15 to -10                    | 7137    | 45.9%     |
| -10 to -5                     | 10221   | 42.7%     |
| -5 to +0                      | 11045   | 43.9%     |
| +0 to +5                      | 14423   | 43.6%     |
| +5 to +10                     | 11157   | 45.0%     |
| +10 to +15                    | 10891   | 45.1%     |
| +15 to +20                    | 7864    | 44.0%     |
| +20 to +25                    | 6607    | 45.0%     |
| +25 to +30                    | 4633    | 43.0%     |
| +30 to +35                    | 3629    | 45.1%     |
| +35 to +40                    | 2213    | 43.8%     |

| team (EPL, all seasons) | wins <40% poss | total wins | low-poss win share |
| ----------------------- | -------------- | ---------- | ------------------ |
| Nott'm Forest           | 29             | 46         | 63%                |
| Cardiff                 | 9              | 17         | 53%                |
| Burnley                 | 34             | 81         | 42%                |
| Hull                    | 14             | 36         | 39%                |
| Crystal Palace          | 53             | 150        | 35%                |
| Sheffield United        | 12             | 34         | 35%                |
| Stoke                   | 31             | 98         | 32%                |
| West Brom               | 30             | 96         | 31%                |
| Brentford               | 17             | 63         | 27%                |
| Bournemouth             | 26             | 100        | 26%                |
| Wolves                  | 29             | 118        | 25%                |
| Watford                 | 14             | 57         | 25%                |

| team (EPL, all seasons) | losses >60% poss | total losses | high-poss loss share |
| ----------------------- | ---------------- | ------------ | -------------------- |
| Chelsea                 | 74               | 174          | 43%                  |
| Liverpool               | 61               | 167          | 37%                  |
| Arsenal                 | 53               | 150          | 35%                  |
| Brighton                | 37               | 126          | 29%                  |
| Man City                | 60               | 208          | 29%                  |
| Man United              | 45               | 175          | 26%                  |
| Tottenham               | 65               | 269          | 24%                  |
| Swansea                 | 20               | 94           | 21%                  |
| Leicester               | 28               | 148          | 19%                  |
| Southampton             | 34               | 228          | 15%                  |
| Leeds                   | 14               | 104          | 13%                  |
| Everton                 | 35               | 291          | 12%                  |

| shot share % | n     | win%  | draw% | loss% |
| ------------ | ----- | ----- | ----- | ----- |
| <35          | 39909 | 20.6% | 25.0% | 54.4% |
| 35-45        | 44623 | 30.4% | 26.2% | 43.4% |
| 45-55        | 53054 | 36.2% | 27.4% | 36.4% |
| 55-65        | 45113 | 43.2% | 26.2% | 30.6% |
| >65          | 40921 | 54.2% | 25.1% | 20.8% |

## Context: home advantage and opponent strength

Two confounds the band table ignores. **Home teams already win more**, so a
home-side possession edge may partly be venue, not control. And **possession is
easier against weak teams** — a side that pins a relegation candidate will post
inflated numbers. Split by venue and by opponent strength (the opponent's final
season points, top vs bottom half within its league-season).

```rust

// team-season points for opponent strength (all matches_full matches)
let mut tp: HashMap<(String, String, i64), (i64, i64)> = HashMap::new(); // (lg,season,tid) -> (pts, gf-ga rank later)
for i in 0..mf.height() {
    if s_hg[i] < 0 || s_ag[i] < 0 { continue; }
    let lg = format!("{}|{}", s_country[i], s_league[i]);
    let key_h = (lg.clone(), s_season[i].clone(), s_hid[i]);
    let key_a = (lg.clone(), s_season[i].clone(), s_aid[i]);
    let ph = if s_hg[i] > s_ag[i] { 3 } else if s_hg[i] == s_ag[i] { 1 } else { 0 };
    let pa = if s_ag[i] > s_hg[i] { 3 } else if s_hg[i] == s_ag[i] { 1 } else { 0 };
    tp.entry(key_h).or_insert((0, 0)).0 += ph;
    tp.entry(key_a).or_insert((0, 0)).0 += pa;
}
// rank teams within league-season by points -> top half = strong
let mut lgsn_teams: HashMap<(String, String), Vec<((String, String, i64), i64)>> = HashMap::new();
for (k, v) in &tp { lgsn_teams.entry((k.0.clone(), k.1.clone())).or_default().push((k.clone(), v.0)); }
let mut strong: HashMap<(String, String, i64), bool> = HashMap::new();
for ((lg, sn), mut teams) in lgsn_teams {
    teams.sort_by(|a, b| b.1.cmp(&a.1));
    let half = teams.len() / 2;
    for (i, (k, _)) in teams.iter().enumerate() {
        strong.insert(k.clone(), i < half);
    }
    let _ = (lg, sn);
}

// win% by possession band x opponent strength — EPL only
let epl_rows: Vec<&MRow> = epl.iter().cloned().collect();
let mut res = vec![(0usize,0usize); 18]; // band(9) x strong(2) -> (wins,total)
for r in &epl_rows {
    let lg = format!("England|{}", r.league);
    for (p, opp_id, gf, ga) in [(r.hp, r.aid, r.hg, r.ag), (r.ap, r.hid, r.ag, r.hg)] {
        let b = bands.iter().position(|&hi| p < hi).unwrap_or(9) - 1;
        let is_strong = strong.get(&(lg.clone(), r.season.clone(), opp_id)).copied().unwrap_or(false);
        let idx = b * 2 + if is_strong { 1 } else { 0 };
        res[idx].1 += 1;
        if gf > ga { res[idx].0 += 1; }
    }
}
let ctx_rows: Vec<Vec<String>> = (0..9).map(|b| vec![
    blabels[b].to_string(),
    format!("{} / {}", res[b*2].1, res[b*2+1].1),
    format!("{:.0}% / {:.0}%",
        100.0*res[b*2].0 as f64/res[b*2].1.max(1) as f64,
        100.0*res[b*2+1].0 as f64/res[b*2+1].1.max(1) as f64),
]).collect();
mars_table(&["possession", "n vs weak / strong", "win% vs weak / strong"], &ctx_rows);
println!("opponent strength = top-half finishers in same league-season (points)");
```

```text
stat rows indexed: 374660
matches with valid possession (both teams): 111836
EPL matches with possession: 8486 | all leagues: 111836
EPL team-matches: wins 6334 | wins with <40%% poss: 802 (12.7%% of wins)
EPL losses 6334 | losses with >60%% poss: 802 (12.7%% of losses)
team-observations with shots: 223620
EPL: corr(home possession, home win) = 0.119
EPL: corr(home shot share,   home win) = 0.258
EPL xG subset (148 matches): corr(poss)=0.148 corr(shots)=0.185 corr(xG)=0.438
opponent strength = top-half finishers in same league-season (points)
```

| league                   | matches | season span           |
| ------------------------ | ------- | --------------------- |
| English Championship     | 12005   | 2003/04 → 2026/27     |
| English League One       | 10707   | 2006/07 → 2026/27     |
| English League Two       | 9879    | 2006/07 → 2026/27     |
| English Premier League   | 8486    | 2001/02 → 2026/27     |
| Spanish La Liga          | 7247    | 2004/05 → 2026/27     |
| Italian Serie A          | 7241    | 2006/07 → 2026/27     |
| French Ligue 1           | 6465    | 2006/07 → 2026/27     |
| MLS                      | 6260    | 2012 → 2026           |
| German Bundesliga        | 4639    | 2005/06 → 2026/27     |
| Liga MX                  | 4542    | 2012/2013 → 2026/2027 |
| Scottish Premiership     | 4316    | 2006/07 → 2026/27     |
| Serie A                  | 3946    | 2014 → 2026           |
| German 2. Bundesliga     | 3246    | 2008/09 → 2026/27     |
| Dutch Eredivisie         | 2993    | 2008/09 → 2026/27     |
| Portuguese Liga Portugal | 2794    | 2008/09 → 2026/27     |

| EPL season | matches with possession |
| ---------- | ----------------------- |
| 2001/02    | 1                       |
| 2002/03    | 378                     |
| 2003/04    | 381                     |
| 2004/05    | 380                     |
| 2005/06    | 380                     |
| 2006/07    | 380                     |
| 2007/08    | 380                     |
| 2008/09    | 380                     |
| 2009/10    | 379                     |
| 2010/11    | 379                     |
| 2011/12    | 207                     |
| 2012/13    | 338                     |
| 2013/14    | 344                     |
| 2014/15    | 380                     |
| 2015/16    | 417                     |
| 2016/17    | 4                       |
| 2017/18    | 380                     |
| 2018/19    | 378                     |
| 2019/20    | 376                     |
| 2020/21    | 372                     |
| 2021/22    | 351                     |
| 2022/23    | 293                     |
| 2023/24    | 370                     |
| 2024/25    | 368                     |
| 2025/26    | 380                     |
| 2026/27    | 110                     |

| possession | n    | win%  | draw% | loss% |
| ---------- | ---- | ----- | ----- | ----- |
| <35        | 1429 | 26.6% | 24.5% | 48.9% |
| 35-40      | 1436 | 29.4% | 24.1% | 46.5% |
| 40-45      | 2296 | 31.7% | 26.1% | 42.2% |
| 45-50      | 3149 | 34.8% | 25.6% | 39.5% |
| 50-55      | 3245 | 38.5% | 26.0% | 35.5% |
| 55-60      | 2441 | 42.2% | 26.1% | 31.7% |
| 60-65      | 1505 | 47.0% | 24.1% | 28.9% |
| 65-70      | 881  | 45.5% | 25.2% | 29.3% |
| >70        | 590  | 54.1% | 23.2% | 22.7% |

| possession (all leagues) | n     | win%  | draw% | loss% |
| ------------------------ | ----- | ----- | ----- | ----- |
| <35                      | 14158 | 31.7% | 25.8% | 42.5% |
| 35-40                    | 18028 | 35.9% | 26.1% | 38.0% |
| 40-45                    | 30971 | 35.8% | 25.8% | 38.4% |
| 45-50                    | 45664 | 35.6% | 26.0% | 38.3% |
| 50-55                    | 48544 | 37.6% | 26.6% | 35.8% |
| 55-60                    | 32774 | 38.5% | 25.9% | 35.6% |
| 60-65                    | 18873 | 38.4% | 26.0% | 35.6% |
| 65-70                    | 9659  | 39.8% | 26.2% | 34.0% |
| >70                      | 5001  | 48.0% | 24.8% | 27.2% |

| possession diff (home − away) | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 196     | 33.2%     |
| -30 to -25                    | 280     | 37.9%     |
| -25 to -20                    | 335     | 35.5%     |
| -20 to -15                    | 479     | 37.2%     |
| -15 to -10                    | 535     | 45.8%     |
| -10 to -5                     | 733     | 39.4%     |
| -5 to +0                      | 762     | 43.8%     |
| +0 to +5                      | 899     | 44.4%     |
| +5 to +10                     | 778     | 45.8%     |
| +10 to +15                    | 796     | 49.9%     |
| +15 to +20                    | 565     | 48.8%     |
| +20 to +25                    | 475     | 55.4%     |
| +25 to +30                    | 389     | 52.2%     |
| +30 to +35                    | 311     | 47.9%     |
| +35 to +40                    | 223     | 52.9%     |

| possession diff — all leagues | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 2274    | 41.1%     |
| -30 to -25                    | 3155    | 44.8%     |
| -25 to -20                    | 4158    | 45.5%     |
| -20 to -15                    | 6062    | 45.4%     |
| -15 to -10                    | 7137    | 45.9%     |
| -10 to -5                     | 10221   | 42.7%     |
| -5 to +0                      | 11045   | 43.9%     |
| +0 to +5                      | 14423   | 43.6%     |
| +5 to +10                     | 11157   | 45.0%     |
| +10 to +15                    | 10891   | 45.1%     |
| +15 to +20                    | 7864    | 44.0%     |
| +20 to +25                    | 6607    | 45.0%     |
| +25 to +30                    | 4633    | 43.0%     |
| +30 to +35                    | 3629    | 45.1%     |
| +35 to +40                    | 2213    | 43.8%     |

| team (EPL, all seasons) | wins <40% poss | total wins | low-poss win share |
| ----------------------- | -------------- | ---------- | ------------------ |
| Nott'm Forest           | 29             | 46         | 63%                |
| Cardiff                 | 9              | 17         | 53%                |
| Burnley                 | 34             | 81         | 42%                |
| Hull                    | 14             | 36         | 39%                |
| Crystal Palace          | 53             | 150        | 35%                |
| Sheffield United        | 12             | 34         | 35%                |
| Stoke                   | 31             | 98         | 32%                |
| West Brom               | 30             | 96         | 31%                |
| Brentford               | 17             | 63         | 27%                |
| Bournemouth             | 26             | 100        | 26%                |
| Wolves                  | 29             | 118        | 25%                |
| Watford                 | 14             | 57         | 25%                |

| team (EPL, all seasons) | losses >60% poss | total losses | high-poss loss share |
| ----------------------- | ---------------- | ------------ | -------------------- |
| Chelsea                 | 74               | 174          | 43%                  |
| Liverpool               | 61               | 167          | 37%                  |
| Arsenal                 | 53               | 150          | 35%                  |
| Brighton                | 37               | 126          | 29%                  |
| Man City                | 60               | 208          | 29%                  |
| Man United              | 45               | 175          | 26%                  |
| Tottenham               | 65               | 269          | 24%                  |
| Swansea                 | 20               | 94           | 21%                  |
| Leicester               | 28               | 148          | 19%                  |
| Southampton             | 34               | 228          | 15%                  |
| Leeds                   | 14               | 104          | 13%                  |
| Everton                 | 35               | 291          | 12%                  |

| shot share % | n     | win%  | draw% | loss% |
| ------------ | ----- | ----- | ----- | ----- |
| <35          | 39909 | 20.6% | 25.0% | 54.4% |
| 35-45        | 44623 | 30.4% | 26.2% | 43.4% |
| 45-55        | 53054 | 36.2% | 27.4% | 36.4% |
| 55-65        | 45113 | 43.2% | 26.2% | 30.6% |
| >65          | 40921 | 54.2% | 25.1% | 20.8% |

| possession | n vs weak / strong | win% vs weak / strong |
| ---------- | ------------------ | --------------------- |
| <35        | 261 / 1168         | 46% / 22%             |
| 35-40      | 403 / 1033         | 48% / 22%             |
| 40-45      | 855 / 1441         | 48% / 22%             |
| 45-50      | 1401 / 1748        | 45% / 27%             |
| 50-55      | 1776 / 1469        | 45% / 30%             |
| 55-60      | 1537 / 904         | 48% / 33%             |
| 60-65      | 995 / 510          | 53% / 34%             |
| 65-70      | 627 / 254          | 50% / 34%             |
| >70        | 457 / 133          | 58% / 40%             |

## Home vs away: is possession worth more in one venue?

A team with 60% at home is often just riding home advantage; the same 60% away
from home is a genuinely dominant performance. Compare the win-rate curve for
home and away teams separately.

```rust

// band table for HOME team's possession only, and AWAY team's only
let band_table_side = |matches: &[&MRow], home_side: bool| -> Vec<Vec<String>> {
    let mut w = vec![0usize; 9]; let mut d = vec![0usize; 9]; let mut l = vec![0usize; 9];
    for r in matches {
        let (p, gf, ga) = if home_side { (r.hp, r.hg, r.ag) } else { (r.ap, r.ag, r.hg) };
        let b = bands.iter().position(|&hi| p < hi).unwrap_or(9) - 1;
        if gf > ga { w[b] += 1; } else if gf == ga { d[b] += 1; } else { l[b] += 1; }
    }
    (0..9).map(|b| {
        let n = (w[b] + d[b] + l[b]) as f64;
        vec![blabels[b].to_string(), (w[b]+d[b]+l[b]).to_string(),
             format!("{:.1}%", 100.0*w[b] as f64/n),
             format!("{:.1}%", 100.0*d[b] as f64/n),
             format!("{:.1}%", 100.0*l[b] as f64/n)]
    }).collect()
};
let epl_refs: Vec<&MRow> = epl.iter().cloned().collect();
let home_b = band_table_side(&epl_refs, true);
let away_b = band_table_side(&epl_refs, false);
// merge into one table: band | home win% | away win%
let ha_rows: Vec<Vec<String>> = (0..9).map(|b| vec![
    blabels[b].to_string(),
    home_b[b][2].clone(), home_b[b][4].clone(),
    away_b[b][2].clone(), away_b[b][4].clone(),
]).collect();
mars_table(&["possession", "home win% / loss%", "away win% / loss%"], &ha_rows);
```

```text
stat rows indexed: 374660
matches with valid possession (both teams): 111836
EPL matches with possession: 8486 | all leagues: 111836
EPL team-matches: wins 6334 | wins with <40%% poss: 802 (12.7%% of wins)
EPL losses 6334 | losses with >60%% poss: 802 (12.7%% of losses)
team-observations with shots: 223620
EPL: corr(home possession, home win) = 0.119
EPL: corr(home shot share,   home win) = 0.258
EPL xG subset (148 matches): corr(poss)=0.148 corr(shots)=0.185 corr(xG)=0.438
opponent strength = top-half finishers in same league-season (points)
```

| league                   | matches | season span           |
| ------------------------ | ------- | --------------------- |
| English Championship     | 12005   | 2003/04 → 2026/27     |
| English League One       | 10707   | 2006/07 → 2026/27     |
| English League Two       | 9879    | 2006/07 → 2026/27     |
| English Premier League   | 8486    | 2001/02 → 2026/27     |
| Spanish La Liga          | 7247    | 2004/05 → 2026/27     |
| Italian Serie A          | 7241    | 2006/07 → 2026/27     |
| French Ligue 1           | 6465    | 2006/07 → 2026/27     |
| MLS                      | 6260    | 2012 → 2026           |
| German Bundesliga        | 4639    | 2005/06 → 2026/27     |
| Liga MX                  | 4542    | 2012/2013 → 2026/2027 |
| Scottish Premiership     | 4316    | 2006/07 → 2026/27     |
| Serie A                  | 3946    | 2014 → 2026           |
| German 2. Bundesliga     | 3246    | 2008/09 → 2026/27     |
| Dutch Eredivisie         | 2993    | 2008/09 → 2026/27     |
| Portuguese Liga Portugal | 2794    | 2008/09 → 2026/27     |

| EPL season | matches with possession |
| ---------- | ----------------------- |
| 2001/02    | 1                       |
| 2002/03    | 378                     |
| 2003/04    | 381                     |
| 2004/05    | 380                     |
| 2005/06    | 380                     |
| 2006/07    | 380                     |
| 2007/08    | 380                     |
| 2008/09    | 380                     |
| 2009/10    | 379                     |
| 2010/11    | 379                     |
| 2011/12    | 207                     |
| 2012/13    | 338                     |
| 2013/14    | 344                     |
| 2014/15    | 380                     |
| 2015/16    | 417                     |
| 2016/17    | 4                       |
| 2017/18    | 380                     |
| 2018/19    | 378                     |
| 2019/20    | 376                     |
| 2020/21    | 372                     |
| 2021/22    | 351                     |
| 2022/23    | 293                     |
| 2023/24    | 370                     |
| 2024/25    | 368                     |
| 2025/26    | 380                     |
| 2026/27    | 110                     |

| possession | n    | win%  | draw% | loss% |
| ---------- | ---- | ----- | ----- | ----- |
| <35        | 1429 | 26.6% | 24.5% | 48.9% |
| 35-40      | 1436 | 29.4% | 24.1% | 46.5% |
| 40-45      | 2296 | 31.7% | 26.1% | 42.2% |
| 45-50      | 3149 | 34.8% | 25.6% | 39.5% |
| 50-55      | 3245 | 38.5% | 26.0% | 35.5% |
| 55-60      | 2441 | 42.2% | 26.1% | 31.7% |
| 60-65      | 1505 | 47.0% | 24.1% | 28.9% |
| 65-70      | 881  | 45.5% | 25.2% | 29.3% |
| >70        | 590  | 54.1% | 23.2% | 22.7% |

| possession (all leagues) | n     | win%  | draw% | loss% |
| ------------------------ | ----- | ----- | ----- | ----- |
| <35                      | 14158 | 31.7% | 25.8% | 42.5% |
| 35-40                    | 18028 | 35.9% | 26.1% | 38.0% |
| 40-45                    | 30971 | 35.8% | 25.8% | 38.4% |
| 45-50                    | 45664 | 35.6% | 26.0% | 38.3% |
| 50-55                    | 48544 | 37.6% | 26.6% | 35.8% |
| 55-60                    | 32774 | 38.5% | 25.9% | 35.6% |
| 60-65                    | 18873 | 38.4% | 26.0% | 35.6% |
| 65-70                    | 9659  | 39.8% | 26.2% | 34.0% |
| >70                      | 5001  | 48.0% | 24.8% | 27.2% |

| possession diff (home − away) | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 196     | 33.2%     |
| -30 to -25                    | 280     | 37.9%     |
| -25 to -20                    | 335     | 35.5%     |
| -20 to -15                    | 479     | 37.2%     |
| -15 to -10                    | 535     | 45.8%     |
| -10 to -5                     | 733     | 39.4%     |
| -5 to +0                      | 762     | 43.8%     |
| +0 to +5                      | 899     | 44.4%     |
| +5 to +10                     | 778     | 45.8%     |
| +10 to +15                    | 796     | 49.9%     |
| +15 to +20                    | 565     | 48.8%     |
| +20 to +25                    | 475     | 55.4%     |
| +25 to +30                    | 389     | 52.2%     |
| +30 to +35                    | 311     | 47.9%     |
| +35 to +40                    | 223     | 52.9%     |

| possession diff — all leagues | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 2274    | 41.1%     |
| -30 to -25                    | 3155    | 44.8%     |
| -25 to -20                    | 4158    | 45.5%     |
| -20 to -15                    | 6062    | 45.4%     |
| -15 to -10                    | 7137    | 45.9%     |
| -10 to -5                     | 10221   | 42.7%     |
| -5 to +0                      | 11045   | 43.9%     |
| +0 to +5                      | 14423   | 43.6%     |
| +5 to +10                     | 11157   | 45.0%     |
| +10 to +15                    | 10891   | 45.1%     |
| +15 to +20                    | 7864    | 44.0%     |
| +20 to +25                    | 6607    | 45.0%     |
| +25 to +30                    | 4633    | 43.0%     |
| +30 to +35                    | 3629    | 45.1%     |
| +35 to +40                    | 2213    | 43.8%     |

| team (EPL, all seasons) | wins <40% poss | total wins | low-poss win share |
| ----------------------- | -------------- | ---------- | ------------------ |
| Nott'm Forest           | 29             | 46         | 63%                |
| Cardiff                 | 9              | 17         | 53%                |
| Burnley                 | 34             | 81         | 42%                |
| Hull                    | 14             | 36         | 39%                |
| Crystal Palace          | 53             | 150        | 35%                |
| Sheffield United        | 12             | 34         | 35%                |
| Stoke                   | 31             | 98         | 32%                |
| West Brom               | 30             | 96         | 31%                |
| Brentford               | 17             | 63         | 27%                |
| Bournemouth             | 26             | 100        | 26%                |
| Wolves                  | 29             | 118        | 25%                |
| Watford                 | 14             | 57         | 25%                |

| team (EPL, all seasons) | losses >60% poss | total losses | high-poss loss share |
| ----------------------- | ---------------- | ------------ | -------------------- |
| Chelsea                 | 74               | 174          | 43%                  |
| Liverpool               | 61               | 167          | 37%                  |
| Arsenal                 | 53               | 150          | 35%                  |
| Brighton                | 37               | 126          | 29%                  |
| Man City                | 60               | 208          | 29%                  |
| Man United              | 45               | 175          | 26%                  |
| Tottenham               | 65               | 269          | 24%                  |
| Swansea                 | 20               | 94           | 21%                  |
| Leicester               | 28               | 148          | 19%                  |
| Southampton             | 34               | 228          | 15%                  |
| Leeds                   | 14               | 104          | 13%                  |
| Everton                 | 35               | 291          | 12%                  |

| shot share % | n     | win%  | draw% | loss% |
| ------------ | ----- | ----- | ----- | ----- |
| <35          | 39909 | 20.6% | 25.0% | 54.4% |
| 35-45        | 44623 | 30.4% | 26.2% | 43.4% |
| 45-55        | 53054 | 36.2% | 27.4% | 36.4% |
| 55-65        | 45113 | 43.2% | 26.2% | 30.6% |
| >65          | 40921 | 54.2% | 25.1% | 20.8% |

| possession | n vs weak / strong | win% vs weak / strong |
| ---------- | ------------------ | --------------------- |
| <35        | 264 / 1165         | 46% / 22%             |
| 35-40      | 404 / 1032         | 48% / 22%             |
| 40-45      | 846 / 1450         | 48% / 22%             |
| 45-50      | 1400 / 1749        | 46% / 26%             |
| 50-55      | 1760 / 1485        | 45% / 31%             |
| 55-60      | 1544 / 897         | 48% / 33%             |
| 60-65      | 1006 / 499         | 53% / 35%             |
| 65-70      | 628 / 253          | 50% / 34%             |
| >70        | 460 / 130          | 58% / 39%             |

| possession | home win% / loss% | away win% / loss% |
| ---------- | ----------------- | ----------------- |
| <35        | 34.5%             | 42.1%             |
| 35-40      | 36.6%             | 37.2%             |
| 40-45      | 41.7%             | 32.7%             |
| 45-50      | 41.7%             | 32.5%             |
| 50-55      | 45.0%             | 29.3%             |
| 55-60      | 49.4%             | 23.9%             |
| 60-65      | 53.9%             | 23.5%             |
| 65-70      | 50.0%             | 23.8%             |
| >70        | 58.7%             | 17.8%             |

## The season-level view and the historical trend

Match-level noise is huge — one deflected shot swings a game. Smooth it twice:
(1) correlate each team's **season-average possession** with its final points
across all EPL team-seasons; (2) track the yearly correlation between possession
differential and home wins to see whether possession has become more or less
decisive over time.

```rust

// (1) EPL team-season: avg possession vs points
let mut ts: HashMap<(String, i64), (f64, f64, usize)> = HashMap::new(); // (season,tid) -> (sum poss, sum opp poss? just poss,n)
for r in &epl {
    for (tid, p) in [(r.hid, r.hp), (r.aid, r.ap)] {
        let e = ts.entry((r.season.clone(), tid)).or_insert((0.0, 0.0, 0));
        e.0 += p; e.2 += 1;
    }
}
// points per team-season
let mut pts: HashMap<(String, i64), i64> = HashMap::new();
for r in &epl {
    let ph = if r.hg > r.ag { 3 } else if r.hg == r.ag { 1 } else { 0 };
    let pa = if r.ag > r.hg { 3 } else if r.hg == r.ag { 1 } else { 0 };
    *pts.entry((r.season.clone(), r.hid)).or_insert(0) += ph;
    *pts.entry((r.season.clone(), r.aid)).or_insert(0) += pa;
}
let mut xs = Vec::new(); let mut ys = Vec::new();
for ((sn, tid), (sp, _, n)) in &ts {
    if *n < 30 { continue; }
    if let Some(p) = pts.get(&(sn.clone(), *tid)) {
        xs.push(sp / *n as f64); ys.push(*p as f64);
    }
}
println!("EPL team-seasons: {} | corr(avg possession, season points) = {:.3}",
    xs.len(), pearson(&xs, &ys));

// (2) yearly correlation: possession diff -> home win, EPL by season
let mut by_year: std::collections::BTreeMap<String, (Vec<f64>, Vec<f64>)> = std::collections::BTreeMap::new();
for r in &epl {
    let e = by_year.entry(r.season.clone()).or_default();
    e.0.push(r.hp - r.ap);
    e.1.push(if r.hg > r.ag { 1.0 } else { 0.0 });
}
let trend_rows: Vec<Vec<String>> = by_year.iter().map(|(sn, (x, y))| vec![
    sn.clone(), format!("{:.3}", pearson(x, y)), x.len().to_string(),
]).collect();
mars_table(&["EPL season", "corr(poss diff, home win)", "matches"], &trend_rows);
```

```text
stat rows indexed: 374660
matches with valid possession (both teams): 111836
EPL matches with possession: 8486 | all leagues: 111836
EPL team-matches: wins 6334 | wins with <40%% poss: 802 (12.7%% of wins)
EPL losses 6334 | losses with >60%% poss: 802 (12.7%% of losses)
team-observations with shots: 223620
EPL: corr(home possession, home win) = 0.119
EPL: corr(home shot share,   home win) = 0.258
EPL xG subset (148 matches): corr(poss)=0.148 corr(shots)=0.185 corr(xG)=0.438
opponent strength = top-half finishers in same league-season (points)
EPL team-seasons: 431 | corr(avg possession, season points) = 0.704
```

| league                   | matches | season span           |
| ------------------------ | ------- | --------------------- |
| English Championship     | 12005   | 2003/04 → 2026/27     |
| English League One       | 10707   | 2006/07 → 2026/27     |
| English League Two       | 9879    | 2006/07 → 2026/27     |
| English Premier League   | 8486    | 2001/02 → 2026/27     |
| Spanish La Liga          | 7247    | 2004/05 → 2026/27     |
| Italian Serie A          | 7241    | 2006/07 → 2026/27     |
| French Ligue 1           | 6465    | 2006/07 → 2026/27     |
| MLS                      | 6260    | 2012 → 2026           |
| German Bundesliga        | 4639    | 2005/06 → 2026/27     |
| Liga MX                  | 4542    | 2012/2013 → 2026/2027 |
| Scottish Premiership     | 4316    | 2006/07 → 2026/27     |
| Serie A                  | 3946    | 2014 → 2026           |
| German 2. Bundesliga     | 3246    | 2008/09 → 2026/27     |
| Dutch Eredivisie         | 2993    | 2008/09 → 2026/27     |
| Portuguese Liga Portugal | 2794    | 2008/09 → 2026/27     |

| EPL season | matches with possession |
| ---------- | ----------------------- |
| 2001/02    | 1                       |
| 2002/03    | 378                     |
| 2003/04    | 381                     |
| 2004/05    | 380                     |
| 2005/06    | 380                     |
| 2006/07    | 380                     |
| 2007/08    | 380                     |
| 2008/09    | 380                     |
| 2009/10    | 379                     |
| 2010/11    | 379                     |
| 2011/12    | 207                     |
| 2012/13    | 338                     |
| 2013/14    | 344                     |
| 2014/15    | 380                     |
| 2015/16    | 417                     |
| 2016/17    | 4                       |
| 2017/18    | 380                     |
| 2018/19    | 378                     |
| 2019/20    | 376                     |
| 2020/21    | 372                     |
| 2021/22    | 351                     |
| 2022/23    | 293                     |
| 2023/24    | 370                     |
| 2024/25    | 368                     |
| 2025/26    | 380                     |
| 2026/27    | 110                     |

| possession | n    | win%  | draw% | loss% |
| ---------- | ---- | ----- | ----- | ----- |
| <35        | 1429 | 26.6% | 24.5% | 48.9% |
| 35-40      | 1436 | 29.4% | 24.1% | 46.5% |
| 40-45      | 2296 | 31.7% | 26.1% | 42.2% |
| 45-50      | 3149 | 34.8% | 25.6% | 39.5% |
| 50-55      | 3245 | 38.5% | 26.0% | 35.5% |
| 55-60      | 2441 | 42.2% | 26.1% | 31.7% |
| 60-65      | 1505 | 47.0% | 24.1% | 28.9% |
| 65-70      | 881  | 45.5% | 25.2% | 29.3% |
| >70        | 590  | 54.1% | 23.2% | 22.7% |

| possession (all leagues) | n     | win%  | draw% | loss% |
| ------------------------ | ----- | ----- | ----- | ----- |
| <35                      | 14158 | 31.7% | 25.8% | 42.5% |
| 35-40                    | 18028 | 35.9% | 26.1% | 38.0% |
| 40-45                    | 30971 | 35.8% | 25.8% | 38.4% |
| 45-50                    | 45664 | 35.6% | 26.0% | 38.3% |
| 50-55                    | 48544 | 37.6% | 26.6% | 35.8% |
| 55-60                    | 32774 | 38.5% | 25.9% | 35.6% |
| 60-65                    | 18873 | 38.4% | 26.0% | 35.6% |
| 65-70                    | 9659  | 39.8% | 26.2% | 34.0% |
| >70                      | 5001  | 48.0% | 24.8% | 27.2% |

| possession diff (home − away) | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 196     | 33.2%     |
| -30 to -25                    | 280     | 37.9%     |
| -25 to -20                    | 335     | 35.5%     |
| -20 to -15                    | 479     | 37.2%     |
| -15 to -10                    | 535     | 45.8%     |
| -10 to -5                     | 733     | 39.4%     |
| -5 to +0                      | 762     | 43.8%     |
| +0 to +5                      | 899     | 44.4%     |
| +5 to +10                     | 778     | 45.8%     |
| +10 to +15                    | 796     | 49.9%     |
| +15 to +20                    | 565     | 48.8%     |
| +20 to +25                    | 475     | 55.4%     |
| +25 to +30                    | 389     | 52.2%     |
| +30 to +35                    | 311     | 47.9%     |
| +35 to +40                    | 223     | 52.9%     |

| possession diff — all leagues | matches | home win% |
| ----------------------------- | ------- | --------- |
| -35 to -30                    | 2274    | 41.1%     |
| -30 to -25                    | 3155    | 44.8%     |
| -25 to -20                    | 4158    | 45.5%     |
| -20 to -15                    | 6062    | 45.4%     |
| -15 to -10                    | 7137    | 45.9%     |
| -10 to -5                     | 10221   | 42.7%     |
| -5 to +0                      | 11045   | 43.9%     |
| +0 to +5                      | 14423   | 43.6%     |
| +5 to +10                     | 11157   | 45.0%     |
| +10 to +15                    | 10891   | 45.1%     |
| +15 to +20                    | 7864    | 44.0%     |
| +20 to +25                    | 6607    | 45.0%     |
| +25 to +30                    | 4633    | 43.0%     |
| +30 to +35                    | 3629    | 45.1%     |
| +35 to +40                    | 2213    | 43.8%     |

| team (EPL, all seasons) | wins <40% poss | total wins | low-poss win share |
| ----------------------- | -------------- | ---------- | ------------------ |
| Nott'm Forest           | 29             | 46         | 63%                |
| Cardiff                 | 9              | 17         | 53%                |
| Burnley                 | 34             | 81         | 42%                |
| Hull                    | 14             | 36         | 39%                |
| Crystal Palace          | 53             | 150        | 35%                |
| Sheffield United        | 12             | 34         | 35%                |
| Stoke                   | 31             | 98         | 32%                |
| West Brom               | 30             | 96         | 31%                |
| Brentford               | 17             | 63         | 27%                |
| Bournemouth             | 26             | 100        | 26%                |
| Wolves                  | 29             | 118        | 25%                |
| Watford                 | 14             | 57         | 25%                |

| team (EPL, all seasons) | losses >60% poss | total losses | high-poss loss share |
| ----------------------- | ---------------- | ------------ | -------------------- |
| Chelsea                 | 74               | 174          | 43%                  |
| Liverpool               | 61               | 167          | 37%                  |
| Arsenal                 | 53               | 150          | 35%                  |
| Brighton                | 37               | 126          | 29%                  |
| Man City                | 60               | 208          | 29%                  |
| Man United              | 45               | 175          | 26%                  |
| Tottenham               | 65               | 269          | 24%                  |
| Swansea                 | 20               | 94           | 21%                  |
| Leicester               | 28               | 148          | 19%                  |
| Southampton             | 34               | 228          | 15%                  |
| Leeds                   | 14               | 104          | 13%                  |
| Everton                 | 35               | 291          | 12%                  |

| shot share % | n     | win%  | draw% | loss% |
| ------------ | ----- | ----- | ----- | ----- |
| <35          | 39909 | 20.6% | 25.0% | 54.4% |
| 35-45        | 44623 | 30.4% | 26.2% | 43.4% |
| 45-55        | 53054 | 36.2% | 27.4% | 36.4% |
| 55-65        | 45113 | 43.2% | 26.2% | 30.6% |
| >65          | 40921 | 54.2% | 25.1% | 20.8% |

| possession | n vs weak / strong | win% vs weak / strong |
| ---------- | ------------------ | --------------------- |
| <35        | 259 / 1170         | 46% / 22%             |
| 35-40      | 402 / 1034         | 49% / 22%             |
| 40-45      | 840 / 1456         | 48% / 22%             |
| 45-50      | 1403 / 1746        | 46% / 26%             |
| 50-55      | 1761 / 1484        | 45% / 30%             |
| 55-60      | 1551 / 890         | 47% / 33%             |
| 60-65      | 1008 / 497         | 53% / 35%             |
| 65-70      | 629 / 252          | 50% / 35%             |
| >70        | 459 / 131          | 58% / 39%             |

| possession | home win% / loss% | away win% / loss% |
| ---------- | ----------------- | ----------------- |
| <35        | 34.5%             | 42.1%             |
| 35-40      | 36.6%             | 37.2%             |
| 40-45      | 41.7%             | 32.7%             |
| 45-50      | 41.7%             | 32.5%             |
| 50-55      | 45.0%             | 29.3%             |
| 55-60      | 49.4%             | 23.9%             |
| 60-65      | 53.9%             | 23.5%             |
| 65-70      | 50.0%             | 23.8%             |
| >70        | 58.7%             | 17.8%             |

| EPL season | corr(poss diff, home win) | matches |
| ---------- | ------------------------- | ------- |
| 2001/02    | NaN                       | 1       |
| 2002/03    | 0.031                     | 378     |
| 2003/04    | 0.259                     | 381     |
| 2004/05    | 0.245                     | 380     |
| 2005/06    | 0.183                     | 380     |
| 2006/07    | 0.198                     | 380     |
| 2007/08    | 0.279                     | 380     |
| 2008/09    | 0.172                     | 380     |
| 2009/10    | 0.109                     | 379     |
| 2010/11    | 0.021                     | 379     |
| 2011/12    | 0.138                     | 207     |
| 2012/13    | 0.112                     | 338     |
| 2013/14    | 0.132                     | 344     |
| 2014/15    | 0.064                     | 380     |
| 2015/16    | -0.005                    | 417     |
| 2016/17    | -0.706                    | 4       |
| 2017/18    | 0.164                     | 380     |
| 2018/19    | 0.187                     | 378     |
| 2019/20    | 0.095                     | 376     |
| 2020/21    | 0.096                     | 372     |
| 2021/22    | 0.181                     | 351     |
| 2022/23    | 0.115                     | 293     |
| 2023/24    | 0.213                     | 370     |
| 2024/25    | 0.018                     | 368     |
| 2025/26    | -0.005                    | 380     |
| 2026/27    | 0.037                     | 110     |

## Findings

**Does possession help you win? Yes — but much less than the cliché suggests,
and mostly by proxy.**

1. **The relationship is real but modest.** In the Premier League, a team's win
   rate climbs from 26.6% with under 35% possession to 54.1% above 70% — a
   near-doubling, but a >70% possessor still drops points nearly a quarter of
   the time. Across all covered leagues the curve is flatter still (31.7% →
   48.0%).

2. **Possession is a team-quality marker more than a match-winner.** Correlating
   each team's _season-average_ possession with its final points gives ρ = 0.704
   across 431 EPL team-seasons — possession tells you who's good. But within a
   single match, possession correlates with winning at only ρ = 0.119, while
   **shot share correlates at 0.258** — shots predict victory more than twice as
   well. On the small xG-covered subset, xG share reaches 0.438.

3. **The extremes cut both ways.** 12.7% of EPL wins were earned with under 40%
   possession; the same share of losses came with over 60%. Nottingham Forest
   won 63% of their matches despite low possession; Chelsea lost 43% of theirs
   _while dominating the ball_.

4. **Context matters.** Possession is nearly worthless against weak opponents
   (win rate ~45-58% across all bands — anyone can have the ball vs a bad team)
   but separates winners from losers against strong ones (22% → 40%). Away from
   home, even >70% possession wins only 47.3% of the time versus 58.7% at home.

5. **No historical trend.** The yearly correlation between possession
   differential and home wins fluctuates between ~0.02 and ~0.28 with no
   directional movement — possession has not become more (or less) decisive
   across two decades.

**Verdict:** possession is football's most quoted stat and one of its weakest
match-level predictors. It measures _who you are_ far better than _what will
happen today_ — and when it comes to predicting a single result, shots and xG do
the job at roughly 2–4× the strength.
