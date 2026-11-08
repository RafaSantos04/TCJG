import { Module } from '@nestjs/common';
import { MikroOrmOutboxRepository } from './infrastructure/persistence/mikro-orm/mikro-orm-outbox.repository.js';
import { OutboxWorker } from './infrastructure/messaging/outbox-worker.js';
import { SqsIntegrationEventPublisher } from './infrastructure/messaging/sqs-integration-event.publisher.js';
import { INTEGRATION_EVENT_PUBLISHER_PORT } from './shared/application/ports/integration-event-publisher.port.js';
import { OUTBOX_REPOSITORY_PORT } from './shared/application/ports/outbox-repository.port.js';
import { OutboxPublisherService } from './shared/application/services/outbox-publisher.service.js';

@Module({
  providers: [
    OutboxPublisherService,
    OutboxWorker,
    {
      provide: OUTBOX_REPOSITORY_PORT,
      useClass: MikroOrmOutboxRepository,
    },
    {
      provide: INTEGRATION_EVENT_PUBLISHER_PORT,
      useClass: SqsIntegrationEventPublisher,
    },
  ],
  exports: [OutboxPublisherService, OUTBOX_REPOSITORY_PORT],
})
export class OutboxModule {}
