export class UniqueConstraintPersistenceError extends Error {
  constructor(readonly constraint?: string) {
    super(
      constraint
        ? `Unique constraint violated: ${constraint}`
        : 'A unique constraint was violated',
    );
    this.name = 'UniqueConstraintPersistenceError';
  }
}

export class TransientPersistenceError extends Error {
  constructor(message = 'A transient persistence failure occurred') {
    super(message);
    this.name = 'TransientPersistenceError';
  }
}
