export class IdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was used with another payload`);
    this.name = 'IdempotencyConflictError';
  }
}
