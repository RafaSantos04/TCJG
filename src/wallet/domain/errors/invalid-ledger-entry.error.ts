export class InvalidLedgerEntryError extends Error {
  override readonly name = 'InvalidLedgerEntryError';

  constructor(message: string) {
    super(message);
  }
}
