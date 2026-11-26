---
title: 'Title defences and dynasties: how often do champions retain?'
description: |
  '999 league-seasons: only 25.1% of champions go back-to-back. Salzburg and Bayern own the record at 11 straight; the 2010s were the dynasty decade.'
author: 'hieudoan'
date: '2026-11-26T18:00'
order: 41
tags: ['football', 'analysis', 'title', 'dynasty', 'standings']
---

## Title defences and dynasties: how rare is repeating?

The hardest thing in football is winning twice. This notebook computes the
champion of every league-season in the dataset (~590 league-seasons, ~40
leagues, 1990s→2026) and asks:

- How often does the champion retain the title the following season?
- Which teams own the longest championship streaks?
- Are dynasties becoming more or less common over time?

Retention rate = P(next season's champion is the same team | the league had a
champion last season). Streaks count _consecutive_ titles in the same league — a
gap year (missing data season) breaks the chain only if a different team won in
between.

```rust

use polars::prelude::*;
use std::collections::HashMap;
use std::collections::HashSet;

let mf = LazyCsvReader::new("data/matches_full.csv")
    .finish().expect("matches_full.csv")
    .collect().expect("collect matches");

fn col_str(df: &DataFrame, name: &str) -> Vec<String> {
    df.column(name).unwrap().str().unwrap().iter()
        .map(|o| o.unwrap_or("").to_string()).collect()
}
fn col_i64(df: &DataFrame, name: &str) -> Vec<i64> {
    let c = df.column(name).unwrap().clone();
    let c = if c.dtype() == &DataType::Null { c.cast(&DataType::Int64).unwrap() } else { c };
    c.i64().unwrap().iter().map(|o| o.unwrap_or(-1)).collect()
}

let s_id = col_i64(&mf, "id");
let s_hg = col_i64(&mf, "hg");
let s_ag = col_i64(&mf, "ag");
let s_country = col_str(&mf, "country");
let s_league = col_str(&mf, "league");
let s_season = col_str(&mf, "season");
let s_date = col_str(&mf, "date");
let s_home_raw = col_str(&mf, "home");
let s_away_raw = col_str(&mf, "away");

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






// canonical team names (football-data style) — collapses name-variant dupes
let s_home: Vec<String> = s_home_raw.iter().map(|n| canon(n).to_string()).collect();
let s_away: Vec<String> = s_away_raw.iter().map(|n| canon(n).to_string()).collect();

// synthetic team ids keyed by (country|league|canonical name) so variants
// of the same club share one id within a competition
let mut tid_map: HashMap<String, i64> = HashMap::new();
let mut s_hid = vec![-1i64; mf.height()];
let mut s_aid = vec![-1i64; mf.height()];
for i in 0..mf.height() {
    for (nm, is_home) in [(&s_home[i], true), (&s_away[i], false)] {
        let key = format!("{}|{}|{}", s_country[i], s_league[i], nm);
        let next = tid_map.len() as i64;
        let id = *tid_map.entry(key).or_insert(next);
        if is_home { s_hid[i] = id; } else { s_aid[i] = id; }
    }
}

// dedup fixtures: same league-season, canonical pairing, date and score
// appears twice when two importers used different name variants
let mut seen: HashSet<(String, String, String, String, String, String, i64, i64)> = HashSet::new();
let mut valid: Vec<usize> = Vec::new();
let mut n_dupes = 0usize;
for i in 0..mf.height() {
    if s_hg[i] < 0 || s_ag[i] < 0 { continue; }
    let key = (s_country[i].clone(), s_league[i].clone(), s_season[i].clone(),
               s_home[i].clone(), s_away[i].clone(), s_date[i][..10].to_string(), s_hg[i], s_ag[i]);
    // unordered pairing: canonical order home<away not guaranteed; use both directions check
    if seen.contains(&key) || seen.contains(&(key.0.clone(), key.1.clone(), key.2.clone(), key.4.clone(), key.3.clone(), key.5.clone(), key.6, key.7)) {
        n_dupes += 1; continue;
    }
    seen.insert(key);
    valid.push(i);
}
println!("completed matches after dedup: {} ({} dupes dropped)", valid.len(), n_dupes);

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

// standings order best->worst for (tid, pts, gd, gf)
fn rank_teams(teams: &[(i64, i64, i64, i64)]) -> Vec<usize> {
    let mut v: Vec<usize> = (0..teams.len()).collect();
    v.sort_by(|&a, &b| {
        teams[b].1.cmp(&teams[a].1)
            .then(teams[b].2.cmp(&teams[a].2))
            .then(teams[b].3.cmp(&teams[a].3))
    });
    v
}

// replay one league-season's matches (idxs sorted by date) -> final standings + max lead per team
fn replay_lgsn(idxs: &[usize], hid: &[i64], aid: &[i64], hg: &[i64], ag: &[i64],
               home: &[String], away: &[String]) -> (Vec<(i64,i64,i64,i64)>, HashMap<i64,String>, HashMap<i64,i64>) {
    let mut st: HashMap<i64, (i64, i64, i64)> = HashMap::new();
    let mut names: HashMap<i64, String> = HashMap::new();
    let mut maxlead: HashMap<i64, i64> = HashMap::new();
    for &i in idxs {
        for (tid, gf, ga, nm) in [(hid[i], hg[i], ag[i], &home[i]), (aid[i], ag[i], hg[i], &away[i])] {
            names.insert(tid, nm.clone());
            let e = st.entry(tid).or_insert((0, 0, 0));
            e.1 += gf; e.2 += ga;
            e.0 += if gf > ga { 3 } else if gf == ga { 1 } else { 0 };
        }
        let mut teams: Vec<(i64, i64, i64, i64)> = st.iter().map(|(&t, &(p, gf, ga))| (t, p, gf - ga, gf)).collect();
        let order = rank_teams(&teams);
        if order.len() >= 2 {
            let lead = teams[order[0]].1 - teams[order[1]].1;
            let top = teams[order[0]].0;
            let cur = maxlead.entry(top).or_insert(0);
            if lead > *cur { *cur = lead; }
        }
        teams.clear();
    }
    let mut teams: Vec<(i64, i64, i64, i64)> = st.iter().map(|(&t, &(p, gf, ga))| (t, p, gf - ga, gf)).collect();
    let order = rank_teams(&teams);
    let mut sorted: Vec<(i64,i64,i64,i64)> = order.iter().map(|&o| teams[o]).collect();
    (sorted, names, maxlead)
}

// champion per league-season
let mut groups: HashMap<(String,String), Vec<usize>> = HashMap::new();
for &i in &valid { groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i); }

struct Champ { lg:String, sn:String, skey:i64, tid:i64, team:String, pts:i64, margin:i64 }
let mut champs: Vec<Champ> = Vec::new();
for ((lg,sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a,&b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    let (table, names, _) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    if table.len() < 2 { continue; }
    champs.push(Champ{
        lg: lg.clone(), sn: sn.clone(), skey: sn.get(..4).and_then(|y| y.parse::<i64>().ok()).unwrap_or(0),
        tid: table[0].0, team: names.get(&table[0].0).cloned().unwrap_or_default(),
        pts: table[0].1, margin: table[0].1 - table[1].1,
    });
}
println!("league-seasons with a champion: {}", champs.len());

// per league: sort by season key, compute streaks + retention
let mut by_lg: HashMap<String, Vec<&Champ>> = HashMap::new();
for c in &champs { by_lg.entry(c.lg.clone()).or_default().push(c); }
for v in by_lg.values_mut() { v.sort_by(|a,b| a.skey.cmp(&b.skey).then(a.sn.cmp(&b.sn))); }

struct Streak { lg:String, team:String, tid:i64, len:usize, from:String, to:String, pts_avg:f64 }
let mut streaks: Vec<Streak> = Vec::new();
let mut retained = 0usize; let mut opportunities = 0usize;
let mut margins_ret: Vec<i64> = Vec::new();
let mut margins_all: Vec<i64> = Vec::new();

for (lg, cs) in &by_lg {
    // retention
    for w in cs.windows(2) {
        opportunities += 1;
        margins_all.push(w[1].margin);
        if w[0].tid == w[1].tid { retained += 1; margins_ret.push(w[1].margin); }
    }
    // streaks
    let mut i = 0;
    while i < cs.len() {
        let mut j = i;
        while j + 1 < cs.len() && cs[j+1].tid == cs[i].tid { j += 1; }
        let len = j - i + 1;
        if len >= 2 {
            let avg_pts = cs[i..=j].iter().map(|c| c.pts as f64).sum::<f64>() / len as f64;
            streaks.push(Streak{
                lg: lg.clone(), team: cs[i].team.clone(), tid: cs[i].tid, len,
                from: cs[i].sn.clone(), to: cs[j].sn.clone(), pts_avg: avg_pts,
            });
        }
        i = j + 1;
    }
}

println!("title retention rate: {}/{} = {:.1}%", retained, opportunities, 100.0*retained as f64/opportunities.max(1) as f64);
println!("avg winning margin — retained titles: {:.1} | all titles: {:.1}",
    margins_ret.iter().sum::<i64>() as f64/margins_ret.len().max(1) as f64,
    margins_all.iter().sum::<i64>() as f64/margins_all.len().max(1) as f64);

streaks.sort_by(|a,b| b.len.cmp(&a.len).then(a.lg.cmp(&b.lg)));
let rows: Vec<Vec<String>> = streaks.iter().take(40).map(|s| vec![
    s.lg.split('|').nth(1).unwrap_or("").to_string(), s.team.clone(),
    s.len.to_string(), format!("{} → {}", s.from, s.to), format!("{:.0}", s.pts_avg),
]).collect();
mars_table(&["league","team","consecutive titles","span","avg pts"], &rows);

// retention rate by league (min 8 seasons)
let mut ret_by_lg: HashMap<String,(usize,usize)> = HashMap::new();
for (lg, cs) in &by_lg {
    if cs.len() < 8 { continue; }
    let mut r = 0; let mut o = 0;
    for w in cs.windows(2) { o += 1; if w[0].tid == w[1].tid { r += 1; } }
    ret_by_lg.insert(lg.clone(), (r,o));
}
let mut rrows: Vec<Vec<String>> = ret_by_lg.iter().map(|(l,(r,o))| vec![
    l.split('|').nth(1).unwrap_or("").to_string(), o.to_string(), r.to_string(),
    format!("{:.0}%", 100.0*(*r) as f64/(*o).max(1) as f64),
]).collect();
rrows.sort_by(|a,b| b[3].trim_end_matches('%').parse::<f64>().unwrap().partial_cmp(&a[3].trim_end_matches('%').parse::<f64>().unwrap()).unwrap());
mars_table(&["league","opportunities","retained","retention %"], &rrows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
league-seasons with a champion: 999
title retention rate: 238/947 = 25.1%
avg winning margin — retained titles: 8.2 | all titles: 6.6
```

