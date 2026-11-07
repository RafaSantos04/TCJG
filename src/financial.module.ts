import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { FINANCIAL_TRANSACTION_PORT } from './shared/application/ports/financial-transaction.port.js';
import { MikroOrmFinancialTransactionAdapter } from './infrastructure/persistence/mikro-orm/mikro-orm-financial-transaction.adapter.js';
import { WalletController } from './presentation/http/wallet.controller.js';
import { WageringController } from './presentation/http/wagering.controller.js';
import { FinancialExceptionFilter } from './presentation/http/filters/financial-exception.filter.js';
import { CreateWallet } from './wallet/application/create-wallet.js';
import { ProcessWagerTransaction } from './wagering/application/process-wager-transaction.js';

@Module({
  controllers: [WalletController, WageringController],
  providers: [
    CreateWallet,
    ProcessWagerTransaction,
    {
      provide: FINANCIAL_TRANSACTION_PORT,
      useClass: MikroOrmFinancialTransactionAdapter,
    },
    {
      provide: APP_FILTER,
      useClass: FinancialExceptionFilter,
    },
  ],
  exports: [CreateWallet, ProcessWagerTransaction, FINANCIAL_TRANSACTION_PORT],
})
export class FinancialModule {}
