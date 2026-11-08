import type { OutboxMessage } from '../../domain/entities/outbox-message.js';

export const INTEGRATION_EVENT_PUBLISHER_PORT = Symbol(
  'INTEGRATION_EVENT_PUBLISHER_PORT',
);

export interface IntegrationEventPublisherPort {
  publish(message: OutboxMessage): Promise<void>;
}
