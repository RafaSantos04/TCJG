import type {
  FinancialQueryPort,
  WalletLedgerEntryReadModel,
} from '../../shared/application/ports/financial-query.port.js';
import { decodeLedgerCursor } from '../../shared/application/services/ledger-cursor.js';
import { ListWalletLedger } from './list-wallet-ledger.js';

const walletId = '0192f291-27dd-7d3f-8071-5f8685deef37';
const createdAt = new Date('2026-11-07T18:00:00.000Z');

function entry(sequence: string): WalletLedgerEntryReadModel {
  return {
    sequence,
    walletId,
    transactionId: `0192f298-345e-7e38-af88-e43f851a8${sequence.padStart(3, '0')}`,
    direction: 'CREDIT',
    money: { amount: '1.00', currency: 'BRL' },
    balanceBefore: { amount: '0.00', currency: 'BRL' },
    balanceAfter: { amount: '1.00', currency: 'BRL' },
    createdAt,
  };
}

describe('ListWalletLedger', () => {
  it('paginates by the last sequence without duplicating concurrent inserts', async () => {
    const entries = [entry('1'), entry('2'), entry('3')];
    const port: FinancialQueryPort = {
      findWallet: vi.fn(async () => ({
        id: walletId,
        playerId: '0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1',
        balance: { amount: '3.00', currency: 'BRL' },
        version: 1,
        createdAt,
        updatedAt: createdAt,
      })),
      listWalletLedger: vi.fn(async (_walletId, after, limit) =>
        entries
          .filter((item) => !after || BigInt(item.sequence) > BigInt(after))
          .slice(0, limit),
      ),
      findWagerById: vi.fn(),
      findWagerByProviderTransaction: vi.fn(),
    };
    const useCase = new ListWalletLedger(port);

    const firstPage = await useCase.execute({ walletId, limit: 2 });
    entries.push(entry('4'));
    const secondPage = await useCase.execute({
      walletId,
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(firstPage.items.map((item) => item.sequence)).toEqual(['1', '2']);
    expect(decodeLedgerCursor(firstPage.nextCursor!)).toBe('2');
    expect(secondPage.items.map((item) => item.sequence)).toEqual(['3', '4']);
    expect(secondPage.nextCursor).toBeNull();
  });
});
