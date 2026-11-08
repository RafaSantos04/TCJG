import { Module } from '@nestjs/common';
import { FinancialModule } from './financial.module.js';
import { PendingReferenceWorker } from './infrastructure/messaging/pending-reference-worker.js';
import { MikroOrmPendingReferenceRepository } from './infrastructure/persistence/mikro-orm/mikro-orm-pending-reference.repository.js';
import { PENDING_REFERENCE_REPOSITORY_PORT } from './shared/application/ports/pending-reference-repository.port.js';
import { ProcessPendingReferences } from './wagering/application/process-pending-references.js';

@Module({
  imports: [FinancialModule],
  providers: [
    ProcessPendingReferences,
    PendingReferenceWorker,
    {
      provide: PENDING_REFERENCE_REPOSITORY_PORT,
      useClass: MikroOrmPendingReferenceRepository,
    },
  ],
  exports: [ProcessPendingReferences, PENDING_REFERENCE_REPOSITORY_PORT],
})
export class PendingReferenceModule {}
