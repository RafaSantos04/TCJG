import { InvalidLedgerCursorError } from '../errors/invalid-ledger-cursor.error.js';
import { decodeLedgerCursor, encodeLedgerCursor } from './ledger-cursor.js';

describe('ledger cursor', () => {
  it('round-trips a sequence as canonical base64url', () => {
    const cursor = encodeLedgerCursor('9223372036854775807');

    expect(cursor).not.toContain('9223372036854775807');
    expect(decodeLedgerCursor(cursor)).toBe('9223372036854775807');
  });

  it.each(['', 'not base64!', 'MA', 'MDE', 'LTE'])(
    'rejects invalid or non-canonical cursor %s',
    (cursor) => {
      expect(() => decodeLedgerCursor(cursor)).toThrow(
        InvalidLedgerCursorError,
      );
    },
  );
});
