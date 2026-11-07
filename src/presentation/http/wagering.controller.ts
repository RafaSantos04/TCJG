import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  StandardSchemaValidationPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProcessWagerTransaction } from '../../wagering/application/process-wager-transaction.js';
import {
  idempotencyKeySchema,
  processWagerTransactionRequestSchema,
  type ProcessWagerTransactionRequest,
} from './schemas/financial-request.schemas.js';

const requestValidationPipe = new StandardSchemaValidationPipe({
  errorHttpStatusCode: 422,
});

@Controller('wagering/transactions')
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransaction,
  ) {}

  @Post()
  @HttpCode(200)
  process(
    @Headers('idempotency-key') rawIdempotencyKey: string | undefined,
    @Body({
      schema: processWagerTransactionRequestSchema,
      pipes: [requestValidationPipe],
    })
    request: ProcessWagerTransactionRequest,
  ) {
    const parsedIdempotencyKey =
      idempotencyKeySchema.safeParse(rawIdempotencyKey);
    if (!parsedIdempotencyKey.success) {
      throw new UnprocessableEntityException(
        'A valid Idempotency-Key header is required',
      );
    }

    return this.processWagerTransaction.execute({
      ...request,
      idempotencyKey: parsedIdempotencyKey.data,
    });
  }
}
