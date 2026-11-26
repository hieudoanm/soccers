---
title: 'The discipline report: who collects cards and who concedes fouls'
description: |
  '152k player-match lines: forwards draw more fouls than they commit,
  Messi has drawn 1,747, Franco Vázquez fouls 3.8 times per game, and
  Granada averages a card per match.'
author: 'hieudoan'
date: '2026-11-28T16:00'
order: 54
tags:
  ['football', 'analysis', 'discipline', 'cards', 'statsbomb', 'mars', 'sqlite']
---

# The discipline report: who collects cards and who concedes fouls

## The discipline report: who collects cards and who concedes fouls

Every player-match line records fouls committed, fouls drawn, yellow and red
cards across ~152,000 appearances. This notebook builds the discipline tables:
the most-booked players, the most-fouling players, the players who _draw_ the
most fouls, and the teams whose matches are card-fests.

The question underneath: is aggression a coaching choice, a player trait, or a
tactical necessity — and does it correlate with anything we can measure (cards,
goals conceded, results)?

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

let pms = load("player_match_stat");
let pl = load("player");
let tm = load("team");

let pm_pid = col_i64(&pms, "player_id");
let pm_tid = col_i64(&pms, "team_id");
let pm_mid = col_i64(&pms, "match_id");
let pm_f = col_f64(&pms, "fouls_committed");
let pm_fd = col_f64(&pms, "fouls_drawn");
let pm_y = col_f64(&pms, "yellow_cards");
let pm_r = col_f64(&pms, "red_cards");
let pm_min = col_f64(&pms, "minutes_played");
let pm_g = col_f64(&pms, "goals");
let pm_a = col_f64(&pms, "assists");

let p_id = col_i64(&pl, "id");
let p_name = col_str(&pl, "name");
let p_pos = col_str(&pl, "position");
let mut pname: HashMap<i64,String> = HashMap::new();
let mut ppos: HashMap<i64,String> = HashMap::new();
for i in 0..pl.height() { pname.insert(p_id[i], p_name[i].clone()); ppos.insert(p_id[i], p_pos[i].clone()); }
let t_id = col_i64(&tm, "id");
let t_name = col_str(&tm, "name");
let mut tname: HashMap<i64,String> = HashMap::new();
for i in 0..tm.height() { tname.insert(t_id[i], t_name[i].clone()); }

struct P { pid: i64, apps: i64, mins: f64, f: f64, fd: f64, y: f64, r: f64, g: f64, a: f64 }
let mut agg: HashMap<i64, P> = HashMap::new();
for i in 0..pm_pid.len() {
    if pm_pid[i] <= 0 { continue; }
    let e = agg.entry(pm_pid[i]).or_insert(P{pid:pm_pid[i],apps:0,mins:0.0,f:0.0,fd:0.0,y:0.0,r:0.0,g:0.0,a:0.0});
    e.apps += 1;
    e.mins += if pm_min[i] > 0.0 { pm_min[i] } else { 90.0 };
    e.f += pm_f[i]; e.fd += pm_fd[i]; e.y += pm_y[i]; e.r += pm_r[i];
    e.g += pm_g[i]; e.a += pm_a[i];
}
let players: Vec<P> = agg.into_values().collect();
println!("players with stats: {}, total cards: {:.0}", players.len(),
    players.iter().map(|p| p.y+p.r).sum::<f64>());

let hdr = ["player","pos","apps","fouls","fouls/90","cards","cards/90","fouls drawn"];
let pos_group = |pos: &str| -> &'static str {
    let n = pos.to_lowercase();
    if n.contains("goalkeeper") { "GK" }
    else if n.contains("defen") || n.contains("back") { "DEF" }
    else if n.contains("midf") { "MID" }
    else if n.contains("attack") || n.contains("striker") || n.contains("wing") || n.contains("forward") { "FWD" }
    else { "UNK" }
};
let row_of = |p: &P| -> Vec<String> {
    vec![
        pname.get(&p.pid).cloned().unwrap_or_default().chars().take(26).collect(),
        pos_group(ppos.get(&p.pid).map(|s|s.as_str()).unwrap_or("")).to_string(),
        p.apps.to_string(),
        format!("{:.0}", p.f),
        format!("{:.2}", p.f*90.0/p.mins),
        format!("{:.0}", p.y+p.r),
        format!("{:.2}", (p.y+p.r)*90.0/p.mins),
        format!("{:.0}", p.fd),
    ]
};
```

```text
players with stats: 11794, total cards: 2855
```

```rust

