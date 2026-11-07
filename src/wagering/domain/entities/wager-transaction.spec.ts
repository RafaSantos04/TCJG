import { Money } from '../../../shared/domain/value-objects/money.js';
import { WalletLedgerDirection } from '../../../wallet/domain/entities/wallet-ledger-entry.js';
import { InvalidLedgerReferenceError } from '../errors/invalid-ledger-reference.error.js';
import { InvalidTransactionStateError } from '../errors/invalid-transaction-state.error.js';
import { LedgerNotApplicableError } from '../errors/ledger-not-applicable.error.js';
import { MissingTransactionReferenceError } from '../errors/missing-transaction-reference.error.js';
import { PendingReferenceNotApplicableError } from '../errors/pending-reference-not-applicable.error.js';
import { FailureCode } from '../value-objects/failure-code.js';
import {
  WagerTransactionKind,
  type WagerTransactionKind as WagerTransactionKindValue,
} from '../value-objects/wager-transaction-kind.js';
import { WagerTransactionStatus } from '../value-objects/wager-transaction-status.js';
import {
  WagerTransaction,
  type CreateWagerTransaction,
} from './wager-transaction.js';

const createdAt = new Date('2026-11-07T14:00:00.000Z');

function createTransaction(
  kind: WagerTransactionKindValue = WagerTransactionKind.BET,
  overrides: Partial<CreateWagerTransaction> = {},
): WagerTransaction {
  const referenceExternalTransactionId =
    kind === WagerTransactionKind.REFUND ||
    kind === WagerTransactionKind.ROLLBACK
      ? 'referenced-external-id'
      : undefined;

  return WagerTransaction.create({
    id: 'transaction-1',
    providerId: 'provider-1',
    externalTransactionId: 'external-1',
    idempotencyKey: 'provider-1:external-1',
    walletId: 'wallet-1',
    playerId: 'player-1',
    roundId: 'round-1',
    gameId: 'game-1',
    kind,
    money: Money.from('25.00', 'BRL'),
    referenceExternalTransactionId,
    createdAt,
    ...overrides,
  });
}

