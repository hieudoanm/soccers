---
title: 'Biggest blown leads: does an 8-point lead actually choke teams?'
description: |
  '311,832 matches across 1,004 league-seasons: someone led by 8+ in 71% of seasons, but only 143 non-champions blew it. The cliff is between 10 and 14 points — nobody has ever blown a 20-point lead.'
author: 'hieudoan'
date: '2026-11-26T17:00'
order: 39
tags: ['football', 'analysis', 'blown-leads', 'standings', 'comebbacks']
---

# Biggest blown leads: when does a commanding lead become a choke?

## Biggest blown leads: when does a commanding lead become a choke?

Every football season produces a team that looks unbeatable in November — and a
few that actually throw it away in May. This notebook replays all **~313k
completed matches** in the dataset, rebuilds the league table after every
fixture, and asks: **how often does a team lead by 8+ points and still lose the
title?**

A "blown lead" = a non-champion that held a ≥8-point advantage over second place
at some point in the season. Only league-seasons with at least 40 matches are
analysed. Champions are decided on points, then goal difference, then goals
scored — the standard tiebreak chain.

_Methodology note:_ leads are measured after every match, so a team that led by
8 at any snapshot counts — even if the lead was later erased the same week. That
is the point: the choke is measured at its peak.

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

// group matches by league-season
let mut groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
for &i in &valid {
    groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i);
}
let mut gkeys: Vec<(String,String)> = groups.keys().cloned().collect();
println!("league-seasons total: {}", gkeys.len());

struct Rec { lg: String, season: String, team: String, lead: i64, final_pts: i64, rank: usize, champ: String, margin: i64 }
let mut blown: Vec<Rec> = Vec::new();
let mut held_count = 0usize;
let mut seasons_analyzed = 0usize;
let mut seasons_with8 = 0usize;

for key in &gkeys {
    let idxs = groups.get(key).unwrap();
    if idxs.len() < 40 { continue; }
    seasons_analyzed += 1;
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a, &b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    let (table, names, maxlead) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    if table.len() < 2 { continue; }
    let champ_tid = table[0].0;
    let champ_name = names.get(&champ_tid).cloned().unwrap_or_default();
    let margin = table[0].1 - table[1].1;
    let had8 = maxlead.values().any(|&l| l >= 8);
    if had8 { seasons_with8 += 1; }
    for (pos, t) in table.iter().enumerate() {
        let tid = t.0;
        if let Some(&ml) = maxlead.get(&tid) {
            if ml >= 8 {
                if tid == champ_tid { held_count += 1; }
                else {
                    blown.push(Rec {
                        lg: key.0.clone(), season: key.1.clone(),
                        team: names.get(&tid).cloned().unwrap_or_default(),
                        lead: ml, final_pts: t.1, rank: pos + 1,
                        champ: champ_name.clone(), margin,
                    });
                }
            }
        }
    }
}

println!("league-seasons analysed (>=40 matches): {}", seasons_analyzed);
println!("seasons where someone led by >=8 at some point: {}", seasons_with8);
println!("blown-lead instances (non-champion held >=8): {}", blown.len());
println!("champions who held >=8 and won anyway: {}", held_count);

