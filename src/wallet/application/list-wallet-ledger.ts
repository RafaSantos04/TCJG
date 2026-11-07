import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCIAL_QUERY_PORT,
  type FinancialQueryPort,
} from '../../shared/application/ports/financial-query.port.js';
import {
  decodeLedgerCursor,
  encodeLedgerCursor,
} from '../../shared/application/services/ledger-cursor.js';
import { WalletNotFoundError } from '../../wagering/application/errors/wallet-not-found.error.js';

export type ListWalletLedgerQuery = Readonly<{
  walletId: string;
  cursor?: string;
  limit: number;
}>;

@Injectable()
export class ListWalletLedger {
  constructor(
    @Inject(FINANCIAL_QUERY_PORT)
    private readonly queries: FinancialQueryPort,
  ) {}

  async execute(query: ListWalletLedgerQuery) {
    const wallet = await this.queries.findWallet(query.walletId);
    if (!wallet) {
      throw new WalletNotFoundError(query.walletId);
    }

    const afterSequence = query.cursor
      ? decodeLedgerCursor(query.cursor)
      : undefined;
    const entries = await this.queries.listWalletLedger(
      query.walletId,
      afterSequence,
      query.limit + 1,
    );
    const hasNextPage = entries.length > query.limit;
    const page = entries.slice(0, query.limit);
    const last = page.at(-1);

    return Object.freeze({
      items: page.map((entry) => ({
        sequence: entry.sequence,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money,
        balanceBefore: entry.balanceBefore,
        balanceAfter: entry.balanceAfter,
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor:
        hasNextPage && last ? encodeLedgerCursor(last.sequence) : null,
    });
  }
}
