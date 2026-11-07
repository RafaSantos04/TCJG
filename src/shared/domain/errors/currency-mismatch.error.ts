export class CurrencyMismatchError extends Error {
  override readonly name = 'CurrencyMismatchError';

  constructor(
    readonly expectedCurrency: string,
    readonly receivedCurrency: string,
  ) {
    super(
      `Currency mismatch: expected ${expectedCurrency}, received ${receivedCurrency}`,
    );
  }
}
