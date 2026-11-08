export type ReceiveInboxMessageProps = Readonly<{
  consumerName: string;
  messageId: string;
  payloadHash: string;
  receivedAt: Date;
}>;

export type InboxMessageState = ReceiveInboxMessageProps &
  Readonly<{
    processedAt?: Date;
  }>;

export class InboxMessage {
  private constructor(
    readonly messageId: string,
    readonly consumerName: string,
    readonly payloadHash: string,
    readonly receivedAt: Date,
    private processedAtValue?: Date,
  ) {}

  static receive(props: ReceiveInboxMessageProps): InboxMessage {
    InboxMessage.assertState(props);
    return new InboxMessage(
      props.messageId,
      props.consumerName,
      props.payloadHash,
      new Date(props.receivedAt),
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    const receivedAt = new Date(state.receivedAt);
    const processedAt = state.processedAt
      ? new Date(state.processedAt)
      : undefined;
    InboxMessage.assertState({ ...state, receivedAt, processedAt });
    return new InboxMessage(
      state.messageId,
      state.consumerName,
      state.payloadHash,
      receivedAt,
      processedAt,
    );
  }

  get processedAt(): Date | undefined {
    return this.processedAtValue ? new Date(this.processedAtValue) : undefined;
  }

  isProcessed(): boolean {
    return this.processedAtValue !== undefined;
  }

  markProcessed(at: Date): void {
    if (Number.isNaN(at.getTime())) {
      throw new Error('Inbox processedAt must be a valid date');
    }
    if (at.getTime() < this.receivedAt.getTime()) {
      throw new Error('Inbox processedAt cannot precede receivedAt');
    }
    this.processedAtValue ??= new Date(at);
  }

  private static assertState(state: InboxMessageState): void {
    if (!state.consumerName.trim()) {
      throw new Error('Inbox consumerName is required');
    }
    if (!state.messageId.trim()) {
      throw new Error('Inbox messageId is required');
    }
    if (!/^[0-9a-f]{64}$/.test(state.payloadHash)) {
      throw new Error('Inbox payloadHash must be a lowercase SHA-256 hash');
    }
    if (Number.isNaN(state.receivedAt.getTime())) {
      throw new Error('Inbox receivedAt must be a valid date');
    }
    if (state.processedAt && Number.isNaN(state.processedAt.getTime())) {
      throw new Error('Inbox processedAt must be a valid date');
    }
  }
}
