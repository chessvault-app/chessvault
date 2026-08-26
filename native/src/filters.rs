//! Port of `gamesWhere` (and `parseBand`) from `server/refgames.ts`: the
//! reference filters as SQL clauses, identical text and bind order, so a
//! filtered deep search through the binary answers exactly what the JS
//! route would. The N4 server side passes the request's query keys
//! through as a JSON object; `get` is that lookup.

use rusqlite::types::Value;

pub struct GamesWhere {
    pub clauses: Vec<String>,
    pub binds: Vec<Value>,
}

fn parse_band(raw: Option<&str>) -> Option<(i64, Option<i64>)> {
    // ^(\d{3,4})-(\d{3,4})?$
    let raw = raw?;
    let (lo, hi) = raw.split_once('-')?;
    let digits = |s: &str| (3..=4).contains(&s.len()) && s.bytes().all(|b| b.is_ascii_digit());
    if !digits(lo) {
        return None;
    }
    let lo: i64 = lo.parse().ok()?;
    if hi.is_empty() {
        return Some((lo, None));
    }
    if !digits(hi) {
        return None;
    }
    let hi: i64 = hi.parse().ok()?;
    if hi < lo {
        return None;
    }
    Some((lo, Some(hi)))
}

fn is_iso_date(s: &str) -> bool {
    // ^\d{4}-\d{2}-\d{2}$
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| matches!(i, 4 | 7) || c.is_ascii_digit())
}

pub fn games_where(
    get: &dyn Fn(&str) -> Option<String>,
    alias: &str,
    seek_players: bool,
) -> GamesWhere {
    let mut clauses: Vec<String> = Vec::new();
    let mut binds: Vec<Value> = Vec::new();
    let like = |value: &str| format!("%{value}%");
    let white_match = if seek_players {
        format!("{alias}white IN (SELECT name FROM players WHERE name LIKE ?)")
    } else {
        format!("{alias}white LIKE ?")
    };
    let black_match = if seek_players {
        format!("{alias}black IN (SELECT name FROM players WHERE name LIKE ?)")
    } else {
        format!("{alias}black LIKE ?")
    };

    if let Some(result) = get("result") {
        if matches!(result.as_str(), "1-0" | "0-1" | "1/2-1/2") {
            clauses.push(format!("{alias}result = ?"));
            binds.push(Value::Text(result));
        }
    }

    let min_elo = get("minElo")
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(0)
        .max(0);
    if min_elo > 0 {
        clauses.push(format!("{alias}white_elo >= ? AND {alias}black_elo >= ?"));
        binds.push(Value::Integer(min_elo));
        binds.push(Value::Integer(min_elo));
    }

    if let Some((lo, hi)) = parse_band(get("band").as_deref()) {
        clauses.push(format!("MIN({alias}white_elo, {alias}black_elo) >= ?"));
        binds.push(Value::Integer(lo));
        if let Some(hi) = hi {
            clauses.push(format!("MIN({alias}white_elo, {alias}black_elo) <= ?"));
            binds.push(Value::Integer(hi));
        }
    }

    let player = get("player")
        .map(|p| p.trim().to_owned())
        .filter(|p| !p.is_empty());
    let side = get("side");
    if let Some(player) = player {
        let side = side.as_deref();
        match side {
            Some("white") => {
                clauses.push(white_match.clone());
                binds.push(Value::Text(like(&player)));
            }
            Some("black") => {
                clauses.push(black_match.clone());
                binds.push(Value::Text(like(&player)));
            }
            _ => {
                clauses.push(format!("({white_match} OR {black_match})"));
                binds.push(Value::Text(like(&player)));
                binds.push(Value::Text(like(&player)));
            }
        }
        // Outcome is the PLAYER'S: without a side it splits by which
        // seat the name matched.
        let outcome = get("outcome");
        match outcome.as_deref() {
            Some("drawn") => clauses.push(format!("{alias}result = '1/2-1/2'")),
            Some(outcome @ ("won" | "lost")) => {
                let as_white = if outcome == "won" { "1-0" } else { "0-1" };
                let as_black = if outcome == "won" { "0-1" } else { "1-0" };
                if matches!(side, Some("white") | Some("black")) {
                    clauses.push(format!("{alias}result = ?"));
                    binds.push(Value::Text(
                        (if side == Some("white") {
                            as_white
                        } else {
                            as_black
                        })
                        .to_owned(),
                    ));
                } else {
                    clauses.push(format!(
                        "(({white_match} AND {alias}result = ?) OR ({black_match} AND {alias}result = ?))"
                    ));
                    binds.push(Value::Text(like(&player)));
                    binds.push(Value::Text(as_white.to_owned()));
                    binds.push(Value::Text(like(&player)));
                    binds.push(Value::Text(as_black.to_owned()));
                }
            }
            _ => {}
        }
    }

    if let Some(opening) = get("opening")
        .map(|o| o.trim().to_owned())
        .filter(|o| !o.is_empty())
    {
        clauses.push(format!("({alias}opening LIKE ? OR {alias}eco LIKE ?)"));
        binds.push(Value::Text(like(&opening)));
        binds.push(Value::Text(format!("{opening}%")));
    }

    if let Some(event) = get("event")
        .map(|e| e.trim().to_owned())
        .filter(|e| !e.is_empty())
    {
        clauses.push(format!("{alias}event LIKE ?"));
        binds.push(Value::Text(like(&event)));
    }

    if let Some(from) = get("from").filter(|v| is_iso_date(v)) {
        clauses.push(format!("REPLACE({alias}date, '.', '-') >= ?"));
        binds.push(Value::Text(from));
    }
    if let Some(to) = get("to").filter(|v| is_iso_date(v)) {
        clauses.push(format!("REPLACE({alias}date, '.', '-') <= ?"));
        binds.push(Value::Text(to));
    }

    GamesWhere { clauses, binds }
}
