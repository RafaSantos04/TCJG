export class ProviderAuthenticationRequiredError extends Error {
  constructor() {
    super('Provider authentication is required');
    this.name = 'ProviderAuthenticationRequiredError';
  }
}
