# Migrations

MikroORM migrations are generated in this directory and committed to the
repository. Schema changes must be versioned and reversible; automatic schema
synchronization is not used.

`Migration20261107160000InitialFinancialSchema` creates the financial schema,
database constraints, the processed-reversal partial unique index and the
append-only ledger trigger. Run `bun run test:integration` against a real
PostgreSQL instance to validate the complete `up/down/up` cycle.