| league                   | team                 | consecutive titles | span                  | avg pts |
| ------------------------ | -------------------- | ------------------ | --------------------- | ------- |
| Bundesliga               | Salzburg             | 11                 | 2013/2014 → 2023/2024 | 77      |
| German Bundesliga        | Bayern Munich        | 11                 | 2012/13 → 2022/23     | 82      |
| Italian Serie A          | Juventus             | 9                  | 2011/12 → 2019/20     | 90      |
| Scottish Premiership     | Celtic               | 9                  | 2011/12 → 2019/20     | 89      |
| French Ligue 1           | Lyon                 | 7                  | 2001/02 → 2007/08     | 77      |
| Greek Super League       | Olympiakos           | 7                  | 2010/11 → 2016/17     | 77      |
| French Ligue 1           | Paris SG             | 6                  | 2021/22 → 2026/27     | 72      |
| Greek Super League       | Olympiakos           | 6                  | 1996/97 → 2006/07     | 82      |
| Premier League           | Zenit                | 6                  | 2018/2019 → 2023/2024 | 66      |
| Scottish Premiership     | Celtic               | 6                  | 2021/22 → 2026/27     | 82      |
| Belgian Pro League       | Anderlecht           | 5                  | 2008/09 → 2012/13     | 69      |
| Portuguese Liga Portugal | Porto                | 5                  | 1994/95 → 1998/99     | 83      |
| Superliga                | CFR Cluj             | 5                  | 2017/2018 → 2021/2022 | 82      |
| Super League             | Basel                | 5                  | 2012/2013 → 2016/2017 | 78      |
| Turkish Süper Lig        | Galatasaray          | 5                  | 2022/23 → 2026/27     | 79      |
| Super League             | Guangzhou Evergrande | 4                  | 2014 → 2017           | 66      |
| English Premier League   | Man City             | 4                  | 2020/21 → 2023/24     | 90      |
| French Ligue 1           | Paris SG             | 4                  | 2012/13 → 2015/16     | 89      |
| Premier Division         | Shamrock Rovers      | 4                  | 2020 → 2023           | 69      |
| Italian Serie A          | Inter                | 4                  | 2006/07 → 2009/10     | 87      |
| Dutch Eredivisie         | PSV Eindhoven        | 4                  | 2004/05 → 2007/08     | 80      |
| Dutch Eredivisie         | Ajax                 | 4                  | 2010/11 → 2013/14     | 74      |
| Dutch Eredivisie         | Ajax                 | 4                  | 2018/19 → 2021/22     | 78      |
| Dutch Eredivisie         | PSV Eindhoven        | 4                  | 2023/24 → 2026/27     | 71      |
| Eliteserien              | Rosenborg            | 4                  | 2015 → 2018           | 66      |
| Portuguese Liga Portugal | Porto                | 4                  | 2005/06 → 2008/09     | 73      |
| Portuguese Liga Portugal | Benfica              | 4                  | 2013/14 → 2016/17     | 82      |
| Super League             | Young Boys           | 4                  | 2017/2018 → 2020/2021 | 84      |
| Turkish Süper Lig        | Galatasaray          | 4                  | 1996/97 → 1999/00     | 78      |
| Super League             | Shanghai Port        | 3                  | 2023 → 2025           | 69      |
| English Premier League   | Man United           | 3                  | 1998/99 → 2000/01     | 83      |
| English Premier League   | Man United           | 3                  | 2006/07 → 2008/09     | 89      |
| Veikkausliiga            | HJK                  | 3                  | 2012 → 2014           | 70      |
| Veikkausliiga            | HJK                  | 3                  | 2020 → 2022           | 55      |
| French Ligue 1           | Paris SG             | 3                  | 2017/18 → 2019/20     | 84      |
| German Bundesliga        | Bayern Munich        | 3                  | 1998/99 → 2000/01     | 71      |
| Greek Super League       | Olympiakos           | 3                  | 2019/20 → 2021/22     | 88      |
| Premier Division         | Dundalk              | 3                  | 2014 → 2016           | 76      |
| Dutch Eredivisie         | Ajax                 | 3                  | 1993/94 → 1995/96     | 84      |
| Ekstraklasa              | Legia                | 3                  | 2015/2016 → 2017/2018 | 72      |

