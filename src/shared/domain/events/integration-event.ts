import { v7 as uuidv7 } from 'uuid';

export type IntegrationEventProps<T> = Readonly<{
  eventId?: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
  data: T;
}>;

export type SerializedIntegrationEvent<T> = Readonly<{
  eventId: string;
  eventType: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  version: number;
  data: Readonly<T>;
}>;

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly data: Readonly<T>;
  private readonly occurredAtValue: Date;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId ?? uuidv7();
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.occurredAtValue = new Date(props.occurredAt.getTime());
    this.data = Object.freeze(props.data);
  }

  get occurredAt(): Date {
    return new Date(this.occurredAtValue.getTime());
  }

  toJSON(): SerializedIntegrationEvent<T> {
    return Object.freeze({
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAtValue.toISOString(),
      version: this.version,
      data: this.data,
    });
  }
}
