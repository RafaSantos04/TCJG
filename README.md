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
- AWS SDK v3 para publicação dos eventos de integração
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
bun run migration:up
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

## API financeira

Com o PostgreSQL ativo e a migration aplicada, a API permite criar uma wallet,
processar `BET`, `WIN` e `LOSS` e consultar o estado persistido:

```http
POST /wallets
Content-Type: application/json

{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "initialBalance": { "amount": "100.00", "currency": "BRL" }
}
```

```http
POST /wagering/transactions
Content-Type: application/json
Idempotency-Key: provider-a:transaction-123

{
  "providerId": "provider-a",
  "externalTransactionId": "transaction-123",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "<id retornado pela criação>",
  "roundId": "round-987",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": { "amount": "25.00", "currency": "BRL" }
}
```

Repetir o segundo request com a mesma chave e payload devolve a resposta
persistida com `idempotentReplay: true`. Reutilizar a chave com outro payload
devolve `409`.

As consultas disponíveis são:

```http
GET /wallets/:walletId
GET /wallets/:walletId/ledger?limit=50&cursor=<nextCursor>
GET /wagering/transactions/:transactionId
GET /providers/:providerId/wagering/transactions/:externalTransactionId
POST /wallets/:walletId/reconciliation
```

O ledger usa paginação por cursor, com `limit` padrão 50 e máximo 200. Use
`nextCursor` exatamente como recebido; o valor codifica a sequência do último
lançamento e não deve ser interpretado pelo cliente. Inserções posteriores não
repetem itens já percorridos.

A reconciliação reconstrói o saldo pela soma dos créditos menos débitos e
também verifica o último `balance_after` e a continuidade da cadeia. A leitura
usa um snapshot `REPEATABLE READ` com lock compartilhado na wallet. Divergências
retornam `consistent: false`, geram o aviso estruturado e incrementam
`reconciliation_divergence_total`; o endpoint nunca altera nem corrige dados.

Erros HTTP possuem um único formato:

```json
{
  "error": {
    "code": "WALLET_NOT_FOUND",
    "message": "Wallet ... was not found",
    "retryable": false
  }
}
```

Falhas transitórias retornam `503`, `retryable: true` e `Retry-After: 1`.
Validação retorna `422`, conflitos retornam `409` e recursos ausentes, `404`.
O health check `GET /` é público. As rotas financeiras passam por uma porta de
identidade de provider; nesta etapa o adapter é propositalmente no-op, pronto
para ser substituído por autenticação real sem alterar controllers e casos de
uso.

## Observabilidade e health

Os logs são JSON via Pino. `X-Correlation-Id` é preservado quando enviado ou
gerado como UUID, devolvido na resposta e propagado por `AsyncLocalStorage`.
Operações financeiras acrescentam `providerId`, `walletId` e `transactionId`;
o consumidor acrescenta também `messageId`. Payloads, headers sensíveis e
objetos monetários completos são redigidos.

```http
GET /metrics
GET /health/live
GET /health/ready
```

`/metrics` expõe as famílias Prometheus de transações, idempotência, SQS,
conflitos de banco, outbox, duração e reconciliação. Liveness verifica somente
o processo; readiness executa o ping oficial do MikroORM e
`GetQueueAttributes` no SQS. As três rotas são públicas.

## Transactional outbox

Toda alteração financeira grava seus eventos na tabela `outbox_messages` dentro
da mesma transação PostgreSQL. Nenhuma requisição publica diretamente no SQS.
Depois do commit, cada instância da API executa um publisher que reivindica até
50 linhas com `FOR UPDATE SKIP LOCKED` e lease de 30 segundos.

O publisher envia o envelope para `wallet-events.fifo` usando o `eventId` UUID
v7 como `MessageDeduplicationId` e o `aggregateId` como `MessageGroupId`.
Somente a confirmação do SQS preenche `published_at`. Falhas incrementam
`attempts`, registram `last_error` e calculam novo `next_attempt_at` com backoff
exponencial e jitter. As linhas nunca são apagadas.

As opções `OUTBOX_*` do `.env.example` permitem reduzir poll, lease e retry nos
testes. Em produção, todas as réplicas podem manter o worker ativo: o lease no
banco distribui o trabalho e permite que outra instância assuma após um crash.
`OutboxPublisherService.getLagSeconds()` fornece o valor de
`outbox_lag_seconds`; a exportação pela solução de métricas pertence à fase de
observabilidade.