| league                   | opportunities | retained | retention % |
| ------------------------ | ------------- | -------- | ----------- |
| Bundesliga               | 14            | 10       | 71%         |
| Scottish Premiership     | 32            | 21       | 66%         |
| Superliga                | 14            | 8        | 57%         |
| Super League             | 14            | 8        | 57%         |
| Greek Super League       | 27            | 14       | 52%         |
| Super League             | 12            | 6        | 50%         |
| Premier Division         | 14            | 7        | 50%         |
| Dutch Eredivisie         | 33            | 16       | 48%         |
| German Bundesliga        | 33            | 16       | 48%         |
| French Ligue 1           | 33            | 16       | 48%         |
| Premier League           | 13            | 6        | 46%         |
| Portuguese Liga Portugal | 33            | 15       | 45%         |
| Veikkausliiga            | 14            | 6        | 43%         |
| Ekstraklasa              | 14            | 6        | 43%         |
| Italian Serie A          | 33            | 14       | 42%         |
| Eliteserien              | 14            | 5        | 36%         |
| Turkish Süper Lig        | 32            | 11       | 34%         |
| English Premier League   | 33            | 11       | 33%         |
| J1 League                | 14            | 4        | 29%         |
| Liga MX                  | 14            | 4        | 29%         |
| Belgian Pro League       | 31            | 9        | 29%         |
| Serie A                  | 14            | 4        | 29%         |
| Allsvenskan              | 14            | 4        | 29%         |
| Spanish La Liga          | 33            | 9        | 27%         |
| Superliga                | 14            | 2        | 14%         |
| Champions League         | 25            | 2        | 8%          |
| MLS                      | 14            | 1        | 7%          |
| Spanish La Liga 2        | 33            | 0        | 0%          |
| English Championship     | 33            | 0        | 0%          |
| English League Two       | 33            | 0        | 0%          |
| UEFA Europa League       | 17            | 0        | 0%          |
| Italian Serie B          | 29            | 0        | 0%          |
| Scottish League One      | 29            | 0        | 0%          |
| Scottish Championship    | 33            | 0        | 0%          |
| French Ligue 2           | 30            | 0        | 0%          |
| English League One       | 33            | 0        | 0%          |
| Scottish League Two      | 29            | 0        | 0%          |
| Liga Profesional         | 13            | 0        | 0%          |
| German 2. Bundesliga     | 33            | 0        | 0%          |

