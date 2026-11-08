import { Writable } from 'node:stream';
import pino from 'pino';
import { observabilityContext } from './observability-context.js';
import { FINANCIAL_REDACT_PATHS } from './pino-options.js';

describe('structured observability logging', () => {
  it('propagates correlation fields and redacts financial payloads', () => {
    let output = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = pino(
      {
        mixin: () => observabilityContext.getStore() ?? {},
        redact: {
          paths: [...FINANCIAL_REDACT_PATHS],
          censor: '[REDACTED]',
        },
      },
      destination,
    );

    observabilityContext.run(
      {
        correlationId: 'correlation-13',
        transactionId: 'transaction-13',
        walletId: 'wallet-13',
        providerId: 'provider-13',
      },
      () =>
        logger.info({
          event: 'wager_transaction_handled',
          money: { amount: '10.00', currency: 'BRL' },
          payload: { secret: 'must-not-leak' },
        }),
    );

    const record = JSON.parse(output) as Record<string, unknown>;
    expect(record).toMatchObject({
      correlationId: 'correlation-13',
      transactionId: 'transaction-13',
      walletId: 'wallet-13',
      providerId: 'provider-13',
      event: 'wager_transaction_handled',
      money: '[REDACTED]',
      payload: '[REDACTED]',
    });
    expect(output).not.toContain('10.00');
    expect(output).not.toContain('must-not-leak');
  });
});
