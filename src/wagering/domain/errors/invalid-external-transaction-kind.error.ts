export class InvalidExternalTransactionKindError extends Error {
  override readonly name = 'InvalidExternalTransactionKindError';

  constructor(readonly receivedKind: string) {
    super(`${receivedKind} is not an externally submittable transaction kind`);
  }
}