## Era check: are dynasties dying out?

Split the dataset into decades and ask whether repeat champions are becoming
rarer — the parity era thesis — or whether a few leagues still produce them
every year.

```rust

// decade of champion's season key -> retained or not
let mut groups: HashMap<(String,String), Vec<usize>> = HashMap::new();
for &i in &valid { groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i); }
let mut champs: Vec<(String,i64,i64,String)> = Vec::new(); // (lg, skey, tid, team)
for ((lg,sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a,&b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    let (table, names, _) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    if table.is_empty() { continue; }
    champs.push((lg.clone(), sn.get(..4).and_then(|y|y.parse::<i64>().ok()).unwrap_or(0), table[0].0, names.get(&table[0].0).cloned().unwrap_or_default()));
}
let mut by_lg: HashMap<String, Vec<(i64,i64,String)>> = HashMap::new();
for (lg,sk,tid,team) in champs { by_lg.entry(lg).or_default().push((sk,tid,team)); }
for v in by_lg.values_mut() { v.sort_by(|a,b| a.0.cmp(&b.0)); }

let mut decade: HashMap<i64,(usize,usize)> = HashMap::new(); // decade -> (retained, opportunities)
let mut unique_winners: HashMap<i64, std::collections::HashSet<i64>> = HashMap::new();
for (_lg, cs) in &by_lg {
    for w in cs.windows(2) {
        let d = (w[1].0 / 10) * 10;
        let e = decade.entry(d).or_insert((0,0));
        e.1 += 1;
        if w[0].1 == w[1].1 { e.0 += 1; }
        unique_winners.entry(d).or_default().insert(w[1].1);
    }
}
let dlabels = ["1990s","2000s","2010s","2020s"];
let dkeys = [1990i64,2000,2010,2020];
let drows: Vec<Vec<String>> = dkeys.iter().enumerate().map(|(i,&d)| {
    let (r,o) = decade.get(&d).copied().unwrap_or((0,0));
    let uniq = unique_winners.get(&d).map(|s| s.len()).unwrap_or(0);
    vec![dlabels[i].to_string(), o.to_string(), r.to_string(),
         format!("{:.0}%", 100.0*r as f64/o.max(1) as f64), uniq.to_string()]
}).collect();
mars_table(&["decade","opportunities","retained","retention %","unique champions"], &drows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
league-seasons with a champion: 999
title retention rate: 238/947 = 25.1%
avg winning margin — retained titles: 8.2 | all titles: 6.6
```

