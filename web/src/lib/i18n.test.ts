import { describe, expect, it } from 'vitest';
import { isUntitled } from './i18n';

describe('isUntitled', () => {
  it('matches the bare placeholder and its numbered copies', () => {
    expect(isUntitled('Untitled study', 'Untitled study')).toBe(true);
    expect(isUntitled('Untitled study 2', 'Untitled study')).toBe(true);
    expect(isUntitled('Untitled book 14', 'Untitled book')).toBe(true);
  });

  it('matches the placeholder minted in another language', () => {
    // The Korean New button creates 제목 없는 책; the check must recognise
    // it whatever language is active when it is read.
    expect(isUntitled('제목 없는 책', 'Untitled book')).toBe(true);
    expect(isUntitled('제목 없는 책 3', 'Untitled book')).toBe(true);
  });

  it('leaves chosen names alone', () => {
    expect(isUntitled('My book 2', 'Untitled book')).toBe(false);
    expect(isUntitled('Untitled bookkeeping', 'Untitled book')).toBe(false);
    expect(isUntitled('Untitled study extra', 'Untitled study')).toBe(false);
  });
});
