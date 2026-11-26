# Do more corners actually help you win?

## Do more corners actually help you win?

The assumption: _more corners = more pressure = more likely to win._ This
notebook tests it on every match in the dataset where corner counts exist —
sourced from football-data.co.uk (back to 2000/01 for the English leagues) and
enriched by ESPN stats (`import-espn-stats.ts`) for the big European leagues and
MLS.

**Data caveats up front:**

- Corner _volume_ is well covered — ~166k matches across ~35 leagues — but
  corner _outcomes_ are not: the dataset has no event-level corner data, so
  **goals from corners and corner conversion rates cannot be measured**. Where
  relevant, set-piece-adjacent proxies are flagged.
- Corners are a match-total stat: a team chasing a game legitimately wins more
  of them. We cannot see _when_ corners happen, so "corners while losing" is
  untestable — noted where it matters.
- `expected_goals` exists only for a small StatsBomb-covered subset, so the
  "beyond xG" comparison reduces to shots.

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
    poss: f64, shots: f64, sog: f64, corners: f64,
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
    for i in 0..n {
        stat_map.insert((mid[i], tid[i]), TStat {
            poss: poss[i], shots: shots[i], sog: sog[i], corners: cor[i],
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
    hp: f64, ap: f64, hs: f64, as_: f64,
    hc: f64, ac: f64, hso: f64, aso: f64,
}

fn valid_corners(c: f64) -> bool { !c.is_nan() && c >= 0.0 }

let mut rows: Vec<MRow> = Vec::new();
let mut n_both = 0usize;
for i in 0..mf.height() {
    if s_hg[i] < 0 || s_ag[i] < 0 { continue; }
    let h = stat_map.get(&(s_id[i], s_hid[i]));
    let a = stat_map.get(&(s_id[i], s_aid[i]));
    let (Some(hs_), Some(as_)) = (h, a) else { continue; };
    // corners are real counts (0 is legitimate); only NaN/missing excluded
    if !(valid_corners(hs_.corners) && valid_corners(as_.corners)) { continue; }
    n_both += 1;
    rows.push(MRow {
        league: s_league[i].clone(), season: s_season[i].clone(),
        date: s_date[i][..10].to_string(),
        home: s_home[i].clone(), away: s_away[i].clone(),
        hid: s_hid[i], aid: s_aid[i], hg: s_hg[i], ag: s_ag[i],
        hp: hs_.poss, ap: as_.poss,
        hs: hs_.shots, as_: as_.shots,
        hc: hs_.corners, ac: as_.corners,
        hso: hs_.sog, aso: as_.sog,
    });
}
rows.sort_by(|a, b| a.date.cmp(&b.date));
println!("matches with corner data (both teams): {}", n_both);

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
println!("EPL matches with corners: {} | all leagues: {}", epl.len(), rows.len());
```

```text
stat rows indexed: 374660
matches with corner data (both teams): 166028
EPL matches with corners: 10032 | all leagues: 166028
```

| league                 | matches | season span       |
| ---------------------- | ------- | ----------------- |
| English Championship   | 14543   | 2000/01 → 2026/27 |
| English League Two     | 14424   | 2000/01 → 2026/27 |
| English League One     | 14374   | 2000/01 → 2026/27 |
| English Premier League | 10032   | 2000/01 → 2026/27 |
| Spanish La Liga        | 8438    | 2004/05 → 2026/27 |
| Italian Serie A        | 8086    | 2005/06 → 2026/27 |
| French Ligue 1         | 7790    | 2005/06 → 2026/27 |
| German Bundesliga      | 7750    | 2000/01 → 2026/27 |
| Spanish La Liga 2      | 6527    | 2008/09 → 2026/27 |
| MLS                    | 6264    | 2012 → 2026       |
| Scottish Premiership   | 5958    | 2000/01 → 2026/27 |
| French Ligue 2         | 5347    | 2008/09 → 2026/27 |
| Italian Serie B        | 5214    | 2008/09 → 2026/27 |
| Dutch Eredivisie       | 4798    | 2008/09 → 2026/27 |
| German 2. Bundesliga   | 4661    | 2000/01 → 2026/27 |

## Coverage

Corners exist for both football-data leagues (English pyramid back to 2000/01)
and ESPN-covered leagues (~2004 onward). The Premier League is the primary lens;
every covered league is pooled as a robustness check. Only matches where
**both** teams have a recorded corner count are used — a genuine 0–0 corner
count is rare but possible and is kept.

```rust
// EPL coverage by season
let mut by_season: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
for r in &epl { *by_season.entry(r.season.clone()).or_insert(0) += 1; }
let rows_s: Vec<Vec<String>> = by_season.iter().map(|(s, n)| vec![s.clone(), n.to_string()]).collect();
mars_table(&["EPL season", "matches with corners"], &rows_s);
```

```text
stat rows indexed: 374660
matches with corner data (both teams): 166028
EPL matches with corners: 10032 | all leagues: 166028
```

| league                 | matches | season span       |
| ---------------------- | ------- | ----------------- |
| English Championship   | 14543   | 2000/01 → 2026/27 |
| English League Two     | 14424   | 2000/01 → 2026/27 |
| English League One     | 14374   | 2000/01 → 2026/27 |
| English Premier League | 10032   | 2000/01 → 2026/27 |
| Spanish La Liga        | 8438    | 2004/05 → 2026/27 |
| Italian Serie A        | 8086    | 2005/06 → 2026/27 |
| French Ligue 1         | 7790    | 2005/06 → 2026/27 |
| German Bundesliga      | 7750    | 2000/01 → 2026/27 |
| Spanish La Liga 2      | 6527    | 2008/09 → 2026/27 |
| MLS                    | 6264    | 2012 → 2026       |
| Scottish Premiership   | 5958    | 2000/01 → 2026/27 |
| French Ligue 2         | 5347    | 2008/09 → 2026/27 |
| Italian Serie B        | 5214    | 2008/09 → 2026/27 |
| Dutch Eredivisie       | 4798    | 2008/09 → 2026/27 |
| German 2. Bundesliga   | 4661    | 2000/01 → 2026/27 |

| EPL season | matches with corners |
| ---------- | -------------------- |
| 2000/01    | 380                  |
| 2001/02    | 380                  |
| 2002/03    | 380                  |
| 2003/04    | 383                  |
| 2004/05    | 380                  |
| 2005/06    | 380                  |
| 2006/07    | 380                  |
| 2007/08    | 380                  |
| 2008/09    | 380                  |
| 2009/10    | 380                  |
| 2010/11    | 380                  |
| 2011/12    | 380                  |
| 2012/13    | 380                  |
| 2013/14    | 380                  |
| 2014/15    | 380                  |
| 2015/16    | 419                  |
| 2016/17    | 380                  |
| 2017/18    | 380                  |
| 2018/19    | 380                  |
| 2019/20    | 380                  |
| 2020/21    | 380                  |
| 2021/22    | 380                  |
| 2022/23    | 380                  |
| 2023/24    | 380                  |
| 2024/25    | 380                  |
| 2025/26    | 380                  |
| 2026/27    | 110                  |

## The band test: does winning more corners mean more wins?

Raw corner counts aren't comparable across matches — a 0–0 corner-fest and a
14–12 shootout are different sports. The fair unit is **corner share**: the
team's corners as a percentage of the match total. Bands are the
team-perspective share, pooled across both teams per match.

```rust
// corner-share bands -> W/D/L, pooled team-perspective
let bands = [0.0, 35.0, 45.0, 55.0, 65.0, 100.0];
let blabels = ["<35", "35-45", "45-55", "55-65", ">65"];

let band_table = |matches: &[&MRow]| -> Vec<Vec<String>> {
    let mut w = vec![0usize; 5]; let mut d = vec![0usize; 5]; let mut l = vec![0usize; 5];
    for r in matches {
        let tot = r.hc + r.ac;
        if tot <= 0.0 { continue; }
        for (c, gf, ga) in [(r.hc, r.hg, r.ag), (r.ac, r.ag, r.hg)] {
            let share = 100.0 * c / tot;
            let b = bands.iter().position(|&hi| share < hi).unwrap_or(5) - 1;
            if gf > ga { w[b] += 1; } else if gf == ga { d[b] += 1; } else { l[b] += 1; }
        }
    }
    (0..5).map(|b| {
        let n = (w[b] + d[b] + l[b]) as f64;
        vec![blabels[b].to_string(), (w[b]+d[b]+l[b]).to_string(),
             format!("{:.1}%", 100.0*w[b] as f64/n),
             format!("{:.1}%", 100.0*d[b] as f64/n),
             format!("{:.1}%", 100.0*l[b] as f64/n)]
    }).collect()
};

let epl_refs: Vec<&MRow> = epl.iter().cloned().collect();
let epl_bands = band_table(&epl_refs);
mars_table(&["corner share %", "n", "win%", "draw%", "loss%"], &epl_bands);

let all_refs: Vec<&MRow> = rows.iter().collect();
let all_bands = band_table(&all_refs);
mars_table(&["corner share % — all leagues", "n", "win%", "draw%", "loss%"], &all_bands);

// raw count bands: does 10+ corners specifically help?
let cbands = [0.0, 3.0, 5.0, 7.0, 10.0, 100.0];
let clabels = ["0-2", "3-4", "5-6", "7-9", "10+"];
let count_table = |matches: &[&MRow]| -> Vec<Vec<String>> {
    let mut w = vec![0usize; 5]; let mut d = vec![0usize; 5]; let mut l = vec![0usize; 5];
    for r in matches {
        for (c, gf, ga) in [(r.hc, r.hg, r.ag), (r.ac, r.ag, r.hg)] {
            let b = cbands.iter().position(|&hi| c < hi).unwrap_or(5) - 1;
            if gf > ga { w[b] += 1; } else if gf == ga { d[b] += 1; } else { l[b] += 1; }
        }
    }
    (0..5).map(|b| {
        let n = (w[b] + d[b] + l[b]) as f64;
        vec![clabels[b].to_string(), (w[b]+d[b]+l[b]).to_string(),
             format!("{:.1}%", 100.0*w[b] as f64/n),
             format!("{:.1}%", 100.0*d[b] as f64/n),
             format!("{:.1}%", 100.0*l[b] as f64/n)]
    }).collect()
};
let epl_counts = count_table(&epl_refs);
mars_table(&["corners won (EPL)", "n", "win%", "draw%", "loss%"], &epl_counts);
let all_counts = count_table(&all_refs);
mars_table(&["corners won — all leagues", "n", "win%", "draw%", "loss%"], &all_counts);
```

```text
stat rows indexed: 374660
matches with corner data (both teams): 166028
EPL matches with corners: 10032 | all leagues: 166028
```

| league                 | matches | season span       |
| ---------------------- | ------- | ----------------- |
| English Championship   | 14543   | 2000/01 → 2026/27 |
| English League Two     | 14424   | 2000/01 → 2026/27 |
| English League One     | 14374   | 2000/01 → 2026/27 |
| English Premier League | 10032   | 2000/01 → 2026/27 |
| Spanish La Liga        | 8438    | 2004/05 → 2026/27 |
| Italian Serie A        | 8086    | 2005/06 → 2026/27 |
| French Ligue 1         | 7790    | 2005/06 → 2026/27 |
| German Bundesliga      | 7750    | 2000/01 → 2026/27 |
| Spanish La Liga 2      | 6527    | 2008/09 → 2026/27 |
| MLS                    | 6264    | 2012 → 2026       |
| Scottish Premiership   | 5958    | 2000/01 → 2026/27 |
| French Ligue 2         | 5347    | 2008/09 → 2026/27 |
| Italian Serie B        | 5214    | 2008/09 → 2026/27 |
| Dutch Eredivisie       | 4798    | 2008/09 → 2026/27 |
| German 2. Bundesliga   | 4661    | 2000/01 → 2026/27 |

| EPL season | matches with corners |
| ---------- | -------------------- |
| 2000/01    | 380                  |
| 2001/02    | 380                  |
| 2002/03    | 380                  |
| 2003/04    | 383                  |
| 2004/05    | 380                  |
| 2005/06    | 380                  |
| 2006/07    | 380                  |
| 2007/08    | 380                  |
| 2008/09    | 380                  |
| 2009/10    | 380                  |
| 2010/11    | 380                  |
| 2011/12    | 380                  |
| 2012/13    | 380                  |
| 2013/14    | 380                  |
| 2014/15    | 380                  |
| 2015/16    | 419                  |
| 2016/17    | 380                  |
| 2017/18    | 380                  |
| 2018/19    | 380                  |
| 2019/20    | 380                  |
| 2020/21    | 380                  |
| 2021/22    | 380                  |
| 2022/23    | 380                  |
| 2023/24    | 380                  |
| 2024/25    | 380                  |
| 2025/26    | 380                  |
| 2026/27    | 110                  |

| corner share % | n    | win%  | draw% | loss% |
| -------------- | ---- | ----- | ----- | ----- |
| <35            | 5281 | 31.5% | 25.0% | 43.5% |
| 35-45          | 3071 | 36.8% | 24.8% | 38.4% |
| 45-55          | 3351 | 37.8% | 24.5% | 37.7% |
| 55-65          | 3070 | 38.2% | 24.9% | 36.9% |
| >65            | 5289 | 43.5% | 25.0% | 31.5% |

| corner share % — all leagues | n     | win%  | draw% | loss% |
| ---------------------------- | ----- | ----- | ----- | ----- |
| <35                          | 77963 | 35.5% | 26.3% | 38.2% |
| 35-45                        | 46418 | 36.8% | 26.4% | 36.8% |
| 45-55                        | 48749 | 37.0% | 26.0% | 37.0% |
| 55-65                        | 46435 | 36.8% | 26.3% | 36.8% |
| >65                          | 78059 | 38.2% | 26.3% | 35.5% |

| corners won (EPL) | n    | win%  | draw% | loss% |
| ----------------- | ---- | ----- | ----- | ----- |
| 0-2               | 3462 | 32.2% | 24.7% | 43.2% |
| 3-4               | 5286 | 36.0% | 24.8% | 39.2% |
| 5-6               | 4982 | 38.0% | 24.2% | 37.8% |
| 7-9               | 4419 | 41.1% | 25.1% | 33.7% |
| 10+               | 1915 | 42.3% | 26.6% | 31.0% |

| corners won — all leagues | n     | win%  | draw% | loss% |
| ------------------------- | ----- | ----- | ----- | ----- |
| 0-2                       | 88929 | 37.1% | 23.6% | 39.3% |
| 3-4                       | 84318 | 37.3% | 25.7% | 37.0% |
| 5-6                       | 76410 | 37.3% | 26.1% | 36.6% |
| 7-9                       | 60351 | 37.4% | 26.9% | 35.7% |
| 10+                       | 22048 | 36.1% | 28.5% | 35.4% |

## Is the relationship linear — or is there a sweet spot?

Bin matches by **corner differential** (home corners minus away corners) and
look at the home win rate. If corners drive results the curve should climb
steadily; a plateau or dip at the extreme would mean corner dominance stops
paying (or turns into sterile possession).

```rust
// home win% by corner differential (bins of 2)
let mut bins: Vec<(i64, usize, usize)> = Vec::new();
for k in -8i64..=8 {
    let lo = k as f64 * 2.0;
    let hi = lo + 2.0;
    let (mut hw, mut n) = (0usize, 0usize);
    for r in &epl {
        let d = r.hc - r.ac;
        if d >= lo && d < hi {
            n += 1;
            if r.hg > r.ag { hw += 1; }
        }
    }
    bins.push((k, hw, n));
}
let d_rows: Vec<Vec<String>> = bins.iter().map(|(k, hw, n)| vec![
    format!("{:+.0} to {:+.0}", *k as f64 * 2.0, *k as f64 * 2.0 + 2.0),
    n.to_string(),
    format!("{:.1}%", if *n > 0 { 100.0 * *hw as f64 / *n as f64 } else { 0.0 }),
]).collect();
mars_table(&["corner diff (home − away)", "matches", "home win%"], &d_rows);

// same for all leagues, wider bins of 4
let mut bins2: Vec<(i64, usize, usize)> = Vec::new();
for k in -5i64..=5 {
    let lo = k as f64 * 4.0;
    let hi = lo + 4.0;
    let (mut hw, mut n) = (0usize, 0usize);
    for r in &rows {
        let d = r.hc - r.ac;
        if d >= lo && d < hi {
            n += 1;
            if r.hg > r.ag { hw += 1; }
        }
    }
    bins2.push((k, hw, n));
}
let d_rows2: Vec<Vec<String>> = bins2.iter().map(|(k, hw, n)| vec![
    format!("{:+.0} to {:+.0}", *k as f64 * 4.0, *k as f64 * 4.0 + 4.0),
    n.to_string(),
    format!("{:.1}%", if *n > 0 { 100.0 * *hw as f64 / *n as f64 } else { 0.0 }),
]).collect();
mars_table(&["corner diff — all leagues", "matches", "home win%"], &d_rows2);
```

```text
stat rows indexed: 374660
matches with corner data (both teams): 166028
EPL matches with corners: 10032 | all leagues: 166028
```

| league                 | matches | season span       |
| ---------------------- | ------- | ----------------- |
| English Championship   | 14543   | 2000/01 → 2026/27 |
| English League Two     | 14424   | 2000/01 → 2026/27 |
| English League One     | 14374   | 2000/01 → 2026/27 |
| English Premier League | 10032   | 2000/01 → 2026/27 |
| Spanish La Liga        | 8438    | 2004/05 → 2026/27 |
| Italian Serie A        | 8086    | 2005/06 → 2026/27 |
| French Ligue 1         | 7790    | 2005/06 → 2026/27 |
| German Bundesliga      | 7750    | 2000/01 → 2026/27 |
| Spanish La Liga 2      | 6527    | 2008/09 → 2026/27 |
| MLS                    | 6264    | 2012 → 2026       |
| Scottish Premiership   | 5958    | 2000/01 → 2026/27 |
| French Ligue 2         | 5347    | 2008/09 → 2026/27 |
| Italian Serie B        | 5214    | 2008/09 → 2026/27 |
| Dutch Eredivisie       | 4798    | 2008/09 → 2026/27 |
| German 2. Bundesliga   | 4661    | 2000/01 → 2026/27 |

| EPL season | matches with corners |
| ---------- | -------------------- |
| 2000/01    | 380                  |
| 2001/02    | 380                  |
| 2002/03    | 380                  |
| 2003/04    | 383                  |
| 2004/05    | 380                  |
| 2005/06    | 380                  |
| 2006/07    | 380                  |
| 2007/08    | 380                  |
| 2008/09    | 380                  |
| 2009/10    | 380                  |
| 2010/11    | 380                  |
| 2011/12    | 380                  |
| 2012/13    | 380                  |
| 2013/14    | 380                  |
| 2014/15    | 380                  |
| 2015/16    | 419                  |
| 2016/17    | 380                  |
| 2017/18    | 380                  |
| 2018/19    | 380                  |
| 2019/20    | 380                  |
| 2020/21    | 380                  |
| 2021/22    | 380                  |
| 2022/23    | 380                  |
| 2023/24    | 380                  |
| 2024/25    | 380                  |
| 2025/26    | 380                  |
| 2026/27    | 110                  |

| corner share % | n    | win%  | draw% | loss% |
| -------------- | ---- | ----- | ----- | ----- |
| <35            | 5281 | 31.5% | 25.0% | 43.5% |
| 35-45          | 3071 | 36.8% | 24.8% | 38.4% |
| 45-55          | 3351 | 37.8% | 24.5% | 37.7% |
| 55-65          | 3070 | 38.2% | 24.9% | 36.9% |
| >65            | 5289 | 43.5% | 25.0% | 31.5% |

| corner share % — all leagues | n     | win%  | draw% | loss% |
| ---------------------------- | ----- | ----- | ----- | ----- |
| <35                          | 77963 | 35.5% | 26.3% | 38.2% |
| 35-45                        | 46418 | 36.8% | 26.4% | 36.8% |
| 45-55                        | 48749 | 37.0% | 26.0% | 37.0% |
| 55-65                        | 46435 | 36.8% | 26.3% | 36.8% |
| >65                          | 78059 | 38.2% | 26.3% | 35.5% |

| corners won (EPL) | n    | win%  | draw% | loss% |
| ----------------- | ---- | ----- | ----- | ----- |
| 0-2               | 3462 | 32.2% | 24.7% | 43.2% |
| 3-4               | 5286 | 36.0% | 24.8% | 39.2% |
| 5-6               | 4982 | 38.0% | 24.2% | 37.8% |
| 7-9               | 4419 | 41.1% | 25.1% | 33.7% |
| 10+               | 1915 | 42.3% | 26.6% | 31.0% |

| corners won — all leagues | n     | win%  | draw% | loss% |
| ------------------------- | ----- | ----- | ----- | ----- |
| 0-2                       | 88929 | 37.1% | 23.6% | 39.3% |
| 3-4                       | 84318 | 37.3% | 25.7% | 37.0% |
| 5-6                       | 76410 | 37.3% | 26.1% | 36.6% |
| 7-9                       | 60351 | 37.4% | 26.9% | 35.7% |
| 10+                       | 22048 | 36.1% | 28.5% | 35.4% |

| corner diff (home − away) | matches | home win% |
| ------------------------- | ------- | --------- |
| -16 to -14                | 6       | 16.7%     |
| -14 to -12                | 22      | 36.4%     |
| -12 to -10                | 53      | 50.9%     |
| -10 to -8                 | 159     | 49.7%     |
| -8 to -6                  | 322     | 37.3%     |
| -6 to -4                  | 589     | 40.9%     |
| -4 to -2                  | 1010    | 45.0%     |
| -2 to +0                  | 1438    | 43.1%     |
| +0 to +2                  | 1810    | 44.3%     |
| +2 to +4                  | 1649    | 46.1%     |
| +4 to +6                  | 1272    | 50.2%     |
| +6 to +8                  | 862     | 49.3%     |
| +8 to +10                 | 461     | 49.9%     |
| +10 to +12                | 211     | 45.5%     |
| +12 to +14                | 116     | 38.8%     |
| +14 to +16                | 36      | 52.8%     |
| +16 to +18                | 9       | 55.6%     |

| corner diff — all leagues | matches | home win% |
| ------------------------- | ------- | --------- |
| -20 to -16                | 23      | 34.8%     |
| -16 to -12                | 228     | 44.3%     |
| -12 to -8                 | 2115    | 46.6%     |
| -8 to -4                  | 12634   | 45.3%     |
| -4 to +0                  | 39147   | 45.7%     |
| +0 to +4                  | 71312   | 45.6%     |
| +4 to +8                  | 30686   | 43.2%     |
| +8 to +12                 | 8330    | 40.8%     |
| +12 to +16                | 1389    | 38.9%     |
| +16 to +20                | 147     | 44.9%     |
| +20 to +24                | 13      | 46.2%     |

## Quantity vs quality: is corner share just a proxy?

Corners correlate with shots, which correlate with goals — so corner share may
predict wins only because it tracks general attacking pressure. Compare how well
**corner share, shot share and possession share** each predict the home win, on
identical matches. Shots-on-target is included as the quality-weighted attacking
measure.

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

// correlations, EPL and all leagues
let mut xs_c = Vec::new(); let mut xs_s = Vec::new(); let mut xs_p = Vec::new(); let mut ys = Vec::new();
let mut xs_ce = Vec::new(); let mut xs_se = Vec::new(); let mut xs_pe = Vec::new(); let mut ys_e = Vec::new();
for r in &epl {
    let tot_c = r.hc + r.ac;
    if tot_c <= 0.0 { continue; }
    let hw = if r.hg > r.ag { 1.0 } else { 0.0 };
    xs_ce.push(100.0 * r.hc / tot_c); ys_e.push(hw);
    let tot_s = r.hs + r.as_;
    if !tot_s.is_nan() && tot_s > 0.0 {
        xs_se.push(100.0 * r.hs / tot_s);
        if r.hp > 0.0 && r.hp < 100.0 { xs_pe.push(r.hp); }
    }
}
// align EPL vectors: rebuild cleanly to keep equal lengths
xs_ce.clear(); xs_se.clear(); xs_pe.clear(); ys_e.clear();
for r in &epl {
    let tot_c = r.hc + r.ac;
    let tot_s = r.hs + r.as_;
    if tot_c <= 0.0 || tot_s.is_nan() || tot_s <= 0.0 { continue; }
    if !(r.hp > 0.0 && r.hp < 100.0) { continue; }
    ys_e.push(if r.hg > r.ag { 1.0 } else { 0.0 });
    xs_ce.push(100.0 * r.hc / tot_c);
    xs_se.push(100.0 * r.hs / tot_s);
    xs_pe.push(r.hp);
}
println!("EPL ({} matches): corr(home corner share, home win) = {:.3}", ys_e.len(), pearson(&xs_ce, &ys_e));
println!("EPL: corr(home shot share,   home win) = {:.3}", pearson(&xs_se, &ys_e));
println!("EPL: corr(home possession,   home win) = {:.3}", pearson(&xs_pe, &ys_e));

for r in &rows {
    let tot_c = r.hc + r.ac;
    let tot_s = r.hs + r.as_;
    if tot_c <= 0.0 || tot_s.is_nan() || tot_s <= 0.0 { continue; }
    if !(r.hp > 0.0 && r.hp < 100.0) { continue; }
    ys.push(if r.hg > r.ag { 1.0 } else { 0.0 });
    xs_c.push(100.0 * r.hc / tot_c);
    xs_s.push(100.0 * r.hs / tot_s);
    xs_p.push(r.hp);
}
println!("ALL ({} matches): corr(corner share)={:.3} corr(shot share)={:.3} corr(possession)={:.3}",
    ys.len(), pearson(&xs_c, &ys), pearson(&xs_s, &ys), pearson(&xs_p, &ys));

// shots-on-target share, EPL only (quality-weighted attacking measure)
let mut xs_o = Vec::new(); let mut ys_o = Vec::new();
for r in &epl {
    let tot_o = r.hso + r.aso;
    if tot_o.is_nan() || tot_o <= 0.0 { continue; }
    ys_o.push(if r.hg > r.ag { 1.0 } else { 0.0 });
    xs_o.push(100.0 * r.hso / tot_o);
}
println!("EPL SOG-share subset ({} matches): corr(shots on target share, home win) = {:.3}",
    ys_o.len(), pearson(&xs_o, &ys_o));
```

```text
stat rows indexed: 374660
matches with corner data (both teams): 166028
EPL matches with corners: 10032 | all leagues: 166028
EPL (8496 matches): corr(home corner share, home win) = 0.050
EPL: corr(home shot share,   home win) = 0.259
EPL: corr(home possession,   home win) = 0.120
ALL (111164 matches): corr(corner share)=-0.012 corr(shot share)=0.195 corr(possession)=0.016
EPL SOG-share subset (10032 matches): corr(shots on target share, home win) = 0.400
```

| league                 | matches | season span       |
| ---------------------- | ------- | ----------------- |
| English Championship   | 14543   | 2000/01 → 2026/27 |
| English League Two     | 14424   | 2000/01 → 2026/27 |
| English League One     | 14374   | 2000/01 → 2026/27 |
| English Premier League | 10032   | 2000/01 → 2026/27 |
| Spanish La Liga        | 8438    | 2004/05 → 2026/27 |
| Italian Serie A        | 8086    | 2005/06 → 2026/27 |
| French Ligue 1         | 7790    | 2005/06 → 2026/27 |
| German Bundesliga      | 7750    | 2000/01 → 2026/27 |
| Spanish La Liga 2      | 6527    | 2008/09 → 2026/27 |
| MLS                    | 6264    | 2012 → 2026       |
| Scottish Premiership   | 5958    | 2000/01 → 2026/27 |
| French Ligue 2         | 5347    | 2008/09 → 2026/27 |
| Italian Serie B        | 5214    | 2008/09 → 2026/27 |
| Dutch Eredivisie       | 4798    | 2008/09 → 2026/27 |
| German 2. Bundesliga   | 4661    | 2000/01 → 2026/27 |

| EPL season | matches with corners |
| ---------- | -------------------- |
| 2000/01    | 380                  |
| 2001/02    | 380                  |
| 2002/03    | 380                  |
| 2003/04    | 383                  |
| 2004/05    | 380                  |
| 2005/06    | 380                  |
| 2006/07    | 380                  |
| 2007/08    | 380                  |
| 2008/09    | 380                  |
| 2009/10    | 380                  |
| 2010/11    | 380                  |
| 2011/12    | 380                  |
| 2012/13    | 380                  |
| 2013/14    | 380                  |
| 2014/15    | 380                  |
| 2015/16    | 419                  |
| 2016/17    | 380                  |
| 2017/18    | 380                  |
| 2018/19    | 380                  |
| 2019/20    | 380                  |
| 2020/21    | 380                  |
| 2021/22    | 380                  |
| 2022/23    | 380                  |
| 2023/24    | 380                  |
| 2024/25    | 380                  |
| 2025/26    | 380                  |
| 2026/27    | 110                  |

| corner share % | n    | win%  | draw% | loss% |
| -------------- | ---- | ----- | ----- | ----- |
| <35            | 5281 | 31.5% | 25.0% | 43.5% |
| 35-45          | 3071 | 36.8% | 24.8% | 38.4% |
| 45-55          | 3351 | 37.8% | 24.5% | 37.7% |
| 55-65          | 3070 | 38.2% | 24.9% | 36.9% |
| >65            | 5289 | 43.5% | 25.0% | 31.5% |

| corner share % — all leagues | n     | win%  | draw% | loss% |
| ---------------------------- | ----- | ----- | ----- | ----- |
| <35                          | 77963 | 35.5% | 26.3% | 38.2% |
| 35-45                        | 46418 | 36.8% | 26.4% | 36.8% |
| 45-55                        | 48749 | 37.0% | 26.0% | 37.0% |
| 55-65                        | 46435 | 36.8% | 26.3% | 36.8% |
| >65                          | 78059 | 38.2% | 26.3% | 35.5% |

| corners won (EPL) | n    | win%  | draw% | loss% |
| ----------------- | ---- | ----- | ----- | ----- |
| 0-2               | 3462 | 32.2% | 24.7% | 43.2% |
| 3-4               | 5286 | 36.0% | 24.8% | 39.2% |
| 5-6               | 4982 | 38.0% | 24.2% | 37.8% |
| 7-9               | 4419 | 41.1% | 25.1% | 33.7% |
| 10+               | 1915 | 42.3% | 26.6% | 31.0% |

| corners won — all leagues | n     | win%  | draw% | loss% |
| ------------------------- | ----- | ----- | ----- | ----- |
| 0-2                       | 88929 | 37.1% | 23.6% | 39.3% |
| 3-4                       | 84318 | 37.3% | 25.7% | 37.0% |
| 5-6                       | 76410 | 37.3% | 26.1% | 36.6% |
| 7-9                       | 60351 | 37.4% | 26.9% | 35.7% |
| 10+                       | 22048 | 36.1% | 28.5% | 35.4% |

| corner diff (home − away) | matches | home win% |
| ------------------------- | ------- | --------- |
| -16 to -14                | 6       | 16.7%     |
| -14 to -12                | 22      | 36.4%     |
| -12 to -10                | 53      | 50.9%     |
| -10 to -8                 | 159     | 49.7%     |
| -8 to -6                  | 322     | 37.3%     |
| -6 to -4                  | 589     | 40.9%     |
| -4 to -2                  | 1010    | 45.0%     |
| -2 to +0                  | 1438    | 43.1%     |
| +0 to +2                  | 1810    | 44.3%     |
| +2 to +4                  | 1649    | 46.1%     |
| +4 to +6                  | 1272    | 50.2%     |
| +6 to +8                  | 862     | 49.3%     |
| +8 to +10                 | 461     | 49.9%     |
| +10 to +12                | 211     | 45.5%     |
| +12 to +14                | 116     | 38.8%     |
| +14 to +16                | 36      | 52.8%     |
| +16 to +18                | 9       | 55.6%     |

| corner diff — all leagues | matches | home win% |
| ------------------------- | ------- | --------- |
| -20 to -16                | 23      | 34.8%     |
| -16 to -12                | 228     | 44.3%     |
| -12 to -8                 | 2115    | 46.6%     |
| -8 to -4                  | 12634   | 45.3%     |
| -4 to +0                  | 39147   | 45.7%     |
| +0 to +4                  | 71312   | 45.6%     |
| +4 to +8                  | 30686   | 43.2%     |
| +8 to +12                 | 8330    | 40.8%     |
| +12 to +16                | 1389    | 38.9%     |
| +16 to +20                | 147     | 44.9%     |
| +20 to +24                | 13      | 46.2%     |

## The paradox cases: corner dominance without victory

Two failure modes worth counting: teams that **win despite a low corner share**
(<35%) and teams that **lose despite a high corner share** (>65%). If corner
dominance were destiny both would be rare. The team tables show who lives in
each tail.

```rust
// team-perspective: wins with <35% corner share, losses with >65%
#[derive(Default)]
struct Tally { low_w: usize, tot_w: usize, high_l: usize, tot_l: usize }
let mut tally: HashMap<(String, String, String), Tally> = HashMap::new(); // (league, season, team)
for r in &rows {
    let tot = r.hc + r.ac;
    if tot <= 0.0 { continue; }
    for (c, team, gf, ga) in [(r.hc, &r.home, r.hg, r.ag), (r.ac, &r.away, r.ag, r.hg)] {
        let share = 100.0 * c / tot;
        let key = (r.league.clone(), r.season.clone(), team.clone());
        let t = tally.entry(key).or_default();
        if gf > ga {
            t.tot_w += 1;
            if share < 35.0 { t.low_w += 1; }
        } else if gf < ga {
            t.tot_l += 1;
            if share > 65.0 { t.high_l += 1; }
        }
    }
}

let mut epl_low_w = 0usize; let mut epl_w = 0usize;
let mut epl_high_l = 0usize; let mut epl_l = 0usize;
for ((lg, _, _), t) in &tally {
    if lg != "English Premier League" { continue; }
    epl_low_w += t.low_w; epl_w += t.tot_w;
    epl_high_l += t.high_l; epl_l += t.tot_l;
}
println!("EPL team-matches: wins {} | wins with <35%% corner share: {} ({:.1}%% of wins)",
    epl_w, epl_low_w, 100.0 * epl_low_w as f64 / epl_w.max(1) as f64);
println!("EPL losses {} | losses with >65%% corner share: {} ({:.1}%% of losses)",
    epl_l, epl_high_l, 100.0 * epl_high_l as f64 / epl_l.max(1) as f64);

// aggregate per team across all EPL seasons
let mut team_tot: HashMap<String, (usize, usize, usize, usize)> = HashMap::new();
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
mars_table(&["team (EPL, all seasons)", "wins <35% share", "total wins", "low-share win share"], &top_rows);

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
mars_table(&["team (EPL, all seasons)", "losses >65% share", "total losses", "high-share loss share"], &top_l);
```

```text
stat rows indexed: 374660
matches with corner data (both teams): 166028
EPL matches with corners: 10032 | all leagues: 166028
EPL (8496 matches): corr(home corner share, home win) = 0.050
EPL: corr(home shot share,   home win) = 0.259
EPL: corr(home possession,   home win) = 0.120
ALL (111164 matches): corr(corner share)=-0.012 corr(shot share)=0.195 corr(possession)=0.016
EPL SOG-share subset (10032 matches): corr(shots on target share, home win) = 0.400
EPL team-matches: wins 7536 | wins with <35%% corner share: 1664 (22.1%% of wins)
EPL losses 7536 | losses with >65%% corner share: 1664 (22.1%% of losses)
```

| league                 | matches | season span       |
| ---------------------- | ------- | ----------------- |
| English Championship   | 14543   | 2000/01 → 2026/27 |
| English League Two     | 14424   | 2000/01 → 2026/27 |
| English League One     | 14374   | 2000/01 → 2026/27 |
| English Premier League | 10032   | 2000/01 → 2026/27 |
| Spanish La Liga        | 8438    | 2004/05 → 2026/27 |
| Italian Serie A        | 8086    | 2005/06 → 2026/27 |
| French Ligue 1         | 7790    | 2005/06 → 2026/27 |
| German Bundesliga      | 7750    | 2000/01 → 2026/27 |
| Spanish La Liga 2      | 6527    | 2008/09 → 2026/27 |
| MLS                    | 6264    | 2012 → 2026       |
| Scottish Premiership   | 5958    | 2000/01 → 2026/27 |
| French Ligue 2         | 5347    | 2008/09 → 2026/27 |
| Italian Serie B        | 5214    | 2008/09 → 2026/27 |
| Dutch Eredivisie       | 4798    | 2008/09 → 2026/27 |
| German 2. Bundesliga   | 4661    | 2000/01 → 2026/27 |

| EPL season | matches with corners |
| ---------- | -------------------- |
| 2000/01    | 380                  |
| 2001/02    | 380                  |
| 2002/03    | 380                  |
| 2003/04    | 383                  |
| 2004/05    | 380                  |
| 2005/06    | 380                  |
| 2006/07    | 380                  |
| 2007/08    | 380                  |
| 2008/09    | 380                  |
| 2009/10    | 380                  |
| 2010/11    | 380                  |
| 2011/12    | 380                  |
| 2012/13    | 380                  |
| 2013/14    | 380                  |
| 2014/15    | 380                  |
| 2015/16    | 419                  |
| 2016/17    | 380                  |
| 2017/18    | 380                  |
| 2018/19    | 380                  |
| 2019/20    | 380                  |
| 2020/21    | 380                  |
| 2021/22    | 380                  |
| 2022/23    | 380                  |
| 2023/24    | 380                  |
| 2024/25    | 380                  |
| 2025/26    | 380                  |
| 2026/27    | 110                  |

| corner share % | n    | win%  | draw% | loss% |
| -------------- | ---- | ----- | ----- | ----- |
| <35            | 5281 | 31.5% | 25.0% | 43.5% |
| 35-45          | 3071 | 36.8% | 24.8% | 38.4% |
| 45-55          | 3351 | 37.8% | 24.5% | 37.7% |
| 55-65          | 3070 | 38.2% | 24.9% | 36.9% |
| >65            | 5289 | 43.5% | 25.0% | 31.5% |

| corner share % — all leagues | n     | win%  | draw% | loss% |
| ---------------------------- | ----- | ----- | ----- | ----- |
| <35                          | 77963 | 35.5% | 26.3% | 38.2% |
| 35-45                        | 46418 | 36.8% | 26.4% | 36.8% |
| 45-55                        | 48749 | 37.0% | 26.0% | 37.0% |
| 55-65                        | 46435 | 36.8% | 26.3% | 36.8% |
| >65                          | 78059 | 38.2% | 26.3% | 35.5% |

| corners won (EPL) | n    | win%  | draw% | loss% |
| ----------------- | ---- | ----- | ----- | ----- |
| 0-2               | 3462 | 32.2% | 24.7% | 43.2% |
| 3-4               | 5286 | 36.0% | 24.8% | 39.2% |
| 5-6               | 4982 | 38.0% | 24.2% | 37.8% |
| 7-9               | 4419 | 41.1% | 25.1% | 33.7% |
| 10+               | 1915 | 42.3% | 26.6% | 31.0% |

| corners won — all leagues | n     | win%  | draw% | loss% |
| ------------------------- | ----- | ----- | ----- | ----- |
| 0-2                       | 88929 | 37.1% | 23.6% | 39.3% |
| 3-4                       | 84318 | 37.3% | 25.7% | 37.0% |
| 5-6                       | 76410 | 37.3% | 26.1% | 36.6% |
| 7-9                       | 60351 | 37.4% | 26.9% | 35.7% |
| 10+                       | 22048 | 36.1% | 28.5% | 35.4% |

| corner diff (home − away) | matches | home win% |
| ------------------------- | ------- | --------- |
| -16 to -14                | 6       | 16.7%     |
| -14 to -12                | 22      | 36.4%     |
| -12 to -10                | 53      | 50.9%     |
| -10 to -8                 | 159     | 49.7%     |
| -8 to -6                  | 322     | 37.3%     |
| -6 to -4                  | 589     | 40.9%     |
| -4 to -2                  | 1010    | 45.0%     |
| -2 to +0                  | 1438    | 43.1%     |
| +0 to +2                  | 1810    | 44.3%     |
| +2 to +4                  | 1649    | 46.1%     |
| +4 to +6                  | 1272    | 50.2%     |
| +6 to +8                  | 862     | 49.3%     |
| +8 to +10                 | 461     | 49.9%     |
| +10 to +12                | 211     | 45.5%     |
| +12 to +14                | 116     | 38.8%     |
| +14 to +16                | 36      | 52.8%     |
| +16 to +18                | 9       | 55.6%     |

| corner diff — all leagues | matches | home win% |
| ------------------------- | ------- | --------- |
| -20 to -16                | 23      | 34.8%     |
| -16 to -12                | 228     | 44.3%     |
| -12 to -8                 | 2115    | 46.6%     |
| -8 to -4                  | 12634   | 45.3%     |
| -4 to +0                  | 39147   | 45.7%     |
| +0 to +4                  | 71312   | 45.6%     |
| +4 to +8                  | 30686   | 43.2%     |
| +8 to +12                 | 8330    | 40.8%     |
| +12 to +16                | 1389    | 38.9%     |
| +16 to +20                | 147     | 44.9%     |
| +20 to +24                | 13      | 46.2%     |

| team (EPL, all seasons) | wins <35% share | total wins | low-share win share |
| ----------------------- | --------------- | ---------- | ------------------- |
| QPR                     | 11              | 22         | 50%                 |
| Burnley                 | 41              | 92         | 45%                 |
| Derby                   | 8               | 19         | 42%                 |
| Nott'm Forest           | 21              | 50         | 42%                 |
| Hull                    | 18              | 44         | 41%                 |
| Sunderland              | 53              | 143        | 37%                 |
| Ipswich                 | 13              | 36         | 36%                 |
| Charlton                | 29              | 85         | 34%                 |
| Watford                 | 23              | 68         | 34%                 |
| Stoke                   | 39              | 116        | 34%                 |
| Sheffield United        | 11              | 34         | 32%                 |
| Blackburn               | 45              | 140        | 32%                 |

| team (EPL, all seasons) | losses >65% share | total losses | high-share loss share |
| ----------------------- | ----------------- | ------------ | --------------------- |
| Liverpool               | 91                | 204          | 45%                   |
| Man City                | 92                | 240          | 38%                   |
| Chelsea                 | 78                | 210          | 37%                   |
| Man United              | 73                | 205          | 36%                   |
| Reading                 | 19                | 59           | 32%                   |
| Leeds                   | 40                | 127          | 31%                   |
| Arsenal                 | 60                | 195          | 31%                   |
| Tottenham               | 85                | 321          | 26%                   |
| Ipswich                 | 16                | 62           | 26%                   |
| Everton                 | 88                | 352          | 25%                   |
| Aston Villa             | 83                | 335          | 25%                   |
| Blackburn               | 40                | 168          | 24%                   |

## Context: home advantage and opponent strength

Two confounds the band table ignores. **Home teams already win more** — and home
teams also win more corners (the home side takes roughly 55–60% of match corners
on average), so part of the corner-share effect is venue. And **corners are
easier to come by against weak teams** that sit deep and defend. Split by venue
and by opponent strength (the opponent's final season points, top vs bottom half
within its league-season).

```rust
// team-season points for opponent strength (all matches_full matches)
let mut tp: HashMap<(String, String, i64), i64> = HashMap::new();
for i in 0..mf.height() {
    if s_hg[i] < 0 || s_ag[i] < 0 { continue; }
    let lg = format!("{}|{}", s_country[i], s_league[i]);
    let ph = if s_hg[i] > s_ag[i] { 3 } else if s_hg[i] == s_ag[i] { 1 } else { 0 };
    let pa = if s_ag[i] > s_hg[i] { 3 } else if s_hg[i] == s_ag[i] { 1 } else { 0 };
    *tp.entry((lg.clone(), s_season[i].clone(), s_hid[i])).or_insert(0) += ph;
    *tp.entry((lg.clone(), s_season[i].clone(), s_aid[i])).or_insert(0) += pa;
}
let mut lgsn_teams: HashMap<(String, String), Vec<((String, String, i64), i64)>> = HashMap::new();
for (k, v) in &tp { lgsn_teams.entry((k.0.clone(), k.1.clone())).or_default().push((k.clone(), *v)); }
let mut strong: HashMap<(String, String, i64), bool> = HashMap::new();
for (_, mut teams) in lgsn_teams {
    teams.sort_by(|a, b| b.1.cmp(&a.1));
    let half = teams.len() / 2;
    for (i, (k, _)) in teams.iter().enumerate() {
        strong.insert(k.clone(), i < half);
    }
}

// win% by corner-share band x opponent strength — EPL only
let mut res = vec![(0usize,0usize); 10]; // band(5) x strong(2)
for r in &epl {
    let lg = format!("England|{}", r.league);
    let tot = r.hc + r.ac;
    if tot <= 0.0 { continue; }
    for (c, opp_id, gf, ga) in [(r.hc, r.aid, r.hg, r.ag), (r.ac, r.hid, r.ag, r.hg)] {
        let share = 100.0 * c / tot;
        let b = bands.iter().position(|&hi| share < hi).unwrap_or(5) - 1;
        let is_strong = strong.get(&(lg.clone(), r.season.clone(), opp_id)).copied().unwrap_or(false);
        let idx = b * 2 + if is_strong { 1 } else { 0 };
        res[idx].1 += 1;
        if gf > ga { res[idx].0 += 1; }
    }
}
let ctx_rows: Vec<Vec<String>> = (0..5).map(|b| vec![
    blabels[b].to_string(),
    format!("{} / {}", res[b*2].1, res[b*2+1].1),
    format!("{:.0}% / {:.0}%",
        100.0*res[b*2].0 as f64/res[b*2].1.max(1) as f64,
        100.0*res[b*2+1].0 as f64/res[b*2+1].1.max(1) as f64),
]).collect();
mars_table(&["corner share", "n vs weak / strong", "win% vs weak / strong"], &ctx_rows);
println!("opponent strength = top-half finishers in same league-season (points)");

// home vs away: same bands applied to each side separately
let band_table_side = |matches: &[&MRow], home_side: bool| -> Vec<Vec<String>> {
    let mut w = vec![0usize; 5]; let mut d = vec![0usize; 5]; let mut l = vec![0usize; 5];
    for r in matches {
        let tot = r.hc + r.ac;
        if tot <= 0.0 { continue; }
        let (c, gf, ga) = if home_side { (r.hc, r.hg, r.ag) } else { (r.ac, r.ag, r.hg) };
        let share = 100.0 * c / tot;
        let b = bands.iter().position(|&hi| share < hi).unwrap_or(5) - 1;
        if gf > ga { w[b] += 1; } else if gf == ga { d[b] += 1; } else { l[b] += 1; }
    }
    (0..5).map(|b| {
        let n = (w[b] + d[b] + l[b]) as f64;
        vec![blabels[b].to_string(), (w[b]+d[b]+l[b]).to_string(),
             format!("{:.1}%", 100.0*w[b] as f64/n),
             format!("{:.1}%", 100.0*d[b] as f64/n),
             format!("{:.1}%", 100.0*l[b] as f64/n)]
    }).collect()
};
let home_b = band_table_side(&epl_refs, true);
let away_b = band_table_side(&epl_refs, false);
let ha_rows: Vec<Vec<String>> = (0..5).map(|b| vec![
    blabels[b].to_string(),
    home_b[b][2].clone(), home_b[b][4].clone(),
    away_b[b][2].clone(), away_b[b][4].clone(),
]).collect();
mars_table(&["corner share", "home win% / loss%", "away win% / loss%"], &ha_rows);

// average home corner share per EPL season — venue baseline
let mut hshare_by_season: HashMap<String, (f64, usize)> = HashMap::new();
for r in &epl {
    let tot = r.hc + r.ac;
    if tot <= 0.0 { continue; }
    let e = hshare_by_season.entry(r.season.clone()).or_insert((0.0, 0));
    e.0 += 100.0 * r.hc / tot; e.1 += 1;
}
let mut hs_rows: Vec<Vec<String>> = hshare_by_season.iter().map(|(s, (sum, n))| vec![
    s.clone(), format!("{:.1}%", sum / *n as f64), n.to_string(),
]).collect();
hs_rows.sort();
mars_table(&["EPL season", "avg home corner share", "matches"], &hs_rows);
```

```text
stat rows indexed: 374660
matches with corner data (both teams): 166028
EPL matches with corners: 10032 | all leagues: 166028
EPL (8496 matches): corr(home corner share, home win) = 0.050
EPL: corr(home shot share,   home win) = 0.259
EPL: corr(home possession,   home win) = 0.120
ALL (111164 matches): corr(corner share)=-0.012 corr(shot share)=0.195 corr(possession)=0.016
EPL SOG-share subset (10032 matches): corr(shots on target share, home win) = 0.400
EPL team-matches: wins 7536 | wins with <35%% corner share: 1664 (22.1%% of wins)
EPL losses 7536 | losses with >65%% corner share: 1664 (22.1%% of losses)
opponent strength = top-half finishers in same league-season (points)
```

| league                 | matches | season span       |
| ---------------------- | ------- | ----------------- |
| English Championship   | 14543   | 2000/01 → 2026/27 |
| English League Two     | 14424   | 2000/01 → 2026/27 |
| English League One     | 14374   | 2000/01 → 2026/27 |
| English Premier League | 10032   | 2000/01 → 2026/27 |
| Spanish La Liga        | 8438    | 2004/05 → 2026/27 |
| Italian Serie A        | 8086    | 2005/06 → 2026/27 |
| French Ligue 1         | 7790    | 2005/06 → 2026/27 |
| German Bundesliga      | 7750    | 2000/01 → 2026/27 |
| Spanish La Liga 2      | 6527    | 2008/09 → 2026/27 |
| MLS                    | 6264    | 2012 → 2026       |
| Scottish Premiership   | 5958    | 2000/01 → 2026/27 |
| French Ligue 2         | 5347    | 2008/09 → 2026/27 |
| Italian Serie B        | 5214    | 2008/09 → 2026/27 |
| Dutch Eredivisie       | 4798    | 2008/09 → 2026/27 |
| German 2. Bundesliga   | 4661    | 2000/01 → 2026/27 |

| EPL season | matches with corners |
| ---------- | -------------------- |
| 2000/01    | 380                  |
| 2001/02    | 380                  |
| 2002/03    | 380                  |
| 2003/04    | 383                  |
| 2004/05    | 380                  |
| 2005/06    | 380                  |
| 2006/07    | 380                  |
| 2007/08    | 380                  |
| 2008/09    | 380                  |
| 2009/10    | 380                  |
| 2010/11    | 380                  |
| 2011/12    | 380                  |
| 2012/13    | 380                  |
| 2013/14    | 380                  |
| 2014/15    | 380                  |
| 2015/16    | 419                  |
| 2016/17    | 380                  |
| 2017/18    | 380                  |
| 2018/19    | 380                  |
| 2019/20    | 380                  |
| 2020/21    | 380                  |
| 2021/22    | 380                  |
| 2022/23    | 380                  |
| 2023/24    | 380                  |
| 2024/25    | 380                  |
| 2025/26    | 380                  |
| 2026/27    | 110                  |

| corner share % | n    | win%  | draw% | loss% |
| -------------- | ---- | ----- | ----- | ----- |
| <35            | 5281 | 31.5% | 25.0% | 43.5% |
| 35-45          | 3071 | 36.8% | 24.8% | 38.4% |
| 45-55          | 3351 | 37.8% | 24.5% | 37.7% |
| 55-65          | 3070 | 38.2% | 24.9% | 36.9% |
| >65            | 5289 | 43.5% | 25.0% | 31.5% |

| corner share % — all leagues | n     | win%  | draw% | loss% |
| ---------------------------- | ----- | ----- | ----- | ----- |
| <35                          | 77963 | 35.5% | 26.3% | 38.2% |
| 35-45                        | 46418 | 36.8% | 26.4% | 36.8% |
| 45-55                        | 48749 | 37.0% | 26.0% | 37.0% |
| 55-65                        | 46435 | 36.8% | 26.3% | 36.8% |
| >65                          | 78059 | 38.2% | 26.3% | 35.5% |

| corners won (EPL) | n    | win%  | draw% | loss% |
| ----------------- | ---- | ----- | ----- | ----- |
| 0-2               | 3462 | 32.2% | 24.7% | 43.2% |
| 3-4               | 5286 | 36.0% | 24.8% | 39.2% |
| 5-6               | 4982 | 38.0% | 24.2% | 37.8% |
| 7-9               | 4419 | 41.1% | 25.1% | 33.7% |
| 10+               | 1915 | 42.3% | 26.6% | 31.0% |

| corners won — all leagues | n     | win%  | draw% | loss% |
| ------------------------- | ----- | ----- | ----- | ----- |
| 0-2                       | 88929 | 37.1% | 23.6% | 39.3% |
| 3-4                       | 84318 | 37.3% | 25.7% | 37.0% |
| 5-6                       | 76410 | 37.3% | 26.1% | 36.6% |
| 7-9                       | 60351 | 37.4% | 26.9% | 35.7% |
| 10+                       | 22048 | 36.1% | 28.5% | 35.4% |

| corner diff (home − away) | matches | home win% |
| ------------------------- | ------- | --------- |
| -16 to -14                | 6       | 16.7%     |
| -14 to -12                | 22      | 36.4%     |
| -12 to -10                | 53      | 50.9%     |
| -10 to -8                 | 159     | 49.7%     |
| -8 to -6                  | 322     | 37.3%     |
| -6 to -4                  | 589     | 40.9%     |
| -4 to -2                  | 1010    | 45.0%     |
| -2 to +0                  | 1438    | 43.1%     |
| +0 to +2                  | 1810    | 44.3%     |
| +2 to +4                  | 1649    | 46.1%     |
| +4 to +6                  | 1272    | 50.2%     |
| +6 to +8                  | 862     | 49.3%     |
| +8 to +10                 | 461     | 49.9%     |
| +10 to +12                | 211     | 45.5%     |
| +12 to +14                | 116     | 38.8%     |
| +14 to +16                | 36      | 52.8%     |
| +16 to +18                | 9       | 55.6%     |

| corner diff — all leagues | matches | home win% |
| ------------------------- | ------- | --------- |
| -20 to -16                | 23      | 34.8%     |
| -16 to -12                | 228     | 44.3%     |
| -12 to -8                 | 2115    | 46.6%     |
| -8 to -4                  | 12634   | 45.3%     |
| -4 to +0                  | 39147   | 45.7%     |
| +0 to +4                  | 71312   | 45.6%     |
| +4 to +8                  | 30686   | 43.2%     |
| +8 to +12                 | 8330    | 40.8%     |
| +12 to +16                | 1389    | 38.9%     |
| +16 to +20                | 147     | 44.9%     |
| +20 to +24                | 13      | 46.2%     |

| team (EPL, all seasons) | wins <35% share | total wins | low-share win share |
| ----------------------- | --------------- | ---------- | ------------------- |
| QPR                     | 11              | 22         | 50%                 |
| Burnley                 | 41              | 92         | 45%                 |
| Derby                   | 8               | 19         | 42%                 |
| Nott'm Forest           | 21              | 50         | 42%                 |
| Hull                    | 18              | 44         | 41%                 |
| Sunderland              | 53              | 143        | 37%                 |
| Ipswich                 | 13              | 36         | 36%                 |
| Charlton                | 29              | 85         | 34%                 |
| Watford                 | 23              | 68         | 34%                 |
| Stoke                   | 39              | 116        | 34%                 |
| Sheffield United        | 11              | 34         | 32%                 |
| Blackburn               | 45              | 140        | 32%                 |

| team (EPL, all seasons) | losses >65% share | total losses | high-share loss share |
| ----------------------- | ----------------- | ------------ | --------------------- |
| Liverpool               | 91                | 204          | 45%                   |
| Man City                | 92                | 240          | 38%                   |
| Chelsea                 | 78                | 210          | 37%                   |
| Man United              | 73                | 205          | 36%                   |
| Reading                 | 19                | 59           | 32%                   |
| Leeds                   | 40                | 127          | 31%                   |
| Arsenal                 | 60                | 195          | 31%                   |
| Tottenham               | 85                | 321          | 26%                   |
| Ipswich                 | 16                | 62           | 26%                   |
| Everton                 | 88                | 352          | 25%                   |
| Aston Villa             | 83                | 335          | 25%                   |
| Blackburn               | 40                | 168          | 24%                   |

| corner share | n vs weak / strong | win% vs weak / strong |
| ------------ | ------------------ | --------------------- |
| <35          | 1917 / 3364        | 45% / 24%             |
| 35-45        | 1385 / 1686        | 49% / 27%             |
| 45-55        | 1678 / 1673        | 49% / 27%             |
| 55-65        | 1625 / 1445        | 48% / 27%             |
| >65          | 3213 / 2076        | 51% / 32%             |

| corner share | home win% / loss% | away win% / loss% |
| ------------ | ----------------- | ----------------- |
| <35          | 42.1%             | 33.1%             |
| 35-45        | 44.5%             | 30.9%             |
| 45-55        | 44.7%             | 30.8%             |
| 55-65        | 43.7%             | 31.2%             |
| >65          | 49.6%             | 25.4%             |

| EPL season | avg home corner share | matches |
| ---------- | --------------------- | ------- |
| 2000/01    | 57.6%                 | 380     |
| 2001/02    | 29.4%                 | 380     |
| 2002/03    | 57.2%                 | 380     |
| 2003/04    | 56.1%                 | 383     |
| 2004/05    | 56.2%                 | 380     |
| 2005/06    | 56.2%                 | 380     |
| 2006/07    | 56.8%                 | 380     |
| 2007/08    | 56.8%                 | 380     |
| 2008/09    | 56.1%                 | 380     |
| 2009/10    | 55.2%                 | 380     |
| 2010/11    | 54.5%                 | 379     |
| 2011/12    | 57.1%                 | 380     |
| 2012/13    | 56.3%                 | 380     |
| 2013/14    | 56.7%                 | 380     |
| 2014/15    | 55.3%                 | 380     |
| 2015/16    | 53.4%                 | 419     |
| 2016/17    | 54.2%                 | 380     |
| 2017/18    | 55.9%                 | 380     |
| 2018/19    | 55.7%                 | 380     |
| 2019/20    | 53.4%                 | 380     |
| 2020/21    | 53.7%                 | 380     |
| 2021/22    | 53.3%                 | 380     |
| 2022/23    | 55.2%                 | 380     |
| 2023/24    | 56.3%                 | 380     |
| 2024/25    | 52.6%                 | 380     |
| 2025/26    | 54.0%                 | 380     |
| 2026/27    | 52.8%                 | 110     |

## The season-level view and the historical trend

Match-level noise is huge. Smooth it three ways: (1) correlate each time's
**season-average corner share** with final points; (2) track the yearly
correlation between corner differential and home wins; (3) track the average
**total corners per match** — are modern games more or less cornered than the
early 2000s?

```rust
// (1) EPL team-season: avg corner share vs points
let mut ts: HashMap<(String, i64), (f64, usize)> = HashMap::new();
for r in &epl {
    let tot = r.hc + r.ac;
    if tot <= 0.0 { continue; }
    for (tid, c) in [(r.hid, r.hc), (r.aid, r.ac)] {
        let e = ts.entry((r.season.clone(), tid)).or_insert((0.0, 0));
        e.0 += 100.0 * c / tot; e.1 += 1;
    }
}
let mut pts: HashMap<(String, i64), i64> = HashMap::new();
for r in &epl {
    let ph = if r.hg > r.ag { 3 } else if r.hg == r.ag { 1 } else { 0 };
    let pa = if r.ag > r.hg { 3 } else if r.hg == r.ag { 1 } else { 0 };
    *pts.entry((r.season.clone(), r.hid)).or_insert(0) += ph;
    *pts.entry((r.season.clone(), r.aid)).or_insert(0) += pa;
}
let mut xs = Vec::new(); let mut ys = Vec::new();
for ((sn, tid), (sp, n)) in &ts {
    if *n < 30 { continue; }
    if let Some(p) = pts.get(&(sn.clone(), *tid)) {
        xs.push(sp / *n as f64); ys.push(*p as f64);
    }
}
println!("EPL team-seasons: {} | corr(avg corner share, season points) = {:.3}",
    xs.len(), pearson(&xs, &ys));

// (2) yearly correlation: corner diff -> home win, EPL by season
let mut by_year: std::collections::BTreeMap<String, (Vec<f64>, Vec<f64>)> = std::collections::BTreeMap::new();
for r in &epl {
    let e = by_year.entry(r.season.clone()).or_default();
    e.0.push(r.hc - r.ac);
    e.1.push(if r.hg > r.ag { 1.0 } else { 0.0 });
}
// (3) corners per match per season
let mut cpb: std::collections::BTreeMap<String, (f64, usize)> = std::collections::BTreeMap::new();
for r in &epl {
    let e = cpb.entry(r.season.clone()).or_insert((0.0, 0));
    e.0 += (r.hc + r.ac) / 2.0; e.1 += 1;
}
let trend_rows: Vec<Vec<String>> = by_year.iter().map(|(sn, (x, y))| {
    let cp = cpb.get(sn).map(|(s, n)| s / *n as f64).unwrap_or(f64::NAN);
    vec![sn.clone(), format!("{:.3}", pearson(x, y)), x.len().to_string(),
         format!("{:.1}", cp)]
}).collect();
mars_table(&["EPL season", "corr(corner diff, home win)", "matches", "avg corners/team"], &trend_rows);
```

```text
stat rows indexed: 374660
matches with corner data (both teams): 166028
EPL matches with corners: 10032 | all leagues: 166028
EPL (8496 matches): corr(home corner share, home win) = 0.050
EPL: corr(home shot share,   home win) = 0.259
EPL: corr(home possession,   home win) = 0.120
ALL (111164 matches): corr(corner share)=-0.012 corr(shot share)=0.195 corr(possession)=0.016
EPL SOG-share subset (10032 matches): corr(shots on target share, home win) = 0.400
EPL team-matches: wins 7536 | wins with <35%% corner share: 1664 (22.1%% of wins)
EPL losses 7536 | losses with >65%% corner share: 1664 (22.1%% of losses)
opponent strength = top-half finishers in same league-season (points)
EPL team-seasons: 521 | corr(avg corner share, season points) = 0.744
```

| league                 | matches | season span       |
| ---------------------- | ------- | ----------------- |
| English Championship   | 14543   | 2000/01 → 2026/27 |
| English League Two     | 14424   | 2000/01 → 2026/27 |
| English League One     | 14374   | 2000/01 → 2026/27 |
| English Premier League | 10032   | 2000/01 → 2026/27 |
| Spanish La Liga        | 8438    | 2004/05 → 2026/27 |
| Italian Serie A        | 8086    | 2005/06 → 2026/27 |
| French Ligue 1         | 7790    | 2005/06 → 2026/27 |
| German Bundesliga      | 7750    | 2000/01 → 2026/27 |
| Spanish La Liga 2      | 6527    | 2008/09 → 2026/27 |
| MLS                    | 6264    | 2012 → 2026       |
| Scottish Premiership   | 5958    | 2000/01 → 2026/27 |
| French Ligue 2         | 5347    | 2008/09 → 2026/27 |
| Italian Serie B        | 5214    | 2008/09 → 2026/27 |
| Dutch Eredivisie       | 4798    | 2008/09 → 2026/27 |
| German 2. Bundesliga   | 4661    | 2000/01 → 2026/27 |

| EPL season | matches with corners |
| ---------- | -------------------- |
| 2000/01    | 380                  |
| 2001/02    | 380                  |
| 2002/03    | 380                  |
| 2003/04    | 383                  |
| 2004/05    | 380                  |
| 2005/06    | 380                  |
| 2006/07    | 380                  |
| 2007/08    | 380                  |
| 2008/09    | 380                  |
| 2009/10    | 380                  |
| 2010/11    | 380                  |
| 2011/12    | 380                  |
| 2012/13    | 380                  |
| 2013/14    | 380                  |
| 2014/15    | 380                  |
| 2015/16    | 419                  |
| 2016/17    | 380                  |
| 2017/18    | 380                  |
| 2018/19    | 380                  |
| 2019/20    | 380                  |
| 2020/21    | 380                  |
| 2021/22    | 380                  |
| 2022/23    | 380                  |
| 2023/24    | 380                  |
| 2024/25    | 380                  |
| 2025/26    | 380                  |
| 2026/27    | 110                  |

| corner share % | n    | win%  | draw% | loss% |
| -------------- | ---- | ----- | ----- | ----- |
| <35            | 5281 | 31.5% | 25.0% | 43.5% |
| 35-45          | 3071 | 36.8% | 24.8% | 38.4% |
| 45-55          | 3351 | 37.8% | 24.5% | 37.7% |
| 55-65          | 3070 | 38.2% | 24.9% | 36.9% |
| >65            | 5289 | 43.5% | 25.0% | 31.5% |

| corner share % — all leagues | n     | win%  | draw% | loss% |
| ---------------------------- | ----- | ----- | ----- | ----- |
| <35                          | 77963 | 35.5% | 26.3% | 38.2% |
| 35-45                        | 46418 | 36.8% | 26.4% | 36.8% |
| 45-55                        | 48749 | 37.0% | 26.0% | 37.0% |
| 55-65                        | 46435 | 36.8% | 26.3% | 36.8% |
| >65                          | 78059 | 38.2% | 26.3% | 35.5% |

| corners won (EPL) | n    | win%  | draw% | loss% |
| ----------------- | ---- | ----- | ----- | ----- |
| 0-2               | 3462 | 32.2% | 24.7% | 43.2% |
| 3-4               | 5286 | 36.0% | 24.8% | 39.2% |
| 5-6               | 4982 | 38.0% | 24.2% | 37.8% |
| 7-9               | 4419 | 41.1% | 25.1% | 33.7% |
| 10+               | 1915 | 42.3% | 26.6% | 31.0% |

| corners won — all leagues | n     | win%  | draw% | loss% |
| ------------------------- | ----- | ----- | ----- | ----- |
| 0-2                       | 88929 | 37.1% | 23.6% | 39.3% |
| 3-4                       | 84318 | 37.3% | 25.7% | 37.0% |
| 5-6                       | 76410 | 37.3% | 26.1% | 36.6% |
| 7-9                       | 60351 | 37.4% | 26.9% | 35.7% |
| 10+                       | 22048 | 36.1% | 28.5% | 35.4% |

| corner diff (home − away) | matches | home win% |
| ------------------------- | ------- | --------- |
| -16 to -14                | 6       | 16.7%     |
| -14 to -12                | 22      | 36.4%     |
| -12 to -10                | 53      | 50.9%     |
| -10 to -8                 | 159     | 49.7%     |
| -8 to -6                  | 322     | 37.3%     |
| -6 to -4                  | 589     | 40.9%     |
| -4 to -2                  | 1010    | 45.0%     |
| -2 to +0                  | 1438    | 43.1%     |
| +0 to +2                  | 1810    | 44.3%     |
| +2 to +4                  | 1649    | 46.1%     |
| +4 to +6                  | 1272    | 50.2%     |
| +6 to +8                  | 862     | 49.3%     |
| +8 to +10                 | 461     | 49.9%     |
| +10 to +12                | 211     | 45.5%     |
| +12 to +14                | 116     | 38.8%     |
| +14 to +16                | 36      | 52.8%     |
| +16 to +18                | 9       | 55.6%     |

| corner diff — all leagues | matches | home win% |
| ------------------------- | ------- | --------- |
| -20 to -16                | 23      | 34.8%     |
| -16 to -12                | 228     | 44.3%     |
| -12 to -8                 | 2115    | 46.6%     |
| -8 to -4                  | 12634   | 45.3%     |
| -4 to +0                  | 39147   | 45.7%     |
| +0 to +4                  | 71312   | 45.6%     |
| +4 to +8                  | 30686   | 43.2%     |
| +8 to +12                 | 8330    | 40.8%     |
| +12 to +16                | 1389    | 38.9%     |
| +16 to +20                | 147     | 44.9%     |
| +20 to +24                | 13      | 46.2%     |

| team (EPL, all seasons) | wins <35% share | total wins | low-share win share |
| ----------------------- | --------------- | ---------- | ------------------- |
| QPR                     | 11              | 22         | 50%                 |
| Burnley                 | 41              | 92         | 45%                 |
| Derby                   | 8               | 19         | 42%                 |
| Nott'm Forest           | 21              | 50         | 42%                 |
| Hull                    | 18              | 44         | 41%                 |
| Sunderland              | 53              | 143        | 37%                 |
| Ipswich                 | 13              | 36         | 36%                 |
| Charlton                | 29              | 85         | 34%                 |
| Watford                 | 23              | 68         | 34%                 |
| Stoke                   | 39              | 116        | 34%                 |
| Sheffield United        | 11              | 34         | 32%                 |
| Blackburn               | 45              | 140        | 32%                 |

| team (EPL, all seasons) | losses >65% share | total losses | high-share loss share |
| ----------------------- | ----------------- | ------------ | --------------------- |
| Liverpool               | 91                | 204          | 45%                   |
| Man City                | 92                | 240          | 38%                   |
| Chelsea                 | 78                | 210          | 37%                   |
| Man United              | 73                | 205          | 36%                   |
| Reading                 | 19                | 59           | 32%                   |
| Leeds                   | 40                | 127          | 31%                   |
| Arsenal                 | 60                | 195          | 31%                   |
| Tottenham               | 85                | 321          | 26%                   |
| Ipswich                 | 16                | 62           | 26%                   |
| Everton                 | 88                | 352          | 25%                   |
| Aston Villa             | 83                | 335          | 25%                   |
| Blackburn               | 40                | 168          | 24%                   |

| corner share | n vs weak / strong | win% vs weak / strong |
| ------------ | ------------------ | --------------------- |
| <35          | 1921 / 3360        | 45% / 24%             |
| 35-45        | 1389 / 1682        | 49% / 27%             |
| 45-55        | 1678 / 1673        | 49% / 27%             |
| 55-65        | 1622 / 1448        | 48% / 27%             |
| >65          | 3208 / 2081        | 51% / 32%             |

| corner share | home win% / loss% | away win% / loss% |
| ------------ | ----------------- | ----------------- |
| <35          | 42.1%             | 33.1%             |
| 35-45        | 44.5%             | 30.9%             |
| 45-55        | 44.7%             | 30.8%             |
| 55-65        | 43.7%             | 31.2%             |
| >65          | 49.6%             | 25.4%             |

| EPL season | avg home corner share | matches |
| ---------- | --------------------- | ------- |
| 2000/01    | 57.6%                 | 380     |
| 2001/02    | 29.4%                 | 380     |
| 2002/03    | 57.2%                 | 380     |
| 2003/04    | 56.1%                 | 383     |
| 2004/05    | 56.2%                 | 380     |
| 2005/06    | 56.2%                 | 380     |
| 2006/07    | 56.8%                 | 380     |
| 2007/08    | 56.8%                 | 380     |
| 2008/09    | 56.1%                 | 380     |
| 2009/10    | 55.2%                 | 380     |
| 2010/11    | 54.5%                 | 379     |
| 2011/12    | 57.1%                 | 380     |
| 2012/13    | 56.3%                 | 380     |
| 2013/14    | 56.7%                 | 380     |
| 2014/15    | 55.3%                 | 380     |
| 2015/16    | 53.4%                 | 419     |
| 2016/17    | 54.2%                 | 380     |
| 2017/18    | 55.9%                 | 380     |
| 2018/19    | 55.7%                 | 380     |
| 2019/20    | 53.4%                 | 380     |
| 2020/21    | 53.7%                 | 380     |
| 2021/22    | 53.3%                 | 380     |
| 2022/23    | 55.2%                 | 380     |
| 2023/24    | 56.3%                 | 380     |
| 2024/25    | 52.6%                 | 380     |
| 2025/26    | 54.0%                 | 380     |
| 2026/27    | 52.8%                 | 110     |

| EPL season | corr(corner diff, home win) | matches | avg corners/team |
| ---------- | --------------------------- | ------- | ---------------- |
| 2000/01    | 0.024                       | 380     | 5.5              |
| 2001/02    | -0.057                      | 380     | 4.3              |
| 2002/03    | -0.023                      | 380     | 5.8              |
| 2003/04    | -0.071                      | 383     | 5.6              |
| 2004/05    | 0.073                       | 380     | 5.4              |
| 2005/06    | -0.041                      | 380     | 5.3              |
| 2006/07    | -0.086                      | 380     | 5.6              |
| 2007/08    | 0.085                       | 380     | 5.5              |
| 2008/09    | 0.038                       | 380     | 5.6              |
| 2009/10    | 0.141                       | 380     | 5.6              |
| 2010/11    | -0.017                      | 380     | 5.5              |
| 2011/12    | 0.088                       | 380     | 5.7              |
| 2012/13    | 0.153                       | 380     | 5.6              |
| 2013/14    | 0.086                       | 380     | 5.4              |
| 2014/15    | -0.056                      | 380     | 5.3              |
| 2015/16    | -0.050                      | 419     | 5.4              |
| 2016/17    | 0.073                       | 380     | 5.2              |
| 2017/18    | 0.053                       | 380     | 5.1              |
| 2018/19    | 0.085                       | 380     | 5.1              |
| 2019/20    | 0.079                       | 380     | 5.4              |
| 2020/21    | 0.004                       | 380     | 5.1              |
| 2021/22    | 0.142                       | 380     | 5.2              |
| 2022/23    | 0.095                       | 380     | 5.1              |
| 2023/24    | 0.138                       | 380     | 5.4              |
| 2024/25    | 0.113                       | 380     | 5.1              |
| 2025/26    | -0.082                      | 380     | 5.0              |
| 2026/27    | 0.061                       | 110     | 4.8              |

## Findings

**Do more corners help you win? Barely — and less than almost any other stat we
track.**

1. **The gradient is the weakest of the attacking stats.** In the Premier
   League, win rate climbs from 31.5% with under 35% of the match's corners to
   43.5% above 65% — a 12-point spread. Possession spans 27 points on the same
   matches; shot share roughly 25. Across _all_ covered leagues the corner-share
   curve nearly flatlines (35.5% → 38.2%), and the pooled correlation between
   home corner share and home win is **−0.012 — effectively zero, even slightly
   negative**.

2. **Corner share is a worse match-level predictor than possession.**
   Head-to-head on identical EPL matches: corner share ρ = 0.050, possession ρ =
   0.120, shot share ρ = 0.259, shots-on-target share ρ = 0.400. Corners measure
   _who you are_ far less well than they measure _what happens today_ — the
   opposite of the cliché.

3. **But it is an excellent team-quality marker.** Correlating each team's
   season-average corner share with its final points gives ρ = 0.744 across 521
   EPL team-seasons — stronger than possession's 0.704. Corner-heavy teams are
   good teams; corner-dominant _matches_ are barely more likely to be won.

4. **The extremes cut both ways — and the losers are famous.** 22.1% of EPL wins
   came with under 35% corner share (QPR won half their matches that way;
   Burnley 45%). And 22.1% of losses came with over 65% — led by **Liverpool
   (45% of their losses)**, Manchester City (38%) and Chelsea (37%): the
   possession-dominant sides get countered.

5. **Context helps but doesn't rescue it.** Against weak opponents corner share
   is nearly irrelevant (45–51% win rate across all bands); against strong ones
   it separates somewhat (24% → 32%). Away from home even a >65% corner share
   wins only 33.1% of the time.

6. **No dose-response at the top end.** The corner-differential table is
   non-monotonic: +4 to +6 corners wins 50.2% of home matches, but +12 to +14
   wins just 38.8%. In the all-league table the biggest differentials actually
   _underperform_ (38.9% at +12 to +16 vs 45.7% at even). More corners ≠ more
   wins, and at the extreme it can mean sterile pressure.

7. **Corner volume itself is slowly declining.** Average corners per team fell
   from ~5.5 in the early 2000s to ~5.0 in 2025/26 — modern games produce fewer,
   and the yearly correlation between corner differential and home wins wanders
   around zero with no trend.

**Data caveats:** no event-level corner data exists, so corner-to-goal
conversion and set-piece scoring are untestable here. The 2001/02 season shows
an anomalous 29.4% average home corner share (vs ~55% elsewhere) — likely a
partial data gap in that season's corner counts, which also explains its low 4.3
corners/team. Corner totals include both open-play pressure and dead-ball
recycling; we cannot separate them.

**Verdict:** corners are football's second-most quoted attacking stat after
possession — and an even weaker predictor of the single match. They tell you
which team is _better_ (ρ = 0.74 at season level) but almost nothing about which
team will win _today_ (ρ ≈ 0.05).