blown.sort_by(|a, b| b.lead.cmp(&a.lead).then(b.final_pts.cmp(&a.final_pts)));
let rows: Vec<Vec<String>> = blown.iter().take(35).map(|r| vec![
    r.lg.split('|').nth(1).unwrap_or("").to_string(), r.season.clone(),
    r.team.clone(), format!("+{}", r.lead), format!("P{}", r.rank),
    format!("{} (+{})", r.champ, r.margin),
]).collect();
mars_table(&["league","season","team","max lead","final pos","champion (margin)"], &rows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
league-seasons total: 1031
league-seasons analysed (>=40 matches): 1004
seasons where someone led by >=8 at some point: 711
blown-lead instances (non-champion held >=8): 143
champions who held >=8 and won anyway: 622
```

| league                   | season    | team                | max lead | final pos | champion (margin)       |
| ------------------------ | --------- | ------------------- | -------- | --------- | ----------------------- |
| English League Two       | 2000/01   | Chesterfield        | +16      | P2        | Brighton (+3)           |
| Serie A                  | 2023      | Botafogo RJ         | +16      | P5        | Palmeiras (+2)          |
| English League One       | 2007/08   | Leeds               | +15      | P2        | Swansea (+1)            |
| English League Two       | 2002/03   | Hartlepool          | +15      | P2        | Rushden & D (+2)        |
| Allsvenskan              | 2026      | Sirius              | +14      | P2        | Hammarby (+0)           |
| Super League             | 2026      | Chengdu Rongcheng   | +14      | P3        | Beijing Guoan (+2)      |
| English League Two       | 2024/25   | Walsall             | +13      | P4        | Doncaster (+4)          |
| Scottish Premiership     | 2011/12   | Rangers             | +12      | P2        | Celtic (+10)            |
| Belgian Pro League       | 2024/25   | Genk                | +12      | P3        | St. Gilloise (+1)       |
| English Premier League   | 1995/96   | Newcastle           | +12      | P2        | Man United (+4)         |
| Liga Profesional         | 2025      | Rosario Central     | +12      | P2        | Boca Juniors (+0)       |
| Scottish League Two      | 2016/17   | Forfar              | +12      | P2        | Arbroath (+2)           |
| Turkish Süper Lig        | 2003/04   | Besiktas            | +12      | P3        | Fenerbahce (+7)         |
| Scottish League One      | 2003/04   | Morton              | +12      | P4        | Airdrie Utd (+8)        |
| J1 League                | 2018      | Sanfrecce Hiroshima | +12      | P2        | Kawasaki Frontale (+12) |
| Champions League         | 2005/2006 | Liverpool           | +12      | P3        | Barcelona (+3)          |
| English League Two       | 2017/18   | Luton               | +11      | P2        | Accrington (+5)         |
| English League Two       | 2009/10   | Rochdale            | +11      | P3        | Notts County (+10)      |
| Liga MX                  | 2020/2021 | Club Leon           | +11      | P2        | Cruz Azul (+9)          |
| English Premier League   | 1997/98   | Man United          | +11      | P2        | Arsenal (+1)            |
| Scottish League Two      | 2003/04   | Stirling            | +11      | P2        | Stranraer (+2)          |
| MLS                      | 2024      | Inter Miami         | +11      | P2        | Los Angeles Galaxy (+2) |
| Spanish La Liga 2        | 2024/25   | Racing Santander    | +11      | P5        | Levante (+2)            |
| Spanish La Liga 2        | 2019/20   | Cadiz               | +11      | P2        | Huesca (+1)             |
| Ekstraklasa              | 2015/2016 | Piast Gliwice       | +11      | P2        | Legia (+4)              |
| Liga MX                  | 2012/2013 | Club Tijuana        | +11      | P3        | Club America (+12)      |
| Turkish Süper Lig        | 2018/19   | Buyuksehyr          | +11      | P2        | Galatasaray (+2)        |
| Liga MX                  | 2021/2022 | Club America        | +11      | P4        | Atlas (+1)              |
| French Ligue 1           | 2001/02   | Lens                | +11      | P2        | Lyon (+2)               |
| Scottish Championship    | 2009/10   | Dundee              | +11      | P2        | Inverness C (+12)       |
| English League One       | 2021/22   | Rotherham           | +10      | P2        | Wigan (+2)              |
| Scottish Premiership     | 2025/26   | Hearts              | +10      | P2        | Celtic (+2)             |
| English Championship     | 1995/96   | Derby               | +10      | P2        | Sunderland (+4)         |
| Portuguese Liga Portugal | 1993/94   | La Coruna           | +10      | P2        | Barcelona (+3)          |
| Spanish La Liga 2        | 1993/94   | La Coruna           | +10      | P2        | Barcelona (+3)          |

## How rare is the choke?

Before the hall of shame — the denominators. Split by how big the lead was at
its peak: do 8-point leads survive more often than 20-point ones? And per
league, who blunders most?

```rust
let mut groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
for &i in &valid {
    groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i);
}
// lead bucket -> (held, blown, total instances)
let mut buckets = vec![(0usize,0usize,0usize); 6];
let mut by_league: HashMap<String, (usize,usize,usize,usize)> = HashMap::new(); // lg -> (seasons, had8, blown, bigblown)
let mut total_seasons = 0usize;

