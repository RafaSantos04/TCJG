import {
  Controller,
  Get,
  Param,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { GetWagerTransaction } from '../../wagering/application/get-wager-transaction.js';
import {
  externalTransactionIdPathSchema,
  providerIdPathSchema,
} from './schemas/financial-request.schemas.js';

const requestValidationPipe = new StandardSchemaValidationPipe({
  errorHttpStatusCode: 422,
});

@Controller('providers/:providerId/wagering/transactions')
export class ProviderWageringController {
  constructor(private readonly getWagerTransaction: GetWagerTransaction) {}

  @Get(':externalTransactionId')
  findOne(
    @Param('providerId', {
      schema: providerIdPathSchema,
      pipes: [requestValidationPipe],
    })
    providerId: string,
    @Param('externalTransactionId', {
      schema: externalTransactionIdPathSchema,
      pipes: [requestValidationPipe],
    })
    externalTransactionId: string,
  ) {
    return this.getWagerTransaction.byProvider(
      providerId,
      externalTransactionId,
    );
  }
}
