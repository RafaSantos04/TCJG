import { Money } from '../../../../shared/domain/value-objects/money.js';
import { WagerTransaction } from '../../../../wagering/domain/entities/wager-transaction.js';
import { FailureCode } from '../../../../wagering/domain/value-objects/failure-code.js';
import { WagerTransactionKind } from '../../../../wagering/domain/value-objects/wager-transaction-kind.js';
import { Wallet } from '../../../../wallet/domain/aggregates/wallet.js';
import { WalletLedgerEntryMapper } from './wallet-ledger-entry.mapper.js';
import { WalletMapper } from './wallet.mapper.js';
import { WagerTransactionMapper } from './wager-transaction.mapper.js';

const createdAt = new Date('2026-11-07T16:00:00.000Z');

describe('persistence mappers', () => {
  it('round-trips Wallet with Money stored as amount and currency columns', () => {
    const wallet = Wallet.open({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      currency: 'BRL',
      at: createdAt,
    });
    wallet.credit(Money.from('1000.00', 'BRL'), 'transaction-1', createdAt);

    const persisted = WalletMapper.toPersistence(wallet);
    const restored = WalletMapper.toDomain(persisted);

    expect(persisted.balance).toBe('1000.00');
    expect(persisted.currency).toBe('BRL');
    expect(restored.balance.toJSON()).toEqual({
      amount: '1000.00',
      currency: 'BRL',
    });
    expect(restored.version).toBe(2);
  });

  it('round-trips WagerTransaction and keeps balanceAfter as an exact string', () => {
    const transaction = WagerTransaction.create({
      id: '0192f298-345e-7e38-af88-e43f851a819d',
      providerId: 'provider-a',
      externalTransactionId: 'transaction-123',
      idempotencyKey: 'provider-a:transaction-123',
      walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      roundId: 'round-987',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.BET,
      money: Money.from('25.00', 'BRL'),
      createdAt,
    });
    transaction.reject(FailureCode.INSUFFICIENT_FUNDS);

    const persisted = WagerTransactionMapper.toPersistence(
      transaction,
      Money.from('10.00', 'BRL'),
    );
    const restored = WagerTransactionMapper.toDomain(persisted);

    expect(persisted.amount).toBe('25.00');
    expect(persisted.currency).toBe('BRL');
    expect(persisted.balanceAfter).toBe('10.00');
    expect(restored.money.toJSON()).toEqual({
      amount: '25.00',
      currency: 'BRL',
    });
    expect(restored.status).toBe(transaction.status);
    expect(restored.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
  });

  it('round-trips WalletLedgerEntry with three exact monetary columns', () => {
    const wallet = Wallet.open({
      id: '0192f291-27dd-7d3f-8071-5f8685deef37',
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      currency: 'BRL',
      at: createdAt,
    });
    const entry = wallet.credit(
      Money.from('100.00', 'BRL'),
      '0192f298-345e-7e38-af88-e43f851a819d',
      createdAt,
    );

    const persisted = WalletLedgerEntryMapper.toPersistence(entry);
    persisted.seq = '1';
    const restored = WalletLedgerEntryMapper.toDomain(persisted);

    expect(persisted.amount).toBe('100.00');
    expect(persisted.balanceBefore).toBe('0.00');
    expect(persisted.balanceAfter).toBe('100.00');
    expect(restored.isBalanced()).toBe(true);
    expect(restored.balanceAfter.amount).toBe('100.00');
  });
});
