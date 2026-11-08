import { Logger } from '@nestjs/common';
import type { ReconciliationDivergence } from '../../shared/application/ports/reconciliation-observability.port.js';
import { NestReconciliationObservabilityAdapter } from './nest-reconciliation-observability.adapter.js';

describe('NestReconciliationObservabilityAdapter', () => {
  it('emits a structured warning and increments the divergence counter', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const adapter = new NestReconciliationObservabilityAdapter();
    const divergence: ReconciliationDivergence = {
      result: {
        walletId: '0192f291-27dd-7d3f-8071-5f8685deef37',
        storedBalance: { amount: '100.00', currency: 'BRL' },
        calculatedBalance: { amount: '90.00', currency: 'BRL' },
        difference: { amount: '10.00', currency: 'BRL' },
        consistent: false,
        checkedEntries: 2,
      },
      reasons: ['CALCULATED_BALANCE_MISMATCH'],
    };

    adapter.recordDivergence(divergence);
    adapter.recordDivergence(divergence);

    expect(adapter.getReconciliationDivergenceTotal()).toBe(2);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: 'reconciliation_divergence',
        metric: 'reconciliation_divergence_total',
        metricValue: 2,
      }),
    );
  });
});
