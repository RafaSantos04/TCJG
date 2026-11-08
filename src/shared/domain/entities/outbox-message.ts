import type { IntegrationEvent } from '../events/integration-event.js';

export type RehydrateOutboxMessage = Readonly<{
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt?: Date;
  publishedAt?: Date;
  lastError?: string;
}>;

export type OutboxRetryPolicy = Readonly<{
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  random?: () => number;
}>;

export class OutboxMessage {
  private attemptsValue: number;
  private nextAttemptAtValue?: Date;
  private publishedAtValue?: Date;
  private lastErrorValue?: string;

  private constructor(
    readonly id: string,
    readonly aggregateId: string,
    readonly eventType: string,
    readonly payload: Readonly<Record<string, unknown>>,
    private readonly occurredAtValue: Date,
    attempts: number,
    nextAttemptAt?: Date,
    publishedAt?: Date,
    lastError?: string,
  ) {
    this.attemptsValue = attempts;
    this.nextAttemptAtValue = nextAttemptAt
      ? new Date(nextAttemptAt.getTime())
      : undefined;
    this.publishedAtValue = publishedAt
      ? new Date(publishedAt.getTime())
      : undefined;
    this.lastErrorValue = lastError;
  }

  static enqueue(event: IntegrationEvent<unknown>): OutboxMessage {
    return new OutboxMessage(
      event.eventId,
      event.aggregateId,
      event.eventType,
      event.toJSON() as Readonly<Record<string, unknown>>,
      event.occurredAt,
      0,
      event.occurredAt,
    );
  }

  static rehydrate(state: RehydrateOutboxMessage): OutboxMessage {
    return new OutboxMessage(
      state.id,
      state.aggregateId,
      state.eventType,
      Object.freeze(state.payload),
      state.occurredAt ? new Date(state.occurredAt) : new Date(),
      state.attempts ?? 0,
      state.nextAttemptAt ? new Date(state.nextAttemptAt) : undefined,
      state.publishedAt ? new Date(state.publishedAt) : undefined,
      state.lastError,
    );
  }

  get occurredAt(): Date {
    return new Date(this.occurredAtValue.getTime());
  }

  get attempts(): number {
    return this.attemptsValue;
  }

  get nextAttemptAt(): Date | undefined {
    return this.nextAttemptAtValue
      ? new Date(this.nextAttemptAtValue.getTime())
      : undefined;
  }

  get publishedAt(): Date | undefined {
    return this.publishedAtValue
      ? new Date(this.publishedAtValue.getTime())
      : undefined;
  }

  get lastError(): string | undefined {
    return this.lastErrorValue;
  }

  isPending(): boolean {
    return !this.publishedAtValue;
  }

  isDue(now: Date): boolean {
    return (
      this.isPending() &&
      (!this.nextAttemptAtValue || this.nextAttemptAtValue <= now)
    );
  }

  markPublished(at: Date): void {
    this.publishedAtValue = new Date(at.getTime());
    this.lastErrorValue = undefined;
  }

  scheduleRetry(now: Date, error: string, policy: OutboxRetryPolicy): void {
    this.attemptsValue += 1;
    const exponential = Math.min(
      policy.maxDelayMs,
      policy.baseDelayMs * (2 ** (this.attemptsValue - 1)),
    );
    const random = policy.random?.() ?? Math.random();
    const jitter = (random * 2 - 1) * policy.jitterRatio;
    const delay = Math.max(0, Math.round(exponential * (1 + jitter)));
    this.nextAttemptAtValue = new Date(now.getTime() + delay);
    this.lastErrorValue = error;
  }
}
