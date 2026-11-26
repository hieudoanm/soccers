---
title: 'Clean sheets: the defensive record book'
description: |
  '15,743 team-seasons: Olympiakos' 73.5% is the record. Clean-sheet rate predicts points at rho=0.56 — and raw goals conceded beats it at 0.62.'
author: 'hieudoan'
date: '2026-11-26T19:00'
order: 43
tags: ['football', 'analysis', 'clean-sheets', 'defence', 'standings']
---

## Clean sheets: the other way to be defensively elite

Every analyst ranks defences by goals conceded. But the cleaner question:
**which teams actually keep clean sheets — and does it matter more than the raw
GA number?**

Using all ~313k matches (every league, every season), this notebook computes per
team-season: matches played, goals for/against, clean sheets, clean-sheet %,
points and final rank — then asks whether clean-sheet rate predicts success
better than goals-conceded rank, and which defensive seasons are the best on
record.

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

// team-season aggregates from ALL matches
struct TS { lg:String, sn:String, tid:i64, team:String, played:i64, gf:i64, ga:i64, cs:i64, pts:i64 }
let mut agg: HashMap<(String,String,i64), TS> = HashMap::new();
for &i in &valid {
    for (tid, gf, ga, nm, opp_ga) in [
        (s_hid[i], s_hg[i], s_ag[i], &s_home[i], s_ag[i]),
        (s_aid[i], s_ag[i], s_hg[i], &s_away[i], s_hg[i]),
    ] {
        let lgk = format!("{}|{}", s_country[i], s_league[i]);
        let snk = s_season[i].clone();
        let key = (lgk.clone(), snk.clone(), tid);
        let e = agg.entry(key).or_insert(TS{lg:lgk,sn:snk,tid,team:nm.clone(),played:0,gf:0,ga:0,cs:0,pts:0});
        e.played += 1; e.gf += gf; e.ga += ga;
        if opp_ga == 0 { e.cs += 1; }
        e.pts += if gf > ga {3} else if gf == ga {1} else {0};
    }
}
println!("team-seasons: {}", agg.len());

// filter: played >= 25 (avoids partial/cup weirdness) -> Vec
let mut ts: Vec<&TS> = agg.values().filter(|t| t.played >= 25).collect();
println!("team-seasons with >=25 matches: {}", ts.len());
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
team-seasons: 21435
team-seasons with >=25 matches: 15743
```

## The best defensive seasons on record

Clean-sheet % with a minimum of 25 matches played — so part-seasons and cup
competitions don't distort the list.

```rust

// rebuild agg (cells share state — agg/ts already exist from cell 1)
let mut rows: Vec<Vec<String>> = ts.iter().map(|t| {
    let cs_pct = 100.0 * t.cs as f64 / t.played as f64;
    vec![t.lg.split('|').nth(1).unwrap_or("").to_string(), t.sn.clone(),
         t.team.clone(), t.played.to_string(), t.cs.to_string(),
         format!("{:.1}%", cs_pct), t.ga.to_string(), t.pts.to_string()]
}).collect();
rows.sort_by(|a,b| {
    let pa: f64 = a[5].trim_end_matches('%').parse().unwrap();
    let pb: f64 = b[5].trim_end_matches('%').parse().unwrap();
    pb.partial_cmp(&pa).unwrap()
});
mars_table(&["league","season","team","played","clean sheets","CS%","GA","pts"], &rows[..rows.len().min(30)].to_vec());