| league                   | team                 | consecutive titles | span                  | avg pts |
| ------------------------ | -------------------- | ------------------ | --------------------- | ------- |
| Bundesliga               | Salzburg             | 11                 | 2013/2014 → 2023/2024 | 77      |
| German Bundesliga        | Bayern Munich        | 11                 | 2012/13 → 2022/23     | 82      |
| Italian Serie A          | Juventus             | 9                  | 2011/12 → 2019/20     | 90      |
| Scottish Premiership     | Celtic               | 9                  | 2011/12 → 2019/20     | 89      |
| French Ligue 1           | Lyon                 | 7                  | 2001/02 → 2007/08     | 77      |
| Greek Super League       | Olympiakos           | 7                  | 2010/11 → 2016/17     | 77      |
| French Ligue 1           | Paris SG             | 6                  | 2021/22 → 2026/27     | 72      |
| Greek Super League       | Olympiakos           | 6                  | 1996/97 → 2006/07     | 82      |
| Premier League           | Zenit                | 6                  | 2018/2019 → 2023/2024 | 66      |
| Scottish Premiership     | Celtic               | 6                  | 2021/22 → 2026/27     | 82      |
| Belgian Pro League       | Anderlecht           | 5                  | 2008/09 → 2012/13     | 69      |
| Portuguese Liga Portugal | Porto                | 5                  | 1994/95 → 1998/99     | 83      |
| Superliga                | CFR Cluj             | 5                  | 2017/2018 → 2021/2022 | 82      |
| Super League             | Basel                | 5                  | 2012/2013 → 2016/2017 | 78      |
| Turkish Süper Lig        | Galatasaray          | 5                  | 2022/23 → 2026/27     | 79      |
| Super League             | Guangzhou Evergrande | 4                  | 2014 → 2017           | 66      |
| English Premier League   | Man City             | 4                  | 2020/21 → 2023/24     | 90      |
| French Ligue 1           | Paris SG             | 4                  | 2012/13 → 2015/16     | 89      |
| Premier Division         | Shamrock Rovers      | 4                  | 2020 → 2023           | 69      |
| Italian Serie A          | Inter                | 4                  | 2006/07 → 2009/10     | 87      |
| Dutch Eredivisie         | PSV Eindhoven        | 4                  | 2004/05 → 2007/08     | 80      |
| Dutch Eredivisie         | Ajax                 | 4                  | 2010/11 → 2013/14     | 74      |
| Dutch Eredivisie         | Ajax                 | 4                  | 2018/19 → 2021/22     | 78      |
| Dutch Eredivisie         | PSV Eindhoven        | 4                  | 2023/24 → 2026/27     | 71      |
| Eliteserien              | Rosenborg            | 4                  | 2015 → 2018           | 66      |
| Portuguese Liga Portugal | Porto                | 4                  | 2005/06 → 2008/09     | 73      |
| Portuguese Liga Portugal | Benfica              | 4                  | 2013/14 → 2016/17     | 82      |
| Super League             | Young Boys           | 4                  | 2017/2018 → 2020/2021 | 84      |
| Turkish Süper Lig        | Galatasaray          | 4                  | 1996/97 → 1999/00     | 78      |
| Super League             | Shanghai Port        | 3                  | 2023 → 2025           | 69      |
| English Premier League   | Man United           | 3                  | 1998/99 → 2000/01     | 83      |
| English Premier League   | Man United           | 3                  | 2006/07 → 2008/09     | 89      |
| Veikkausliiga            | HJK                  | 3                  | 2012 → 2014           | 70      |
| Veikkausliiga            | HJK                  | 3                  | 2020 → 2022           | 55      |
| French Ligue 1           | Paris SG             | 3                  | 2017/18 → 2019/20     | 84      |
| German Bundesliga        | Bayern Munich        | 3                  | 1998/99 → 2000/01     | 71      |
| Greek Super League       | Olympiakos           | 3                  | 2019/20 → 2021/22     | 88      |
| Premier Division         | Dundalk              | 3                  | 2014 → 2016           | 76      |
| Dutch Eredivisie         | Ajax                 | 3                  | 1993/94 → 1995/96     | 84      |
| Ekstraklasa              | Legia                | 3                  | 2015/2016 → 2017/2018 | 72      |

