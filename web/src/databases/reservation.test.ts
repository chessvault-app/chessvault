import { describe, expect, it } from 'vitest';
import {
  FRESH_DATABASES,
  MAX_ROWS,
  databasesShapeOf,
  parseDatabasesShape,
  storedDatabasesShape,
} from './reservation';

describe('parseDatabasesShape', () => {
  it('reads the floor for a device that has never been here', () => {
    expect(parseDatabasesShape(null)).toEqual(FRESH_DATABASES);
  });

  it('reads the floor for anything unreadable', () => {
    expect(parseDatabasesShape('')).toEqual(FRESH_DATABASES);
    expect(parseDatabasesShape('not json')).toEqual(FRESH_DATABASES);
    expect(parseDatabasesShape('42')).toEqual(FRESH_DATABASES);
    expect(parseDatabasesShape('null')).toEqual(FRESH_DATABASES);
  });

  it('round-trips a stored shape', () => {
    const shape = { mount: 'manager' as const, rows: 7 };
    expect(parseDatabasesShape(storedDatabasesShape(shape))).toEqual(shape);
  });

  it('keeps the two panel-less mounts distinct', () => {
    expect(parseDatabasesShape('{"mount":"mounted","rows":0}').mount).toBe('mounted');
    expect(parseDatabasesShape('{"mount":"none","rows":0}').mount).toBe('none');
  });

  it('reads an unknown mount as the panel, and drops rows the card cannot draw', () => {
    expect(parseDatabasesShape('{"mount":"sheet","rows":3}')).toEqual({ mount: 'manager', rows: 3 });
    expect(parseDatabasesShape('{"mount":"mounted","rows":3}')).toEqual({ mount: 'mounted', rows: 0 });
  });

  it('clamps a count past the cap rather than dropping it', () => {
    expect(parseDatabasesShape('{"mount":"manager","rows":40}').rows).toBe(MAX_ROWS);
  });

  it('reads a bad count as the empty list', () => {
    expect(parseDatabasesShape('{"mount":"manager","rows":-1}').rows).toBe(0);
    expect(parseDatabasesShape('{"mount":"manager","rows":"6"}').rows).toBe(0);
  });
});

describe('databasesShapeOf', () => {
  it('reads the three mounts the way the page does', () => {
    expect(databasesShapeOf({ ready: true, databases: [{}, {}] })).toEqual({ mount: 'manager', rows: 2 });
    expect(databasesShapeOf({ ready: false, databases: [] })).toEqual({ mount: 'manager', rows: 0 });
    expect(databasesShapeOf({ ready: true })).toEqual({ mount: 'mounted', rows: 0 });
    expect(databasesShapeOf({ ready: false })).toEqual({ mount: 'none', rows: 0 });
  });
});
