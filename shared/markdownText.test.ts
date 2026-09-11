import { describe, expect, it } from 'vitest';
import { markdownToText } from './markdownText.ts';

describe('markdownToText', () => {
  it('drops the front matter and keeps the prose', () => {
    expect(markdownToText('---\naliases: a, b\n---\n\nHello there.\n')).toBe('Hello there.');
  });

  it('strips heading, list, quote and emphasis marks', () => {
    expect(markdownToText('# Title\n\n- one\n- **two**\n> quoted *word*\n')).toBe('Title\none\ntwo\nquoted word');
  });

  it('keeps the visible text of links and wiki links', () => {
    expect(markdownToText('See [[Najdorf|the Najdorf]] and [[Rook endings]] on [the site](https://x).')).toBe(
      'See the Najdorf and Rook endings on the site.',
    );
  });

  it('drops a chess board wholesale and keeps any other fence as text', () => {
    expect(markdownToText('Before.\n\n```chess\n1. e4 {hi} e5\n```\n\nAfter.\n\n```\ncode here\n```\n')).toBe(
      'Before.\nAfter.\ncode here',
    );
  });

  it('collapses runs of blank lines and spaces', () => {
    expect(markdownToText('a   b\n\n\n\nc')).toBe('a b\nc');
  });
});
