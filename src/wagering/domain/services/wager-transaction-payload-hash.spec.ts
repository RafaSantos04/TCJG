import {
  calculateWagerTransactionPayloadHash,
  canonicalizeJson,
  type WagerTransactionBusinessPayload,
} from './wager-transaction-payload-hash.js';
import { WagerTransactionKind } from '../value-objects/wager-transaction-kind.js';

describe('wager transaction payload hash', () => {
  it('sorts object keys recursively without spaces', () => {
    const first = {
      z: 'last',
      nested: { currency: 'BRL', amount: '10.00' },
      a: 'first',
    };
    const second = {
      a: 'first',
      nested: { amount: '10.00', currency: 'BRL' },
      z: 'last',
    };

    const expected =
      '{"a":"first","nested":{"amount":"10.00","currency":"BRL"},"z":"last"}';

    expect(canonicalizeJson(first)).toBe(expected);
    expect(canonicalizeJson(second)).toBe(expected);
  });

  it('calculates the expected SHA-256 hex digest', () => {
    const payload: WagerTransactionBusinessPayload = {
      walletId: 'wallet-1',
      roundId: 'round-1',
      providerId: 'provider-1',
      playerId: 'player-1',
      money: { currency: 'BRL', amount: '25.00' },
      kind: WagerTransactionKind.BET,
      gameId: 'game-1',
      externalTransactionId: 'external-1',
    };

    expect(calculateWagerTransactionPayloadHash(payload)).toBe(
      '0b0d83f0c7ad282cc057bade61932bc91a85ef7f732e1acd8e6bd67c3df96197',
    );
  });

  it('omits an absent optional reference from canonical JSON', () => {
    expect(
      canonicalizeJson({
        kind: WagerTransactionKind.BET,
        referenceExternalTransactionId: undefined,
      }),
    ).toBe('{"kind":"BET"}');
  });
});
