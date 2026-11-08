import type {
  FinancialQueryPort,
  WalletReconciliationSnapshot,
} from '../../shared/application/ports/financial-query.port.js';
import type { ReconciliationObservabilityPort } from '../../shared/application/ports/reconciliation-observability.port.js';
import { WalletNotFoundError } from '../../wagering/application/errors/wallet-not-found.error.js';
import { ReconcileWallet } from './reconcile-wallet.js';

const walletId = '0192f291-27dd-7d3f-8071-5f8685deef37';
const now = new Date('2026-11-08T12:00:00.000Z');

function snapshot(storedBalance = '90.00'): WalletReconciliationSnapshot {
  return {
    wallet: {
      id: walletId,
      playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
      balance: { amount: storedBalance, currency: 'BRL' },
      version: 2,
      createdAt: now,
      updatedAt: now,
    },
    entries: [
      {
        sequence: '1',
        walletId,
        transactionId: '0192f298-345e-7e38-af88-e43f851a8101',
        direction: 'CREDIT',
        money: { amount: '100.00', currency: 'BRL' },
        balanceBefore: { amount: '0.00', currency: 'BRL' },
        balanceAfter: { amount: '100.00', currency: 'BRL' },
        createdAt: now,
      },
      {
        sequence: '2',
        walletId,
        transactionId: '0192f298-345e-7e38-af88-e43f851a8102',
        direction: 'DEBIT',
        money: { amount: '10.00', currency: 'BRL' },
        balanceBefore: { amount: '100.00', currency: 'BRL' },
        balanceAfter: { amount: '90.00', currency: 'BRL' },
        createdAt: now,
      },
    ],
  };
}

function setup(currentSnapshot: WalletReconciliationSnapshot | undefined) {
  const queries: FinancialQueryPort = {
    findWallet: vi.fn(),
    getWalletReconciliationSnapshot: vi.fn(async () => currentSnapshot),
    listWalletLedger: vi.fn(),
    findWagerById: vi.fn(),
    findWagerByProviderTransaction: vi.fn(),
  };
  const recordDivergence = vi.fn();
  const observability: ReconciliationObservabilityPort = { recordDivergence };

  return {
    useCase: new ReconcileWallet(queries, observability),
    recordDivergence,
  };
}

describe('ReconcileWallet', () => {
  it('reports a consistent wallet reconstructed from the complete ledger', async () => {
    const { useCase, recordDivergence } = setup(snapshot());

    await expect(useCase.execute(walletId)).resolves.toEqual({
      walletId,
      storedBalance: { amount: '90.00', currency: 'BRL' },
      calculatedBalance: { amount: '90.00', currency: 'BRL' },
      difference: { amount: '0.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 2,
    });
    expect(recordDivergence).not.toHaveBeenCalled();
  });

  it('reports and counts a divergence without changing the snapshot', async () => {
    const divergent = snapshot('95.00');
    const { useCase, recordDivergence } = setup(divergent);

    const result = await useCase.execute(walletId);

    expect(result).toMatchObject({
      storedBalance: { amount: '95.00', currency: 'BRL' },
      calculatedBalance: { amount: '90.00', currency: 'BRL' },
      difference: { amount: '5.00', currency: 'BRL' },
      consistent: false,
    });
    expect(recordDivergence).toHaveBeenCalledWith(
      expect.objectContaining({
        result,
        reasons: expect.arrayContaining([
          'CALCULATED_BALANCE_MISMATCH',
          'LAST_LEDGER_BALANCE_MISMATCH',
        ]),
      }),
    );
    expect(divergent.wallet.balance.amount).toBe('95.00');
  });

  it('detects a broken balance chain even when the final amounts match', async () => {
    const broken = snapshot();
    const second = broken.entries[1]!;
    const { useCase, recordDivergence } = setup({
      ...broken,
      entries: [
        broken.entries[0]!,
        {
          ...second,
          balanceBefore: { amount: '99.00', currency: 'BRL' },
        },
      ],
    });

    const result = await useCase.execute(walletId);

    expect(result.consistent).toBe(false);
    expect(recordDivergence).toHaveBeenCalledWith(
      expect.objectContaining({
        reasons: expect.arrayContaining(['LEDGER_CHAIN_GAP']),
      }),
    );
  });

  it('returns the standard not-found error for an unknown wallet', async () => {
    const { useCase } = setup(undefined);

    await expect(useCase.execute(walletId)).rejects.toBeInstanceOf(
      WalletNotFoundError,
    );
  });
});
