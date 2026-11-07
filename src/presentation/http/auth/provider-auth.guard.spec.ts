import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ProviderIdentityMismatchError } from '../../../shared/application/errors/provider-identity-mismatch.error.js';
import type { ProviderIdentityPort } from '../../../shared/application/ports/provider-identity.port.js';
import { ProviderAuthGuard } from './provider-auth.guard.js';

function contextFor(request: unknown): ExecutionContext {
  return {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: vi.fn(() => ({ getRequest: () => request })),
  } as unknown as ExecutionContext;
}

describe('ProviderAuthGuard', () => {
  it('allows the request when authenticated and claimed providers match', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => false),
    } as unknown as Reflector;
    const identities: ProviderIdentityPort = {
      authenticate: vi.fn(async () => ({ providerId: 'provider-a' })),
    };
    const guard = new ProviderAuthGuard(reflector, identities);

    await expect(
      guard.canActivate(contextFor({ body: { providerId: 'provider-a' } })),
    ).resolves.toBe(true);
  });

  it('rejects a provider attempting to act as another provider', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => false),
    } as unknown as Reflector;
    const identities: ProviderIdentityPort = {
      authenticate: vi.fn(async () => ({ providerId: 'provider-a' })),
    };
    const guard = new ProviderAuthGuard(reflector, identities);

    await expect(
      guard.canActivate(contextFor({ params: { providerId: 'provider-b' } })),
    ).rejects.toBeInstanceOf(ProviderIdentityMismatchError);
  });

  it('rejects a provider route when no identity is authenticated', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => false),
    } as unknown as Reflector;
    const identities: ProviderIdentityPort = {
      authenticate: vi.fn(async () => undefined),
    };
    const guard = new ProviderAuthGuard(reflector, identities);

    await expect(
      guard.canActivate(contextFor({ params: { providerId: 'provider-a' } })),
    ).rejects.toThrow('Provider authentication is required');
  });

  it('keeps public routes independent from the identity provider', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => true),
    } as unknown as Reflector;
    const authenticate = vi.fn();
    const identities: ProviderIdentityPort = { authenticate };
    const guard = new ProviderAuthGuard(reflector, identities);

    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
