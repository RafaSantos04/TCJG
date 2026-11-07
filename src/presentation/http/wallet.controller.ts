import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { CreateWallet } from '../../wallet/application/create-wallet.js';
import { GetWallet } from '../../wallet/application/get-wallet.js';
import { ListWalletLedger } from '../../wallet/application/list-wallet-ledger.js';
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
}
