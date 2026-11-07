export class ProviderIdentityMismatchError extends Error {
  constructor() {
    super('The authenticated provider does not match the requested provider');
    this.name = 'ProviderIdentityMismatchError';
  }
}
