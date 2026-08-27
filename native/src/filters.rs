//! Port of `gamesWhere` (and `parseBand`) from `server/refgames.ts`: the
//! reference filters as SQL clauses, identical text and bind order, so a
//! filtered deep search through the binary answers exactly what the JS
//! route would. The N4 server side passes the request's query keys
//! through as a JSON object; `get` is that lookup.

use rusqlite::types::Value;

use crate::util::js_number;

/// The filter keys `games_where` consults — the contract the
/// `capabilities` subcommand declares to the server. The server routes a
/// deep search using any filter NOT listed here down its JS path, which
/// is what lets the TypeScript side grow a filter before this crate
/// learns it: an undeclared filter is a slower answer, never a wrong
/// one. Grow this list only in the same change that teaches
/// `games_where` the key — the test below holds the two together.
pub const SUPPORTED_FILTERS: &[&str] = &[
    "result", "minElo", "band", "player", "side", "outcome", "opening", "event", "from", "to",
];

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

    // JS-number semantics, not integer parse: `Number(...) || 0` lets a
    // fractional minElo through as a REAL, and the two paths must build
    // the same clause for the same query string.
    let min_elo = js_number(get("minElo").as_deref().unwrap_or(""));
    let positive = match &min_elo {
        Value::Integer(v) => *v > 0,
        Value::Real(v) => *v > 0.0,
        _ => false,
    };
    if positive {
        clauses.push(format!("{alias}white_elo >= ? AND {alias}black_elo >= ?"));
        binds.push(min_elo.clone());
        binds.push(min_elo);
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

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::BTreeSet;

    use super::*;

    /// A value each filter accepts, so that with every key answered the
    /// whole of `games_where` runs and consults everything it knows —
    /// including the keys it only reads behind another (outcome behind
    /// player). Panics on an unknown key, which IS the failure being
    /// tested for: a filter `games_where` consults but never declared.
    fn sample(key: &str) -> String {
        match key {
            "result" => "1-0",
            "minElo" => "2500",
            "band" => "1600-1999",
            "player" => "Carlsen",
            "side" => "white",
            "outcome" => "won",
            "opening" => "B90",
            "event" => "Tata Steel",
            "from" | "to" => "2020-01-01",
            other => panic!("games_where consults a key SUPPORTED_FILTERS does not declare: {other}"),
        }
        .to_owned()
    }

    /// SUPPORTED_FILTERS must be exactly the keys `games_where` reads —
    /// recorded from the getter itself, not asserted from memory. An
    /// extra declared key would promise the server a filter this side
    /// ignores (wrong rows); an undeclared consulted key would keep the
    /// fast path off a filter it actually supports.
    #[test]
    fn declares_exactly_what_it_consults() {
        let asked = RefCell::new(BTreeSet::new());
        let get = |key: &str| {
            asked.borrow_mut().insert(key.to_owned());
            Some(sample(key))
        };
        games_where(&get, "", false);
        let asked: Vec<String> = asked.into_inner().into_iter().collect();
        let mut declared: Vec<String> = SUPPORTED_FILTERS.iter().map(|s| (*s).to_owned()).collect();
        declared.sort();
        assert_eq!(asked, declared);
    }
}
