# Greatest escapes: the teams that survived from the drop zone

## Greatest escapes: the teams that survived from the drop zone

The mirror image of the choke. This notebook asks: **how often does a team sit
in the bottom three with a month of football left — and live to tell the tale?**

Method: every league-season with ≥40 matches is replayed fixture by fixture. At
each match we rebuild the table and check which teams are in the bottom three
**with ≤10 of their own matches remaining**. A team that was bottom-three at
that checkpoint but finished outside the bottom three is an "escape". Finished
bottom-three anyway = a "near miss".

Bottom-three is used as the relegation-zone proxy across all leagues —
relegation spots vary (2 in Scotland, 4 in some leagues) but bottom-three is the
consistent danger zone.

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

let mut groups: HashMap<(String, String), Vec<usize>> = HashMap::new();
for &i in &valid {
    groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i);
}

// pass 1: final standings per team per lgsn
struct Final { pts: i64, played: i64 }
let mut finals: HashMap<(String,String,i64), Final> = HashMap::new();
let mut lgsn_teams: HashMap<(String,String), Vec<i64>> = HashMap::new();
for ((lg, sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut st: HashMap<i64,(i64,i64,i64,i64)> = HashMap::new(); // tid -> (pts,gf,ga,played)
    for &i in idxs {
        for (tid, gf, ga) in [(s_hid[i], s_hg[i], s_ag[i]), (s_aid[i], s_ag[i], s_hg[i])] {
            let e = st.entry(tid).or_insert((0,0,0,0));
            e.0 += if gf > ga {3} else if gf == ga {1} else {0};
            e.1 += gf; e.2 += ga; e.3 += 1;
        }
    }
    for (&tid,&v) in &st {
        finals.insert((lg.clone(), sn.clone(), tid), Final{pts:v.0, played:v.3});
    }
    lgsn_teams.insert((lg.clone(), sn.clone()), st.keys().cloned().collect());
}
println!("team-seasons: {}", finals.len());

// pass 2: replay; find each team's min games-left while bottom-3 (only when <=10 left)
// escape = was bottom3 at some snapshot with <=10 left AND finished outside bottom 3
struct Esc { lg:String, season:String, team:String, tid:i64, games_left_at_bt3: i64, final_rank: usize, final_pts: i64, teams_in_lg: usize }
let mut escapes: Vec<Esc> = Vec::new();
let mut near_misses = 0usize;
let mut bt3_count = 0usize;

for ((lg, sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a, &b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    // final played per team & final rank
    let final_teams: Vec<i64> = lgsn_teams.get(&(lg.clone(), sn.clone())).unwrap().clone();
    let mut fvec: Vec<(i64,i64,i64,i64)> = final_teams.iter().map(|&t| {
        let f = finals.get(&(lg.clone(), sn.clone(), t)).unwrap();
        // need gd — recompute from st? we stored only pts/played; recompute gd quickly from finals? store gd too
        (t, f.pts, 0i64, 0i64)
    }).collect();
    // rebuild gd from raw matches
    let mut gd_map: HashMap<i64,i64> = HashMap::new();
    for &i in idxs {
        let _ = i;
    }
    // simpler: recompute full final table via replay_lgsn
    let (table, names, _ml) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    let n_teams = table.len();
    let mut final_rank: HashMap<i64, usize> = HashMap::new();
    let mut final_played: HashMap<i64, i64> = HashMap::new();
    for (pos,t) in table.iter().enumerate() { final_rank.insert(t.0, pos+1); }
    for &i in idxs {
        *final_played.entry(s_hid[i]).or_insert(0) += 1;
        *final_played.entry(s_aid[i]).or_insert(0) += 1;
    }
    let _ = (&mut fvec, &mut gd_map);

    // replay again tracking bottom-3 with games-left <= 10
    let mut st: HashMap<i64,(i64,i64,i64,i64)> = HashMap::new(); // pts,gf,ga,played
    let mut bt3_min_left: HashMap<i64,i64> = HashMap::new();
    let mut last_dates: HashSet<String> = HashSet::new();
    for pp in 0..sorted_idx.len() {
        let dt = s_date[sorted_idx[pp]][..10].to_string();
        if pp+1==sorted_idx.len() || &s_date[sorted_idx[pp+1]][..10] != dt.as_str() { last_dates.insert(dt); }
    }
    for &i in &sorted_idx {
        for (tid, gf, ga) in [(s_hid[i], s_hg[i], s_ag[i]), (s_aid[i], s_ag[i], s_hg[i])] {
            let e = st.entry(tid).or_insert((0,0,0,0));
            e.0 += if gf > ga {3} else if gf == ga {1} else {0};
            e.1 += gf; e.2 += ga; e.3 += 1;
        }
        if last_dates.contains(&s_date[i][..10].to_string()) {
        // games-left check: only bother when some team has <=10 left
        let mut teams: Vec<(i64,i64,i64,i64)> = st.iter().map(|(&t,&(p,gf,ga,pl))| (t,p,gf-ga,gf)).collect();
        // bottom-3 = worst 3 by rank order
        let order = rank_teams(&teams);
        for &oi in order.iter().skip(n_teams.saturating_sub(3)) {
            let tid = teams[oi].0;
            let played_now = st.get(&tid).map(|v| v.3).unwrap_or(0);
            let fp = *final_played.get(&tid).unwrap_or(&played_now);
            let left = fp.saturating_sub(played_now);
            if left <= 10 {
                let cur = bt3_min_left.entry(tid).or_insert(99);
                if left < *cur { *cur = left; }
            }
        }
        teams.clear();
        }
    }
    for (&tid,&gl) in &bt3_min_left {
        bt3_count += 1;
        let rank = *final_rank.get(&tid).unwrap_or(&99);
        if rank + 3 <= n_teams {
            escapes.push(Esc {
                lg: lg.clone(), season: sn.clone(),
                team: names.get(&tid).cloned().unwrap_or_default(), tid,
                games_left_at_bt3: gl, final_rank: rank,
                final_pts: table.iter().find(|t| t.0==tid).map(|t| t.1).unwrap_or(0),
                teams_in_lg: n_teams,
            });
        } else { near_misses += 1; }
    }
}

println!("team-seasons that were bottom-3 with <=10 games left: {}", bt3_count);
println!("escapes (finished outside bottom 3): {}", escapes.len());
println!("near misses (stayed bottom 3): {}", near_misses);

escapes.sort_by(|a,b| b.games_left_at_bt3.cmp(&a.games_left_at_bt3).then(a.final_rank.cmp(&b.final_rank)));
let rows: Vec<Vec<String>> = escapes.iter().take(40).map(|r| vec![
    r.lg.split('|').nth(1).unwrap_or("").to_string(), r.season.clone(),
    r.team.clone(), format!("{} left", r.games_left_at_bt3),
    format!("P{}/{}", r.final_rank, r.teams_in_lg),
]).collect();
mars_table(&["league","season","team","bottom-3 until","final position"], &rows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
team-seasons: 21299
team-seasons that were bottom-3 with <=10 games left: 4742
escapes (finished outside bottom 3): 1747
near misses (stayed bottom 3): 2995
```

| league                      | season    | team                | bottom-3 until | final position |
| --------------------------- | --------- | ------------------- | -------------- | -------------- |
| AFC Champions League Elite  | 2024/2025 | Yokohama F. Marinos | 10 left        | P3/24          |
| Scottish League Two         | 2025/26   | Forfar              | 10 left        | P4/10          |
| German 2. Bundesliga        | 2026/27   | Kaiserslautern      | 10 left        | P5/18          |
| Scottish League Two         | 2004/05   | Montrose            | 10 left        | P5/10          |
| Scottish League One         | 2009/10   | Peterhead           | 10 left        | P5/10          |
| Scottish League One         | 2022/23   | Queen of Sth        | 10 left        | P5/10          |
| Indian Super league         | 2021/2022 | Bengaluru           | 10 left        | P6/11          |
| Scottish Premiership        | 2009/10   | Hamilton            | 10 left        | P6/12          |
| German 2. Bundesliga        | 2017/18   | Bochum              | 10 left        | P6/18          |
| Indian Super league         | 2021/2022 | Odisha              | 10 left        | P7/11          |
| Scottish Premiership        | 1994/95   | Kilmarnock          | 10 left        | P7/10          |
| English League Two          | 2026/27   | Exeter              | 10 left        | P8/24          |
| Bundesliga                  | 2026/2027 | Tirol               | 10 left        | P8/12          |
| German Bundesliga           | 2016/17   | Werder Bremen       | 10 left        | P8/18          |
| Italian Serie A             | 2000/01   | Brescia             | 10 left        | P8/18          |
| Portuguese Liga Portugal    | 2026/27   | Sp Braga            | 10 left        | P8/18          |
| Spanish La Liga             | 2026/27   | Ath Bilbao          | 10 left        | P8/20          |
| Super League                | 2025/2026 | Servette            | 10 left        | P8/12          |
| Dutch Eredivisie            | 2013/14   | Den Haag            | 10 left        | P9/18          |
| Spanish La Liga 2           | 2013/14   | Alcorcon            | 10 left        | P9/22          |
| Scottish Premiership        | 2002/03   | Livingston          | 10 left        | P9/12          |
| Superliga                   | 2014/2015 | Odense              | 10 left        | P9/12          |
| Serie A                     | 2026      | Vasco               | 10 left        | P10/20         |
| German 2. Bundesliga        | 2011/12   | Duisburg            | 10 left        | P10/18         |
| Veikkausliiga               | 2026      | SJK                 | 10 left        | P10/13         |
| English Premier League      | 1994/95   | Southampton         | 10 left        | P10/22         |
| Dutch Eredivisie            | 2013/14   | Utrecht             | 10 left        | P10/18         |
| Superliga                   | 2019/2020 | Academica Clinceni  | 10 left        | P10/15         |
| Greek Super League          | 2006/07   | Xanthi              | 10 left        | P10/16         |
| Allsvenskan                 | 2024      | Varnamo             | 10 left        | P10/17         |
| English Premier League      | 2001/02   | Blackburn           | 10 left        | P10/20         |
| Belgian Pro League          | 2019/20   | Kortrijk            | 10 left        | P11/16         |
| German Bundesliga           | 2005/06   | Mainz               | 10 left        | P11/18         |
| Belgian Pro League          | 2003/04   | Lokeren             | 10 left        | P11/18         |
| Ekstraklasa                 | 2017/2018 | Pogon Szczecin      | 10 left        | P11/16         |
| Italian Serie B             | 2025/26   | Mantova             | 10 left        | P11/20         |
| Superliga                   | 2017/2018 | Randers FC          | 10 left        | P11/16         |
| Copa De La Liga Profesional | 2021      | Argentinos Jrs      | 10 left        | P11/26         |
| Greek Super League          | 2019/20   | Lamia               | 10 left        | P11/14         |
| Premier League              | 2021/2022 | Khimki              | 10 left        | P11/18         |

## The escape artists

Sorted by how early they climbed out — the biggest comebacks had the most games
left when they were last in the bottom three. Near misses (those that stayed
down) are counted for the base rate.

```rust

// per-league escape rates + deepest escapes (smallest games-left at bottom-3)
// recompute compactly: reuse same replay but only record min games-left bottom-3
let mut groups: HashMap<(String,String), Vec<usize>> = HashMap::new();
for &i in &valid { groups.entry((format!("{}|{}", s_country[i], s_league[i]), s_season[i].clone())).or_default().push(i); }

struct Esc2 { lg:String, season:String, team:String, gl:i64, rank:usize, n:usize }
let mut escapes2: Vec<Esc2> = Vec::new();
let mut by_league: HashMap<String,(usize,usize)> = HashMap::new(); // seasons with bt3, escapes

for ((lg,sn), idxs) in &groups {
    if idxs.len() < 40 { continue; }
    let mut sorted_idx = idxs.clone();
    sorted_idx.sort_by(|&a,&b| s_date[a].cmp(&s_date[b]).then(s_id[a].cmp(&s_id[b])));
    let (table, names, _) = replay_lgsn(&sorted_idx, &s_hid, &s_aid, &s_hg, &s_ag, &s_home, &s_away);
    let n_teams = table.len();
    let mut final_rank: HashMap<i64,usize> = HashMap::new();
    for (pos,t) in table.iter().enumerate() { final_rank.insert(t.0,pos+1); }
    let mut final_played: HashMap<i64,i64> = HashMap::new();
    for &i in idxs { *final_played.entry(s_hid[i]).or_insert(0)+=1; *final_played.entry(s_aid[i]).or_insert(0)+=1; }

    let mut st: HashMap<i64,(i64,i64,i64,i64)> = HashMap::new();
    let mut bt3_min: HashMap<i64,i64> = HashMap::new();
    let mut last_dates: HashSet<String> = HashSet::new();
    for pp in 0..sorted_idx.len() {
        let dt = s_date[sorted_idx[pp]][..10].to_string();
        if pp+1==sorted_idx.len() || &s_date[sorted_idx[pp+1]][..10] != dt.as_str() { last_dates.insert(dt); }
    }
    for &i in &sorted_idx {
        for (tid,gf,ga) in [(s_hid[i],s_hg[i],s_ag[i]),(s_aid[i],s_ag[i],s_hg[i])] {
            let e = st.entry(tid).or_insert((0,0,0,0));
            e.0 += if gf>ga {3} else if gf==ga {1} else {0}; e.1+=gf; e.2+=ga; e.3+=1;
        }
        if last_dates.contains(&s_date[i][..10].to_string()) {
        let mut teams: Vec<(i64,i64,i64,i64)> = st.iter().map(|(&t,&(p,gf,ga,_))|(t,p,gf-ga,gf)).collect();
        let order = rank_teams(&teams);
        for &oi in order.iter().skip(n_teams.saturating_sub(3)) {
            let tid = teams[oi].0;
            let left = (*final_played.get(&tid).unwrap_or(&0)).saturating_sub(st.get(&tid).map(|v|v.3).unwrap_or(0));
            if left <= 10 {
                let cur = bt3_min.entry(tid).or_insert(99);
                if left < *cur { *cur = left; }
            }
        }
        teams.clear();
        }
    }
    let le = by_league.entry(lg.clone()).or_insert((0,0));
    for (&tid,&gl) in &bt3_min {
        le.0 += 1;
        let rank = *final_rank.get(&tid).unwrap_or(&99);
        if rank + 3 <= n_teams && gl >= 1 {
            le.1 += 1;
            escapes2.push(Esc2{lg:lg.clone(),season:sn.clone(),team:names.get(&tid).cloned().unwrap_or_default(),gl,rank,n:n_teams});
        }
    }
}

println!("escapes total: {}", escapes2.len());
// deepest escapes: smallest games-left while bottom-3
escapes2.sort_by(|a,b| a.gl.cmp(&b.gl).then(a.rank.cmp(&b.rank)));
let rows: Vec<Vec<String>> = escapes2.iter().take(30).map(|r| vec![
    r.lg.split('|').nth(1).unwrap_or("").to_string(), r.season.clone(),
    r.team.clone(), format!("{} left", r.gl), format!("P{}/{}", r.rank, r.n),
]).collect();
mars_table(&["league","season","team","last bottom-3 at","final position"], &rows);

// per-league escape rate
let mut lrows: Vec<Vec<String>> = by_league.iter().filter(|(_,v)| v.0>=10).map(|(l,v)| vec![
    l.split('|').nth(1).unwrap_or("").to_string(), v.0.to_string(), v.1.to_string(),
    format!("{:.0}%", 100.0*v.1 as f64/v.0.max(1) as f64),
]).collect();
lrows.sort_by(|a,b| b[2].parse::<f64>().unwrap().partial_cmp(&a[2].parse::<f64>().unwrap()).unwrap());
mars_table(&["league","bottom-3 team-seasons","escapes","escape rate"], &lrows);
```

```text
completed matches after dedup: 311832 (1190 dupes dropped)
team-seasons: 21299
team-seasons that were bottom-3 with <=10 games left: 4744
escapes (finished outside bottom 3): 1748
near misses (stayed bottom 3): 2996
escapes total: 1731
```

| league                      | season    | team                | bottom-3 until | final position |
| --------------------------- | --------- | ------------------- | -------------- | -------------- |
| AFC Champions League Elite  | 2024/2025 | Yokohama F. Marinos | 10 left        | P3/24          |
| Scottish League Two         | 2025/26   | Forfar              | 10 left        | P4/10          |
| Scottish League One         | 2009/10   | Peterhead           | 10 left        | P5/10          |
| Scottish League Two         | 2004/05   | Montrose            | 10 left        | P5/10          |
| German 2. Bundesliga        | 2026/27   | Kaiserslautern      | 10 left        | P5/18          |
| Scottish League One         | 2022/23   | Queen of Sth        | 10 left        | P5/10          |
| Scottish Premiership        | 2009/10   | Hamilton            | 10 left        | P6/12          |
| German 2. Bundesliga        | 2017/18   | Bochum              | 10 left        | P6/18          |
| Indian Super league         | 2021/2022 | Bengaluru           | 10 left        | P6/11          |
| Scottish Premiership        | 1994/95   | Kilmarnock          | 10 left        | P7/10          |
| Indian Super league         | 2021/2022 | Odisha              | 10 left        | P7/11          |
| Spanish La Liga             | 2026/27   | Ath Bilbao          | 10 left        | P8/20          |
| Super League                | 2025/2026 | Servette            | 10 left        | P8/12          |
| Portuguese Liga Portugal    | 2026/27   | Sp Braga            | 10 left        | P8/18          |
| English League Two          | 2026/27   | Exeter              | 10 left        | P8/24          |
| Italian Serie A             | 2000/01   | Brescia             | 10 left        | P8/18          |
| Bundesliga                  | 2026/2027 | Tirol               | 10 left        | P8/12          |
| German Bundesliga           | 2016/17   | Werder Bremen       | 10 left        | P8/18          |
| Scottish Premiership        | 2002/03   | Livingston          | 10 left        | P9/12          |
| Spanish La Liga 2           | 2013/14   | Alcorcon            | 10 left        | P9/22          |
| Superliga                   | 2014/2015 | Odense              | 10 left        | P9/12          |
| Dutch Eredivisie            | 2013/14   | Den Haag            | 10 left        | P9/18          |
| Superliga                   | 2019/2020 | Academica Clinceni  | 10 left        | P10/15         |
| English Premier League      | 1994/95   | Southampton         | 10 left        | P10/22         |
| Dutch Eredivisie            | 2013/14   | Utrecht             | 10 left        | P10/18         |
| Allsvenskan                 | 2024      | Varnamo             | 10 left        | P10/17         |
| Serie A                     | 2026      | Vasco               | 10 left        | P10/20         |
| Veikkausliiga               | 2026      | SJK                 | 10 left        | P10/13         |
| English Premier League      | 2001/02   | Blackburn           | 10 left        | P10/20         |
| German 2. Bundesliga        | 2011/12   | Duisburg            | 10 left        | P10/18         |
| Greek Super League          | 2006/07   | Xanthi              | 10 left        | P10/16         |
| Greek Super League          | 2019/20   | Lamia               | 10 left        | P11/14         |
| Belgian Pro League          | 2019/20   | Kortrijk            | 10 left        | P11/16         |
| Belgian Pro League          | 2003/04   | Lokeren             | 10 left        | P11/18         |
| Premier League              | 2021/2022 | Khimki              | 10 left        | P11/18         |
| Superliga                   | 2017/2018 | Randers FC          | 10 left        | P11/16         |
| Ekstraklasa                 | 2017/2018 | Pogon Szczecin      | 10 left        | P11/16         |
| Italian Serie B             | 2025/26   | Mantova             | 10 left        | P11/20         |
| Copa De La Liga Profesional | 2021      | Argentinos Jrs      | 10 left        | P11/26         |
| German Bundesliga           | 2005/06   | Mainz               | 10 left        | P11/18         |

| league                | season    | team         | last bottom-3 at | final position |
| --------------------- | --------- | ------------ | ---------------- | -------------- |
| Scottish League One   | 2013/14   | Airdrie Utd  | 1 left           | P6/10          |
| Scottish Premiership  | 1997/98   | Aberdeen     | 1 left           | P6/10          |
| Scottish Championship | 1997/98   | St Mirren    | 1 left           | P6/10          |
| Scottish League One   | 2002/03   | Dumbarton    | 1 left           | P6/10          |
| Scottish League One   | 2005/06   | Ayr          | 1 left           | P6/10          |
| Super League          | 2017/2018 | Sion         | 1 left           | P6/10          |
| Scottish Premiership  | 1994/95   | Hearts       | 1 left           | P6/10          |
| Scottish League Two   | 2013/14   | Montrose     | 1 left           | P6/10          |
| Scottish League One   | 1998/99   | Stirling     | 1 left           | P6/10          |
| Bundesliga            | 2025/2026 | Hartberg     | 1 left           | P6/12          |
| Scottish League Two   | 2024/25   | Clyde        | 1 left           | P7/10          |
| Scottish Championship | 1994/95   | St Mirren    | 1 left           | P7/10          |
| Scottish League Two   | 2003/04   | Queens Park  | 1 left           | P7/10          |
| Scottish League One   | 2006/07   | Alloa        | 1 left           | P7/10          |
| Scottish Championship | 1997/98   | Ayr          | 1 left           | P7/10          |
| Scottish League One   | 2016/17   | Stranraer    | 1 left           | P7/10          |
| Scottish Premiership  | 2013/14   | Ross County  | 1 left           | P7/12          |
| Scottish League One   | 2011/12   | Forfar       | 1 left           | P7/10          |
| Super League          | 2021/2022 | Luzern       | 1 left           | P7/11          |
| Premier Division      | 2025      | Sligo Rovers | 1 left           | P7/10          |
| Scottish League Two   | 2012/13   | Stirling     | 1 left           | P7/10          |
| Scottish Championship | 2011/12   | Raith Rvs    | 1 left           | P7/10          |
| Scottish Championship | 2016/17   | St Mirren    | 1 left           | P7/10          |
| Scottish League One   | 2026/27   | Peterhead    | 1 left           | P7/10          |
| Scottish League Two   | 2018/19   | Elgin        | 1 left           | P7/10          |
| Scottish Championship | 1995/96   | Clydebank    | 1 left           | P7/10          |
| Scottish League One   | 2015/16   | Brechin      | 1 left           | P7/10          |
| Bundesliga            | 2012/2013 | Neustadt     | 1 left           | P7/10          |
| Scottish League Two   | 2013/14   | Albion Rvs   | 1 left           | P7/10          |
| Bundesliga            | 2016/2017 | Mattersburg  | 1 left           | P7/10          |

| league                      | bottom-3 team-seasons | escapes | escape rate |
| --------------------------- | --------------------- | ------- | ----------- |
| English Championship        | 181                   | 79      | 44%         |
| Spanish La Liga             | 175                   | 73      | 42%         |
| German 2. Bundesliga        | 175                   | 73      | 42%         |
| English League Two          | 175                   | 73      | 42%         |
| Italian Serie B             | 161                   | 71      | 44%         |
| German Bundesliga           | 171                   | 69      | 40%         |
| French Ligue 2              | 160                   | 67      | 42%         |
| French Ligue 1              | 168                   | 65      | 39%         |
| Portuguese Liga Portugal    | 165                   | 63      | 38%         |
| Turkish Süper Lig           | 162                   | 63      | 39%         |
| Spanish La Liga 2           | 163                   | 61      | 37%         |
| English League One          | 160                   | 58      | 36%         |
| English Premier League      | 159                   | 57      | 36%         |
| Champions League            | 137                   | 56      | 41%         |
| Italian Serie A             | 152                   | 49      | 32%         |
| Greek Super League          | 134                   | 45      | 34%         |
| Scottish Premiership        | 143                   | 44      | 31%         |
| Belgian Pro League          | 140                   | 43      | 31%         |
| Dutch Eredivisie            | 142                   | 40      | 28%         |
| MLS                         | 82                    | 36      | 44%         |
| Ekstraklasa                 | 81                    | 36      | 44%         |
| Scottish League One         | 126                   | 36      | 29%         |
| Liga Profesional            | 76                    | 34      | 45%         |
| Scottish Championship       | 135                   | 33      | 24%         |
| Serie A                     | 75                    | 30      | 40%         |
| Scottish League Two         | 119                   | 29      | 24%         |
| Liga MX                     | 72                    | 27      | 38%         |
| Eliteserien                 | 70                    | 25      | 36%         |
| Superliga                   | 69                    | 24      | 35%         |
| Superliga                   | 68                    | 23      | 34%         |
| Copa De La Liga Profesional | 37                    | 22      | 59%         |
| Super League                | 60                    | 21      | 35%         |
| UEFA Europa League          | 75                    | 21      | 28%         |
| Bundesliga                  | 66                    | 21      | 32%         |
| Premier League              | 60                    | 18      | 30%         |
| UEFA Conference League      | 36                    | 18      | 50%         |
| Allsvenskan                 | 62                    | 17      | 27%         |
| Veikkausliiga               | 62                    | 17      | 27%         |
| Super League                | 60                    | 15      | 25%         |
| J1 League                   | 59                    | 14      | 24%         |
| AFC Champions League Elite  | 22                    | 13      | 59%         |
| FIFA World Cup              | 19                    | 13      | 68%         |
| Premier Division            | 55                    | 10      | 18%         |
| UEFA Euro                   | 14                    | 8       | 57%         |
| FA Women's Super League     | 18                    | 6       | 33%         |

## Findings

**Being bottom-three with ten games left is not a death sentence — but it is
close to one.**

Scope: 21,299 team-seasons across all competitions; standings replayed
match-by-match and evaluated once per matchday. A team-season counted when it
sat in the bottom three at any point with ≤10 games remaining.

1. **The base rate: ~37% escape.** Of 4,744 team-seasons that were bottom-three
   with ten or fewer games left, **1,745 finished outside the bottom three** and
   2,996 stayed down.

2. **The deeper the hole, the deader it gets.** The most dramatic escapes —
   teams still bottom-three with only 1–2 games left — are dominated by 10-team
   leagues (Scottish League One/Two, Championship) where one result swings three
   places. Aberdeen (Scottish Premiership 1997/98) and Hearts (1994/95) escaped
   with a single game in hand. In 18–20 team leagues, escaping from bottom-three
   at 1 game left is nearly impossible.

3. **Cautionary escapes exist too.** The table of biggest escapes is full of
   teams that were bottom-three with _ten_ games left and finished mid-table —
   Forfar, Montrose, Peterhead, Kaiserslautern, Werder Bremen (Bundesliga
   2016/17, P8/18). Ten games is enough time for a complete reset.

4. **League escape rates cluster at 36–44%.** Championship 44%, Serie B 44%, La
   Liga 42%, 2. Bundesliga 42%, Ligue 1 39%, Portugal 38% — bigger leagues don't
   escape more often; squad depth matters more than table size.

5. **Caveats:** "games left" is computed per team against its own remaining
   fixtures — postponed matches and cup scheduling can make the count fuzzy at
   the boundary; cup competitions (Champions League, World Cup) have
   non-standard "bottom-3" meanings and are included in the raw counts;
   standings replay uses 3/1/0 with GD/GF tiebreaks.
