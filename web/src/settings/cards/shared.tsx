
export interface Settings {
  profile: { name?: string; chesscom?: string; lichess?: string };
  gate: boolean;
  totp: boolean;
  lichess: { configured: boolean; last4: string | null };
  /** The Syzygy server this vault asks, and what it falls back to when
      nobody has said — see server/tablebase.ts. */
  tablebase: {
    /** Which of the three answers — stored, not inferred. */
    source: 'lichess' | 'server' | 'files';
    url: string | null;
    fallback: string;
    /** Whether the client and the server are the same computer, which
        decides whether asking for a filesystem path is a fair question. */
    sameMachine: boolean;
    /** A directory of Syzygy files on the server, and whether it can
        actually answer — a path that has gone missing, or a build with
        no native binary, falls back to the server silently. */
    dir: string | null;
    local: boolean;
  };
  vaultPath: string;
  /** What the vault is called, or null when its folder name stands in. */
  name: string | null;
  version: string;
}

/** What /api/storage answers: a figure per area of disk, plus the vault
    folder itself (see server/storage.ts). */
export interface StorageReport {
  areas: { key: string; bytes: number; files: number }[];
  vault?: { config: number; folders: number };
}

/** This tab's session just stopped being honoured — a credential change
    revoked every session, or Sign out revoked this one — so the cleanest
    continuation is the lock screen with fresh state. The delay gives the
    feedback note a beat to be read before the reload takes it. */
export const reauth = (): void => {
  setTimeout(() => window.location.reload(), 1200);
};

export function Feedback({ note }: { note: { kind: 'ok' | 'error'; text: string } | null }) {
  if (!note) return null;
  return (
    <p className={note.kind === 'ok' ? 'text-good text-sm' : 'text-destructive text-sm'} role="status">
      {note.text}
    </p>
  );
}

export type Note = { kind: 'ok' | 'error'; text: string } | null;

export interface UpdateResult {
  state: 'dev' | 'current' | 'available' | 'failed';
  version?: string;
  error?: string;
}

/**
 * The download, as it happens.
 *
 * The shell downloads an installer of some eighty megabytes in the
 * background and said nothing at all while it did — a slow connection and
 * a stalled one looked the same — then finished in a native message box
 * whose "Later" dismissed the offer to restart for the rest of the run.
 * Both halves are on this card instead.
 */
export interface UpdateStatus {
  phase: 'idle' | 'downloading' | 'ready' | 'failed';
  version?: string;
  transferred?: number;
  total?: number;
  percent?: number;
  error?: string;
}

/**
 * The shell's own settings, and only when there is a shell.
 *
 * The app talks HTTP and nothing else — that rule is why the desktop build
 * can lag or disappear without leaving debt. This does not break it: the
 * control is feature-detected, so in a browser the card is simply not
 * there, and what it calls is the shell's configuration bridge rather than
 * anything the app depends on.
 *
 * It is here because the alternative was a menu bar hidden behind Alt,
 * which is not a way anybody finds a setting.
 */
export interface VaultShell {
  switchVault?: () => Promise<void>;
  /** The shell's native directory dialog, which is the only way to turn
      a folder into a PATH — no browser API yields one (a directory input
      gives relative names, the File System Access API an opaque handle).
      Optional, and absent in every browser, so a caller feature-detects
      and falls back to the text box. */
  pickFolder?: (title?: string) => Promise<string | null>;
  appInfo?: () => Promise<{ version?: string } | undefined>;
  checkForUpdates?: () => Promise<UpdateResult>;
  updateStatus?: () => Promise<UpdateStatus>;
  onUpdateStatus?: (fn: (state: UpdateStatus) => void) => () => void;
  restartToUpdate?: () => Promise<boolean>;
  /** The window's own chrome. Newer than the bridge, and the material
      half is newer still, so every field here is asked for before use. */
  titleBar?: {
    material?: () => Promise<{ supported: boolean; enabled: boolean; kind: string } | undefined>;
    setMaterial?: (on: boolean) => Promise<boolean>;
  };
}

/** Bytes as something readable; a cache of a few megabytes should not be
    reported in seven digits. */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
