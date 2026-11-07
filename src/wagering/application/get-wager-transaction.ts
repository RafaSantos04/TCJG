import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCIAL_QUERY_PORT,
  type FinancialQueryPort,
  type WagerTransactionReadModel,
} from '../../shared/application/ports/financial-query.port.js';
import { WagerTransactionNotFoundError } from './errors/wager-transaction-not-found.error.js';

@Injectable()
export class GetWagerTransaction {
  constructor(
    @Inject(FINANCIAL_QUERY_PORT)
    private readonly queries: FinancialQueryPort,
  ) {}

  async byId(transactionId: string) {
    const transaction = await this.queries.findWagerById(transactionId);
    if (!transaction) {
      throw new WagerTransactionNotFoundError(transactionId);
    }

    return GetWagerTransaction.toResponse(transaction);
  }

  async byProvider(providerId: string, externalTransactionId: string) {
    const transaction = await this.queries.findWagerByProviderTransaction(
      providerId,
      externalTransactionId,
    );
    if (!transaction) {
      throw new WagerTransactionNotFoundError(
        `${providerId}/${externalTransactionId}`,
      );
    }

    return GetWagerTransaction.toResponse(transaction);
  }

  private static toResponse(transaction: WagerTransactionReadModel) {
    return Object.freeze({
      ...transaction,
      createdAt: transaction.createdAt.toISOString(),
      processedAt: transaction.processedAt?.toISOString(),
    });
  }
}
