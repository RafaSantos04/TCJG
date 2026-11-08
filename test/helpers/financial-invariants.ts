import type { Connection } from '@mikro-orm/core';

type FinancialInvariantRow = Readonly<{
  balance: string;
  ledgerBalance: string;
  lastBalanceAfter: string | null;
  chainGaps: string;
  checkedEntries: string;
}>;

export async function expectWalletMatchesLedger(
  connection: Connection,
  walletId: string,
  schema?: string,
): Promise<void> {
  const wallets = qualifiedTable(schema, 'wallets');
  const ledger = qualifiedTable(schema, 'wallet_ledger_entries');
  const [row] = await connection.execute<FinancialInvariantRow[]>(
    `with ordered_ledger as (
       select
         direction,
         amount,
         balance_before,
         balance_after,
         lag(balance_after) over (order by seq) as previous_balance_after
       from ${ledger}
       where wallet_id = ?
     ), ledger_summary as (
       select
         coalesce(sum(
           case direction when 'CREDIT' then amount else -amount end
         ), 0)::text as "ledgerBalance",
         count(*) filter (
           where previous_balance_after is not null
             and balance_before <> previous_balance_after
         )::text as "chainGaps",
         count(*)::text as "checkedEntries"
       from ordered_ledger
     )
     select
       w.balance::text as balance,
       s."ledgerBalance",
       (
         select balance_after::text
         from ${ledger}
         where wallet_id = w.id
         order by seq desc
         limit 1
       ) as "lastBalanceAfter",
       s."chainGaps",
       s."checkedEntries"
     from ${wallets} w
     cross join ledger_summary s
     where w.id = ?`,
    [walletId, walletId],
  );

  expect(row, `wallet ${walletId} was not found`).toBeDefined();
  expect(row?.balance).toBe(row?.ledgerBalance);
  expect(row?.balance).toBe(row?.lastBalanceAfter);
  expect(row?.chainGaps).toBe('0');
  expect(Number(row?.checkedEntries ?? 0)).toBeGreaterThan(0);
}

function qualifiedTable(schema: string | undefined, table: string): string {
  if (!schema) return `"${table}"`;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
    throw new Error('Unsafe test schema name');
  }
  return `"${schema}"."${table}"`;
}
