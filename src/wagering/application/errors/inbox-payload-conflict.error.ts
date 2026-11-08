export class InboxPayloadConflictError extends Error {
  constructor(
    readonly consumerName: string,
    readonly messageId: string,
  ) {
    super(
      `Inbox message ${consumerName}/${messageId} was received with another payload`,
    );
    this.name = 'InboxPayloadConflictError';
  }
}
