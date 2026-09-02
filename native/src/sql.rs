//! SQL mirrored from the TS pipeline, verbatim — each constant names its
//! source of truth. Rust cannot import the TS strings, so this file is
//! the one deliberate duplication in the crate; the whole-file parity
//! test (JS-built vs Rust-built database diffed table by table) is the
//! guard against drift. Edit only together with the TS side.

/// `scripts/build-refgames.ts` — the games and meta tables.
pub const GAMES_SCHEMA: &str = "
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    white TEXT NOT NULL COLLATE NOCASE,
    black TEXT NOT NULL COLLATE NOCASE,
    white_elo INTEGER NOT NULL,
    black_elo INTEGER NOT NULL,
    result TEXT NOT NULL,
    date TEXT,
    event TEXT,
    eco TEXT,
    opening TEXT,
    moves TEXT NOT NULL,
    ply_count INTEGER,
    final_wmen INTEGER,
    final_bmen INTEGER
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
";

/// `server/refgamesIndex.ts` SCHEMA — the plies table, sans its index
/// (created separately after the bulk insert, as the TS pass does).
pub const PLIES_TABLE: &str = "
  CREATE TABLE IF NOT EXISTS plies (
    pos INTEGER NOT NULL,
    uci TEXT NOT NULL,
    game_id INTEGER NOT NULL,
    ply INTEGER NOT NULL,
    r INTEGER NOT NULL,
    eb INTEGER NOT NULL
  );
";

/// `server/refgamesIndex.ts` SCAN_PACK_SCHEMA — the packed scan-index
/// (one blob per game, spec in shared/scanPack.ts).
pub const SCAN_PACK_TABLE: &str = "
  CREATE TABLE IF NOT EXISTS scan_pack (
    game_id INTEGER PRIMARY KEY,
    pack BLOB NOT NULL
  );
";

pub const PLIES_INDEX: &str = "CREATE INDEX IF NOT EXISTS idx_plies_pos ON plies (pos);";

/// `server/refgamesIndex.ts` REFGAMES_MOVE_COUNTS — per-(pos, uci, eb)
/// result sums, thin positions (< MOVE_COUNT_MIN_GAMES) dropped.
pub const MOVE_COUNTS: &str = "
  CREATE TABLE IF NOT EXISTS move_counts AS
    SELECT pos, uci, eb,
           SUM(r = 0) AS w,
           SUM(r = 1) AS d,
           SUM(r = 2) AS b
    FROM plies
    GROUP BY pos, uci, eb;
  CREATE TEMP TABLE mc_thin AS
    SELECT pos FROM move_counts GROUP BY pos HAVING SUM(w + d + b) < 5;
  DELETE FROM move_counts WHERE pos IN (SELECT pos FROM mc_thin);
  DROP TABLE mc_thin;
  CREATE INDEX IF NOT EXISTS idx_move_counts_pos ON move_counts (pos);
";

/// `scripts/lib/db-tuning.ts` REFGAMES_INDEXES.
pub const REFGAMES_INDEXES: &str = "
  CREATE INDEX IF NOT EXISTS idx_games_players ON games (white, black, opening, eco);
";

/// `scripts/lib/db-tuning.ts` REFGAMES_LOOKUPS.
pub const REFGAMES_LOOKUPS: &str = "
  CREATE TABLE IF NOT EXISTS players AS
    SELECT name, COUNT(*) AS games, SUM(w) AS as_white, SUM(b) AS as_black, MAX(elo) AS max_elo
    FROM (
      SELECT white AS name, 1 AS w, 0 AS b, white_elo AS elo FROM games
      UNION ALL
      SELECT black AS name, 0 AS w, 1 AS b, black_elo AS elo FROM games
    )
    GROUP BY name;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name ON players (name);
  CREATE TABLE IF NOT EXISTS openings AS
    SELECT opening, eco, COUNT(*) AS games FROM games
    WHERE opening IS NOT NULL OR eco IS NOT NULL
    GROUP BY opening, eco;
  CREATE TABLE IF NOT EXISTS events AS
    SELECT event, COUNT(*) AS games FROM games
    WHERE event IS NOT NULL
    GROUP BY event;
";
