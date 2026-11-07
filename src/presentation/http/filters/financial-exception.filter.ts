import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { TransientPersistenceError } from '../../../shared/application/errors/persistence.error.js';
import { IdempotencyConflictError } from '../../../wagering/application/errors/idempotency-conflict.error.js';
import { WagerTransactionConflictError } from '../../../wagering/application/errors/wager-transaction-conflict.error.js';
import { WalletNotFoundError } from '../../../wagering/application/errors/wallet-not-found.error.js';
import { WalletAlreadyExistsError } from '../../../wallet/application/errors/wallet-already-exists.error.js';

type ErrorMapping = Readonly<{
  status: number;
  code: string;
  retryable: boolean;
}>;

@Injectable()
@Catch(
  WalletAlreadyExistsError,
  IdempotencyConflictError,
  WagerTransactionConflictError,
  WalletNotFoundError,
  TransientPersistenceError,
)
export class FinancialExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: Error, host: ArgumentsHost): void {
    const mapping = FinancialExceptionFilter.map(exception);
    const context = host.switchToHttp();
    const response = context.getResponse();

    if (mapping.retryable) {
      this.httpAdapterHost.httpAdapter.setHeader(response, 'Retry-After', '1');
    }

    this.httpAdapterHost.httpAdapter.reply(
      response,
      {
        error: {
          code: mapping.code,
          message: exception.message,
          retryable: mapping.retryable,
        },
      },
      mapping.status,
    );
  }

  private static map(exception: Error): ErrorMapping {
    if (exception instanceof WalletAlreadyExistsError) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'WALLET_ALREADY_EXISTS',
        retryable: false,
      };
    }

    if (exception instanceof IdempotencyConflictError) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'IDEMPOTENCY_CONFLICT',
        retryable: false,
      };
    }

    if (exception instanceof WagerTransactionConflictError) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'WAGER_TRANSACTION_CONFLICT',
        retryable: false,
      };
    }

    if (exception instanceof WalletNotFoundError) {
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'WALLET_NOT_FOUND',
        retryable: false,
      };
    }

    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'TRANSIENT_PERSISTENCE_FAILURE',
      retryable: true,
    };
  }
}
