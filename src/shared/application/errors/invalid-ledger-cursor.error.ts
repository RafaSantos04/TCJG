export class InvalidLedgerCursorError extends Error {
  constructor() {
    super('Ledger cursor is invalid');
    this.name = 'InvalidLedgerCursorError';
  }
}
