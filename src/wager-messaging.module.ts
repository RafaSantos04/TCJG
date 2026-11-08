import { Module } from '@nestjs/common';
import { FinancialModule } from './financial.module.js';
import { SqsWagerConsumer } from './infrastructure/messaging/sqs-wager-consumer.js';
import { ProcessWagerMessage } from './wagering/application/process-wager-message.js';

@Module({
  imports: [FinancialModule],
  providers: [ProcessWagerMessage, SqsWagerConsumer],
  exports: [ProcessWagerMessage, SqsWagerConsumer],
})
export class WagerMessagingModule {}
