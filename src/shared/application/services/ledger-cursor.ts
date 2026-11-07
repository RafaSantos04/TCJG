import { InvalidLedgerCursorError } from '../errors/invalid-ledger-cursor.error.js';

const SEQUENCE_PATTERN = /^[1-9]\d*$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function encodeLedgerCursor(sequence: string): string {
  if (!SEQUENCE_PATTERN.test(sequence)) {
    throw new InvalidLedgerCursorError();
  }

  return Buffer.from(sequence, 'utf8').toString('base64url');
}

export function decodeLedgerCursor(cursor: string): string {
  if (!BASE64URL_PATTERN.test(cursor)) {
    throw new InvalidLedgerCursorError();
  }

  const sequence = Buffer.from(cursor, 'base64url').toString('utf8');
  if (
    !SEQUENCE_PATTERN.test(sequence) ||
    encodeLedgerCursor(sequence) !== cursor
  ) {
    throw new InvalidLedgerCursorError();
  }

  return sequence;
}
