/// <reference types="vite/client" />

/** True only in the static demo build (web/vite.demo.config.ts). */
declare const __DEMO__: boolean;

/** True only in a build made with CHESS_LAG=1 — see lagMs() in lib/api.ts. */
declare const __LAG__: boolean;

/** The source repository, from package.json — see web/vite.licenses.ts. */
declare const __REPO_URL__: string;

/**
 * Whether each bundled-asset row of the licence inventory prints a
 * version, in the inventory's order — see web/vite.licenses.ts. Every row
 * after them is a package, and a package always has one.
 */
declare const __LICENCE_ASSET_VERSIONS__: readonly boolean[];

/**
 * What the demo's /api/health reports, stamped at build time. Defined by
 * the demo config alone: every other build folds the demo server away
 * before these are reached, so they exist exactly where they are used.
 */
declare const __DEMO_VERSION__: string;
declare const __DEMO_BUILD__: string;
