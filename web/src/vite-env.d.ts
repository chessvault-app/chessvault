/// <reference types="vite/client" />

/** True only in the static demo build (web/vite.demo.config.ts). */
declare const __DEMO__: boolean;

/** True only in a build made with CHESS_LAG=1 — see lagMs() in lib/api.ts. */
declare const __LAG__: boolean;

/** The source repository, from package.json — see web/vite.licenses.ts. */
declare const __REPO_URL__: string;
