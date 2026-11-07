# TCJG

Serviço de carteira e transações de apostas desenvolvido em NestJS, com foco
em consistência financeira, concorrência, idempotência e processamento seguro
de mensagens.

## Stack

- Bun 1.x para instalação, scripts e execução do artefato de produção
- NestJS 12 com ESM e `NodeAdapter`
- TypeScript em modo estrito
- PostgreSQL 17
- MikroORM 7 e migrations versionadas
- LocalStack para emular SQS localmente
- Vitest para testes unitários e E2E
- Docker Compose para o ambiente integrado

## Pré-requisitos

- [Bun](https://bun.sh/) 1.x
- Docker Desktop com Docker Compose, para o ambiente integrado

## Instalação

```bash
bun install --frozen-lockfile
```

Esse comando também instala as dependências de desenvolvimento necessárias aos
testes. Execute-o no host antes de `test:unit`, `test:integration` ou
`test:concurrency`; construir a imagem Docker não instala dependências no host.

Copie `.env.example` para `.env` antes de executar a API fora do Docker. O
arquivo `.env` não é versionado.

## Executar todo o ambiente

```bash
bun run infra:up
```

Esse comando constrói a API e inicia:

- API em `http://localhost:3000`
- PostgreSQL em `localhost:5433` (porta interna `5432`)
- LocalStack em `http://localhost:4566`

O container de inicialização cria automaticamente:

- `wager-transactions.fifo`
- `wager-transactions-dlq.fifo`
- `wallet-events.fifo`

`wager-transactions.fifo` usa a DLQ com `maxReceiveCount=5`.

O LocalStack está fixado em `4.14.0`, a última linha comunitária anterior à
exigência de conta das imagens 2026. O projeto precisa apenas do SQS local e não
depende de recursos licenciados.

Para validar três instâncias da API, o Compose reserva as portas 3000–3002:

```bash
docker compose up --build --scale api=3 -d
docker compose ps
```

Para acompanhar a API:

```bash
bun run infra:logs
```

Para encerrar os containers sem remover os volumes:

```bash
bun run infra:down
```

## Executar a API no host

Inicie PostgreSQL e LocalStack e depois execute:

```bash
bun run start:dev
```

O modo de desenvolvimento usa o compilador do Nest. O artefato de produção é
compilado e executado pelo runtime Bun:

```bash
bun run build
bun run start:prod
```

## Qualidade

```bash
bun run test:unit
bun run test:integration
bun run test:concurrency
bun run typecheck
bun run lint
bun run test:e2e
bun run build
```

Os testes E2E substituem apenas o módulo de banco por um módulo vazio. Assim,
eles exercitam o bootstrap, o controller e o `NodeAdapter` sem exigir um
PostgreSQL externo.

Os testes de integração executam o Vitest explicitamente no runtime Bun e usam
um PostgreSQL real. Além do teste básico de persistência com MikroORM, a suíte
financeira cria um schema isolado, executa o ciclo `up/down/up` da migration e
valida as constraints de unicidade, saldo, referências, reversões e ledger
append-only. O schema de teste é removido ao concluir. Use `TEST_DATABASE_URL`
para selecionar o banco.

## Migrations

As migrations ficam em
`src/infrastructure/persistence/mikro-orm/migrations` e devem ser versionadas.
Não usamos sincronização automática de schema.

```bash
bun run db:migration:create
bun run migration:up
bun run db:migration:list
bun run migration:down
```

Os comandos de migration exigem o PostgreSQL ativo e usam `DATABASE_URL`.
A migration inicial cria `wallets`, `wager_transactions`,
`wallet_ledger_entries`, `inbox_messages` e `outbox_messages`. Valores
monetários são persistidos como `numeric(20,2)` e convertidos entre `string` e
o value object `Money` pelos mappers da infraestrutura.

## Estrutura

```text
src/
├── shared/domain/   value objects e erros compartilhados
├── <módulo>/
│   ├── domain/          regras de negócio e invariantes
│   ├── application/     casos de uso e portas
│   ├── infrastructure/  persistência e integrações
│   └── presentation/    HTTP ou consumidores
├── infrastructure/  composição compartilhada de banco e mensageria
├── presentation/    endpoints de sistema
├── config/          contrato das variáveis de ambiente
├── app.module.ts    composição das dependências
└── main.ts          bootstrap da aplicação
```

Leia [ARCHITECTURE.md](./ARCHITECTURE.md) para entender as regras entre as
camadas e as decisões técnicas da fundação.
