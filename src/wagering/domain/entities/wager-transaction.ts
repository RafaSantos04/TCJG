import type { Money } from '../../../shared/domain/value-objects/money.js';
import {
  WalletLedgerDirection,
  type WalletLedgerDirection as WalletLedgerDirectionValue,
} from '../../../wallet/domain/entities/wallet-ledger-entry.js';
import { InvalidLedgerReferenceError } from '../errors/invalid-ledger-reference.error.js';
import { InvalidTransactionStateError } from '../errors/invalid-transaction-state.error.js';
import { LedgerNotApplicableError } from '../errors/ledger-not-applicable.error.js';
import { MissingTransactionReferenceError } from '../errors/missing-transaction-reference.error.js';
import { PendingReferenceNotApplicableError } from '../errors/pending-reference-not-applicable.error.js';
import { calculateWagerTransactionPayloadHash } from '../services/wager-transaction-payload-hash.js';
import type { FailureCode } from '../value-objects/failure-code.js';
import {
  WagerTransactionKind,
  type WagerTransactionKind as WagerTransactionKindValue,
} from '../value-objects/wager-transaction-kind.js';
import {
  WagerTransactionStatus,
  type WagerTransactionStatus as WagerTransactionStatusValue,
} from '../value-objects/wager-transaction-status.js';

export type CreateWagerTransaction = Readonly<{
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKindValue;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
}>;

export type RehydrateWagerTransaction = CreateWagerTransaction &
  Readonly<{
    payloadHash: string;
    status: WagerTransactionStatusValue;
    referenceTransactionId?: string;
    failureCode?: FailureCode;
    processedAt?: Date;
  }>;

export class WagerTransaction {
  private readonly createdAtValue: Date;
  private statusValue: WagerTransactionStatusValue;
  private referenceTransactionIdValue: string | undefined;
  private failureCodeValue: FailureCode | undefined;
  private processedAtValue: Date | undefined;

  private constructor(
    readonly id: string,
    readonly providerId: string,
    readonly externalTransactionId: string,
    readonly idempotencyKey: string,
    readonly payloadHash: string,
    readonly walletId: string,
    readonly playerId: string,
    readonly roundId: string,
    readonly gameId: string,
    readonly kind: WagerTransactionKindValue,
    readonly money: Money,
    readonly referenceExternalTransactionId: string | undefined,
    createdAt: Date,
    status: WagerTransactionStatusValue,
    referenceTransactionId?: string,
    failureCode?: FailureCode,
    processedAt?: Date,
  ) {
    this.createdAtValue = new Date(createdAt.getTime());
    this.statusValue = status;
    this.referenceTransactionIdValue = referenceTransactionId;
    this.failureCodeValue = failureCode;
    this.processedAtValue = processedAt
      ? new Date(processedAt.getTime())
      : undefined;
  }

  static create(input: CreateWagerTransaction): WagerTransaction {
    if (
      WagerTransaction.requiresReferenceKind(input.kind) &&
      !input.referenceExternalTransactionId?.trim()
    ) {
      throw new MissingTransactionReferenceError(input.kind);
    }

    const payloadHash = calculateWagerTransactionPayloadHash({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money.toJSON(),
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });

    return new WagerTransaction(
      input.id,
      input.providerId,
      input.externalTransactionId,
      input.idempotencyKey,
      payloadHash,
      input.walletId,
      input.playerId,
      input.roundId,
      input.gameId,
      input.kind,
      input.money,
      input.referenceExternalTransactionId,
      input.createdAt,
      WagerTransactionStatus.PENDING,
    );
  }

  static rehydrate(input: RehydrateWagerTransaction): WagerTransaction {
    return new WagerTransaction(
      input.id,
      input.providerId,
      input.externalTransactionId,
      input.idempotencyKey,
      input.payloadHash,
      input.walletId,
      input.playerId,
      input.roundId,
      input.gameId,
      input.kind,
      input.money,
      input.referenceExternalTransactionId,
      input.createdAt,
      input.status,
      input.referenceTransactionId,
      input.failureCode,
      input.processedAt,
    );
  }

  get status(): WagerTransactionStatusValue {
    return this.statusValue;
  }

  get referenceTransactionId(): string | undefined {
    return this.referenceTransactionIdValue;
  }

  get failureCode(): FailureCode | undefined {
    return this.failureCodeValue;
  }

