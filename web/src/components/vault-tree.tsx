import type { LucideIcon } from 'lucide-react';
import { FileJson, Folder, FolderGit2, FolderOpen } from 'lucide-react';
import { Figures } from '@/components/figures';
import { t } from '@/lib/i18n';

/**
 * The vault as a folder: its path, what it weighs, and one row per thing
 * that lives in it, with what kind of file that is and how much.
 *
 * The product's thesis is that everything is a plain file, and until now
 * the only place a user could see that was the landing page, which draws
 * this same listing of the demo's vault. Here it is drawn from the live
 * folder (server/storage, which already walks it for the Storage card),
 * in the Vault card, which is where a user looks for what the vault is
 * called and where it lives. Not a file tree in the shell: the app
 * navigates by kind, and a second navigation shaped like a folder would
 * be two answers to "where is my study".
 *
 * One ruler and an icon per row, not drawn branches (index.css,
 * `.vault-tree`). The elbows this replaces were a terminal's tree in a
 * card that is not a terminal, and they carried nothing the eye could
 * not already see from the indent; the icon in their place carries what
 * the trailing slash used to say, so the names are the names. The
 * landing page's listing keeps its elbows, where looking like a shell is
 * the point. Below 30rem each row stacks its gloss under the path, the
 * way that listing does under 18.75rem: one odd row out of nine would
 * read as breakage, nine stacked rows read as a list.
 */

/**
 * What a row is. It picks the icon, and whether the row counts its files:
 * a folder's count is a number of the user's own documents, while the
 * history store's is a number of git objects, which is not the same
 * question and is not asked.
 */
export type VaultKind = 'folder' | 'git' | 'json';

const ICONS: Record<VaultKind, LucideIcon> = { folder: Folder, git: FolderGit2, json: FileJson };

export interface VaultRow {
  /** The name as the folder shows it, bare: `games`, `config.json`. */
  path: string;
  /** What kind of file lives there, in plain words. */
  gloss: string;
  kind: VaultKind;
  bytes: number;
  files: number;
}

/**
 * The rows the Vault card lists, from the areas /api/storage reports, in
 * the folder's own order. A row shows only where there is something in
 * it; the demo's vault has no books, a new vault has nothing. The
 * placeholder reads the same list, so the words a row's gloss wraps to
 * are the words it reserves.
 */
export const VAULT_ROWS: { path: string; gloss: string; kind: VaultKind; keys: string[] }[] = [
  { path: 'games', kind: 'folder', gloss: 'one PGN per game, and the archives you browsed', keys: ['games', 'gamesCache'] },
  { path: 'studies', kind: 'folder', gloss: 'one study per PGN file, chapters inside it', keys: ['studies'] },
  { path: 'notes', kind: 'folder', gloss: 'markdown, boards in the text', keys: ['notes'] },
  { path: 'books', kind: 'folder', gloss: 'your PDFs, and what was read from them', keys: ['books'] },
  { path: 'puzzlebooks', kind: 'folder', gloss: 'puzzle books read from scans', keys: ['puzzlebooks'] },
  { path: 'puzzles', kind: 'folder', gloss: 'every attempt, and where you are', keys: ['puzzles'] },
  { path: 'repertoire', kind: 'folder', gloss: 'the opening map and its drills', keys: ['repertoire'] },
  { path: 'sources', kind: 'folder', gloss: 'PGN files you added', keys: ['sources'] },
  { path: '.history.git', kind: 'git', gloss: 'every earlier version', keys: ['history'] },
  { path: 'config.json', kind: 'json', gloss: 'settings and tokens', keys: ['config'] },
];

export function VaultTree({
  path,
  rows,
}: {
  /** Where the folder is, or null where the page cannot say (the demo). */
  path: string | null;
  rows: VaultRow[];
}) {
  const bytes = rows.reduce((sum, r) => sum + r.bytes, 0);
  const files = rows.reduce((sum, r) => sum + r.files, 0);
  return (
    <div className="vault-tree bg-muted rounded-lg px-3.5 pt-3 pb-3.5">
      {/* The path is the one literal here and wears the mono face; the
          totals are a sentence, so only their figures do (the Figures
          rule). The folder count is not said: the rows below are the
          folders. The open folder is what the ruler hangs from. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3">
        <VaultPath path={path} />
        <span className="text-muted-foreground text-sm whitespace-nowrap">
          <Figures text={`${size(bytes)} · ${t('{n} files', { n: files })}`} />
        </span>
      </div>
      <ul>
        {rows.map((r) => {
          const Icon = ICONS[r.kind];
          return (
            <li key={r.path}>
              <span className="icon text-muted-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="path text-foreground font-mono text-sm whitespace-nowrap">{r.path}</span>
              <span className="gloss text-muted-foreground min-w-0 text-sm">{r.gloss}</span>
              <span className="size text-muted-foreground font-mono text-sm tabular-nums whitespace-nowrap">
                {/* A folder counts its files; a file is one, and says so by
                    not counting. */}
                {r.files > 0 && r.kind === 'folder' && (
                  <>
                    {r.files === 1 ? t('1 file') : t('{n} files', { n: r.files })}
                    {' · '}
                  </>
                )}
                {size(r.bytes)}
              </span>
            </li>
          );
        })}
      </ul>
      <VaultNote />
    </div>
  );
}

/**
 * Where the vault is, behind the open folder the ruler hangs from.
 *
 * Its own component because the placeholder draws it too: the path comes
 * from the settings the page already has, so it is known before the walk
 * that counts the rows is, and a bar standing in for a string we can
 * print is a worse answer than the string.
 */
export function VaultPath({ path }: { path: string | null }) {
  return (
    <span className="text-foreground flex min-w-0 items-center gap-2 font-mono text-sm">
      <FolderOpen className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-all">{path ?? t('The demo vault, in this tab')}</span>
    </span>
  );
}

/**
 * The sentence that closes the box, which says the same thing whatever
 * the vault holds. The placeholder prints it rather than drawing bars
 * over it, for the same reason: nothing about it is waiting on the walk.
 *
 * border-strong, the divider that survives a busy surface: on the muted
 * box the plain hairline measured 1.07:1 in dark.
 */
export function VaultNote() {
  return (
    <p className="text-muted-foreground mt-2.5 border-t border-[var(--border-strong)] pt-2 text-sm leading-relaxed">
      <Figures
        text={t(
          'Plain files. Any editor opens them and any backup tool copies them; nothing here needs this app to stay readable. The puzzle database, reference games and indexes live outside it and can be rebuilt.',
        )}
      />
    </p>
  );
}

/** Bytes as the Storage card says them (settings/SettingsPage `size`). */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
