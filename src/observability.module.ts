import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import { OutboxModule } from './outbox.module.js';
import { HealthController } from './infrastructure/health/health.controller.js';
import { SqsHealthIndicator } from './infrastructure/health/sqs-health.indicator.js';
import { MetricsController } from './infrastructure/observability/metrics.controller.js';
import { MetricsService } from './infrastructure/observability/metrics.service.js';
import { observabilityContext } from './infrastructure/observability/observability-context.js';
import { ObservabilityContextInterceptor } from './infrastructure/observability/observability-context.interceptor.js';
import { FINANCIAL_REDACT_PATHS } from './infrastructure/observability/pino-options.js';

@Global()
@Module({
  imports: [
    TerminusModule,
    OutboxModule,
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (request: IncomingMessage, response: ServerResponse) => {
          const incoming = request.headers['x-correlation-id'];
          const correlationId =
            typeof incoming === 'string' && incoming.length > 0
              ? incoming
              : randomUUID();
          response.setHeader('X-Correlation-Id', correlationId);
          return correlationId;
        },
        customProps: (request: IncomingMessage & { id?: string }) => ({
          correlationId: request.id,
        }),
        mixin: () => observabilityContext.getStore() ?? {},
        redact: {
          paths: [...FINANCIAL_REDACT_PATHS],
          censor: '[REDACTED]',
        },
        serializers: {
          req: (request: IncomingMessage & { id?: string }) => ({
            id: request.id,
            method: request.method,
            url: request.url,
          }),
          res: (response: ServerResponse) => ({
            statusCode: response.statusCode,
          }),
        },
      },
    }),
  ],
  controllers: [HealthController, MetricsController],
  providers: [
    MetricsService,
    SqsHealthIndicator,
    {
      provide: APP_INTERCEPTOR,
      useClass: ObservabilityContextInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}
