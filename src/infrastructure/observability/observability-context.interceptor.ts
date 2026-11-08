import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  assignObservabilityContext,
  observabilityContext,
  type ObservabilityContext,
} from './observability-context.js';

type FinancialRequest = IncomingMessage & {
  id?: string;
  body?: { walletId?: unknown; providerId?: unknown };
  params?: { walletId?: unknown; providerId?: unknown };
};

@Injectable()
export class ObservabilityContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FinancialRequest>();
    const response = context.switchToHttp().getResponse<ServerResponse>();
    const correlationId =
      request.id ?? incomingCorrelationId(request) ?? randomUUID();
    response.setHeader('X-Correlation-Id', correlationId);
    const store: ObservabilityContext = { correlationId };
    const walletId = request.body?.walletId ?? request.params?.walletId;
    const providerId = request.body?.providerId ?? request.params?.providerId;
    if (typeof walletId === 'string') store.walletId = walletId;
    if (typeof providerId === 'string') store.providerId = providerId;

    return new Observable((subscriber) =>
      observabilityContext.run(store, () =>
        next.handle().subscribe({
          next: (value: unknown) => {
            if (hasStringProperty(value, 'transactionId')) {
              assignObservabilityContext({
                transactionId: value.transactionId,
              });
            }
            subscriber.next(value);
          },
          error: (error: unknown) => subscriber.error(error),
          complete: () => subscriber.complete(),
        }),
      ),
    );
  }
}

function incomingCorrelationId(request: IncomingMessage): string | undefined {
  const value = request.headers['x-correlation-id'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function hasStringProperty(
  value: unknown,
  property: string,
): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    property in value &&
    typeof (value as Record<string, unknown>)[property] === 'string'
  );
}
