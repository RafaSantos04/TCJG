export class WalletNotFoundError extends Error {
  constructor(readonly walletId: string) {
    super(`Wallet ${walletId} was not found`);
    this.name = 'WalletNotFoundError';
  }
}
