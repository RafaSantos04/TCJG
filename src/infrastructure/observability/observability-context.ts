import { AsyncLocalStorage } from 'node:async_hooks';

export type ObservabilityContext = {
  correlationId: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
};

export const observabilityContext =
  new AsyncLocalStorage<ObservabilityContext>();

export function assignObservabilityContext(
  fields: Partial<ObservabilityContext>,
): void {
  const store = observabilityContext.getStore();
  if (store) Object.assign(store, fields);
}
