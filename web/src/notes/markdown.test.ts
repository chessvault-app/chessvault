import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc, splitFrontMatter } from './markdown';

const roundTrip = (md: string): string => docToMarkdown(markdownToDoc(md));

describe('note markdown codec', () => {
  it('round-trips typical markdown idempotently', () => {
    const md = [
      '# Caro-Kann ideas',
      '',
      'The **main point** of *this* line is `c6` prep — see [lichess](https://lichess.org).',
      '',
      '## Plans',
      '',
      '- trade the light bishop',
      '- push ~~h5~~ c5 at the right moment',
      '',
      '1. first',
      '2. second',
      '',
      '> A quote about pawn structure.',
      '',
      '---',
      '',
      '```',
      'plain code',
      '```',
      '',
    ].join('\n');
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once); // idempotent
    // Content survives (whitespace normalisation aside).
    expect(once).toContain('# Caro-Kann ideas');
    expect(once).toContain('**main point**');
    expect(once).toContain('[lichess](https://lichess.org)');
    expect(once).toContain('~~h5~~');
    expect(once).toContain('> A quote about pawn structure.');
  });

  it('parses ```chess fences into chess blocks and serialises them back', () => {
    const md = [
      'Before the board.',
      '',
      '```chess',
      '1. e4 c5 ( 1... e5 2. Nf3 ) 2. Nf3 d6 *',
      '```',
      '',
      'After the board.',
      '',
    ].join('\n');

    const doc = markdownToDoc(md);
    let pgn: string | null = null;
    doc.descendants((node) => {
      if (node.type.name === 'chessBlock') pgn = node.attrs.pgn as string;
    });
    expect(pgn).toBe('1. e4 c5 ( 1... e5 2. Nf3 ) 2. Nf3 d6 *');

    const out = docToMarkdown(doc);
    expect(out).toContain('```chess\n1. e4 c5 ( 1... e5 2. Nf3 ) 2. Nf3 d6 *\n```');
    expect(roundTrip(out)).toBe(out);
  });

  it('keeps ordinary fenced code blocks distinct from chess blocks', () => {
    const md = '```ts\nconst x = 1;\n```\n';
    const doc = markdownToDoc(md);
    let language: string | null = null;
    let chessBlocks = 0;
    doc.descendants((node) => {
      if (node.type.name === 'codeBlock') language = node.attrs.language as string | null;
      if (node.type.name === 'chessBlock') chessBlocks += 1;
    });
    expect(language).toBe('ts');
    expect(chessBlocks).toBe(0);
    expect(docToMarkdown(doc)).toBe('```ts\nconst x = 1;\n```\n');
  });

  it('round-trips a chess block with a custom start position (FEN header)', () => {
    const md = [
      '```chess',
      '[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]',
      '[SetUp "1"]',
      '',
      '1. O-O *',
      '```',
      '',
    ].join('\n');
    const once = roundTrip(md);
    expect(once).toContain('[FEN "4k3/8/8/8/8/8/8/4K2R w K - 0 1"]');
    expect(roundTrip(once)).toBe(once);
  });

  describe('front matter', () => {
    const md = ['---', 'tags: endgame, rook', 'title: Lucena', '---', '', '# Lucena', '', 'Body.', ''].join('\n');

    it('is split off rather than parsed as a rule and a heading', () => {
      const { front, body } = splitFrontMatter(md);
      expect(front).toBe('---\ntags: endgame, rook\ntitle: Lucena\n---\n');
      expect(body).toBe('\n# Lucena\n\nBody.\n');
      // The bug this exists for: CommonMark reads that block as an <hr>
      // followed by a setext H2, and the next autosave wrote it back that
      // way — so the document must not contain it at all.
      const doc = markdownToDoc(md);
      expect(doc.textContent).not.toContain('tags:');
    });

    it('survives a round trip verbatim', () => {
      const { front } = splitFrontMatter(md);
      const out = docToMarkdown(markdownToDoc(md), front);
      expect(out).toBe('---\ntags: endgame, rook\ntitle: Lucena\n---\n\n# Lucena\n\nBody.\n');
      // And again, so an untouched note that is opened twice is unchanged.
      expect(docToMarkdown(markdownToDoc(out), splitFrontMatter(out).front)).toBe(out);
    });

    it('leaves a note that merely starts with a rule alone', () => {
      const ruled = '---\n\nAfter a rule.\n';
      expect(splitFrontMatter(ruled).front).toBe('');
      expect(roundTrip(ruled)).toContain('After a rule.');
    });

    it('adds nothing to a note that has none', () => {
      expect(docToMarkdown(markdownToDoc('# Plain\n\nBody.\n'))).toBe('# Plain\n\nBody.\n');
    });
  });

  describe('hostile input', () => {
    // Notes are user-authored and rendered by a rich editor, and the entire
    // raw-HTML defence is two settings on the MarkdownIt instance: `html:
    // false`, and its default validateLink. Nothing else exercises either,
    // so this block exists to make a future `html: true` (or a laxer custom
    // validateLink) fail here instead of shipping.

    /** Every link href in the parsed document. */
    const linkHrefs = (md: string): string[] => {
      const hrefs: string[] = [];
      markdownToDoc(md).descendants((node) => {
        for (const mark of node.marks) {
          if (mark.type.name === 'link') hrefs.push(String(mark.attrs.href));
        }
      });
      return hrefs;
    };

    it('keeps a script tag as literal text', () => {
      const doc = markdownToDoc('Before <script>alert(1)</script> after.\n');
      // Text, verbatim — the tag never became markup of any kind. (With
      // html: true the parser meets an html token it has no mapping for
      // and this parse would not even succeed.)
      expect(doc.textContent).toContain('<script>alert(1)</script>');
    });

    it('keeps an event-handler tag as literal text', () => {
      const doc = markdownToDoc('<img src=x onerror=alert(1)>\n');
      expect(doc.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('refuses a javascript: href instead of making a link', () => {
      const md = '[link](javascript:alert(1))\n';
      // validateLink rejects the scheme, so no link mark exists at all and
      // the text stays on the page as the literal characters typed.
      expect(linkHrefs(md)).toEqual([]);
      expect(markdownToDoc(md).textContent).toContain('[link](javascript:alert(1))');
      // And an ordinary link still works, so the guard is the scheme check
      // rather than links being broken across the board.
      expect(linkHrefs('[ok](https://lichess.org)\n')).toEqual(['https://lichess.org']);
    });

    it('treats benign inline HTML as literal text too', () => {
      const doc = markdownToDoc('some <b>bold</b> words\n');
      expect(doc.textContent).toContain('<b>bold</b>');
      let bolded = false;
      doc.descendants((node) => {
        if (node.marks.some((mark) => mark.type.name === 'bold')) bolded = true;
      });
      expect(bolded).toBe(false);
    });
  });
});