describe('WagerTransaction', () => {
  it('creates a pending transaction with a canonical payload hash', () => {
    const inputDate = new Date(createdAt);
    const transaction = createTransaction(WagerTransactionKind.BET, {
      createdAt: inputDate,
    });

    inputDate.setUTCFullYear(2030);
    const exposedDate = transaction.createdAt;
    exposedDate.setUTCFullYear(2031);

    expect(transaction.status).toBe(WagerTransactionStatus.PENDING);
    expect(transaction.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(transaction.createdAt).toEqual(createdAt);
    expect(transaction.referenceTransactionId).toBeUndefined();
    expect(transaction.failureCode).toBeUndefined();
    expect(transaction.processedAt).toBeUndefined();
  });

  it.each([WagerTransactionKind.REFUND, WagerTransactionKind.ROLLBACK])(
    'requires an external reference when creating %s',
    (kind) => {
      expect(() =>
        createTransaction(kind, {
          referenceExternalTransactionId: undefined,
        }),
      ).toThrow(MissingTransactionReferenceError);
    },
  );

  it('rehydrates persisted state without revalidating transitions', () => {
    const transaction = WagerTransaction.rehydrate({
      id: 'transaction-1',
      providerId: 'provider-1',
      externalTransactionId: 'external-1',
      idempotencyKey: 'provider-1:external-1',
      payloadHash: 'persisted-hash',
      walletId: 'wallet-1',
      playerId: 'player-1',
      roundId: 'round-1',
      gameId: 'game-1',
      kind: WagerTransactionKind.ROLLBACK,
      money: Money.from('25.00', 'BRL'),
      referenceExternalTransactionId: undefined,
      createdAt,
      status: WagerTransactionStatus.REJECTED,
      failureCode: undefined,
    });

    expect(transaction.status).toBe(WagerTransactionStatus.REJECTED);
    expect(transaction.payloadHash).toBe('persisted-hash');
    expect(transaction.failureCode).toBeUndefined();
  });

  it('transitions PENDING to PROCESSED and protects the processed timestamp', () => {
    const transaction = createTransaction();
    const processedAt = new Date('2026-11-07T14:01:00.000Z');

    transaction.markProcessed(undefined, processedAt);
    processedAt.setUTCFullYear(2030);
    const exposedDate = transaction.processedAt;
    exposedDate?.setUTCFullYear(2031);

    expect(transaction.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(transaction.isTerminal()).toBe(true);
    expect(transaction.processedAt).toEqual(
      new Date('2026-11-07T14:01:00.000Z'),
    );
  });

  it('transitions PENDING to REJECTED with a failure code', () => {
    const transaction = createTransaction();

    transaction.reject(FailureCode.INSUFFICIENT_FUNDS);

    expect(transaction.status).toBe(WagerTransactionStatus.REJECTED);
    expect(transaction.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
    expect(transaction.isTerminal()).toBe(true);
  });

  it('transitions PENDING to FAILED with a failure code', () => {
    const transaction = createTransaction();

    transaction.fail(FailureCode.INTERNAL_FAILURE);

    expect(transaction.status).toBe(WagerTransactionStatus.FAILED);
    expect(transaction.failureCode).toBe(FailureCode.INTERNAL_FAILURE);
    expect(transaction.isTerminal()).toBe(true);
  });

  it.each(['processed', 'rejected', 'failed'] as const)(
    'transitions PENDING_REFERENCE to %s',
    (target) => {
      const transaction = createTransaction(WagerTransactionKind.REFUND);
      transaction.markPendingReference();

      if (target === 'processed') {
        transaction.markProcessed(
          'internal-reference-id',
          new Date('2026-11-07T14:01:00.000Z'),
        );
      } else if (target === 'rejected') {
        transaction.reject(FailureCode.REFERENCE_NOT_FOUND);
      } else {
        transaction.fail(FailureCode.INTERNAL_FAILURE);
      }

      expect(transaction.status).toBe(
        target === 'processed'
          ? WagerTransactionStatus.PROCESSED
          : target === 'rejected'
            ? WagerTransactionStatus.REJECTED
            : WagerTransactionStatus.FAILED,
      );
    },
  );

  it('requires the resolved internal reference before processing REFUND or ROLLBACK', () => {
    const transaction = createTransaction(WagerTransactionKind.REFUND);

    expect(() =>
      transaction.markProcessed(
        undefined,
        new Date('2026-11-07T14:01:00.000Z'),
      ),
    ).toThrow(MissingTransactionReferenceError);
    expect(transaction.status).toBe(WagerTransactionStatus.PENDING);
  });

  it.each([
    WagerTransactionStatus.PROCESSED,
    WagerTransactionStatus.REJECTED,
    WagerTransactionStatus.FAILED,
  ])('blocks every transition from terminal status %s', (terminalStatus) => {
    const transaction = createTransaction();

    if (terminalStatus === WagerTransactionStatus.PROCESSED) {
      transaction.markProcessed(undefined, createdAt);
    } else if (terminalStatus === WagerTransactionStatus.REJECTED) {
      transaction.reject(FailureCode.INSUFFICIENT_FUNDS);
    } else {
      transaction.fail(FailureCode.INTERNAL_FAILURE);
    }

    expect(() => transaction.markPendingReference()).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => transaction.markProcessed(undefined, createdAt)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => transaction.reject(FailureCode.INTERNAL_FAILURE)).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => transaction.fail(FailureCode.INTERNAL_FAILURE)).toThrow(
      InvalidTransactionStateError,
    );
  });

  it('does not allow PENDING_REFERENCE to transition to itself', () => {
    const transaction = createTransaction(WagerTransactionKind.ROLLBACK);
    transaction.markPendingReference();

    expect(() => transaction.markPendingReference()).toThrow(
      InvalidTransactionStateError,
    );
  });

  it.each([
    WagerTransactionKind.OPENING,
    WagerTransactionKind.BET,
    WagerTransactionKind.WIN,
    WagerTransactionKind.LOSS,
  ])('does not allow %s to wait for a reference', (kind) => {
    const transaction = createTransaction(kind);

    expect(() => transaction.markPendingReference()).toThrow(
      PendingReferenceNotApplicableError,
    );
    expect(transaction.status).toBe(WagerTransactionStatus.PENDING);
  });

  it.each([
    [WagerTransactionKind.BET, WalletLedgerDirection.DEBIT],
    [WagerTransactionKind.WIN, WalletLedgerDirection.CREDIT],
    [WagerTransactionKind.REFUND, WalletLedgerDirection.CREDIT],
    [WagerTransactionKind.OPENING, WalletLedgerDirection.CREDIT],
  ] as const)('maps %s to ledger direction %s', (kind, expectedDirection) => {
    expect(createTransaction(kind).ledgerDirectionFor()).toBe(
      expectedDirection,
    );
  });

  it.each([
    [WagerTransactionKind.BET, WalletLedgerDirection.CREDIT],
    [WagerTransactionKind.WIN, WalletLedgerDirection.DEBIT],
    [WagerTransactionKind.REFUND, WalletLedgerDirection.DEBIT],
  ] as const)(
    'maps ROLLBACK of %s to ledger direction %s',
    (referenceKind, expectedDirection) => {
      const rollback = createTransaction(WagerTransactionKind.ROLLBACK);
      const reference = createTransaction(referenceKind);

      expect(rollback.ledgerDirectionFor(reference)).toBe(expectedDirection);
    },
  );

  it.each([
    WagerTransactionKind.OPENING,
    WagerTransactionKind.LOSS,
    WagerTransactionKind.ROLLBACK,
  ])('rejects ROLLBACK of invalid reference kind %s', (referenceKind) => {
    const rollback = createTransaction(WagerTransactionKind.ROLLBACK);
    const reference = createTransaction(referenceKind);

    expect(() => rollback.ledgerDirectionFor(reference)).toThrow(
      InvalidLedgerReferenceError,
    );
  });

  it('does not expose a ledger direction for LOSS', () => {
    const transaction = createTransaction(WagerTransactionKind.LOSS);

    expect(transaction.affectsBalance()).toBe(false);
    expect(() => transaction.ledgerDirectionFor()).toThrow(
      LedgerNotApplicableError,
    );
  });

  it('does not expose a ledger direction for a REJECTED transaction', () => {
    const transaction = createTransaction(WagerTransactionKind.BET);
    transaction.reject(FailureCode.INSUFFICIENT_FUNDS);

    expect(transaction.affectsBalance()).toBe(false);
    expect(() => transaction.ledgerDirectionFor()).toThrow(
      LedgerNotApplicableError,
    );
  });

  it.each([WagerTransactionKind.REFUND, WagerTransactionKind.ROLLBACK])(
    'reports that %s requires a reference',
    (kind) => {
      expect(createTransaction(kind).requiresReference()).toBe(true);
    },
  );

  it('matches only the same payload hash', () => {
    const transaction = createTransaction();

    expect(transaction.matchesPayload(transaction.payloadHash)).toBe(true);
    expect(transaction.matchesPayload('different-hash')).toBe(false);
  });

  it('excludes transport metadata from the payload hash', () => {
    const first = createTransaction(WagerTransactionKind.BET, {
      id: 'internal-id-1',
      idempotencyKey: 'key-1',
      createdAt: new Date('2026-11-07T14:00:00.000Z'),
    });
    const second = createTransaction(WagerTransactionKind.BET, {
      id: 'internal-id-2',
      idempotencyKey: 'key-2',
      createdAt: new Date('2026-11-07T15:00:00.000Z'),
    });

    expect(first.payloadHash).toBe(second.payloadHash);
  });

  it('detects a divergent payload under the same idempotency key', () => {
    const original = createTransaction();
    const divergent = createTransaction(WagerTransactionKind.BET, {
      money: Money.from('30.00', 'BRL'),
    });

    expect(original.idempotencyKey).toBe(divergent.idempotencyKey);
    expect(original.payloadHash).not.toBe(divergent.payloadHash);
  });
});