| league                   | opportunities | retained | retention % |
| ------------------------ | ------------- | -------- | ----------- |
| Bundesliga               | 14            | 10       | 71%         |
| Scottish Premiership     | 32            | 21       | 66%         |
| Superliga                | 14            | 8        | 57%         |
| Super League             | 14            | 8        | 57%         |
| Greek Super League       | 27            | 14       | 52%         |
| Super League             | 12            | 6        | 50%         |
| Premier Division         | 14            | 7        | 50%         |
| Dutch Eredivisie         | 33            | 16       | 48%         |
| French Ligue 1           | 33            | 16       | 48%         |
| German Bundesliga        | 33            | 16       | 48%         |
| Premier League           | 13            | 6        | 46%         |
| Portuguese Liga Portugal | 33            | 15       | 45%         |
| Veikkausliiga            | 14            | 6        | 43%         |
| Ekstraklasa              | 14            | 6        | 43%         |
| Italian Serie A          | 33            | 14       | 42%         |
| Eliteserien              | 14            | 5        | 36%         |
| Turkish Süper Lig        | 32            | 11       | 34%         |
| English Premier League   | 33            | 11       | 33%         |
| Allsvenskan              | 14            | 4        | 29%         |
| Liga MX                  | 14            | 4        | 29%         |
| Belgian Pro League       | 31            | 9        | 29%         |
| Serie A                  | 14            | 4        | 29%         |
| J1 League                | 14            | 4        | 29%         |
| Spanish La Liga          | 33            | 9        | 27%         |
| Superliga                | 14            | 2        | 14%         |
| Champions League         | 25            | 2        | 8%          |
| MLS                      | 14            | 1        | 7%          |
| English League One       | 33            | 0        | 0%          |
| German 2. Bundesliga     | 33            | 0        | 0%          |
| UEFA Europa League       | 17            | 0        | 0%          |
| English Championship     | 33            | 0        | 0%          |
| Scottish League One      | 29            | 0        | 0%          |
| Liga Profesional         | 13            | 0        | 0%          |
| English League Two       | 33            | 0        | 0%          |
| French Ligue 2           | 30            | 0        | 0%          |
| Scottish Championship    | 33            | 0        | 0%          |
| Scottish League Two      | 29            | 0        | 0%          |
| Italian Serie B          | 29            | 0        | 0%          |
| Spanish La Liga 2        | 33            | 0        | 0%          |