  get createdAt(): Date {
    return new Date(this.createdAtValue.getTime());
  }

  get processedAt(): Date | undefined {
    return this.processedAtValue
      ? new Date(this.processedAtValue.getTime())
      : undefined;
  }

  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertCanTransitionTo(WagerTransactionStatus.PROCESSED);

    if (this.requiresReference() && !referenceTransactionId?.trim()) {
      throw new MissingTransactionReferenceError(this.kind);
    }

    this.referenceTransactionIdValue = referenceTransactionId;
    this.processedAtValue = new Date(at.getTime());
    this.statusValue = WagerTransactionStatus.PROCESSED;
  }

  markPendingReference(): void {
    this.assertCanTransitionTo(WagerTransactionStatus.PENDING_REFERENCE);

    if (!this.requiresReference()) {
      throw new PendingReferenceNotApplicableError(this.kind);
    }

    this.statusValue = WagerTransactionStatus.PENDING_REFERENCE;
  }

  reject(code: FailureCode): void {
    this.assertCanTransitionTo(WagerTransactionStatus.REJECTED);
    this.failureCodeValue = code;
    this.statusValue = WagerTransactionStatus.REJECTED;
  }

  fail(code: FailureCode): void {
    this.assertCanTransitionTo(WagerTransactionStatus.FAILED);
    this.failureCodeValue = code;
    this.statusValue = WagerTransactionStatus.FAILED;
  }

  isTerminal(): boolean {
    return (
      this.statusValue === WagerTransactionStatus.PROCESSED ||
      this.statusValue === WagerTransactionStatus.REJECTED ||
      this.statusValue === WagerTransactionStatus.FAILED
    );
  }

  affectsBalance(): boolean {
    return (
      this.kind !== WagerTransactionKind.LOSS &&
      this.statusValue !== WagerTransactionStatus.REJECTED &&
      this.statusValue !== WagerTransactionStatus.FAILED
    );
  }

  requiresReference(): boolean {
    return WagerTransaction.requiresReferenceKind(this.kind);
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  ledgerDirectionFor(reference?: WagerTransaction): WalletLedgerDirectionValue {
    if (!this.affectsBalance()) {
      throw new LedgerNotApplicableError(this.kind, this.statusValue);
    }

    switch (this.kind) {
      case WagerTransactionKind.BET:
        return WalletLedgerDirection.DEBIT;
      case WagerTransactionKind.OPENING:
      case WagerTransactionKind.WIN:
      case WagerTransactionKind.REFUND:
        return WalletLedgerDirection.CREDIT;
      case WagerTransactionKind.ROLLBACK:
        return this.rollbackLedgerDirection(reference);
      case WagerTransactionKind.LOSS:
        throw new LedgerNotApplicableError(this.kind, this.statusValue);
    }
  }

  private rollbackLedgerDirection(
    reference: WagerTransaction | undefined,
  ): WalletLedgerDirectionValue {
    if (reference?.kind === WagerTransactionKind.BET) {
      return WalletLedgerDirection.CREDIT;
    }

    if (
      reference?.kind === WagerTransactionKind.WIN ||
      reference?.kind === WagerTransactionKind.REFUND
    ) {
      return WalletLedgerDirection.DEBIT;
    }

    throw new InvalidLedgerReferenceError(reference?.kind);
  }

  private assertCanTransitionTo(next: WagerTransactionStatusValue): void {
    const allowedTransitions: readonly WagerTransactionStatusValue[] =
      this.statusValue === WagerTransactionStatus.PENDING
        ? [
            WagerTransactionStatus.PROCESSED,
            WagerTransactionStatus.REJECTED,
            WagerTransactionStatus.FAILED,
            WagerTransactionStatus.PENDING_REFERENCE,
          ]
        : this.statusValue === WagerTransactionStatus.PENDING_REFERENCE
          ? [
              WagerTransactionStatus.PROCESSED,
              WagerTransactionStatus.REJECTED,
              WagerTransactionStatus.FAILED,
            ]
          : [];

    if (!allowedTransitions.includes(next)) {
      throw new InvalidTransactionStateError(this.statusValue, next);
    }
  }

  private static requiresReferenceKind(
    kind: WagerTransactionKindValue,
  ): boolean {
    return (
      kind === WagerTransactionKind.REFUND ||
      kind === WagerTransactionKind.ROLLBACK
    );
  }
}
