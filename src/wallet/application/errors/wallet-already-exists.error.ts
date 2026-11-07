export class WalletAlreadyExistsError extends Error {
  constructor(
    readonly playerId: string,
    readonly currency: string,
  ) {
    super(`A ${currency} wallet already exists for player ${playerId}`);
    this.name = 'WalletAlreadyExistsError';
  }
}