// most cards per 90 (min 30 apps)
let mut cards: Vec<&P> = players.iter().filter(|p| p.apps >= 30).collect();
cards.sort_by(|a,b| ((b.y+b.r)*90.0/b.mins).partial_cmp(&((a.y+a.r)*90.0/a.mins)).unwrap());
mars_table(&hdr, &cards.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

```text
players with stats: 11794, total cards: 2855
```

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Fabián Ariel Orellana Vale | FWD | 49   | 50    | 1.10     | 13    | 0.29     | 122         |
| Yannick Cahuzac            | FWD | 33   | 60    | 2.23     | 7     | 0.26     | 32          |
| Deyverson Brum Silva Acost | FWD | 40   | 55    | 1.53     | 9     | 0.25     | 82          |
| Alexis Ruano Delgado       | DEF | 31   | 24    | 0.80     | 7     | 0.23     | 15          |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Iago Aspas Juncal          | FWD | 49   | 53    | 1.30     | 9     | 0.22     | 71          |
| Roberto Trashorras Gayoso  | DEF | 43   | 62    | 1.58     | 8     | 0.20     | 95          |
| Manuel Agudo Durán         | MID | 42   | 62    | 1.56     | 8     | 0.20     | 87          |
| Jonathas Cristian de Jesus | FWD | 48   | 76    | 1.74     | 8     | 0.18     | 74          |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Younousse Sankharé         | DEF | 33   | 54    | 1.86     | 5     | 0.17     | 53          |
| Esteban Félix Granero Moli | MID | 31   | 38    | 1.30     | 5     | 0.17     | 42          |
| Danilo Soddimo             | MID | 33   | 42    | 1.43     | 5     | 0.17     | 49          |
| Radja Nainggolan           | MID | 35   | 53    | 1.80     | 5     | 0.17     | 57          |
| Juan Torres Ruiz           | DEF | 31   | 44    | 1.47     | 5     | 0.17     | 28          |
| Charles Días Barbosa de Ol | FWD | 44   | 83    | 1.97     | 7     | 0.17     | 58          |
| Aleksandar Mitrović        | FWD | 45   | 63    | 1.49     | 7     | 0.17     | 76          |
| María Dolores Gallardo Nuñ | GK  | 37   | 0     | 0.00     | 6     | 0.16     | 1           |
| Fabrizio Cacciatore        | MID | 35   | 24    | 0.75     | 5     | 0.16     | 16          |
| Gary Alexis Medel Soto     | MID | 39   | 38    | 1.13     | 5     | 0.15     | 28          |

```rust

// most fouls committed per 90 (min 30 apps)
let mut fouls: Vec<&P> = players.iter().filter(|p| p.apps >= 30).collect();
fouls.sort_by(|a,b| (b.f*90.0/b.mins).partial_cmp(&(a.f*90.0/a.mins)).unwrap());
mars_table(&hdr, &fouls.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

```text
players with stats: 11794, total cards: 2855
```

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Fabián Ariel Orellana Vale | FWD | 49   | 50    | 1.10     | 13    | 0.29     | 122         |
| Yannick Cahuzac            | FWD | 33   | 60    | 2.23     | 7     | 0.26     | 32          |
| Deyverson Brum Silva Acost | FWD | 40   | 55    | 1.53     | 9     | 0.25     | 82          |
| Alexis Ruano Delgado       | DEF | 31   | 24    | 0.80     | 7     | 0.23     | 15          |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Iago Aspas Juncal          | FWD | 49   | 53    | 1.30     | 9     | 0.22     | 71          |
| Roberto Trashorras Gayoso  | DEF | 43   | 62    | 1.58     | 8     | 0.20     | 95          |
| Manuel Agudo Durán         | MID | 42   | 62    | 1.56     | 8     | 0.20     | 87          |
| Jonathas Cristian de Jesus | FWD | 48   | 76    | 1.74     | 8     | 0.18     | 74          |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Younousse Sankharé         | DEF | 33   | 54    | 1.86     | 5     | 0.17     | 53          |
| Esteban Félix Granero Moli | MID | 31   | 38    | 1.30     | 5     | 0.17     | 42          |
| Danilo Soddimo             | MID | 33   | 42    | 1.43     | 5     | 0.17     | 49          |
| Radja Nainggolan           | MID | 35   | 53    | 1.80     | 5     | 0.17     | 57          |
| Juan Torres Ruiz           | DEF | 31   | 44    | 1.47     | 5     | 0.17     | 28          |
| Charles Días Barbosa de Ol | FWD | 44   | 83    | 1.97     | 7     | 0.17     | 58          |
| Aleksandar Mitrović        | FWD | 45   | 63    | 1.49     | 7     | 0.17     | 76          |
| María Dolores Gallardo Nuñ | GK  | 37   | 0     | 0.00     | 6     | 0.16     | 1           |
| Fabrizio Cacciatore        | MID | 35   | 24    | 0.75     | 5     | 0.16     | 16          |
| Gary Alexis Medel Soto     | MID | 39   | 38    | 1.13     | 5     | 0.15     | 28          |

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Franco Damián Vázquez      | MID | 46   | 145   | 3.81     | 4     | 0.11     | 223         |
| Papa Kouly Diop            | DEF | 47   | 151   | 3.79     | 2     | 0.05     | 81          |
| Hernán Arsenio Pérez Gonzá | FWD | 36   | 104   | 3.51     | 1     | 0.03     | 63          |
| Pedro Pablo Hernández      | MID | 36   | 100   | 3.37     | 4     | 0.13     | 123         |
| Lorenzo Lollo              | MID | 31   | 86    | 3.28     | 0     | 0.00     | 46          |
| Gabriel Fernández Arenas   | DEF | 55   | 156   | 3.24     | 2     | 0.04     | 80          |
| Gonzalo Escalante          | DEF | 41   | 121   | 3.22     | 3     | 0.08     | 39          |
| Raúl García Escudero       | FWD | 55   | 150   | 3.08     | 5     | 0.10     | 128         |
| Cheikh N''Doye             | MID | 35   | 88    | 2.98     | 2     | 0.07     | 53          |
| Anderson Luís de Souza     | MID | 57   | 149   | 2.95     | 5     | 0.10     | 176         |
| Ignacio Camacho Barnola    | DEF | 31   | 84    | 2.90     | 3     | 0.10     | 56          |
| Lassana Diarra             | DEF | 31   | 78    | 2.85     | 0     | 0.00     | 40          |
| Paul Pogba                 | MID | 48   | 125   | 2.80     | 4     | 0.09     | 99          |
| Artur Ioniţă               | MID | 31   | 68    | 2.73     | 1     | 0.04     | 36          |
| Didier Ndong Ibrahim       | DEF | 34   | 80    | 2.70     | 0     | 0.00     | 43          |
| Karim Bellarabi            | FWD | 33   | 70    | 2.60     | 4     | 0.15     | 69          |
| Víctor Sánchez Mata        | FWD | 49   | 114   | 2.60     | 3     | 0.07     | 66          |
| Juraj Kucka                | DEF | 38   | 89    | 2.58     | 2     | 0.06     | 65          |
| Sofiane Boufal             | MID | 41   | 88    | 2.57     | 1     | 0.03     | 96          |
| José Luis García del Pozo  | DEF | 44   | 98    | 2.56     | 2     | 0.05     | 59          |

```rust

// most fouls drawn per 90 — the players defenders can't stop fouling
let mut drawn: Vec<&P> = players.iter().filter(|p| p.apps >= 30).collect();
drawn.sort_by(|a,b| (b.fd*90.0/b.mins).partial_cmp(&(a.fd*90.0/a.mins)).unwrap());
mars_table(&hdr, &drawn.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());
```

```text
players with stats: 11794, total cards: 2855
```

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Fabián Ariel Orellana Vale | FWD | 49   | 50    | 1.10     | 13    | 0.29     | 122         |
| Yannick Cahuzac            | FWD | 33   | 60    | 2.23     | 7     | 0.26     | 32          |
| Deyverson Brum Silva Acost | FWD | 40   | 55    | 1.53     | 9     | 0.25     | 82          |
| Alexis Ruano Delgado       | DEF | 31   | 24    | 0.80     | 7     | 0.23     | 15          |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Iago Aspas Juncal          | FWD | 49   | 53    | 1.30     | 9     | 0.22     | 71          |
| Roberto Trashorras Gayoso  | DEF | 43   | 62    | 1.58     | 8     | 0.20     | 95          |
| Manuel Agudo Durán         | MID | 42   | 62    | 1.56     | 8     | 0.20     | 87          |
| Jonathas Cristian de Jesus | FWD | 48   | 76    | 1.74     | 8     | 0.18     | 74          |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Younousse Sankharé         | DEF | 33   | 54    | 1.86     | 5     | 0.17     | 53          |
| Esteban Félix Granero Moli | MID | 31   | 38    | 1.30     | 5     | 0.17     | 42          |
| Danilo Soddimo             | MID | 33   | 42    | 1.43     | 5     | 0.17     | 49          |
| Radja Nainggolan           | MID | 35   | 53    | 1.80     | 5     | 0.17     | 57          |
| Juan Torres Ruiz           | DEF | 31   | 44    | 1.47     | 5     | 0.17     | 28          |
| Charles Días Barbosa de Ol | FWD | 44   | 83    | 1.97     | 7     | 0.17     | 58          |
| Aleksandar Mitrović        | FWD | 45   | 63    | 1.49     | 7     | 0.17     | 76          |
| María Dolores Gallardo Nuñ | GK  | 37   | 0     | 0.00     | 6     | 0.16     | 1           |
| Fabrizio Cacciatore        | MID | 35   | 24    | 0.75     | 5     | 0.16     | 16          |
| Gary Alexis Medel Soto     | MID | 39   | 38    | 1.13     | 5     | 0.15     | 28          |

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Franco Damián Vázquez      | MID | 46   | 145   | 3.81     | 4     | 0.11     | 223         |
| Papa Kouly Diop            | DEF | 47   | 151   | 3.79     | 2     | 0.05     | 81          |
| Hernán Arsenio Pérez Gonzá | FWD | 36   | 104   | 3.51     | 1     | 0.03     | 63          |
| Pedro Pablo Hernández      | MID | 36   | 100   | 3.37     | 4     | 0.13     | 123         |
| Lorenzo Lollo              | MID | 31   | 86    | 3.28     | 0     | 0.00     | 46          |
| Gabriel Fernández Arenas   | DEF | 55   | 156   | 3.24     | 2     | 0.04     | 80          |
| Gonzalo Escalante          | DEF | 41   | 121   | 3.22     | 3     | 0.08     | 39          |
| Raúl García Escudero       | FWD | 55   | 150   | 3.08     | 5     | 0.10     | 128         |
| Cheikh N''Doye             | MID | 35   | 88    | 2.98     | 2     | 0.07     | 53          |
| Anderson Luís de Souza     | MID | 57   | 149   | 2.95     | 5     | 0.10     | 176         |
| Ignacio Camacho Barnola    | DEF | 31   | 84    | 2.90     | 3     | 0.10     | 56          |
| Lassana Diarra             | DEF | 31   | 78    | 2.85     | 0     | 0.00     | 40          |
| Paul Pogba                 | MID | 48   | 125   | 2.80     | 4     | 0.09     | 99          |
| Artur Ioniţă               | MID | 31   | 68    | 2.73     | 1     | 0.04     | 36          |
| Didier Ndong Ibrahim       | DEF | 34   | 80    | 2.70     | 0     | 0.00     | 43          |
| Karim Bellarabi            | FWD | 33   | 70    | 2.60     | 4     | 0.15     | 69          |
| Víctor Sánchez Mata        | FWD | 49   | 114   | 2.60     | 3     | 0.07     | 66          |
| Juraj Kucka                | DEF | 38   | 89    | 2.58     | 2     | 0.06     | 65          |
| Sofiane Boufal             | MID | 41   | 88    | 2.57     | 1     | 0.03     | 96          |
| José Luis García del Pozo  | DEF | 44   | 98    | 2.56     | 2     | 0.05     | 59          |

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Franco Damián Vázquez      | MID | 46   | 145   | 3.81     | 4     | 0.11     | 223         |
| Neymar da Silva Santos Jun | FWD | 158  | 204   | 1.41     | 15    | 0.10     | 665         |
| Pedro Pablo Hernández      | MID | 36   | 100   | 3.37     | 4     | 0.13     | 123         |
| Bryan Dabo                 | DEF | 37   | 64    | 2.05     | 2     | 0.06     | 122         |
| Ronaldo de Assis Moreira   | FWD | 59   | 75    | 1.41     | 3     | 0.06     | 202         |
| Wilfried Zaha              | FWD | 34   | 43    | 1.57     | 2     | 0.07     | 102         |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Anderson Luís de Souza     | MID | 57   | 149   | 2.95     | 5     | 0.10     | 176         |
| Borja Valero Iglesias      | DEF | 44   | 52    | 1.39     | 3     | 0.08     | 129         |
| Nicolas de Roussel de Prév | MID | 36   | 67    | 2.24     | 0     | 0.00     | 103         |
| Eden Hazard                | FWD | 45   | 26    | 0.66     | 0     | 0.00     | 129         |
| Lionel Andrés Messi Cuccit | FWD | 603  | 417   | 0.77     | 27    | 0.05     | 1747        |
| Carlos Alberto Vela Garrid | FWD | 50   | 68    | 1.58     | 1     | 0.02     | 133         |
| Daniel Ceballos Fernández  | MID | 39   | 51    | 1.53     | 4     | 0.12     | 102         |
| Emmanuel Agyemang-Badu     | MID | 34   | 30    | 1.02     | 0     | 0.00     | 90          |
| Juan Guillermo Cuadrado Be | DEF | 43   | 41    | 1.09     | 1     | 0.03     | 113         |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Andrea Belotti             | FWD | 45   | 72    | 1.83     | 0     | 0.00     | 117         |
| Federico Dionisi           | FWD | 34   | 62    | 2.03     | 3     | 0.10     | 90          |
| Gilles Sunu                | FWD | 32   | 33    | 1.24     | 0     | 0.00     | 78          |

```rust

// raw card totals (volume kings)
let mut vol: Vec<&P> = players.iter().collect();
vol.sort_by(|a,b| (b.y+b.r).partial_cmp(&(a.y+a.r)).unwrap());
mars_table(&hdr, &vol.iter().take(20).map(|p| row_of(p)).collect::<Vec<_>>());

// red cards — every dismissal on record
let mut reds: Vec<&P> = players.iter().filter(|p| p.r > 0.0).collect();
reds.sort_by(|a,b| b.r.partial_cmp(&a.r).unwrap().then(b.apps.cmp(&a.apps)));
let rrows: Vec<Vec<String>> = reds.iter().take(20).map(|p| vec![
    pname.get(&p.pid).cloned().unwrap_or_default().chars().take(26).collect(),
    ppos.get(&p.pid).cloned().unwrap_or_default(),
    p.apps.to_string(),
    format!("{:.0}", p.r),
]).collect();
mars_table(&["player","pos","apps","red cards"], &rrows);

// position-level discipline averages
let mut pos_stats: HashMap<&str,(i64,f64,f64,f64,f64)> = HashMap::new();
for p in &players {
    let g = pos_group(ppos.get(&p.pid).map(|s|s.as_str()).unwrap_or(""));
    let e = pos_stats.entry(g).or_insert((0,0.0,0.0,0.0,0.0));
    e.0 += p.apps; e.1 += p.f; e.2 += p.fd; e.3 += p.y+p.r; e.4 += p.mins;
}
let prows: Vec<Vec<String>> = ["FWD","MID","DEF","GK","UNK"].iter().filter_map(|g| {
    pos_stats.get(*g).map(|(n,f,fd,c,m)| vec![
        g.to_string(), n.to_string(),
        format!("{:.2}", *f*90.0/ *m),
        format!("{:.2}", *fd*90.0/ *m),
        format!("{:.2}", *c*90.0/ *m),
    ])
}).collect();
mars_table(&["pos","apps","fouls committed/90","fouls drawn/90","cards/90"], &prows);
```

```text
players with stats: 11794, total cards: 2855
```

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Fabián Ariel Orellana Vale | FWD | 49   | 50    | 1.10     | 13    | 0.29     | 122         |
| Yannick Cahuzac            | FWD | 33   | 60    | 2.23     | 7     | 0.26     | 32          |
| Deyverson Brum Silva Acost | FWD | 40   | 55    | 1.53     | 9     | 0.25     | 82          |
| Alexis Ruano Delgado       | DEF | 31   | 24    | 0.80     | 7     | 0.23     | 15          |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Iago Aspas Juncal          | FWD | 49   | 53    | 1.30     | 9     | 0.22     | 71          |
| Roberto Trashorras Gayoso  | DEF | 43   | 62    | 1.58     | 8     | 0.20     | 95          |
| Manuel Agudo Durán         | MID | 42   | 62    | 1.56     | 8     | 0.20     | 87          |
| Jonathas Cristian de Jesus | FWD | 48   | 76    | 1.74     | 8     | 0.18     | 74          |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Younousse Sankharé         | DEF | 33   | 54    | 1.86     | 5     | 0.17     | 53          |
| Esteban Félix Granero Moli | MID | 31   | 38    | 1.30     | 5     | 0.17     | 42          |
| Danilo Soddimo             | MID | 33   | 42    | 1.43     | 5     | 0.17     | 49          |
| Radja Nainggolan           | MID | 35   | 53    | 1.80     | 5     | 0.17     | 57          |
| Juan Torres Ruiz           | DEF | 31   | 44    | 1.47     | 5     | 0.17     | 28          |
| Charles Días Barbosa de Ol | FWD | 44   | 83    | 1.97     | 7     | 0.17     | 58          |
| Aleksandar Mitrović        | FWD | 45   | 63    | 1.49     | 7     | 0.17     | 76          |
| María Dolores Gallardo Nuñ | GK  | 37   | 0     | 0.00     | 6     | 0.16     | 1           |
| Fabrizio Cacciatore        | MID | 35   | 24    | 0.75     | 5     | 0.16     | 16          |
| Gary Alexis Medel Soto     | MID | 39   | 38    | 1.13     | 5     | 0.15     | 28          |

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Franco Damián Vázquez      | MID | 46   | 145   | 3.81     | 4     | 0.11     | 223         |
| Papa Kouly Diop            | DEF | 47   | 151   | 3.79     | 2     | 0.05     | 81          |
| Hernán Arsenio Pérez Gonzá | FWD | 36   | 104   | 3.51     | 1     | 0.03     | 63          |
| Pedro Pablo Hernández      | MID | 36   | 100   | 3.37     | 4     | 0.13     | 123         |
| Lorenzo Lollo              | MID | 31   | 86    | 3.28     | 0     | 0.00     | 46          |
| Gabriel Fernández Arenas   | DEF | 55   | 156   | 3.24     | 2     | 0.04     | 80          |
| Gonzalo Escalante          | DEF | 41   | 121   | 3.22     | 3     | 0.08     | 39          |
| Raúl García Escudero       | FWD | 55   | 150   | 3.08     | 5     | 0.10     | 128         |
| Cheikh N''Doye             | MID | 35   | 88    | 2.98     | 2     | 0.07     | 53          |
| Anderson Luís de Souza     | MID | 57   | 149   | 2.95     | 5     | 0.10     | 176         |
| Ignacio Camacho Barnola    | DEF | 31   | 84    | 2.90     | 3     | 0.10     | 56          |
| Lassana Diarra             | DEF | 31   | 78    | 2.85     | 0     | 0.00     | 40          |
| Paul Pogba                 | MID | 48   | 125   | 2.80     | 4     | 0.09     | 99          |
| Artur Ioniţă               | MID | 31   | 68    | 2.73     | 1     | 0.04     | 36          |
| Didier Ndong Ibrahim       | DEF | 34   | 80    | 2.70     | 0     | 0.00     | 43          |
| Karim Bellarabi            | FWD | 33   | 70    | 2.60     | 4     | 0.15     | 69          |
| Víctor Sánchez Mata        | FWD | 49   | 114   | 2.60     | 3     | 0.07     | 66          |
| Juraj Kucka                | DEF | 38   | 89    | 2.58     | 2     | 0.06     | 65          |
| Sofiane Boufal             | MID | 41   | 88    | 2.57     | 1     | 0.03     | 96          |
| José Luis García del Pozo  | DEF | 44   | 98    | 2.56     | 2     | 0.05     | 59          |

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Franco Damián Vázquez      | MID | 46   | 145   | 3.81     | 4     | 0.11     | 223         |
| Neymar da Silva Santos Jun | FWD | 158  | 204   | 1.41     | 15    | 0.10     | 665         |
| Pedro Pablo Hernández      | MID | 36   | 100   | 3.37     | 4     | 0.13     | 123         |
| Bryan Dabo                 | DEF | 37   | 64    | 2.05     | 2     | 0.06     | 122         |
| Ronaldo de Assis Moreira   | FWD | 59   | 75    | 1.41     | 3     | 0.06     | 202         |
| Wilfried Zaha              | FWD | 34   | 43    | 1.57     | 2     | 0.07     | 102         |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Anderson Luís de Souza     | MID | 57   | 149   | 2.95     | 5     | 0.10     | 176         |
| Borja Valero Iglesias      | DEF | 44   | 52    | 1.39     | 3     | 0.08     | 129         |
| Nicolas de Roussel de Prév | MID | 36   | 67    | 2.24     | 0     | 0.00     | 103         |
| Eden Hazard                | FWD | 45   | 26    | 0.66     | 0     | 0.00     | 129         |
| Lionel Andrés Messi Cuccit | FWD | 603  | 417   | 0.77     | 27    | 0.05     | 1747        |
| Carlos Alberto Vela Garrid | FWD | 50   | 68    | 1.58     | 1     | 0.02     | 133         |
| Daniel Ceballos Fernández  | MID | 39   | 51    | 1.53     | 4     | 0.12     | 102         |
| Emmanuel Agyemang-Badu     | MID | 34   | 30    | 1.02     | 0     | 0.00     | 90          |
| Juan Guillermo Cuadrado Be | DEF | 43   | 41    | 1.09     | 1     | 0.03     | 113         |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Andrea Belotti             | FWD | 45   | 72    | 1.83     | 0     | 0.00     | 117         |
| Federico Dionisi           | FWD | 34   | 62    | 2.03     | 3     | 0.10     | 90          |
| Gilles Sunu                | FWD | 32   | 33    | 1.24     | 0     | 0.00     | 78          |

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Jordi Alba Ramos           | DEF | 284  | 234   | 0.87     | 28    | 0.10     | 200         |
| Lionel Andrés Messi Cuccit | FWD | 603  | 417   | 0.77     | 27    | 0.05     | 1747        |
| Gerard Piqué Bernabéu      | DEF | 358  | 285   | 0.85     | 24    | 0.07     | 187         |
| Víctor Valdés Arribas      | GK  | 256  | 5     | 0.02     | 20    | 0.08     | 30          |
| Luis Alberto Suárez Díaz   | FWD | 204  | 201   | 1.05     | 19    | 0.10     | 349         |
| Sergio Busquets i Burgos   | DEF | 420  | 586   | 1.54     | 18    | 0.05     | 944         |
| Neymar da Silva Santos Jun | FWD | 158  | 204   | 1.41     | 15    | 0.10     | 665         |
| Fabián Ariel Orellana Vale | FWD | 49   | 50    | 1.10     | 13    | 0.29     | 122         |
| Xavier Hernández Creus     | MID | 266  | 126   | 0.52     | 12    | 0.05     | 406         |
| Samuel Yves Umtiti         | DEF | 162  | 124   | 0.80     | 11    | 0.07     | 126         |
| Francesc Fàbregas i Soler  | MID | 121  | 138   | 1.33     | 10    | 0.10     | 191         |
| Gianluigi Donnarumma       | GK  | 104  | 2     | 0.02     | 9     | 0.09     | 15          |
| Deyverson Brum Silva Acost | FWD | 40   | 55    | 1.53     | 9     | 0.25     | 82          |
| Iago Aspas Juncal          | FWD | 49   | 53    | 1.30     | 9     | 0.22     | 71          |
| Katie McCabe               | DEF | 79   | 73    | 1.03     | 8     | 0.11     | 104         |
| Roberto Trashorras Gayoso  | DEF | 43   | 62    | 1.58     | 8     | 0.20     | 95          |
| Manuel Agudo Durán         | MID | 42   | 62    | 1.56     | 8     | 0.20     | 87          |
| Jonathas Cristian de Jesus | FWD | 48   | 76    | 1.74     | 8     | 0.18     | 74          |
| Daniel Alves da Silva      | DEF | 250  | 473   | 2.06     | 8     | 0.03     | 392         |
| Jessica Dahiana Martínez V | FWD | 26   | 28    | 1.40     | 7     | 0.35     | 65          |

| player                     | pos                | apps | red cards |
| -------------------------- | ------------------ | ---- | --------- |
| Jordi Alba Ramos           | FULL_BACK          | 284  | 2         |
| Anderson Luís de Souza     | ATTACKING_MIDFIELD | 57   | 2         |
| Fabián Ariel Orellana Vale | WINGER             | 49   | 2         |
| Jonathas Cristian de Jesus | STRIKER            | 48   | 2         |
| Diego Perotti              | CENTER_BACK        | 34   | 2         |
| Yannick Cahuzac            | WINGER             | 33   | 2         |
| Younousse Sankharé         | DEFENSIVE_MIDFIELD | 33   | 2         |
| Víctor Valdés Arribas      | GOALKEEPER         | 256  | 1         |
| Javier Alejandro Mascheran | CENTER_BACK        | 221  | 1         |
| Ousmane Dembélé            | CENTRAL_MIDFIELD   | 125  | 1         |
| Ella Toone                 | CENTRAL_MIDFIELD   | 76   | 1         |
| Rosella Ayane              | WINGER             | 73   | 1         |
| Alex Greenwood             | FULL_BACK          | 66   | 1         |
| Achraf Hakimi Mouh         | WINGER             | 60   | 1         |
| Ronaldo de Assis Moreira   | WINGER             | 59   | 1         |
| Gilly Louise Scarlett Flah | CENTER_BACK        | 55   | 1         |
| Ibrahim Afellay            | WINGER             | 55   | 1         |
| Bruno Miguel Borges Fernan | ATTACKING_MIDFIELD | 54   | 1         |
| Kayleigh Green             | STRIKER            | 53   | 1         |
| Lauren James               | STRIKER            | 50   | 1         |

| pos | apps  | fouls committed/90 | fouls drawn/90 | cards/90 |
| --- | ----- | ------------------ | -------------- | -------- |
| FWD | 40739 | 0.87               | 1.00           | 0.02     |
| MID | 30688 | 0.93               | 0.99           | 0.02     |
| DEF | 60475 | 0.92               | 0.69           | 0.02     |
| GK  | 14262 | 0.01               | 0.09           | 0.02     |
| UNK | 5969  | 0.00               | 0.00           | 0.00     |

```rust

// team discipline: team-total fouls/cards per team-match
struct T { tid: i64, f: f64, y: f64, r: f64 }
let mut tagg: HashMap<i64, T> = HashMap::new();
let mut team_matches: HashMap<i64, std::collections::HashSet<i64>> = HashMap::new();
for i in 0..pm_pid.len() {
    if pm_tid[i] <= 0 { continue; }
    team_matches.entry(pm_tid[i]).or_default().insert(pm_mid[i]);
    let e = tagg.entry(pm_tid[i]).or_insert(T{tid:pm_tid[i],f:0.0,y:0.0,r:0.0});
    e.f += pm_f[i]; e.y += pm_y[i]; e.r += pm_r[i];
}
let mut trows_all: Vec<(i64,f64,f64,i64)> = tagg.iter().map(|(tid,t)| {
    let n = team_matches.get(tid).map(|s| s.len() as i64).unwrap_or(0);
    (*tid, t.f/n.max(1) as f64, (t.y+t.r)/n.max(1) as f64, n)
}).collect();
trows_all.retain(|(_,_,_,n)| *n >= 20); // enough team-matches
// cards per team-match desc
trows_all.sort_by(|a,b| b.2.partial_cmp(&a.2).unwrap());
let tcard: Vec<Vec<String>> = trows_all.iter().take(20).map(|(tid,fls,cds,_)| vec![
    tname.get(tid).cloned().unwrap_or_default().chars().take(28).collect(),
    format!("{:.2}", cds), format!("{:.2}", fls),
]).collect();
mars_table(&["team","cards per team-match","fouls per team-match"], &tcard);

trows_all.sort_by(|a,b| b.1.partial_cmp(&a.1).unwrap());
let tfoul: Vec<Vec<String>> = trows_all.iter().take(20).map(|(tid,fls,cds,_)| vec![
    tname.get(tid).cloned().unwrap_or_default().chars().take(28).collect(),
    format!("{:.2}", fls), format!("{:.2}", cds),
]).collect();
mars_table(&["team","fouls per team-match","cards per team-match"], &tfoul);
```

```text
players with stats: 11794, total cards: 2855
```

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Fabián Ariel Orellana Vale | FWD | 49   | 50    | 1.10     | 13    | 0.29     | 122         |
| Yannick Cahuzac            | FWD | 33   | 60    | 2.23     | 7     | 0.26     | 32          |
| Deyverson Brum Silva Acost | FWD | 40   | 55    | 1.53     | 9     | 0.25     | 82          |
| Alexis Ruano Delgado       | DEF | 31   | 24    | 0.80     | 7     | 0.23     | 15          |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Iago Aspas Juncal          | FWD | 49   | 53    | 1.30     | 9     | 0.22     | 71          |
| Roberto Trashorras Gayoso  | DEF | 43   | 62    | 1.58     | 8     | 0.20     | 95          |
| Manuel Agudo Durán         | MID | 42   | 62    | 1.56     | 8     | 0.20     | 87          |
| Jonathas Cristian de Jesus | FWD | 48   | 76    | 1.74     | 8     | 0.18     | 74          |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Younousse Sankharé         | DEF | 33   | 54    | 1.86     | 5     | 0.17     | 53          |
| Esteban Félix Granero Moli | MID | 31   | 38    | 1.30     | 5     | 0.17     | 42          |
| Danilo Soddimo             | MID | 33   | 42    | 1.43     | 5     | 0.17     | 49          |
| Radja Nainggolan           | MID | 35   | 53    | 1.80     | 5     | 0.17     | 57          |
| Juan Torres Ruiz           | DEF | 31   | 44    | 1.47     | 5     | 0.17     | 28          |
| Charles Días Barbosa de Ol | FWD | 44   | 83    | 1.97     | 7     | 0.17     | 58          |
| Aleksandar Mitrović        | FWD | 45   | 63    | 1.49     | 7     | 0.17     | 76          |
| María Dolores Gallardo Nuñ | GK  | 37   | 0     | 0.00     | 6     | 0.16     | 1           |
| Fabrizio Cacciatore        | MID | 35   | 24    | 0.75     | 5     | 0.16     | 16          |
| Gary Alexis Medel Soto     | MID | 39   | 38    | 1.13     | 5     | 0.15     | 28          |

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Franco Damián Vázquez      | MID | 46   | 145   | 3.81     | 4     | 0.11     | 223         |
| Papa Kouly Diop            | DEF | 47   | 151   | 3.79     | 2     | 0.05     | 81          |
| Hernán Arsenio Pérez Gonzá | FWD | 36   | 104   | 3.51     | 1     | 0.03     | 63          |
| Pedro Pablo Hernández      | MID | 36   | 100   | 3.37     | 4     | 0.13     | 123         |
| Lorenzo Lollo              | MID | 31   | 86    | 3.28     | 0     | 0.00     | 46          |
| Gabriel Fernández Arenas   | DEF | 55   | 156   | 3.24     | 2     | 0.04     | 80          |
| Gonzalo Escalante          | DEF | 41   | 121   | 3.22     | 3     | 0.08     | 39          |
| Raúl García Escudero       | FWD | 55   | 150   | 3.08     | 5     | 0.10     | 128         |
| Cheikh N''Doye             | MID | 35   | 88    | 2.98     | 2     | 0.07     | 53          |
| Anderson Luís de Souza     | MID | 57   | 149   | 2.95     | 5     | 0.10     | 176         |
| Ignacio Camacho Barnola    | DEF | 31   | 84    | 2.90     | 3     | 0.10     | 56          |
| Lassana Diarra             | DEF | 31   | 78    | 2.85     | 0     | 0.00     | 40          |
| Paul Pogba                 | MID | 48   | 125   | 2.80     | 4     | 0.09     | 99          |
| Artur Ioniţă               | MID | 31   | 68    | 2.73     | 1     | 0.04     | 36          |
| Didier Ndong Ibrahim       | DEF | 34   | 80    | 2.70     | 0     | 0.00     | 43          |
| Karim Bellarabi            | FWD | 33   | 70    | 2.60     | 4     | 0.15     | 69          |
| Víctor Sánchez Mata        | FWD | 49   | 114   | 2.60     | 3     | 0.07     | 66          |
| Juraj Kucka                | DEF | 38   | 89    | 2.58     | 2     | 0.06     | 65          |
| Sofiane Boufal             | MID | 41   | 88    | 2.57     | 1     | 0.03     | 96          |
| José Luis García del Pozo  | DEF | 44   | 98    | 2.56     | 2     | 0.05     | 59          |

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Franco Damián Vázquez      | MID | 46   | 145   | 3.81     | 4     | 0.11     | 223         |
| Neymar da Silva Santos Jun | FWD | 158  | 204   | 1.41     | 15    | 0.10     | 665         |
| Pedro Pablo Hernández      | MID | 36   | 100   | 3.37     | 4     | 0.13     | 123         |
| Bryan Dabo                 | DEF | 37   | 64    | 2.05     | 2     | 0.06     | 122         |
| Ronaldo de Assis Moreira   | FWD | 59   | 75    | 1.41     | 3     | 0.06     | 202         |
| Wilfried Zaha              | FWD | 34   | 43    | 1.57     | 2     | 0.07     | 102         |
| Isaac Ajayi Success        | FWD | 32   | 58    | 2.09     | 5     | 0.18     | 97          |
| Anderson Luís de Souza     | MID | 57   | 149   | 2.95     | 5     | 0.10     | 176         |
| Borja Valero Iglesias      | DEF | 44   | 52    | 1.39     | 3     | 0.08     | 129         |
| Nicolas de Roussel de Prév | MID | 36   | 67    | 2.24     | 0     | 0.00     | 103         |
| Eden Hazard                | FWD | 45   | 26    | 0.66     | 0     | 0.00     | 129         |
| Lionel Andrés Messi Cuccit | FWD | 603  | 417   | 0.77     | 27    | 0.05     | 1747        |
| Carlos Alberto Vela Garrid | FWD | 50   | 68    | 1.58     | 1     | 0.02     | 133         |
| Daniel Ceballos Fernández  | MID | 39   | 51    | 1.53     | 4     | 0.12     | 102         |
| Emmanuel Agyemang-Badu     | MID | 34   | 30    | 1.02     | 0     | 0.00     | 90          |
| Juan Guillermo Cuadrado Be | DEF | 43   | 41    | 1.09     | 1     | 0.03     | 113         |
| Domenico Berardi           | FWD | 35   | 52    | 1.69     | 7     | 0.23     | 92          |
| Andrea Belotti             | FWD | 45   | 72    | 1.83     | 0     | 0.00     | 117         |
| Federico Dionisi           | FWD | 34   | 62    | 2.03     | 3     | 0.10     | 90          |
| Gilles Sunu                | FWD | 32   | 33    | 1.24     | 0     | 0.00     | 78          |

| player                     | pos | apps | fouls | fouls/90 | cards | cards/90 | fouls drawn |
| -------------------------- | --- | ---- | ----- | -------- | ----- | -------- | ----------- |
| Jordi Alba Ramos           | DEF | 284  | 234   | 0.87     | 28    | 0.10     | 200         |
| Lionel Andrés Messi Cuccit | FWD | 603  | 417   | 0.77     | 27    | 0.05     | 1747        |
| Gerard Piqué Bernabéu      | DEF | 358  | 285   | 0.85     | 24    | 0.07     | 187         |
| Víctor Valdés Arribas      | GK  | 256  | 5     | 0.02     | 20    | 0.08     | 30          |
| Luis Alberto Suárez Díaz   | FWD | 204  | 201   | 1.05     | 19    | 0.10     | 349         |
| Sergio Busquets i Burgos   | DEF | 420  | 586   | 1.54     | 18    | 0.05     | 944         |
| Neymar da Silva Santos Jun | FWD | 158  | 204   | 1.41     | 15    | 0.10     | 665         |
| Fabián Ariel Orellana Vale | FWD | 49   | 50    | 1.10     | 13    | 0.29     | 122         |
| Xavier Hernández Creus     | MID | 266  | 126   | 0.52     | 12    | 0.05     | 406         |
| Samuel Yves Umtiti         | DEF | 162  | 124   | 0.80     | 11    | 0.07     | 126         |
| Francesc Fàbregas i Soler  | MID | 121  | 138   | 1.33     | 10    | 0.10     | 191         |
| Iago Aspas Juncal          | FWD | 49   | 53    | 1.30     | 9     | 0.22     | 71          |
| Gianluigi Donnarumma       | GK  | 104  | 2     | 0.02     | 9     | 0.09     | 15          |
| Deyverson Brum Silva Acost | FWD | 40   | 55    | 1.53     | 9     | 0.25     | 82          |
| Manuel Agudo Durán         | MID | 42   | 62    | 1.56     | 8     | 0.20     | 87          |
| Katie McCabe               | DEF | 79   | 73    | 1.03     | 8     | 0.11     | 104         |
| Daniel Alves da Silva      | DEF | 250  | 473   | 2.06     | 8     | 0.03     | 392         |
| Jonathas Cristian de Jesus | FWD | 48   | 76    | 1.74     | 8     | 0.18     | 74          |
| Roberto Trashorras Gayoso  | DEF | 43   | 62    | 1.58     | 8     | 0.20     | 95          |
| Charles Días Barbosa de Ol | FWD | 44   | 83    | 1.97     | 7     | 0.17     | 58          |

| player                     | pos                | apps | red cards |
| -------------------------- | ------------------ | ---- | --------- |
| Jordi Alba Ramos           | FULL_BACK          | 284  | 2         |
| Anderson Luís de Souza     | ATTACKING_MIDFIELD | 57   | 2         |
| Fabián Ariel Orellana Vale | WINGER             | 49   | 2         |
| Jonathas Cristian de Jesus | STRIKER            | 48   | 2         |
| Diego Perotti              | CENTER_BACK        | 34   | 2         |
| Yannick Cahuzac            | WINGER             | 33   | 2         |
| Younousse Sankharé         | DEFENSIVE_MIDFIELD | 33   | 2         |
| Víctor Valdés Arribas      | GOALKEEPER         | 256  | 1         |
| Javier Alejandro Mascheran | CENTER_BACK        | 221  | 1         |
| Ousmane Dembélé            | CENTRAL_MIDFIELD   | 125  | 1         |
| Ella Toone                 | CENTRAL_MIDFIELD   | 76   | 1         |
| Rosella Ayane              | WINGER             | 73   | 1         |
| Alex Greenwood             | FULL_BACK          | 66   | 1         |
| Achraf Hakimi Mouh         | WINGER             | 60   | 1         |
| Ronaldo de Assis Moreira   | WINGER             | 59   | 1         |
| Ibrahim Afellay            | WINGER             | 55   | 1         |
| Gilly Louise Scarlett Flah | CENTER_BACK        | 55   | 1         |
| Bruno Miguel Borges Fernan | ATTACKING_MIDFIELD | 54   | 1         |
| Kayleigh Green             | STRIKER            | 53   | 1         |
| Lauren James               | STRIKER            | 50   | 1         |

| pos | apps  | fouls committed/90 | fouls drawn/90 | cards/90 |
| --- | ----- | ------------------ | -------------- | -------- |
| FWD | 40739 | 0.87               | 1.00           | 0.02     |
| MID | 30688 | 0.93               | 0.99           | 0.02     |
| DEF | 60475 | 0.92               | 0.69           | 0.02     |
| GK  | 14262 | 0.01               | 0.09           | 0.02     |
| UNK | 5969  | 0.00               | 0.00           | 0.00     |

| team                | cards per team-match | fouls per team-match |
| ------------------- | -------------------- | -------------------- |
| Granada             | 1.02                 | 18.64                |
| Celta Vigo          | 0.91                 | 17.78                |
| Espanyol            | 0.84                 | 21.21                |
| Netherlands         | 0.80                 | 17.40                |
| Levante             | 0.79                 | 16.88                |
| Nürnberg W          | 0.77                 | 14.05                |
| FC Levante Badalona | 0.73                 | 12.37                |
| Atletico Madrid W   | 0.73                 | 10.53                |
| Argentina           | 0.73                 | 15.64                |
| Malaga              | 0.72                 | 17.89                |
| Frosinone           | 0.68                 | 18.05                |
| Palermo             | 0.66                 | 17.74                |
| Kerala Blasters     | 0.65                 | 17.43                |
| Real Betis          | 0.64                 | 17.10                |
| Sporting Gijón      | 0.64                 | 17.59                |
| Bayer Leverkusen    | 0.63                 | 13.37                |
| Getafe              | 0.61                 | 18.07                |
| RB Leipzig W        | 0.59                 | 13.59                |
| Lazio               | 0.58                 | 16.97                |
| Chievo              | 0.58                 | 18.13                |

| team            | fouls per team-match | cards per team-match |
| --------------- | -------------------- | -------------------- |
| Espanyol        | 21.21                | 0.84                 |
| Osasuna         | 19.30                | 0.45                 |
| Granada         | 18.64                | 1.02                 |
| Torino          | 18.63                | 0.34                 |
| Carpi           | 18.58                | 0.34                 |
| Bengaluru       | 18.50                | 0.25                 |
| Atlético Madrid | 18.35                | 0.50                 |
| Atalanta        | 18.21                | 0.39                 |
| Chievo          | 18.13                | 0.58                 |
| Getafe          | 18.07                | 0.61                 |
| Frosinone       | 18.05                | 0.68                 |
| Genoa           | 18.05                | 0.32                 |
| Athletic Club   | 17.94                | 0.44                 |
| Malaga          | 17.89                | 0.72                 |
| Hellas Verona   | 17.84                | 0.26                 |
| Celta Vigo      | 17.78                | 0.91                 |
| Rayo Vallecano  | 17.77                | 0.51                 |
| Palermo         | 17.74                | 0.66                 |
| Sporting Gijón  | 17.59                | 0.64                 |
| Kerala Blasters | 17.43                | 0.65                 |

## Findings

From 152k player-match lines and 2,855 cards:

- **Card-rate leaders are specialists, not stars**: Fabián Orellana (0.29
  cards/90), Yannick Cahuzac (0.26) and Deyverson (0.25) top the per-90 table —
  players who foul early and often in limited minutes. Among volume players,
  Alba (28 cards), Messi (27) and Piqué (24) lead the raw totals.
- **The real foul merchants commit 3–4 per game**: Franco Vázquez (3.81
  fouls/90), Papa Kouly Diop (3.79) and Lorenzo Lollo (3.28, _zero_ cards) —
  defenders who stop attacks with tactical fouling, not punishment.
- **Forwards draw more fouls than they commit** (1.00 vs 0.87 per 90); defenders
  invert it (commit 0.92, draw 0.69). Dribbling is a card-generating skill —
  Messi has drawn **1,747 fouls** across his career, the most on record.
- **Team identity is real**: Granada averages 1.02 cards per match (highest),
  Espanyol 21.2 fouls per match — Spanish football's aggressive reputation shows
  up directly in the data.
- Red cards are genuinely rare: only ~20 players have 2+ in the dataset; Jordi
  Alba leads with 2 in 284 apps.

Caveats: fouls/card data comes from StatsBomb competitions only; "fouls drawn"
includes fouls that wouldn't be given in stricter leagues; small samples (min 30
apps) still let one bad run dominate a rate; cards/90 looks flat (~0.02) because
yellows are spread thin.