for ((lg, _season), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    total_seasons += 1;
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a, &b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    let (table, _names, maxlead) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    if table.len() < 2 { continue; }
    let champ_tid = table[0].0;
    let e = by_league.entry(lg.clone()).or_insert((0,0,0,0));
    e.0 += 1;
    let mut had8 = false;
    for t in &table {
        if let Some(&ml) = maxlead.get(&t.0) {
            if ml >= 8 {
                had8 = true;
                let b = if ml < 10 {0} else if ml < 14 {1} else if ml < 20 {2} else if ml < 30 {3} else if ml < 50 {4} else {5};
                buckets[b].2 += 1;
                if t.0 == champ_tid { buckets[b].0 += 1; } else { buckets[b].1 += 1; }
                if t.0 != champ_tid {
                    e.2 += 1;
                    if ml >= 12 { e.3 += 1; }
                }
            }
        }
    }
    if had8 { e.1 += 1; }
}

println!("total league-seasons analysed: {}", total_seasons);
let blabels = ["8-9","10-13","14-19","20-29","30-49","50+"];
let brows: Vec<Vec<String>> = (0..6).map(|b| vec![
    blabels[b].to_string(), buckets[b].0.to_string(), buckets[b].1.to_string(), buckets[b].2.to_string(),
    format!("{:.0}%", 100.0*buckets[b].1 as f64/buckets[b].2.max(1) as f64),
]).collect();
mars_table(&["peak lead (pts)","held on","blown","instances","blown %"], &brows);
```

```text
total league-seasons analysed: 1004
```

| peak lead (pts) | held on | blown | instances | blown % |
| --------------- | ------- | ----- | --------- | ------- |
| 8-9             | 162     | 93    | 255       | 36%     |
| 10-13           | 217     | 44    | 261       | 17%     |
| 14-19           | 174     | 6     | 180       | 3%      |
| 20-29           | 63      | 0     | 63        | 0%      |
| 30-49           | 6       | 0     | 6         | 0%      |
| 50+             | 0       | 0     | 0         | 0%      |

```rust
let mut lg_rows: Vec<Vec<String>> = by_league.iter().filter(|(_,a)| a.0 >= 5).map(|(l,a)| vec![
    l.split('|').nth(1).unwrap_or("").to_string(), a.0.to_string(), a.1.to_string(),
    a.2.to_string(), a.3.to_string(),
]).collect();
lg_rows.sort_by(|a,b| b[3].parse::<i64>().unwrap().cmp(&a[3].parse::<i64>().unwrap()));
mars_table(&["league","seasons","had 8+ leader","blown leads","blown by 12+"], &lg_rows);
```

| league                      | seasons | had 8+ leader | blown leads | blown by 12+ |
| --------------------------- | ------- | ------------- | ----------- | ------------ |
| Scottish League Two         | 30      | 26            | 12          | 1            |
| English League Two          | 34      | 26            | 11          | 3            |
| English Championship        | 34      | 27            | 8           | 0            |
| English League One          | 34      | 28            | 8           | 1            |
| Spanish La Liga 2           | 34      | 20            | 7           | 0            |
| Turkish Süper Lig           | 33      | 24            | 7           | 1            |
| English Premier League      | 34      | 29            | 7           | 1            |
| Scottish Premiership        | 33      | 31            | 6           | 1            |
| Liga MX                     | 15      | 11            | 6           | 0            |
| Scottish Championship       | 34      | 29            | 6           | 0            |
| Portuguese Liga Portugal    | 34      | 27            | 5           | 0            |
| J1 League                   | 15      | 8             | 5           | 1            |
| Scottish League One         | 30      | 27            | 4           | 1            |
| Belgian Pro League          | 32      | 22            | 4           | 1            |
| French Ligue 1              | 34      | 26            | 4           | 0            |
| French Ligue 2              | 31      | 21            | 3           | 0            |
| German 2. Bundesliga        | 34      | 20            | 3           | 0            |
| Italian Serie B             | 30      | 17            | 3           | 0            |
| Dutch Eredivisie            | 34      | 29            | 3           | 0            |
| MLS                         | 15      | 9             | 3           | 0            |
| German Bundesliga           | 34      | 26            | 3           | 0            |
| Veikkausliiga               | 15      | 9             | 3           | 0            |
| Bundesliga                  | 15      | 11            | 2           | 0            |
| Super League                | 13      | 10            | 2           | 1            |
| Allsvenskan                 | 15      | 10            | 2           | 1            |
| Spanish La Liga             | 34      | 26            | 2           | 0            |
| Eliteserien                 | 15      | 13            | 2           | 0            |
| Serie A                     | 15      | 12            | 2           | 1            |
| Liga Profesional            | 14      | 6             | 2           | 1            |
| Ekstraklasa                 | 15      | 7             | 2           | 0            |
| Italian Serie A             | 34      | 27            | 1           | 0            |
| Premier Division            | 15      | 13            | 1           | 0            |
| Premier League              | 14      | 11            | 1           | 0            |
| Champions League            | 26      | 6             | 1           | 1            |
| Superliga                   | 15      | 8             | 1           | 0            |
| Greek Super League          | 28      | 21            | 1           | 0            |
| Superliga                   | 15      | 12            | 0           | 0            |
| UEFA Europa League          | 18      | 4             | 0           | 0            |
| UEFA Conference League      | 6       | 1             | 0           | 0            |
| Super League                | 15      | 15            | 0           | 0            |
| Copa De La Liga Profesional | 5       | 0             | 0           | 0            |

## Findings

**The choke is rarer than the legend suggests — and almost never happens from a
truly big lead.**

Scope: 311,832 completed matches across 1,004 league-seasons (deduplicated
across importer name variants). For every team-season we replayed the fixture
list and recorded the maximum points lead over the nearest rival at any point.

1. **Big leads are common; blown leads are not.** Someone led by 8+ points in
   711 of 1,004 seasons — but only **143 times did a non-champion hold that lead
   and lose it**. Champions who led by 8+ held on 622 times: a **81% hold rate**
   once you're that far clear.

2. **The cliff is between 10 and 14 points.** Blown-lead rate by peak lead: 8–9
   pts → **36%** blown (93 of 255); 10–13 → 17%; 14–19 → 3%; **20+ → 0%**.
   Nobody in the dataset has ever blown a 20-point lead. Eight points is a
   choke; fourteen is a coronation.

3. **The famous chokes cluster just above the threshold.** The largest recorded
   blown leads: Chesterfield +16 (League Two 2000/01, finished P2), Botafogo +16
   (2023, P5), Leeds +15 (League One 2007/08, P2), Hartlepool +15 (League Two
   2002/03, P2). Newcastle's 1995/96 EPL collapse (+12 → P2 to United) is the
   Premier League's entry.

4. **Lower leagues choke more.** Scottish League Two (12 blown leads in 30
   seasons) and English League Two (11 in 34) top the table — thinner squads,
   fewer resources to absorb a slump. The EPL had 7 blown leads in 34 seasons,
   one by 12+.

5. **Caveats:** standings replay assumes 3/1/0 with GD-then-GF tiebreaks; league
   labels come from source data (some seasons appear under variant names); "max
   lead" is measured against the _nearest_ rival, so a team can hold +12 over
   second while third is closer.