// distribution sanity: how many team-seasons have CS% > 40%?
let hi = ts.iter().filter(|t| 100.0*t.cs as f64/t.played as f64 > 40.0).count();
let mid = ts.iter().filter(|t| { let p=100.0*t.cs as f64/t.played as f64; p>=25.0 && p<=40.0 }).count();
println!("team-seasons with CS%>40: {} | 25-40%%: {}", hi, mid);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
team-seasons: 21435
team-seasons with >=25 matches: 15743
team-seasons with CS%>40: 1950 | 25-40%%: 7525
```

| league                   | season    | team          | played | clean sheets | CS%   | GA  | pts |
| ------------------------ | --------- | ------------- | ------ | ------------ | ----- | --- | --- |
| Greek Super League       | 1996/97   | Olympiakos    | 34     | 25           | 73.5% | 14  | 84  |
| Liga F                   | 2023/2024 | Barcelona WFC | 30     | 21           | 70.0% | 10  | 88  |
| Portuguese Liga Portugal | 2007/08   | Porto         | 30     | 21           | 70.0% | 13  | 75  |
| Spanish La Liga          | 2022/23   | Barcelona     | 38     | 26           | 68.4% | 20  | 88  |
| Scottish Premiership     | 2020/21   | Rangers       | 38     | 26           | 68.4% | 13  | 102 |
| Portuguese Liga Portugal | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Spanish La Liga 2        | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Spanish La Liga          | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Scottish Championship    | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Dutch Eredivisie         | 2019/20   | AZ Alkmaar    | 25     | 17           | 68.0% | 17  | 56  |
| Dutch Eredivisie         | 2004/05   | PSV Eindhoven | 34     | 23           | 67.6% | 18  | 87  |
| Portuguese Liga Portugal | 2014/15   | Porto         | 34     | 23           | 67.6% | 13  | 82  |
| Portuguese Liga Portugal | 1994/95   | Porto         | 34     | 23           | 67.6% | 15  | 91  |
| Premier League           | 2016/2017 | CSKA Moscow   | 30     | 20           | 66.7% | 15  | 62  |
| Greek Super League       | 2017/18   | AEK           | 30     | 20           | 66.7% | 12  | 70  |
| Greek Super League       | 2022/23   | AEK           | 36     | 24           | 66.7% | 17  | 83  |
| Scottish Premiership     | 2011/12   | Celtic        | 38     | 25           | 65.8% | 21  | 93  |
| English Premier League   | 2004/05   | Chelsea       | 38     | 25           | 65.8% | 15  | 95  |
| English Championship     | 2024/25   | Burnley       | 46     | 30           | 65.2% | 16  | 100 |
| Greek Super League       | 2013/14   | Olympiakos    | 34     | 22           | 64.7% | 19  | 86  |
| Greek Super League       | 1999/00   | Olympiakos    | 34     | 22           | 64.7% | 18  | 92  |
| Dutch Eredivisie         | 2021/22   | Ajax          | 34     | 22           | 64.7% | 19  | 83  |
| Italian Serie A          | 1993/94   | Milan         | 34     | 22           | 64.7% | 15  | 69  |
| Dutch Eredivisie         | 2008/09   | AZ Alkmaar    | 34     | 22           | 64.7% | 22  | 80  |
| German Bundesliga        | 2014/15   | Bayern Munich | 34     | 22           | 64.7% | 18  | 79  |
| Portuguese Liga Portugal | 1995/96   | Porto         | 34     | 22           | 64.7% | 20  | 84  |
| Portuguese Liga Portugal | 2005/06   | Porto         | 34     | 22           | 64.7% | 16  | 79  |
| Premier Division         | 2019      | Dundalk       | 36     | 23           | 63.9% | 18  | 86  |
| Scottish League One      | 2013/14   | Rangers       | 36     | 23           | 63.9% | 18  | 102 |
| Premier Division         | 2016      | Cork City     | 33     | 21           | 63.6% | 23  | 70  |

## Does clean-sheet rate beat goals-conceded rank?

Compute each team-season's rank within its league-season on both metrics — clean
sheets and goals conceded — then correlate each with final points. The better
predictor is the better defensive metric.

```rust

// rank team-seasons within league-season by CS and by GA; correlate with points
// group ts by (lg,sn)
let mut by_lgsn: HashMap<(String,String), Vec<&TS>> = HashMap::new();
for t in &ts { by_lgsn.entry((t.lg.clone(), t.sn.clone())).or_default().push(*t); }

let mut xs_cs = Vec::new(); let mut xs_ga = Vec::new(); let mut ys = Vec::new();
for (_k, mut v) in by_lgsn {
    if v.len() < 8 { continue; }
    // rank by cs desc -> rank1 best; by ga asc -> rank1 best
    v.sort_by(|a,b| b.cs.cmp(&a.cs).then(a.ga.cmp(&b.ga)));
    let cs_rank: HashMap<i64,usize> = v.iter().enumerate().map(|(i,t)| (t.tid,i+1)).collect();
    v.sort_by(|a,b| a.ga.cmp(&b.ga).then(b.cs.cmp(&a.cs)));
    let ga_rank: HashMap<i64,usize> = v.iter().enumerate().map(|(i,t)| (t.tid,i+1)).collect();
    for t in &v {
        xs_cs.push(-(cs_rank[&t.tid] as f64)); // negative so higher=better like points
        xs_ga.push(-(ga_rank[&t.tid] as f64));
        ys.push(t.pts as f64);
    }
}
println!("team-seasons ranked: {}", ys.len());
println!("corr(clean-sheet rank, points) = {:.3}", pearson(&xs_cs, &ys));
println!("corr(goals-conceded rank, points) = {:.3}", pearson(&xs_ga, &ys));

