import { describe, expect, it } from 'vitest';

import { SEPARATOR_BIG_STEP, SEPARATOR_STEP, separatorKey } from '@/components/separator-keys';

const key = (key: string, shiftKey = false) => ({ key, shiftKey });

describe('separatorKey', () => {
  it('moves a column divider with Left and Right, a step at a time', () => {
    expect(separatorKey(key('ArrowRight'), 'vertical', 400, 280, 820)).toEqual({
      kind: 'move',
      to: 400 + SEPARATOR_STEP,
    });
    expect(separatorKey(key('ArrowLeft'), 'vertical', 400, 280, 820)).toEqual({
      kind: 'move',
      to: 400 - SEPARATOR_STEP,
    });
    // Up and Down belong to the page behind a column divider.
    expect(separatorKey(key('ArrowUp'), 'vertical', 400, 280, 820)).toBeNull();
  });

  it('moves a row divider with Up and Down', () => {
    expect(separatorKey(key('ArrowDown'), 'horizontal', 300, 100, 600)).toEqual({
      kind: 'move',
      to: 300 + SEPARATOR_STEP,
    });
    expect(separatorKey(key('ArrowLeft'), 'horizontal', 300, 100, 600)).toBeNull();
  });

  it('takes a larger step with Shift', () => {
    expect(separatorKey(key('ArrowRight', true), 'vertical', 400, 280, 820)).toEqual({
      kind: 'move',
      to: 400 + SEPARATOR_BIG_STEP,
    });
  });

  it('stops at the same limits the pointer does', () => {
    expect(separatorKey(key('ArrowLeft', true), 'vertical', 290, 280, 820)).toEqual({
      kind: 'move',
      to: 280,
    });
    expect(separatorKey(key('ArrowRight', true), 'vertical', 800, 280, 820)).toEqual({
      kind: 'move',
      to: 820,
    });
  });

  it('resets on Enter, as the double-click does', () => {
    expect(separatorKey(key('Enter'), 'vertical', 400, 280, 820)).toEqual({ kind: 'reset' });
  });

  it('ignores every other key', () => {
    expect(separatorKey(key('Home'), 'vertical', 400, 280, 820)).toBeNull();
    expect(separatorKey(key('a'), 'horizontal', 400, 280, 820)).toBeNull();
  });
});