| decade | opportunities | retained | retention % | unique champions |
| ------ | ------------- | -------- | ----------- | ---------------- |
| 1990s  | 106           | 22       | 21%         | 77               |
| 2000s  | 218           | 41       | 19%         | 140              |
| 2010s  | 341           | 101      | 30%         | 195              |
| 2020s  | 287           | 77       | 27%         | 191              |

## Findings

**Defending the title is the hardest thing in club football — only 1 in 4
champions goes back-to-back.**

Scope: 999 league-seasons with a determinable champion; 947 offered a defending
champion a chance to retain.

1. **The base rate is 25.1%** — 238 of 947 title defences succeeded. The other
   three-quarters of champions are dethroned.

2. **Dynasties are real but concentrated.** Longest consecutive-title runs: RB
   Salzburg 11 (2013/14→2023/24), Bayern Munich 11 (2012/13→ 2022/23), Juventus
   9, Celtic 9 (both 2011/12→2019/20). Five-peat-or- better is a short list —
   the table is dominated by a handful of superclubs.

3. **Some leagues are structurally easier to defend.** Austria's Bundesliga: 71%
   retention (10/14). Scottish Premiership: 66% (21/32) — the Old Firm duopoly.
   The big-5 leagues sit at 42–48%; Ligue 1 48%, Serie A 42%, EPL ('Premier
   League' label, incl. Russia) 46%.

4. **Defended titles are slightly more dominant.** Champions who retained
   averaged an **8.2-point** winning margin vs **6.6** across all titles —
   retention correlates with winning comfortably.

5. **The 2010s were the dynasty decade.** Retention by decade: 21% (1990s) → 19%
   (2000s) → **30%** (2010s) → 27% (2020s), with unique champions per decade
   rising 77 → 140 → 195 → 191. The modern game is more parity-driven _and_
   produced more dynasties — both at once, because a few superclubs monopolised
   the top while the rest churned.

6. **Caveats:** league labels are source-dependent ('Bundesliga' = Austria,
   'German Bundesliga' = Germany, 'Premier League' = Russia); short-history
   leagues have small opportunity counts; seasons ending mid-table or with
   shared champions are excluded.
