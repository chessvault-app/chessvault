import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT } from './paths.ts';

/**
 * The native pipeline binary, when one is present — the heavy jobs, the
 * deep-search scan and the local tablebase prefer it (measured on an
 * Elite month: build 71.8 s vs ~180 s, deep search 1.3 s vs 12.7 s, both
 * answering byte-identically; see native/). Nothing requires it: a fresh
 * checkout, the demo and the tests all run the JS children exactly as
 * before, and CHESS_NATIVE=0 forces that path when comparing the two is
 * the point. Looked up per spawn so a binary built mid-session is picked
 * up.
 *
 * ONE lookup for every caller. The tablebase prober carried its own copy
 * that knew only the cargo build directory, so an installed desktop app,
 * whose packager drops the binary beside the bundled server, never found
 * it and quietly answered every endgame from the network instead of the
 * vault's own tables.
 */
export function nativeBinary(): string | null {
  if (process.env.CHESS_NATIVE === '0') return null;
  const exe = process.platform === 'win32' ? 'chessvault-core.exe' : 'chessvault-core';
  for (const candidate of [
    resolve(REPO_ROOT, 'server', exe), // packaged beside the bundled .mjs children
    resolve(REPO_ROOT, 'native', 'target', 'release', exe), // a repo cargo build
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
