import { createHash } from 'node:crypto';
import type { SerializedMoney } from '../../../shared/domain/value-objects/money.js';
import type { WagerTransactionKind } from '../value-objects/wager-transaction-kind.js';

export type WagerTransactionBusinessPayload = Readonly<{
  providerId: string;
  externalTransactionId: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: SerializedMoney;
  referenceExternalTransactionId?: string;
}>;

export function canonicalizeJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeJson(item)}`)
      .join(',')}}`;
  }

  throw new TypeError(`Unsupported canonical JSON value: ${typeof value}`);
}

export function calculateWagerTransactionPayloadHash(
  payload: WagerTransactionBusinessPayload,
): string {
  return createHash('sha256')
    .update(canonicalizeJson(payload), 'utf8')
    .digest('hex');
}
