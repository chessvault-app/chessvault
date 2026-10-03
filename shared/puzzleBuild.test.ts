import { describe, expect, it } from 'vitest';
import { machineReasonOf } from './puzzleBuild.ts';

/** An error the way Node and better-sqlite3 build theirs: a message and a code. */
const coded = (code: string | number, message = 'x'): Error => Object.assign(new Error(message), { code });

describe('machineReasonOf', () => {
  it('reads a full disk from the system and from SQLite', () => {
    expect(machineReasonOf(coded('ENOSPC', 'ENOSPC: no space left on device, write'))).toBe('disk');
    expect(machineReasonOf(coded('EDQUOT'))).toBe('disk');
    expect(machineReasonOf(coded('SQLITE_FULL', 'database or disk is full'))).toBe('disk');
  });

  it('reads exhausted memory from the system and from SQLite', () => {
    expect(machineReasonOf(coded('ENOMEM'))).toBe('memory');
    expect(machineReasonOf(coded('SQLITE_NOMEM', 'out of memory'))).toBe('memory');
  });

  it('leaves everything else to the step that threw it', () => {
    // fzstd's own errors carry a number.
    expect(machineReasonOf(coded(0, 'invalid zstd data'))).toBeNull();
    expect(machineReasonOf(coded('SQLITE_CONSTRAINT_PRIMARYKEY'))).toBeNull();
    expect(machineReasonOf(coded('ECONNRESET'))).toBeNull();
    expect(machineReasonOf(new TypeError('fetch failed'))).toBeNull();
    expect(machineReasonOf('a string')).toBeNull();
    expect(machineReasonOf(null)).toBeNull();
  });
});
