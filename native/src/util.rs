//! Small helpers that exist to match JS behaviour, quirks included.

use rusqlite::types::Value;

/// `Number(header) || 0` as the build script applies it to Elo tags:
/// trimmed, empty is 0, unparsable is 0. Fractional values survive as
/// REAL exactly as a JS number would. (Divergence, deliberate: JS
/// `Number` also accepts hex and `Infinity`, which no Elo tag ever is —
/// those land on 0 here.)
pub fn js_number(s: &str) -> Value {
    let t = s.trim();
    if t.is_empty() {
        return Value::Integer(0);
    }
    if let Ok(v) = t.parse::<i64>() {
        return Value::Integer(v);
    }
    match t.parse::<f64>() {
        Ok(v) if v.is_finite() => Value::Real(v),
        _ => Value::Integer(0),
    }
}

/// `n.toLocaleString()` as the progress lines print it — the server's
/// PROGRESS_RE expects comma-grouped digits.
pub fn commas(n: u64) -> String {
    let digits = n.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// `new Date().toISOString()` — UTC, millisecond precision.
pub fn iso_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock after 1970");
    let ms = now.as_millis() as u64;
    let secs = (ms / 1000) as i64;
    let millis = ms % 1000;
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (h, mi, s) = (sod / 3600, (sod % 3600) / 60, sod % 60);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{millis:03}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commas_group_like_to_locale_string() {
        assert_eq!(commas(0), "0");
        assert_eq!(commas(999), "999");
        assert_eq!(commas(1_000), "1,000");
        assert_eq!(commas(285_431), "285,431");
        assert_eq!(commas(1_234_567), "1,234,567");
    }

    #[test]
    fn js_number_quirks() {
        assert_eq!(js_number("2431"), Value::Integer(2431));
        assert_eq!(js_number("  2431 "), Value::Integer(2431));
        assert_eq!(js_number(""), Value::Integer(0));
        assert_eq!(js_number("abc"), Value::Integer(0));
        assert_eq!(js_number("2400.5"), Value::Real(2400.5));
    }

    #[test]
    fn iso_now_shape() {
        let s = iso_now();
        assert_eq!(s.len(), 24);
        assert!(s.ends_with('Z'));
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[10..11], "T");
    }
}
