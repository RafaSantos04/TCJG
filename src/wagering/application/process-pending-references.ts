import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PENDING_REFERENCE_REPOSITORY_PORT,
  type PendingReferenceRepositoryPort,
} from '../../shared/application/ports/pending-reference-repository.port.js';
import { ProcessWagerTransaction } from './process-wager-transaction.js';

export type PendingReferenceRunStats = Readonly<{
  claimed: number;
  processed: number;
  rejected: number;
  rescheduled: number;
  skipped: number;
  failed: number;
}>;

@Injectable()
export class ProcessPendingReferences {
  private readonly logger = new Logger(ProcessPendingReferences.name);

  constructor(
    @Inject(PENDING_REFERENCE_REPOSITORY_PORT)
    private readonly repository: PendingReferenceRepositoryPort,
    private readonly processWagerTransaction: ProcessWagerTransaction,
    private readonly config: ConfigService,
  ) {}

  async runOnce(): Promise<PendingReferenceRunStats> {
    const claims = await this.repository.claimBatch(
      this.config.getOrThrow<number>('PENDING_REFERENCE_BATCH_SIZE'),
      this.config.getOrThrow<number>('PENDING_REFERENCE_LEASE_MS'),
    );
    const outcomes = await Promise.all(
      claims.map(async (claim) => {
        try {
          return await this.processWagerTransaction.retryPending(
            claim.transactionId,
            claim.attempts,
          );
        } catch (error) {
          this.logger.error(
            error instanceof Error ? error.stack : String(error),
          );
          return 'failed' as const;
        }
      }),
    );

    return Object.freeze({
      claimed: claims.length,
      processed: outcomes.filter((outcome) => outcome === 'processed').length,
      rejected: outcomes.filter((outcome) => outcome === 'rejected').length,
      rescheduled: outcomes.filter((outcome) => outcome === 'rescheduled')
        .length,
      skipped: outcomes.filter((outcome) => outcome === 'skipped').length,
      failed: outcomes.filter((outcome) => outcome === 'failed').length,
    });
  }
}
