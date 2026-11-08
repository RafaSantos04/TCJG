import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProcessPendingReferences } from '../../wagering/application/process-pending-references.js';

@Injectable()
export class PendingReferenceWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private stopping = false;
  private loopPromise?: Promise<void>;
  private wake?: () => void;

  constructor(
    private readonly processor: ProcessPendingReferences,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.getOrThrow<boolean>('PENDING_REFERENCE_WORKER_ENABLED')) {
      return;
    }
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
        await this.processor.runOnce();
      } catch (error) {
        this.logger.error(error instanceof Error ? error.stack : String(error));
      }
      if (!this.stopping) {
        await this.delay(
          this.config.getOrThrow<number>('PENDING_REFERENCE_POLL_INTERVAL_MS'),
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
