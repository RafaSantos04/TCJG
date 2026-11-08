import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCIAL_QUERY_PORT,
  type FinancialQueryPort,
  type WalletReconciliationSnapshot,
} from '../../shared/application/ports/financial-query.port.js';
import {
  RECONCILIATION_OBSERVABILITY_PORT,
  type ReconciliationObservabilityPort,
} from '../../shared/application/ports/reconciliation-observability.port.js';
import {
  Money,
  type SerializedMoney,
} from '../../shared/domain/value-objects/money.js';
import { WalletNotFoundError } from '../../wagering/application/errors/wallet-not-found.error.js';
import { WalletLedgerDirection } from '../domain/entities/wallet-ledger-entry.js';

export type ReconciliationResult = Readonly<{
  walletId: string;
  storedBalance: SerializedMoney;
  calculatedBalance: SerializedMoney;
  difference: SerializedMoney;
  consistent: boolean;
  checkedEntries: number;
}>;

type ReconciliationEvaluation = Readonly<{
  result: ReconciliationResult;
  reasons: readonly string[];
}>;

@Injectable()
export class ReconcileWallet {
  constructor(
    @Inject(FINANCIAL_QUERY_PORT)
    private readonly queries: FinancialQueryPort,
    @Inject(RECONCILIATION_OBSERVABILITY_PORT)
    private readonly observability: ReconciliationObservabilityPort,
  ) {}

  async execute(walletId: string): Promise<ReconciliationResult> {
    const snapshot =
      await this.queries.getWalletReconciliationSnapshot(walletId);
    if (!snapshot) throw new WalletNotFoundError(walletId);

    const evaluation = evaluateWalletReconciliation(snapshot);
    if (!evaluation.result.consistent) {
      this.observability.recordDivergence(evaluation);
    }

    return evaluation.result;
  }
}

export function evaluateWalletReconciliation(
  snapshot: WalletReconciliationSnapshot,
): ReconciliationEvaluation {
  const { wallet, entries } = snapshot;
  const currency = wallet.balance.currency;
  const reasons = new Set<string>();
  let calculated = Money.zero(currency);
  let previousBalanceAfter: SerializedMoney | undefined;

  for (const entry of entries) {
    const entryCurrencies = [
      entry.money.currency,
      entry.balanceBefore.currency,
      entry.balanceAfter.currency,
    ];
    if (entryCurrencies.some((entryCurrency) => entryCurrency !== currency)) {
      reasons.add('CURRENCY_MISMATCH');
    }

    const amount = Money.from(entry.money.amount, currency);
    calculated =
      entry.direction === WalletLedgerDirection.CREDIT
        ? calculated.add(amount)
        : calculated.subtract(amount);

    if (
      previousBalanceAfter &&
      (entry.balanceBefore.amount !== previousBalanceAfter.amount ||
        entry.balanceBefore.currency !== previousBalanceAfter.currency)
    ) {
      reasons.add('LEDGER_CHAIN_GAP');
    }
    previousBalanceAfter = entry.balanceAfter;
  }

  const stored = Money.from(wallet.balance.amount, currency);
  const firstEntry = entries[0];
  if (
    firstEntry &&
    (firstEntry.balanceBefore.amount !== '0.00' ||
      firstEntry.balanceBefore.currency !== currency)
  ) {
    reasons.add('LEDGER_DOES_NOT_START_AT_ZERO');
  }
  if (!stored.equals(calculated)) reasons.add('CALCULATED_BALANCE_MISMATCH');
  if (
    !previousBalanceAfter ||
    previousBalanceAfter.amount !== wallet.balance.amount ||
    previousBalanceAfter.currency !== currency
  ) {
    reasons.add('LAST_LEDGER_BALANCE_MISMATCH');
  }

  const result = Object.freeze({
    walletId: wallet.id,
    storedBalance: stored.toJSON(),
    calculatedBalance: calculated.toJSON(),
    difference: stored.subtract(calculated).toJSON(),
    consistent: reasons.size === 0,
    checkedEntries: entries.length,
  });

  return Object.freeze({ result, reasons: Object.freeze([...reasons]) });
}
