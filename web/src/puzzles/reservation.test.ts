import { describe, expect, it } from 'vitest';
import {
  FRESH_DASHBOARD,
  MAX_ATTEMPTS,
  MAX_BOOKS,
  parseDashboardShape,
  storedDashboardShape,
} from './reservation';

describe('parseDashboardShape', () => {
  it('reads the floor for a device that has never been here', () => {
    expect(parseDashboardShape(null)).toEqual(FRESH_DASHBOARD);
  });

  it('reads the floor for anything unreadable', () => {
    expect(parseDashboardShape('')).toEqual(FRESH_DASHBOARD);
    expect(parseDashboardShape('not json')).toEqual(FRESH_DASHBOARD);
    expect(parseDashboardShape('42')).toEqual(FRESH_DASHBOARD);
    expect(parseDashboardShape('null')).toEqual(FRESH_DASHBOARD);
  });

  it('round-trips a stored shape', () => {
    const shape = { review: 'button' as const, books: 2, attempts: 7 };
    expect(parseDashboardShape(storedDashboardShape(shape))).toEqual(shape);
  });

  it('keeps the note case distinct from the button', () => {
    expect(parseDashboardShape('{"review":"note","books":0,"attempts":0}').review).toBe('note');
  });

  it('reads an unknown review value as the button, not as nothing learned', () => {
    const shape = parseDashboardShape('{"review":"banner","books":1,"attempts":1}');
    expect(shape.review).toBe('button');
    expect(shape.books).toBe(1);
  });

  it('reads the retired "none" as the button the slot now always holds', () => {
    expect(parseDashboardShape('{"review":"none","books":0,"attempts":0}').review).toBe('button');
  });

  it('clamps counts past the caps rather than dropping them', () => {
    const shape = parseDashboardShape('{"review":"none","books":40,"attempts":500}');
    expect(shape.books).toBe(MAX_BOOKS);
    expect(shape.attempts).toBe(MAX_ATTEMPTS);
  });

  it('reads broken counts as zero without losing the rest', () => {
    const shape = parseDashboardShape('{"review":"button","books":-1,"attempts":2.5}');
    expect(shape).toEqual({ review: 'button', books: 0, attempts: 0 });
  });
});
