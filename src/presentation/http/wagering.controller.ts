import type { ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Param,
  Res,
  StandardSchemaValidationPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProcessWagerTransaction } from '../../wagering/application/process-wager-transaction.js';
import { GetWagerTransaction } from '../../wagering/application/get-wager-transaction.js';
import { WagerTransactionStatus } from '../../wagering/domain/value-objects/wager-transaction-status.js';
import { MetricsService } from '../../infrastructure/observability/metrics.service.js';
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
  private readonly logger = new Logger(WageringController.name);

  constructor(
    private readonly processWagerTransaction: ProcessWagerTransaction,
    private readonly getWagerTransaction: GetWagerTransaction,
    private readonly metrics: MetricsService,
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

    const startedAt = performance.now();
    try {
      const result = await this.processWagerTransaction.execute({
        ...request,
        idempotencyKey: parsedIdempotencyKey.data,
      });
      this.metrics.recordWager(result.status, request.kind);
      if (result.idempotentReplay) this.metrics.recordReplay('http');
      this.logger.log({
        event: 'wager_transaction_handled',
        transactionId: result.transactionId,
        walletId: request.walletId,
        providerId: request.providerId,
        status: result.status,
        kind: request.kind,
        idempotentReplay: result.idempotentReplay,
      });
      response.statusCode =
        result.status === WagerTransactionStatus.PENDING_REFERENCE ? 202 : 200;
      return result;
    } finally {
      this.metrics.observeWagerDuration(
        'http',
        (performance.now() - startedAt) / 1_000,
      );
    }
  }
}
