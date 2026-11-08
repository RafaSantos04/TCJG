export const PENDING_REFERENCE_REPOSITORY_PORT = Symbol(
  'PENDING_REFERENCE_REPOSITORY_PORT',
);

export type PendingReferenceClaim = Readonly<{
  transactionId: string;
  attempts: number;
  leaseUntil: Date;
}>;

export interface PendingReferenceRepositoryPort {
  claimBatch(limit: number, leaseMs: number): Promise<PendingReferenceClaim[]>;
}
