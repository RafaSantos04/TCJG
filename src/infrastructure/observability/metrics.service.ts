import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  private readonly wagerTransactions = new Counter({
    name: 'wager_transactions_total',
    help: 'Processed wagering transactions by terminal status and kind',
    labelNames: ['status', 'kind'] as const,
    registers: [this.registry],
  });
  private readonly idempotentReplays = new Counter({
    name: 'idempotent_replays_total',
    help: 'Idempotent replays by entry source',
    labelNames: ['source'] as const,
    registers: [this.registry],
  });
  private readonly idempotencyConflicts = new Counter({
    name: 'idempotency_conflicts_total',
    help: 'Requests rejected because an idempotency key changed payload',
    registers: [this.registry],
  });
  private readonly sqsRetries = new Counter({
    name: 'sqs_retries_total',
    help: 'SQS messages scheduled for another delivery',
    registers: [this.registry],
  });
  private readonly sqsDlqMessages = new Counter({
    name: 'sqs_dlq_messages_total',
    help: 'SQS messages moved to the dead-letter queue',
    registers: [this.registry],
  });
  private readonly lockConflicts = new Counter({
    name: 'lock_conflicts_total',
    help: 'Database lock, deadlock and unique-conflict retries',
    registers: [this.registry],
  });
  private readonly outboxLag = new Gauge({
    name: 'outbox_lag_seconds',
    help: 'Age in seconds of the oldest unpublished outbox message',
    registers: [this.registry],
  });
  private readonly outboxPending = new Gauge({
    name: 'outbox_pending',
    help: 'Number of unpublished outbox messages',
    registers: [this.registry],
  });
  private readonly wagerDuration = new Histogram({
    name: 'wager_processing_duration_seconds',
    help: 'End-to-end wagering processing duration',
    labelNames: ['source'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [this.registry],
  });
  private readonly reconciliationDivergence = new Counter({
    name: 'reconciliation_divergence_total',
    help: 'Wallet reconciliations that detected an inconsistency',
    registers: [this.registry],
  });

  recordWager(status: string, kind: string): void {
    this.wagerTransactions.inc({ status, kind });
  }
  recordReplay(source: 'http' | 'sqs'): void {
    this.idempotentReplays.inc({ source });
  }
  recordIdempotencyConflict(): void {
    this.idempotencyConflicts.inc();
  }
  recordSqsRetry(): void {
    this.sqsRetries.inc();
  }
  recordSqsDlq(): void {
    this.sqsDlqMessages.inc();
  }
  recordLockConflict(): void {
    this.lockConflicts.inc();
  }
  observeWagerDuration(source: 'http' | 'sqs', seconds: number): void {
    this.wagerDuration.observe({ source }, seconds);
  }
  recordReconciliationDivergence(): void {
    this.reconciliationDivergence.inc();
  }
  setOutbox(lagSeconds: number, pending: number): void {
    this.outboxLag.set(lagSeconds);
    this.outboxPending.set(pending);
  }
}
