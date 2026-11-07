import { InvalidExternalTransactionKindError } from '../errors/invalid-external-transaction-kind.error.js';
import { WagerTransactionKind } from '../value-objects/wager-transaction-kind.js';
import { parseExternalWagerTransactionKind } from './external-wager-transaction-kind.js';

describe('parseExternalWagerTransactionKind', () => {
  it.each([
    WagerTransactionKind.BET,
    WagerTransactionKind.WIN,
    WagerTransactionKind.LOSS,
    WagerTransactionKind.REFUND,
    WagerTransactionKind.ROLLBACK,
  ])('accepts the external kind %s', (kind) => {
    expect(parseExternalWagerTransactionKind(kind)).toBe(kind);
  });

  it('rejects the internal OPENING kind', () => {
    expect(() =>
      parseExternalWagerTransactionKind(WagerTransactionKind.OPENING),
    ).toThrow(InvalidExternalTransactionKindError);
  });

  it('rejects an unknown kind', () => {
    expect(() => parseExternalWagerTransactionKind('UNKNOWN')).toThrow(
      InvalidExternalTransactionKindError,
    );
  });
});
