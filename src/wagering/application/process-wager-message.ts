import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCIAL_TRANSACTION_PORT,
  type FinancialTransactionPort,
} from '../../shared/application/ports/financial-transaction.port.js';
import { TransientPersistenceError } from '../../shared/application/errors/persistence.error.js';
import { InboxMessage } from '../../shared/domain/entities/inbox-message.js';
import {
  wagerMessageEnvelopeSchema,
  type WagerMessageEnvelope,
} from './schemas/wager-message.schema.js';
import { InboxPayloadConflictError } from './errors/inbox-payload-conflict.error.js';
import { InvalidWagerMessageError } from './errors/invalid-wager-message.error.js';
import {
  ProcessWagerTransaction,
  type ProcessWagerTransactionResult,
} from './process-wager-transaction.js';

export type ProcessWagerMessageResult = Readonly<{
  messageId: string;
  duplicate: boolean;
  transaction?: ProcessWagerTransactionResult;
}>;

@Injectable()
export class ProcessWagerMessage {
  constructor(
    @Inject(FINANCIAL_TRANSACTION_PORT)
    private readonly transactions: FinancialTransactionPort,
    private readonly processWagerTransaction: ProcessWagerTransaction,
  ) {}

  async execute(
    rawBody: string | undefined,
    consumerName: string,
  ): Promise<ProcessWagerMessageResult> {
    const envelope = ProcessWagerMessage.parse(rawBody);
    const payloadHash = ProcessWagerMessage.hash(envelope);
    const receivedAt = new Date();

    return this.transactions.run(async (context) => {
      let inbox = InboxMessage.receive({
        consumerName,
        messageId: envelope.messageId,
        payloadHash,
        receivedAt,
      });

      const inserted = await context.insertInbox(inbox);
      if (!inserted) {
        const persisted = await context.lockInbox(
          consumerName,
          envelope.messageId,
        );
        if (!persisted) {
          throw new TransientPersistenceError(
            `Inbox message ${consumerName}/${envelope.messageId} disappeared during deduplication`,
          );
        }
        if (persisted.payloadHash !== payloadHash) {
          throw new InboxPayloadConflictError(consumerName, envelope.messageId);
        }
        if (persisted.isProcessed()) {
          return Object.freeze({
            messageId: envelope.messageId,
            duplicate: true,
          });
        }
        inbox = persisted;
      }

      const transaction = await this.processWagerTransaction.execute(
        envelope.data,
        context,
      );
      inbox.markProcessed(new Date());
      await context.updateInbox(inbox);

      return Object.freeze({
        messageId: envelope.messageId,
        duplicate: false,
        transaction,
      });
    });
  }

  private static parse(rawBody: string | undefined): WagerMessageEnvelope {
    if (!rawBody) {
      throw new InvalidWagerMessageError('SQS message body is required');
    }

    let value: unknown;
    try {
      value = JSON.parse(rawBody);
    } catch {
      throw new InvalidWagerMessageError('SQS message body must be valid JSON');
    }

    const parsed = wagerMessageEnvelopeSchema.safeParse(value);
    if (!parsed.success) {
      throw new InvalidWagerMessageError(
        `SQS message does not match WagerTransactionRequested: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')}`,
      );
    }
    return parsed.data;
  }

  private static hash(envelope: WagerMessageEnvelope): string {
    return createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
  }
}
