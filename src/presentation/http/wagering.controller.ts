import type { ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Param,
  Res,
  StandardSchemaValidationPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProcessWagerTransaction } from '../../wagering/application/process-wager-transaction.js';
import { GetWagerTransaction } from '../../wagering/application/get-wager-transaction.js';
import { WagerTransactionStatus } from '../../wagering/domain/value-objects/wager-transaction-status.js';
import {
  idempotencyKeySchema,
  processWagerTransactionRequestSchema,
  type ProcessWagerTransactionRequest,
  uuidPathSchema,
} from './schemas/financial-request.schemas.js';

const requestValidationPipe = new StandardSchemaValidationPipe({
  errorHttpStatusCode: 422,
});

@Controller('wagering/transactions')
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransaction,
    private readonly getWagerTransaction: GetWagerTransaction,
  ) {}

  @Get(':transactionId')
  findOne(
    @Param('transactionId', {
      schema: uuidPathSchema,
      pipes: [requestValidationPipe],
    })
    transactionId: string,
  ) {
    return this.getWagerTransaction.byId(transactionId);
  }

  @Post()
  @HttpCode(200)
  async process(
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Body({
      schema: processWagerTransactionRequestSchema,
      pipes: [requestValidationPipe],
    })
    request: ProcessWagerTransactionRequest,
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    const parsedIdempotencyKey =
      idempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedIdempotencyKey.success) {
      throw new UnprocessableEntityException(
        'A valid Idempotency-Key header is required',
      );
    }

    const result = await this.processWagerTransaction.execute({
      ...request,
      idempotencyKey: parsedIdempotencyKey.data,
    });
    response.statusCode =
      result.status === WagerTransactionStatus.PENDING_REFERENCE ? 202 : 200;
    return result;
  }
}
