import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { InvalidLedgerCursorError } from '../../../shared/application/errors/invalid-ledger-cursor.error.js';
import { TransientPersistenceError } from '../../../shared/application/errors/persistence.error.js';
import { ProviderAuthenticationRequiredError } from '../../../shared/application/errors/provider-authentication-required.error.js';
import { ProviderIdentityMismatchError } from '../../../shared/application/errors/provider-identity-mismatch.error.js';
import { IdempotencyConflictError } from '../../../wagering/application/errors/idempotency-conflict.error.js';
import { WagerTransactionConflictError } from '../../../wagering/application/errors/wager-transaction-conflict.error.js';
import { WagerTransactionNotFoundError } from '../../../wagering/application/errors/wager-transaction-not-found.error.js';
import { WalletNotFoundError } from '../../../wagering/application/errors/wallet-not-found.error.js';
import { WalletAlreadyExistsError } from '../../../wallet/application/errors/wallet-already-exists.error.js';
import { MetricsService } from '../../../infrastructure/observability/metrics.service.js';

type ErrorMapping = Readonly<{
  status: number;
  code: string;
  retryable: boolean;
}>;

@Injectable()
@Catch()
export class FinancialExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(FinancialExceptionFilter.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof IdempotencyConflictError) {
      this.metrics?.recordIdempotencyConflict();
    }
    if (
      exception instanceof TransientPersistenceError &&
      /lock|deadlock|serialization/i.test(exception.message)
    ) {
      this.metrics?.recordLockConflict();
    }
    const mapping = FinancialExceptionFilter.map(exception);
    if (mapping.status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const response = host.switchToHttp().getResponse();
    if (mapping.retryable) {
      this.httpAdapterHost.httpAdapter.setHeader(response, 'Retry-After', '1');
    }

    this.httpAdapterHost.httpAdapter.reply(
      response,
      {
        error: {
          code: mapping.code,
          message: FinancialExceptionFilter.message(exception, mapping.status),
          retryable: mapping.retryable,
        },
      },
      mapping.status,
    );
  }

  private static map(exception: unknown): ErrorMapping {
    if (exception instanceof WalletAlreadyExistsError) {
      return this.mapping(409, 'WALLET_ALREADY_EXISTS');
    }
    if (exception instanceof IdempotencyConflictError) {
      return this.mapping(409, 'IDEMPOTENCY_CONFLICT');
    }
    if (exception instanceof WagerTransactionConflictError) {
      return this.mapping(409, 'WAGER_TRANSACTION_CONFLICT');
    }
    if (exception instanceof WalletNotFoundError) {
      return this.mapping(404, 'WALLET_NOT_FOUND');
    }
    if (exception instanceof WagerTransactionNotFoundError) {
      return this.mapping(404, 'WAGER_TRANSACTION_NOT_FOUND');
    }
    if (exception instanceof InvalidLedgerCursorError) {
      return this.mapping(422, 'INVALID_LEDGER_CURSOR');
    }
    if (exception instanceof ProviderIdentityMismatchError) {
      return this.mapping(403, 'PROVIDER_IDENTITY_MISMATCH');
    }
    if (exception instanceof ProviderAuthenticationRequiredError) {
      return this.mapping(401, 'PROVIDER_AUTHENTICATION_REQUIRED');
    }
    if (exception instanceof TransientPersistenceError) {
      return {
        status: 503,
        code: 'TRANSIENT_PERSISTENCE_FAILURE',
        retryable: true,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return this.mapping(
        status,
        status === 422 ? 'VALIDATION_ERROR' : `HTTP_${status}`,
      );
    }

    return this.mapping(500, 'INTERNAL_ERROR');
  }

  private static mapping(status: number, code: string): ErrorMapping {
    return { status, code, retryable: false };
  }

  private static message(exception: unknown, status: number): string {
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      return 'An unexpected error occurred';
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = response.message;
        if (Array.isArray(message)) return message.join('; ');
        if (typeof message === 'string') return message;
      }
    }

    return exception instanceof Error ? exception.message : 'Request failed';
  }
}
