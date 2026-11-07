import { CurrencyMismatchError } from '../../../shared/domain/errors/currency-mismatch.error.js';
import { Money } from '../../../shared/domain/value-objects/money.js';
import { InvalidLedgerEntryError } from '../errors/invalid-ledger-entry.error.js';
import {
  WalletLedgerDirection,
  WalletLedgerEntry,
} from './wallet-ledger-entry.js';

const createdAt = new Date('2026-11-07T12:00:00.000Z');

describe('WalletLedgerEntry', () => {
  it('exposes no transition methods', () => {
    expect(
      Object.getOwnPropertyNames(WalletLedgerEntry.prototype).sort(),
    ).toEqual(['constructor', 'createdAt', 'isBalanced'].sort());
  });

  it.each([
    {
      direction: WalletLedgerDirection.CREDIT,
      balanceBefore: '10.00',
      money: '5.00',
      balanceAfter: '15.00',
    },
    {
      direction: WalletLedgerDirection.DEBIT,
      balanceBefore: '10.00',
      money: '5.00',
      balanceAfter: '5.00',
    },
  ])('creates a balanced $direction entry', (example) => {
    const entry = WalletLedgerEntry.create({
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: example.direction,
      money: Money.from(example.money, 'BRL'),
      balanceBefore: Money.from(example.balanceBefore, 'BRL'),
      balanceAfter: Money.from(example.balanceAfter, 'BRL'),
      createdAt,
    });

    expect(entry.isBalanced()).toBe(true);
    expect(entry.direction).toBe(example.direction);
    expect(entry.createdAt).toEqual(createdAt);
  });

  it('rejects arithmetic inconsistent with the direction', () => {
    expect(() =>
      WalletLedgerEntry.create({
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: WalletLedgerDirection.DEBIT,
        money: Money.from('5.00', 'BRL'),
        balanceBefore: Money.from('10.00', 'BRL'),
        balanceAfter: Money.from('15.00', 'BRL'),
        createdAt,
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it('rehydrates persisted state without revalidating its transition', () => {
    const entry = WalletLedgerEntry.rehydrate({
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: WalletLedgerDirection.DEBIT,
      money: Money.from('5.00', 'BRL'),
      balanceBefore: Money.from('10.00', 'BRL'),
      balanceAfter: Money.from('15.00', 'BRL'),
      createdAt,
    });

    expect(entry.balanceAfter.amount).toBe('15.00');
    expect(entry.isBalanced()).toBe(false);
  });

  it('rejects negative balances', () => {
    expect(() =>
      WalletLedgerEntry.create({
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: WalletLedgerDirection.DEBIT,
        money: Money.from('10.00', 'BRL'),
        balanceBefore: Money.from('5.00', 'BRL'),
        balanceAfter: Money.from('5.00', 'BRL').subtract(
          Money.from('10.00', 'BRL'),
        ),
        createdAt,
      }),
    ).toThrow(InvalidLedgerEntryError);
  });

  it.each([Money.zero('BRL'), Money.from('1.00', 'BRL').negate()])(
    'rejects a non-positive amount',
    (money) => {
      expect(() =>
        WalletLedgerEntry.create({
          walletId: 'wallet-1',
          transactionId: 'transaction-1',
          direction: WalletLedgerDirection.CREDIT,
          money,
          balanceBefore: Money.zero('BRL'),
          balanceAfter: Money.zero('BRL'),
          createdAt,
        }),
      ).toThrow(InvalidLedgerEntryError);
    },
  );

  it('rejects currencies that do not match', () => {
    expect(() =>
      WalletLedgerEntry.create({
        walletId: 'wallet-1',
        transactionId: 'transaction-1',
        direction: WalletLedgerDirection.CREDIT,
        money: Money.from('5.00', 'USD'),
        balanceBefore: Money.from('10.00', 'BRL'),
        balanceAfter: Money.from('15.00', 'BRL'),
        createdAt,
      }),
    ).toThrow(CurrencyMismatchError);
  });

  it('is frozen and protects its timestamp from external mutation', () => {
    const inputDate = new Date(createdAt);
    const entry = WalletLedgerEntry.create({
      walletId: 'wallet-1',
      transactionId: 'transaction-1',
      direction: WalletLedgerDirection.CREDIT,
      money: Money.from('5.00', 'BRL'),
      balanceBefore: Money.from('10.00', 'BRL'),
      balanceAfter: Money.from('15.00', 'BRL'),
      createdAt: inputDate,
    });

    inputDate.setUTCFullYear(2030);
    const exposedDate = entry.createdAt;
    exposedDate.setUTCFullYear(2031);

    expect(Object.isFrozen(entry)).toBe(true);
    expect(entry.createdAt).toEqual(createdAt);
  });
});
