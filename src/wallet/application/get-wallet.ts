import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCIAL_QUERY_PORT,
  type FinancialQueryPort,
} from '../../shared/application/ports/financial-query.port.js';
import { WalletNotFoundError } from '../../wagering/application/errors/wallet-not-found.error.js';

@Injectable()
export class GetWallet {
  constructor(
    @Inject(FINANCIAL_QUERY_PORT)
    private readonly queries: FinancialQueryPort,
  ) {}

  async execute(walletId: string) {
    const wallet = await this.queries.findWallet(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return Object.freeze({
      ...wallet,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    });
  }
}
