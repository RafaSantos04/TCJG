import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ProviderAuthenticationRequiredError } from '../../../shared/application/errors/provider-authentication-required.error.js';
import { ProviderIdentityMismatchError } from '../../../shared/application/errors/provider-identity-mismatch.error.js';
import {
  PROVIDER_IDENTITY_PORT,
  type ProviderIdentityPort,
} from '../../../shared/application/ports/provider-identity.port.js';
import { IS_PUBLIC_ROUTE } from './public.decorator.js';

type ProviderRequest = Readonly<{
  body?: { providerId?: unknown };
  params?: { providerId?: unknown };
}>;

@Injectable()
export class ProviderAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PROVIDER_IDENTITY_PORT)
    private readonly identities: ProviderIdentityPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_ROUTE,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<ProviderRequest>();
    const claimedProvider =
      request.body?.providerId ?? request.params?.providerId;
    const identity = await this.identities.authenticate(request);

    if (typeof claimedProvider === 'string' && !identity) {
      throw new ProviderAuthenticationRequiredError();
    }

    if (
      typeof claimedProvider === 'string' &&
      identity &&
      identity.providerId !== claimedProvider
    ) {
      throw new ProviderIdentityMismatchError();
    }

    return true;
  }
}
