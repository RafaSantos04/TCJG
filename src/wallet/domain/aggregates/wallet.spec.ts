import { CurrencyMismatchError } from '../../../shared/domain/errors/currency-mismatch.error.js';
import { Money } from '../../../shared/domain/value-objects/money.js';
import { WalletLedgerDirection } from '../entities/wallet-ledger-entry.js';
import { InsufficientFundsError } from '../errors/insufficient-funds.error.js';
import { InvalidWalletAmountError } from '../errors/invalid-wallet-amount.error.js';
import { Wallet } from './wallet.js';

const walletId = 'wallet-1';
const playerId = 'player-1';
const openedAt = new Date('2026-11-07T12:00:00.000Z');

function openWallet(): Wallet {
  return Wallet.open({
    id: walletId,
    playerId,
    currency: 'BRL',
    at: openedAt,
  });
}

describe('Wallet', () => {
  it('opens with zero balance, version one and encapsulated timestamps', () => {
    const inputDate = new Date(openedAt);
    const wallet = Wallet.open({
      id: walletId,
      playerId,
      currency: 'BRL',
      at: inputDate,
    });

    inputDate.setUTCFullYear(2030);
    const exposedDate = wallet.updatedAt;
    exposedDate.setUTCFullYear(2031);

    expect(wallet.id).toBe(walletId);
    expect(wallet.playerId).toBe(playerId);
    expect(wallet.balance.toJSON()).toEqual({
      amount: '0.00',
      currency: 'BRL',
    });
    expect(wallet.currency).toBe('BRL');
    expect(wallet.version).toBe(1);
    expect(wallet.createdAt).toEqual(openedAt);
    expect(wallet.updatedAt).toEqual(openedAt);
  });

  it('rehydrates the persisted state without replaying transitions', () => {
    const balance = Money.from('85.25', 'BRL');
    const createdAt = new Date('2026-11-01T10:00:00.000Z');
    const updatedAt = new Date('2026-11-06T18:30:00.000Z');

    const wallet = Wallet.rehydrate({
      id: walletId,
      playerId,
      balance,
      version: 7,
      createdAt,
      updatedAt,
    });

    expect(wallet.balance).toBe(balance);
    expect(wallet.version).toBe(7);
    expect(wallet.createdAt).toEqual(createdAt);
    expect(wallet.updatedAt).toEqual(updatedAt);
  });

  it('credits the balance and returns the matching ledger entry', () => {
    const wallet = openWallet();
    const creditedAt = new Date('2026-11-07T12:05:00.000Z');

    const entry = wallet.credit(
      Money.from('100.00', 'BRL'),
      'transaction-credit',
      creditedAt,
    );

    expect(wallet.balance.amount).toBe('100.00');
    expect(wallet.version).toBe(2);
    expect(wallet.updatedAt).toEqual(creditedAt);
    expect(entry).toMatchObject({
      walletId,
      transactionId: 'transaction-credit',
      direction: WalletLedgerDirection.CREDIT,
    });
    expect(entry.money.amount).toBe('100.00');
    expect(entry.balanceBefore.amount).toBe('0.00');
    expect(entry.balanceAfter.amount).toBe('100.00');
    expect(entry.createdAt).toEqual(creditedAt);
    expect(entry.isBalanced()).toBe(true);
  });

  it('debits the balance and returns the matching ledger entry', () => {
    const wallet = openWallet();
    wallet.credit(
      Money.from('100.00', 'BRL'),
      'transaction-opening',
      new Date('2026-11-07T12:01:00.000Z'),
    );
    const debitedAt = new Date('2026-11-07T12:10:00.000Z');

    const entry = wallet.debit(
      Money.from('25.50', 'BRL'),
      'transaction-debit',
      debitedAt,
    );

    expect(wallet.balance.amount).toBe('74.50');
    expect(wallet.version).toBe(3);
    expect(wallet.updatedAt).toEqual(debitedAt);
    expect(entry.direction).toBe(WalletLedgerDirection.DEBIT);
    expect(entry.balanceBefore.amount).toBe('100.00');
    expect(entry.balanceAfter.amount).toBe('74.50');
    expect(entry.isBalanced()).toBe(true);
  });

  it('rejects insufficient funds without changing aggregate state', () => {
    const wallet = openWallet();
    const creditedAt = new Date('2026-11-07T12:01:00.000Z');
    wallet.credit(Money.from('10.00', 'BRL'), 'transaction-credit', creditedAt);

    expect(() =>
      wallet.debit(
        Money.from('10.01', 'BRL'),
        'transaction-debit',
        new Date('2026-11-07T12:02:00.000Z'),
      ),
    ).toThrow(InsufficientFundsError);
    expect(wallet.balance.amount).toBe('10.00');
    expect(wallet.version).toBe(2);
    expect(wallet.updatedAt).toEqual(creditedAt);
  });

  it.each(['credit', 'debit'] as const)(
    'rejects a currency mismatch on %s without changing aggregate state',
    (operation) => {
      const wallet = openWallet();

      expect(() =>
        wallet[operation](
          Money.from('1.00', 'USD'),
          'transaction-id',
          new Date('2026-11-07T12:05:00.000Z'),
        ),
      ).toThrow(CurrencyMismatchError);
      expect(wallet.balance.amount).toBe('0.00');
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(openedAt);
    },
  );

  it.each([
    ['zero', Money.zero('BRL')],
    ['negative', Money.from('1.00', 'BRL').negate()],
  ])(
    'rejects a %s operation amount without changing balance or version',
    (_description, amount) => {
      const wallet = openWallet();

      expect(() =>
        wallet.credit(
          amount,
          'transaction-id',
          new Date('2026-11-07T12:05:00.000Z'),
        ),
      ).toThrow(InvalidWalletAmountError);
      expect(wallet.balance.amount).toBe('0.00');
      expect(wallet.version).toBe(1);
      expect(wallet.updatedAt).toEqual(openedAt);
    },
  );
});
