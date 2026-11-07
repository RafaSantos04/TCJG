export class WagerTransactionNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Wager transaction ${identifier} was not found`);
    this.name = 'WagerTransactionNotFoundError';
  }
}