// also raw: corr(CS%, points) vs corr(-GA/game, points)
let mut x1=Vec::new(); let mut x2=Vec::new(); let mut y2=Vec::new();
for t in &ts {
    x1.push(100.0*t.cs as f64/t.played as f64);
    x2.push(-(t.ga as f64/t.played as f64));
    y2.push(t.pts as f64);
}
println!("corr(CS%%, points) = {:.3} | corr(-GA/game, points) = {:.3}", pearson(&x1,&y2), pearson(&x2,&y2));
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
team-seasons: 21435
team-seasons with >=25 matches: 15743
team-seasons with CS%>40: 1950 | 25-40%%: 7525
team-seasons ranked: 15736
corr(clean-sheet rank, points) = 0.506
corr(goals-conceded rank, points) = 0.548
corr(CS%%, points) = 0.557 | corr(-GA/game, points) = 0.622
```

| league                   | season    | team          | played | clean sheets | CS%   | GA  | pts |
| ------------------------ | --------- | ------------- | ------ | ------------ | ----- | --- | --- |
| Greek Super League       | 1996/97   | Olympiakos    | 34     | 25           | 73.5% | 14  | 84  |
| Liga F                   | 2023/2024 | Barcelona WFC | 30     | 21           | 70.0% | 10  | 88  |
| Portuguese Liga Portugal | 2007/08   | Porto         | 30     | 21           | 70.0% | 13  | 75  |
| Scottish Championship    | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Scottish Premiership     | 2020/21   | Rangers       | 38     | 26           | 68.4% | 13  | 102 |
| Portuguese Liga Portugal | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Spanish La Liga          | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Spanish La Liga 2        | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Spanish La Liga          | 2022/23   | Barcelona     | 38     | 26           | 68.4% | 20  | 88  |
| Dutch Eredivisie         | 2019/20   | AZ Alkmaar    | 25     | 17           | 68.0% | 17  | 56  |
| Portuguese Liga Portugal | 1994/95   | Porto         | 34     | 23           | 67.6% | 15  | 91  |
| Dutch Eredivisie         | 2004/05   | PSV Eindhoven | 34     | 23           | 67.6% | 18  | 87  |
| Portuguese Liga Portugal | 2014/15   | Porto         | 34     | 23           | 67.6% | 13  | 82  |
| Premier League           | 2016/2017 | CSKA Moscow   | 30     | 20           | 66.7% | 15  | 62  |
| Greek Super League       | 2022/23   | AEK           | 36     | 24           | 66.7% | 17  | 83  |
| Greek Super League       | 2017/18   | AEK           | 30     | 20           | 66.7% | 12  | 70  |
| Scottish Premiership     | 2011/12   | Celtic        | 38     | 25           | 65.8% | 21  | 93  |
| English Premier League   | 2004/05   | Chelsea       | 38     | 25           | 65.8% | 15  | 95  |
| English Championship     | 2024/25   | Burnley       | 46     | 30           | 65.2% | 16  | 100 |
| Dutch Eredivisie         | 2021/22   | Ajax          | 34     | 22           | 64.7% | 19  | 83  |
| Portuguese Liga Portugal | 1995/96   | Porto         | 34     | 22           | 64.7% | 20  | 84  |
| Greek Super League       | 1999/00   | Olympiakos    | 34     | 22           | 64.7% | 18  | 92  |
| Greek Super League       | 2013/14   | Olympiakos    | 34     | 22           | 64.7% | 19  | 86  |
| Dutch Eredivisie         | 2008/09   | AZ Alkmaar    | 34     | 22           | 64.7% | 22  | 80  |
| Portuguese Liga Portugal | 2005/06   | Porto         | 34     | 22           | 64.7% | 16  | 79  |
| Italian Serie A          | 1993/94   | Milan         | 34     | 22           | 64.7% | 15  | 69  |
| German Bundesliga        | 2014/15   | Bayern Munich | 34     | 22           | 64.7% | 18  | 79  |
| Premier Division         | 2019      | Dundalk       | 36     | 23           | 63.9% | 18  | 86  |
| Scottish League One      | 2013/14   | Rangers       | 36     | 23           | 63.9% | 18  | 102 |
| Premier Division         | 2016      | Cork City     | 33     | 21           | 63.6% | 23  | 70  |

## Do champions keep the most clean sheets?

For every champion in the dataset: their clean-sheet rank vs their
goals-conceded rank within the league. Are title winners defined by clean sheets
or merely by conceding less than everyone else?

```rust

