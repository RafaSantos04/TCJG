import { Controller, Get, Header, Inject } from '@nestjs/common';
import { Public } from '../../presentation/http/auth/public.decorator.js';
import {
  OUTBOX_REPOSITORY_PORT,
  type OutboxRepositoryPort,
} from '../../shared/application/ports/outbox-repository.port.js';
import { MetricsService } from './metrics.service.js';

@Public()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(OUTBOX_REPOSITORY_PORT)
    private readonly outbox: OutboxRepositoryPort,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    const [lag, pending] = await Promise.all([
      this.outbox.getLagSeconds(),
      this.outbox.getPendingCount(),
    ]);
    this.metrics.setOutbox(lag, pending);
    return this.metrics.registry.metrics();
  }
}
