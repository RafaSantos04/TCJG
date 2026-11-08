import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { MikroOrmFinancialQueryAdapter } from './infrastructure/persistence/mikro-orm/mikro-orm-financial-query.adapter.js';
import { NestReconciliationObservabilityAdapter } from './infrastructure/observability/nest-reconciliation-observability.adapter.js';
import { NoopProviderIdentityAdapter } from './presentation/http/auth/noop-provider-identity.adapter.js';
import { ProviderAuthGuard } from './presentation/http/auth/provider-auth.guard.js';
import { FINANCIAL_TRANSACTION_PORT } from './shared/application/ports/financial-transaction.port.js';
import { FINANCIAL_QUERY_PORT } from './shared/application/ports/financial-query.port.js';
import { RECONCILIATION_OBSERVABILITY_PORT } from './shared/application/ports/reconciliation-observability.port.js';
import { PROVIDER_IDENTITY_PORT } from './shared/application/ports/provider-identity.port.js';
import { MikroOrmFinancialTransactionAdapter } from './infrastructure/persistence/mikro-orm/mikro-orm-financial-transaction.adapter.js';
import { WalletController } from './presentation/http/wallet.controller.js';
import { WageringController } from './presentation/http/wagering.controller.js';
import { ProviderWageringController } from './presentation/http/provider-wagering.controller.js';
import { FinancialExceptionFilter } from './presentation/http/filters/financial-exception.filter.js';
import { CreateWallet } from './wallet/application/create-wallet.js';
import { GetWallet } from './wallet/application/get-wallet.js';
import { ListWalletLedger } from './wallet/application/list-wallet-ledger.js';
import { ReconcileWallet } from './wallet/application/reconcile-wallet.js';
import { GetWagerTransaction } from './wagering/application/get-wager-transaction.js';
import { ProcessWagerTransaction } from './wagering/application/process-wager-transaction.js';

@Module({
  controllers: [
    WalletController,
    WageringController,
    ProviderWageringController,
  ],
  providers: [
    CreateWallet,
    GetWallet,
    ListWalletLedger,
    ReconcileWallet,
    GetWagerTransaction,
    ProcessWagerTransaction,
    {
      provide: FINANCIAL_TRANSACTION_PORT,
      useClass: MikroOrmFinancialTransactionAdapter,
    },
    {
      provide: FINANCIAL_QUERY_PORT,
      useClass: MikroOrmFinancialQueryAdapter,
    },
    {
      provide: RECONCILIATION_OBSERVABILITY_PORT,
      useClass: NestReconciliationObservabilityAdapter,
    },
    {
      provide: PROVIDER_IDENTITY_PORT,
      useClass: NoopProviderIdentityAdapter,
    },
    {
      provide: APP_GUARD,
      useClass: ProviderAuthGuard,
    },
    {
      provide: APP_FILTER,
      useClass: FinancialExceptionFilter,
    },
  ],
  exports: [
    CreateWallet,
    GetWallet,
    ListWalletLedger,
    ReconcileWallet,
    GetWagerTransaction,
    ProcessWagerTransaction,
    FINANCIAL_QUERY_PORT,
    FINANCIAL_TRANSACTION_PORT,
  ],
})
export class FinancialModule {}
