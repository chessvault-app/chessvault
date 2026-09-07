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
 * The rails are borders, not glyphs (index.css, `.vault-tree`): a
 * parent's rail runs through its rows unbroken and stops at the middle
 * of the last one. Below 30rem each row stacks its gloss under the path,
 * the way the landing page's listing does under 18.75rem: one odd row
 * out of nine would read as breakage, nine stacked rows read as a list.
 */
export interface VaultRow {
  /** The path as the folder shows it: `games/`, `config.json`. */
  path: string;
  /** What kind of file lives there, in plain words. */
  gloss: string;
  bytes: number;
  files: number;
}

export function VaultTree({
  path,
  folders,
  rows,
}: {
  /** Where the folder is, or null where the page cannot say (the demo). */
  path: string | null;
  folders: number;
  rows: VaultRow[];
}) {
  const bytes = rows.reduce((sum, r) => sum + r.bytes, 0);
  const files = rows.reduce((sum, r) => sum + r.files, 0);
  return (
    <div className="vault-tree bg-muted rounded-lg px-3.5 pt-3 pb-3.5">
      <div className="text-muted-foreground mb-2 flex flex-wrap justify-between gap-x-3 font-mono text-sm">
        <span className="text-foreground min-w-0 break-all">{path ?? t('The demo vault, in this tab')}</span>
        <span className="tabular-nums whitespace-nowrap">
          {size(bytes)} · {t('{n} folders', { n: folders })} · {t('{n} files', { n: files })}
        </span>
      </div>
      <ul>
        {rows.map((r) => (
          <li key={r.path}>
            <span className="text-foreground font-mono text-sm whitespace-nowrap">{r.path}</span>
            <span className="text-muted-foreground min-w-0 text-sm">{r.gloss}</span>
            <span className="text-muted-foreground font-mono text-sm tabular-nums whitespace-nowrap">
              {/* A folder counts its files; a file is one, and says so by
                  not counting. */}
              {r.files > 0 && r.path.endsWith('/') && (
                <>
                  {r.files === 1 ? t('1 file') : t('{n} files', { n: r.files })}
                  {' · '}
                </>
              )}
              {size(r.bytes)}
            </span>
          </li>
        ))}
      </ul>
      {/* border-strong, the divider that survives a busy surface: on the muted
          box the plain hairline measured 1.07:1 in dark. */}
      <p className="text-muted-foreground mt-2.5 border-t border-[var(--border-strong)] pt-2 text-sm leading-relaxed">
        <Figures
          text={t(
            'Plain files. Any editor opens them and any backup tool copies them; nothing here needs this app to stay readable. The puzzle database, reference games and indexes live outside it and can be rebuilt.',
          )}
        />
      </p>
    </div>
  );
}

/** Bytes as the Storage card says them (settings/SettingsPage `size`). */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
