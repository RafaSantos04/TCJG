export class WagerTransactionConflictError extends Error {
  constructor(providerId: string, externalTransactionId: string) {
    super(`Transaction ${providerId}/${externalTransactionId} already exists`);
    this.name = 'WagerTransactionConflictError';
  }
}
