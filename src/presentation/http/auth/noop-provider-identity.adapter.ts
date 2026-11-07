import { Injectable } from '@nestjs/common';
import type {
  ProviderIdentity,
  ProviderIdentityPort,
} from '../../../shared/application/ports/provider-identity.port.js';

type ProviderRequest = Readonly<{
  body?: { providerId?: unknown };
  params?: { providerId?: unknown };
}>;

@Injectable()
export class NoopProviderIdentityAdapter implements ProviderIdentityPort {
  async authenticate(request: unknown): Promise<ProviderIdentity | undefined> {
    const candidate = request as ProviderRequest;
    const providerId =
      candidate.body?.providerId ?? candidate.params?.providerId;

    return typeof providerId === 'string'
      ? Object.freeze({ providerId })
      : undefined;
  }
}
