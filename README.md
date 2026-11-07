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

Copie `.env.example` para `.env` antes de executar a API fora do Docker. O
arquivo `.env` não é versionado.

## Executar todo o ambiente

```bash
bun run infra:up
```

Esse comando constrói a API e inicia:

- API em `http://localhost:3000`
- PostgreSQL em `localhost:5432`
- LocalStack em `http://localhost:4566`

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
bun run typecheck
bun run lint
bun run test
bun run test:e2e
bun run build
```

Os testes E2E substituem apenas o módulo de banco por um módulo vazio. Assim,
eles exercitam o bootstrap, o controller e o `NodeAdapter` sem exigir um
PostgreSQL externo. Testes de integração reais com PostgreSQL serão adicionados
junto às entidades e constraints.

## Migrations

As migrations ficam em
`src/infrastructure/persistence/mikro-orm/migrations` e devem ser versionadas.
Não usamos sincronização automática de schema.

```bash
bun run db:migration:create
bun run db:migration:up
bun run db:migration:list
bun run db:migration:down
```

Os comandos de migration exigem o PostgreSQL ativo e usam `DATABASE_URL`.

## Estrutura

```text
src/
├── domain/          regras de negócio e invariantes
├── application/     casos de uso e portas
├── infrastructure/  banco, ORM, SQS e implementações externas
├── presentation/    controllers HTTP e consumidores
├── config/          contrato das variáveis de ambiente
├── app.module.ts    composição das dependências
└── main.ts          bootstrap da aplicação
```

Leia [ARCHITECTURE.md](./ARCHITECTURE.md) para entender as regras entre as
camadas e as decisões técnicas da fundação.
