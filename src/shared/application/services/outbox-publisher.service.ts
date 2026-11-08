import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  INTEGRATION_EVENT_PUBLISHER_PORT,
  type IntegrationEventPublisherPort,
} from '../ports/integration-event-publisher.port.js';
import {
  OUTBOX_REPOSITORY_PORT,
  type ClaimedOutboxMessage,
  type OutboxRepositoryPort,
} from '../ports/outbox-repository.port.js';

export type OutboxRunStats = Readonly<{
  claimed: number;
  published: number;
  retried: number;
  leaseLost: number;
  maxAttemptsReached: number;
}>;

@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(
    @Inject(OUTBOX_REPOSITORY_PORT)
    private readonly repository: OutboxRepositoryPort,
    @Inject(INTEGRATION_EVENT_PUBLISHER_PORT)
    private readonly publisher: IntegrationEventPublisherPort,
    private readonly config: ConfigService,
  ) {}

  async runOnce(): Promise<OutboxRunStats> {
    const claimed = await this.repository.claimBatch(
      this.config.getOrThrow<number>('OUTBOX_BATCH_SIZE'),
      this.config.getOrThrow<number>('OUTBOX_LEASE_MS'),
    );
    const groups = new Map<string, ClaimedOutboxMessage[]>();
    for (const item of claimed) {
      const group = groups.get(item.message.aggregateId) ?? [];
      group.push(item);
      groups.set(item.message.aggregateId, group);
    }
    const results = (
      await Promise.all(
        [...groups.values()].map(async (group) => {
          const groupResults: PublishResult[] = [];
          for (const item of group) {
            const result = await this.publishClaim(item);
            groupResults.push(result);
            if (result !== 'published') break;
          }
          return groupResults;
        }),
      )
    ).flat();

    return Object.freeze({
      claimed: claimed.length,
      published: results.filter((result) => result === 'published').length,
      retried: results.filter(
        (result) => result === 'retried' || result === 'max-attempts',
      ).length,
      leaseLost: results.filter((result) => result === 'lease-lost').length,
      maxAttemptsReached: results.filter((result) => result === 'max-attempts')
        .length,
    });
  }

  getLagSeconds(): Promise<number> {
    return this.repository.getLagSeconds();
  }

  private async publishClaim(
    claim: ClaimedOutboxMessage,
  ): Promise<PublishResult> {
    try {
      await this.publisher.publish(claim.message);
      return (await this.repository.markPublished(
        claim.message.id,
        claim.leaseUntil,
      ))
        ? 'published'
        : 'lease-lost';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      claim.message.scheduleRetry(new Date(), message.slice(0, 2_000), {
        baseDelayMs: this.config.getOrThrow<number>('OUTBOX_RETRY_BASE_MS'),
        maxDelayMs: this.config.getOrThrow<number>('OUTBOX_RETRY_MAX_MS'),
        jitterRatio: this.config.getOrThrow<number>('OUTBOX_RETRY_JITTER'),
      });
      const updated = await this.repository.scheduleRetry(
        claim.message,
        claim.leaseUntil,
      );
      if (!updated) return 'lease-lost';

      if (
        claim.message.attempts >=
        this.config.getOrThrow<number>('OUTBOX_MAX_ATTEMPTS')
      ) {
        this.logger.error(
          `Outbox ${claim.message.id} reached ${claim.message.attempts} attempts`,
        );
        return 'max-attempts';
      }
      return 'retried';
    }
  }
}

type PublishResult = 'published' | 'retried' | 'max-attempts' | 'lease-lost';
