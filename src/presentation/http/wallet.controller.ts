import {
  Body,
  Controller,
  Post,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { CreateWallet } from '../../wallet/application/create-wallet.js';
import {
  createWalletRequestSchema,
  type CreateWalletRequest,
} from './schemas/financial-request.schemas.js';

const requestValidationPipe = new StandardSchemaValidationPipe({
  errorHttpStatusCode: 422,
});

@Controller('wallets')
export class WalletController {
  constructor(private readonly createWallet: CreateWallet) {}

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
}