## Consumidor SQS e inbox

Cada réplica pode consumir `wager-transactions.fifo` com long polling em lotes
de até 10 mensagens. O envelope `WagerTransactionRequested` é validado antes de
abrir a transação e não aceita `OPENING`, campos extras, dinheiro sem duas casas
ou identificadores inválidos.

Para mensagens válidas, a chave `(consumer_name, message_id)` é inserida em
`inbox_messages` com `ON CONFLICT DO NOTHING`. Inbox, wallet, wager, ledger e
outbox usam o mesmo `FinancialTransactionContext`; `processed_at` é preenchido
na mesma transação. O `DeleteMessage` só ocorre depois que ela confirma. Uma
redelivery com o mesmo hash apenas recebe ack; a mesma chave com outro payload é
tratada como mensagem permanente inválida.

Falhas transitórias e permanentes permanecem sem ack e recebem visibility
timeout exponencial até `SQS_MAX_RECEIVE_COUNT`. No limite, a mensagem é enviada
para `wager-transactions-dlq.fifo` com a classificação da falha e só então é
removida da fila principal. Resultados de negócio, inclusive `REJECTED` e replay
financeiro, são terminais e recebem ack normalmente após o commit.

No shutdown, o consumer cancela o long polling, termina as mensagens já
iniciadas e devolve imediatamente a visibilidade das mensagens recebidas que
ainda não começaram. As opções `SQS_*` de `.env.example` controlam filas,
concorrência, visibility timeout e retry. O Compose habilita o consumer; o
default do schema fica desabilitado para testes de bootstrap que não sobem SQS.

## Reversões e referências fora de ordem

`POST /wagering/transactions` e o consumidor SQS aceitam `REFUND` e
`ROLLBACK`, ambos com `referenceExternalTransactionId`. A referência é buscada
por provider e identificador externo. Provider, player, wallet, moeda, rodada,
tipo, estado e valor são validados antes de qualquer alteração de saldo.

`REFUND` credita uma `BET` processada. `ROLLBACK` inverte `BET`, `WIN` ou
`REFUND`. Débitos de reversão sem saldo são persistidos como
`REJECTED/REVERSAL_INSUFFICIENT_FUNDS`; uma segunda reversão do mesmo tipo é
`REJECTED/ALREADY_REVERSED`.

Quando a referência ainda não existe, a API responde `202` e persiste
`PENDING_REFERENCE` com evento na outbox. O worker reivindica linhas com
`FOR UPDATE SKIP LOCKED`, usa lease e backoff exponencial e reaplica o fluxo sob
lock da wallet. Por padrão, a décima tentativa sem referência encerra como
`REJECTED/REFERENCE_NOT_FOUND`. Todas as opções estão em
`PENDING_REFERENCE_*` no `.env.example`.

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
PostgreSQL e LocalStack reais. Além do teste básico de persistência com MikroORM, a suíte
financeira cria um schema isolado, executa o ciclo `up/down/up` da migration e
valida as constraints de unicidade, saldo, referências, reversões e ledger
append-only. A suíte da outbox valida recuperação de lease abandonado, dois
publishers concorrentes, indisponibilidade do SQS com retry e lag. O schema e a
fila de teste são removidos ao concluir. A suíte do consumer valida redelivery
após commit antes do ack, mata um processo Bun real nesse intervalo, reconecta
a aplicação ao mesmo schema, confirma a deduplicação persistente, força
rollback no meio da transação, cobre retry transitório, poison message na DLQ e
shutdown sem perda. Ao fim de cada cenário financeiro, o saldo materializado é
comparado com a soma e a continuidade do ledger diretamente no PostgreSQL.
PostgreSQL e SQS não são substituídos por mocks nesses testes. Use
`TEST_DATABASE_URL` para selecionar o banco e `AWS_ENDPOINT_URL` para selecionar
o SQS.

Os testes de concorrência usam PostgreSQL real, exigem pelo menos três URLs
distintas e verificam o liveness de cada instância antes de distribuir o HTTP.
Execute-os depois de reconstruir e subir a API:

```bash
bun run infra:up:scaled
bun run migration:up
bun run test:concurrency
```

As URLs podem ser substituídas por `CONCURRENCY_API_URLS` e o banco por
`TEST_DATABASE_URL`.

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
