//! chessvault-core — the native seat for the reference-games heavy jobs.
//! Spawned by the server exactly like the JS children it mirrors: argv
//! only (no shell), progress on stdout, nonzero exit on failure.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use chessvault_core::build::run_build;
use chessvault_core::deep::run_deep_search;
use chessvault_core::index::index_positions;
use chessvault_core::optimize::run_optimize;
use chessvault_core::util::commas;

const USAGE: &str = "usage:
  chessvault-core build <sources...> --name <name> [--append] --data <dir>
  chessvault-core index <name> [--append] --data <dir>
  chessvault-core optimize <name> --data <dir>
  chessvault-core deep-search <name> (--fen <fen> [--match <rung>] | --material <spec>) [--filters <json>] --data <dir>
  chessvault-core capabilities";

fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_alphanumeric()
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

struct Args {
    positional: Vec<String>,
    name: Option<String>,
    data: Option<PathBuf>,
    append: bool,
    fen: Option<String>,
    filters: Option<String>,
    match_mode: Option<String>,
    material: Option<String>,
}

fn parse(args: &[String]) -> Result<Args, String> {
    let mut out = Args {
        positional: Vec::new(),
        name: None,
        data: None,
        append: false,
        fen: None,
        filters: None,
        match_mode: None,
        material: None,
    };
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--append" => out.append = true,
            "--name" => {
                i += 1;
                out.name = Some(args.get(i).ok_or("--name needs a value")?.clone());
            }
            "--data" => {
                i += 1;
                out.data = Some(PathBuf::from(args.get(i).ok_or("--data needs a value")?));
            }
            "--fen" => {
                i += 1;
                out.fen = Some(args.get(i).ok_or("--fen needs a value")?.clone());
            }
            "--filters" => {
                i += 1;
                out.filters = Some(args.get(i).ok_or("--filters needs a value")?.clone());
            }
            "--match" => {
                i += 1;
                out.match_mode = Some(args.get(i).ok_or("--match needs a value")?.clone());
            }
            "--material" => {
                i += 1;
                out.material = Some(args.get(i).ok_or("--material needs a value")?.clone());
            }
            flag if flag.starts_with("--") => return Err(format!("unknown flag: {flag}")),
            positional => out.positional.push(positional.to_owned()),
        }
        i += 1;
    }
    Ok(out)
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let Some((command, rest)) = argv.split_first() else {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    };
    let args = match parse(rest) {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };

    // What the server asks before trusting this binary with a filtered
    // deep search: which gamesWhere filters and scan modes this build
    // understands. One JSON line, no --data, no side effects — a
    // request using anything not declared here runs on the server's JS
    // path instead.
    if command == "capabilities" {
        println!(
            "{}",
            serde_json::json!({
                "filters": chessvault_core::filters::SUPPORTED_FILTERS,
                "scan": chessvault_core::scan_match::SUPPORTED_SCAN,
            })
        );
        return ExitCode::SUCCESS;
    }

    let Some(data) = args.data.clone() else {
        eprintln!("--data <dir> is required");
        return ExitCode::from(2);
    };

    match command.as_str() {
        "build" => {
            let Some(name) = args.name.clone() else {
                eprintln!("--name <name> is required");
                return ExitCode::from(2);
            };
            if !valid_name(&name) {
                eprintln!("invalid database name: {name}");
                return ExitCode::FAILURE;
            }
            if args.positional.is_empty() {
                eprintln!("no sources given");
                return ExitCode::FAILURE;
            }
            let sources: Vec<PathBuf> = args.positional.iter().map(PathBuf::from).collect();
            for source in &sources {
                if !source.exists() {
                    eprintln!("source not found: {}", source.display());
                    return ExitCode::FAILURE;
                }
            }
            match run_build(&sources, &name, &data, args.append) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::FAILURE
                }
            }
        }
        "index" => {
            let Some(name) = args.positional.first() else {
                eprintln!("usage: chessvault-core index <name> [--append] --data <dir>");
                return ExitCode::from(2);
            };
            if !valid_name(name) {
                eprintln!("invalid database name: {name}");
                return ExitCode::FAILURE;
            }
            let path = data.join("refgames").join(format!("{name}.sqlite"));
            if !path.exists() {
                eprintln!("no such database: {}", path.display());
                return ExitCode::FAILURE;
            }
            let started = Instant::now();
            match index_positions(&path, args.append, &mut |line| println!("{line}")) {
                Ok(stats) => {
                    println!(
                        "done: {} positions from {} games, {:.1}s",
                        commas(stats.plies),
                        commas(stats.games),
                        started.elapsed().as_secs_f64(),
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::FAILURE
                }
            }
        }
        "optimize" => {
            let Some(name) = args.positional.first() else {
                eprintln!("usage: chessvault-core optimize <name> --data <dir>");
                return ExitCode::from(2);
            };
            if !valid_name(name) {
                eprintln!("invalid database name: {name}");
                return ExitCode::FAILURE;
            }
            let path = data.join("refgames").join(format!("{name}.sqlite"));
            if !path.exists() {
                eprintln!("no such database: {name}");
                return ExitCode::FAILURE;
            }
            match run_optimize(&path) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::FAILURE
                }
            }
        }
        "deep-search" => {
            let Some(name) = args.positional.first() else {
                eprintln!(
                    "usage: chessvault-core deep-search <name> (--fen <fen> [--match <rung>] | --material <spec>) [--filters <json>] --data <dir>"
                );
                return ExitCode::from(2);
            };
            if !valid_name(name) {
                eprintln!("invalid database name: {name}");
                return ExitCode::FAILURE;
            }
            // One hunt per invocation, exactly as the server enforces:
            // a position (with an optional rung) or a material spec.
            if args.fen.is_none() && args.material.is_none() {
                eprintln!("--fen <fen> or --material <spec> is required");
                return ExitCode::from(2);
            }
            if args.material.is_some() && (args.fen.is_some() || args.match_mode.is_some()) {
                eprintln!("--material excludes --fen and --match");
                return ExitCode::from(2);
            }
            let path = data.join("refgames").join(format!("{name}.sqlite"));
            if !path.exists() {
                eprintln!("no such database: {name}");
                return ExitCode::FAILURE;
            }
            let filters: std::collections::HashMap<String, String> = match args
                .filters
                .as_deref()
                .map(serde_json::from_str)
                .transpose()
            {
                Ok(map) => map.unwrap_or_default(),
                Err(error) => {
                    eprintln!("bad --filters json: {error}");
                    return ExitCode::from(2);
                }
            };
            match run_deep_search(
                &path,
                args.fen.as_deref(),
                args.match_mode.as_deref(),
                args.material.as_deref(),
                &|key| filters.get(key).cloned(),
            ) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::FAILURE
                }
            }
        }
        other => {
            eprintln!("unknown command: {other}\n{USAGE}");
            ExitCode::from(2)
        }
    }
}
