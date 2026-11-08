import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxPublisherService } from '../../shared/application/services/outbox-publisher.service.js';

@Injectable()
export class OutboxWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxWorker.name);
  private stopping = false;
  private loopPromise?: Promise<void>;
  private wake?: () => void;

  constructor(
    private readonly publisher: OutboxPublisherService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.getOrThrow<boolean>('OUTBOX_WORKER_ENABLED')) return;
    this.loopPromise = this.loop().catch((error: unknown) => {
      this.logger.error(error instanceof Error ? error.stack : String(error));
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    while (!this.stopping) {
      try {
        await this.publisher.runOnce();
      } catch (error) {
        this.logger.error(error instanceof Error ? error.stack : String(error));
      }
      if (!this.stopping) {
        await this.delay(
          this.config.getOrThrow<number>('OUTBOX_POLL_INTERVAL_MS'),
        );
      }
    }
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, milliseconds);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
    });
  }
}
