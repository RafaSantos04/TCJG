export const PROVIDER_IDENTITY_PORT = Symbol('PROVIDER_IDENTITY_PORT');

export type ProviderIdentity = Readonly<{
  providerId: string;
}>;

export interface ProviderIdentityPort {
  authenticate(request: unknown): Promise<ProviderIdentity | undefined>;
}
