import { Fragment, useCallback, useEffect, useSyncExternalStore } from 'react';
import { WIKI_RE, parseWikiMatch } from '@shared/wikiLinks';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { docsNow, documents, resolveAndOpen, stateOf, subscribeDocs } from './wikiDocs';

/**
 * Plain text with its wiki links picked out, for somewhere that is not an
 * editor.
 *
 * A move comment is a string on a move, not a document — there is no
 * ProseMirror behind it, so the decoration machinery the notes editor uses
 * has nothing to attach to. This does the same job by building the spans
 * itself: the brackets are not hidden, they are simply never rendered, and
 * what a link resolves to comes from the same index and the same rule as
 * everywhere else.
 *
 * Read-only by definition, so the reading-mode contract applies without a
 * mode to check: a plain click follows, `role="link"` and a tab stop make
 * it reachable without a mouse, and Enter opens it — the split the editor
 * has to make between typing and reading does not arise here.
 *
 * An embed renders as an ordinary link rather than as a card. `![[Note]]`
 * in a note draws a bordered block with an excerpt in it; a move comment is
 * one line of prose inside a table of moves, and a card wedged into that
 * row would push the moves apart to say what the link already says. The
 * text on disk keeps its `!`, so the same comment read in Obsidian is
 * unchanged.
 */
export function WikiText({ text, className }: { text: string; className?: string }) {
  // The index arrives after the first paint, and a link drawn before it
  // lands says `unknown` — an ordinary link. Re-render when it comes so
  // the broken ones can say so; without this a comment rendered on load
  // would keep its provisional answer until something else redrew it.
  const docs = useSyncExternalStore(subscribeDocs, docsNow, docsNow);
  useEffect(() => {
    void documents();
  }, []);

  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(WIKI_RE)) {
    const { target, text: shown } = parseWikiMatch(match);
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push(<WikiSpan key={match.index} target={target} shown={shown} docs={docs} />);
    at = match.index + match[0].length;
  }
  if (at === 0) return <>{text}</>;
  if (at < text.length) parts.push(text.slice(at));
  return (
    <span className={className}>
      {parts.map((part, i) => (
        <Fragment key={i}>{part}</Fragment>
      ))}
    </span>
  );
}

function WikiSpan({
  target,
  shown,
  docs,
}: {
  target: string;
  shown: string;
  docs: ReturnType<typeof docsNow>;
}) {
  const state = stateOf(target, docs);
  const dead = state !== 'ok' && state !== 'unknown';
  const open = useCallback(() => void resolveAndOpen(target), [target]);

  // A link that names nothing says so on hover and is announced as a link
  // in neither mode: there is nothing to open, so `role` and the tab stop
  // would be a promise the press cannot keep. It stays PRESSABLE, which is
  // not a contradiction — pressing it is how the reader gets the offer to
  // write the missing note, or to say which of two documents was meant.
  // Both halves are the editor's rule (`affordanceFor` and `handleClick`),
  // followed here rather than reasoned out again, because a link that
  // behaves one way in a note and another in a comment is the drift this
  // whole shared layer exists to stop.
  return (
    <span
      className={cn('wiki-link', dead && `wiki-link-${state}`)}
      {...(dead
        ? {
            title: t(
              state === 'broken'
                ? 'Nothing in the vault is named this'
                : 'More than one document is named this',
            ),
          }
        : { role: 'link', tabIndex: 0, title: t('Click to open') })}
      onClick={(e) => {
        // The comment sits inside the move table, where a click selects the
        // move it hangs off. Following a link and moving the cursor are two
        // different intentions and only one of them was asked for.
        e.stopPropagation();
        open();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        open();
      }}
    >
      {shown}
    </span>
  );
}