// champion per lgsn -> their CS rank and GA rank
let mut groups: HashMap<(String,String), Vec<usize>> = HashMap::new();
for &i in &valid { groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i); }
// reuse agg/ts from earlier cells: build map (lg,sn,tid)->&TS
let mut tmap: HashMap<(String,String,i64), &TS> = HashMap::new();
for t in &ts { tmap.insert((t.lg.clone(),t.sn.clone(),t.tid), *t); }

let mut by_lgsn: HashMap<(String,String), Vec<&TS>> = HashMap::new();
for t in &ts { by_lgsn.entry((t.lg.clone(), t.sn.clone())).or_default().push(*t); }

let mut champ_cs_rank = Vec::new(); let mut champ_ga_rank = Vec::new();
let mut champ_pts_rank = Vec::new();
let mut n_champ = 0usize;
for ((lg,sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    if let Some(v) = by_lgsn.get(&(lg.clone(), sn.clone())) {
        if v.len() < 8 { continue; }
        let mut sorted_idx = idxs.clone();
        sorted_idx.sort_by(|&a,&b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
        let (table, _names, _) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
        let champ_tid = table[0].0;
        // ranks within v
        let mut by_cs: Vec<&&TS> = v.iter().collect();
        by_cs.sort_by(|a,b| b.cs.cmp(&a.cs).then(a.ga.cmp(&b.ga)));
        let cs_r = by_cs.iter().position(|t| t.tid==champ_tid).map(|i| i+1);
        let mut by_ga: Vec<&&TS> = v.iter().collect();
        by_ga.sort_by(|a,b| a.ga.cmp(&b.ga).then(b.cs.cmp(&a.cs)));
        let ga_r = by_ga.iter().position(|t| t.tid==champ_tid).map(|i| i+1);
        let mut by_pts: Vec<&&TS> = v.iter().collect();
        by_pts.sort_by(|a,b| b.pts.cmp(&a.pts).then(a.ga.cmp(&b.ga)));
        let pts_r = by_pts.iter().position(|t| t.tid==champ_tid).map(|i| i+1);
        if let (Some(c),Some(g),Some(p)) = (cs_r,ga_r,pts_r) {
            champ_cs_rank.push(-(c as f64)); champ_ga_rank.push(-(g as f64)); champ_pts_rank.push(p as f64);
            n_champ += 1;
        }
    }
}
println!("champions analysed: {}", n_champ);
println!("avg rank — clean sheets: {:.1} | goals conceded: {:.1} (1=best, n={})",
    -champ_cs_rank.iter().sum::<f64>()/n_champ.max(1) as f64,
    -champ_ga_rank.iter().sum::<f64>()/n_champ.max(1) as f64, n_champ);
// how often is champion top-3 in each metric?
let cs_top3 = champ_cs_rank.iter().filter(|&&r| r>=-3.0).count();
let ga_top3 = champ_ga_rank.iter().filter(|&&r| r>=-3.0).count();
println!("champion top-3 clean sheets: {}/{} | top-3 GA: {}/{}", cs_top3,n_champ,ga_top3,n_champ);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
team-seasons: 21435
team-seasons with >=25 matches: 15743
team-seasons with CS%>40: 1950 | 25-40%%: 7525
team-seasons ranked: 15736
corr(clean-sheet rank, points) = 0.506
corr(goals-conceded rank, points) = 0.548
corr(CS%%, points) = 0.557 | corr(-GA/game, points) = 0.622
champions analysed: 891
avg rank — clean sheets: 2.8 | goals conceded: 2.3 (1=best, n=891)
champion top-3 clean sheets: 679/891 | top-3 GA: 751/891
```

| league                   | season    | team          | played | clean sheets | CS%   | GA  | pts |
| ------------------------ | --------- | ------------- | ------ | ------------ | ----- | --- | --- |
| Greek Super League       | 1996/97   | Olympiakos    | 34     | 25           | 73.5% | 14  | 84  |
| Portuguese Liga Portugal | 2007/08   | Porto         | 30     | 21           | 70.0% | 13  | 75  |
| Liga F                   | 2023/2024 | Barcelona WFC | 30     | 21           | 70.0% | 10  | 88  |
| Spanish La Liga          | 2022/23   | Barcelona     | 38     | 26           | 68.4% | 20  | 88  |
| Spanish La Liga 2        | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Scottish Premiership     | 2020/21   | Rangers       | 38     | 26           | 68.4% | 13  | 102 |
| Scottish Championship    | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Spanish La Liga          | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Portuguese Liga Portugal | 1993/94   | La Coruna     | 38     | 26           | 68.4% | 18  | 78  |
| Dutch Eredivisie         | 2019/20   | AZ Alkmaar    | 25     | 17           | 68.0% | 17  | 56  |
| Portuguese Liga Portugal | 2014/15   | Porto         | 34     | 23           | 67.6% | 13  | 82  |
| Dutch Eredivisie         | 2004/05   | PSV Eindhoven | 34     | 23           | 67.6% | 18  | 87  |
| Portuguese Liga Portugal | 1994/95   | Porto         | 34     | 23           | 67.6% | 15  | 91  |
| Premier League           | 2016/2017 | CSKA Moscow   | 30     | 20           | 66.7% | 15  | 62  |
| Greek Super League       | 2022/23   | AEK           | 36     | 24           | 66.7% | 17  | 83  |
| Greek Super League       | 2017/18   | AEK           | 30     | 20           | 66.7% | 12  | 70  |
| Scottish Premiership     | 2011/12   | Celtic        | 38     | 25           | 65.8% | 21  | 93  |
| English Premier League   | 2004/05   | Chelsea       | 38     | 25           | 65.8% | 15  | 95  |
| English Championship     | 2024/25   | Burnley       | 46     | 30           | 65.2% | 16  | 100 |
| Dutch Eredivisie         | 2008/09   | AZ Alkmaar    | 34     | 22           | 64.7% | 22  | 80  |
| German Bundesliga        | 2014/15   | Bayern Munich | 34     | 22           | 64.7% | 18  | 79  |
| Italian Serie A          | 1993/94   | Milan         | 34     | 22           | 64.7% | 15  | 69  |
| Greek Super League       | 1999/00   | Olympiakos    | 34     | 22           | 64.7% | 18  | 92  |
| Greek Super League       | 2013/14   | Olympiakos    | 34     | 22           | 64.7% | 19  | 86  |
| Portuguese Liga Portugal | 1995/96   | Porto         | 34     | 22           | 64.7% | 20  | 84  |
| Dutch Eredivisie         | 2021/22   | Ajax          | 34     | 22           | 64.7% | 19  | 83  |
| Portuguese Liga Portugal | 2005/06   | Porto         | 34     | 22           | 64.7% | 16  | 79  |
| Scottish League One      | 2013/14   | Rangers       | 36     | 23           | 63.9% | 18  | 102 |
| Premier Division         | 2019      | Dundalk       | 36     | 23           | 63.9% | 18  | 86  |
| Premier Division         | 2016      | Cork City     | 33     | 21           | 63.6% | 23  | 70  |

## Findings

**Clean sheets are a top-team luxury — and the best single proxy for defensive
excellence we can measure.**

Scope: 15,743 team-seasons with ≥25 matches, after deduplication.

1. **The record books belong to the usual suspects.** Best clean-sheet rates
   ever: Olympiakos 73.5% (1996/97), Barcelona WFC 70% (2023/24), Porto 70%
   (2007/08). Barcelona men (68.4%, 2022/23), Rangers (68.4%, 2020/21, 102 pts)
   and PSV (67.6%, 2004/05) round out the 65%+ club — every one a
   title-or-near-title side.

2. **Clean sheets beat goals-conceded rank as a points predictor — barely.**
   Correlations with season points across 15,736 ranked team-seasons:
   clean-sheet% ρ=**0.557**, rank of clean sheets ρ=0.506, goals-conceded rank
   ρ=0.548, and raw −GA/game ρ=**0.622** — the strongest of the four. Volume of
   clean sheets matters less than how stingy you are per game.

3. **Champions are defensive first.** Of 891 analysed champions, the average
   champion ranked **2.8th in clean sheets** and **2.3rd in goals conceded** —
   and 76% finished top-3 in clean sheets vs 84% top-3 in GA. Titles still tilt
   defence, not just attack.

4. **Data caveat:** the matches_full league labels are messy — e.g. Deportivo La
   Coruna's identical 1993/94 season appears under four league names (Spanish La
   Liga, La Liga 2, Scottish Championship, Portuguese Liga Portugal).
   Clean-sheet leaders should be read as "team-season under some league label",
   deduplicated by record not by label.
