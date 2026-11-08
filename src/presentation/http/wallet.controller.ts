import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { CreateWallet } from '../../wallet/application/create-wallet.js';
import { GetWallet } from '../../wallet/application/get-wallet.js';
import { ListWalletLedger } from '../../wallet/application/list-wallet-ledger.js';
import { ReconcileWallet } from '../../wallet/application/reconcile-wallet.js';
import {
  createWalletRequestSchema,
  ledgerQuerySchema,
  type LedgerQuery,
  type CreateWalletRequest,
  uuidPathSchema,
} from './schemas/financial-request.schemas.js';

const requestValidationPipe = new StandardSchemaValidationPipe({
  errorHttpStatusCode: 422,
});

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly createWallet: CreateWallet,
    private readonly getWallet: GetWallet,
    private readonly listWalletLedger: ListWalletLedger,
    private readonly reconcileWallet: ReconcileWallet,
  ) {}

  @Post()
  create(
    @Body({
      schema: createWalletRequestSchema,
      pipes: [requestValidationPipe],
    })
    request: CreateWalletRequest,
  ) {
    return this.createWallet.execute(request);
  }

  @Get(':walletId')
  findOne(
    @Param('walletId', {
      schema: uuidPathSchema,
      pipes: [requestValidationPipe],
    })
    walletId: string,
  ) {
    return this.getWallet.execute(walletId);
  }

  @Get(':walletId/ledger')
  listLedger(
    @Param('walletId', {
      schema: uuidPathSchema,
      pipes: [requestValidationPipe],
    })
    walletId: string,
    @Query({ schema: ledgerQuerySchema, pipes: [requestValidationPipe] })
    query: LedgerQuery,
  ) {
    return this.listWalletLedger.execute({ walletId, ...query });
  }

  @Post(':walletId/reconciliation')
  @HttpCode(200)
  reconcile(
    @Param('walletId', {
      schema: uuidPathSchema,
      pipes: [requestValidationPipe],
    })
    walletId: string,
  ) {
    return this.reconcileWallet.execute(walletId);
  }
}
