import { Injectable, Logger } from '@nestjs/common';
import type {
  ReconciliationDivergence,
  ReconciliationObservabilityPort,
} from '../../shared/application/ports/reconciliation-observability.port.js';
import { MetricsService } from './metrics.service.js';

@Injectable()
export class NestReconciliationObservabilityAdapter implements ReconciliationObservabilityPort {
  private readonly logger = new Logger(
    NestReconciliationObservabilityAdapter.name,
  );
  private reconciliationDivergenceTotal = 0;

  constructor(private readonly metrics: MetricsService) {}

  getReconciliationDivergenceTotal(): number {
    return this.reconciliationDivergenceTotal;
  }

  recordDivergence(divergence: ReconciliationDivergence): void {
    this.reconciliationDivergenceTotal += 1;
    this.metrics.recordReconciliationDivergence();
    this.logger.warn({
      event: 'reconciliation_divergence',
      metric: 'reconciliation_divergence_total',
      metricValue: this.reconciliationDivergenceTotal,
      walletId: divergence.result.walletId,
      storedBalance: divergence.result.storedBalance,
      calculatedBalance: divergence.result.calculatedBalance,
      difference: divergence.result.difference,
      checkedEntries: divergence.result.checkedEntries,
      reasons: divergence.reasons,
    });
  }
}
