import type { ReconciliationResult } from '../../../wallet/application/reconcile-wallet.js';

export const RECONCILIATION_OBSERVABILITY_PORT = Symbol(
  'RECONCILIATION_OBSERVABILITY_PORT',
);

export type ReconciliationDivergence = Readonly<{
  result: ReconciliationResult;
  reasons: readonly string[];
}>;

export interface ReconciliationObservabilityPort {
  recordDivergence(divergence: ReconciliationDivergence): void;
}
