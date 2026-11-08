# Roteiro de apresentação do TCJG

Este roteiro serve para ensaiar a explicação. A ideia é compreender a sequência
e as garantias; não decorar nomes de classes.

## Resumo em 90 segundos

O TCJG é um serviço de wallet e wagering em NestJS. O domínio é TypeScript puro
e dinheiro nunca usa ponto flutuante: `Money` guarda centavos em `bigint` e a
API serializa decimal com duas casas. PostgreSQL é a fonte de verdade para
saldo, ledger append-only e idempotência.

Cada comando financeiro abre uma única transação. A wallet é bloqueada com
`SELECT ... FOR UPDATE`, a regra roda sobre o aggregate e wallet, wager, ledger,
inbox e outbox confirmam ou revertem juntos. Constraints, `CHECK`s, versão e
triggers são defesa em profundidade.

A entrega é at-least-once. A outbox impede perder eventos depois do commit e a
inbox impede repetir efeitos quando o SQS redelivery acontece. Três instâncias
podem trabalhar simultaneamente porque os locks são por wallet ou por linha,
nunca globais.

## Fluxo 1 — duas BETs concorrentes de 80

Estado inicial: wallet com `100.00`. Duas requisições diferentes tentam debitar
`80.00` ao mesmo tempo.

1. Ambas passam pela validação de entrada e abrem transações.
2. Uma delas adquire o lock da wallet; a outra espera somente essa wallet.
3. A primeira lê `100.00`, debita `80.00`, grava saldo `20.00`, wager, ledger e
   outbox e confirma.
4. A segunda adquire o lock e passa a enxergar `20.00`, não o saldo antigo.
5. O domínio rejeita a segunda como `INSUFFICIENT_FUNDS`. A rejeição é
   persistida e auditável, mas não cria débito nem deixa saldo negativo.

Resultado: saldo `20.00`, um único débito e nenhum lost update. O ponto-chave é
que o lock permanece da leitura até o commit; não existe
`read → calculate → update` fora da mesma transação.

## Fluxo 2 — a mesma BET enviada 50 vezes

As 50 requisições têm a mesma `Idempotency-Key` e o mesmo payload.

1. Uma requisição vence e grava a wager protegida por uma constraint única.
2. Requisições que já enxergam a linha comparam o SHA-256 do payload canônico e
   devolvem o resultado persistido.
3. Requisições que competem no insert perdem com `23505`, fazem rollback e
   abrem uma transação curta apenas para reler o vencedor.
4. Se o commit ficar visível entre a consulta por chave e a consulta pela
   identidade externa, a mesma chave e o mesmo hash também são tratados como
   replay.

Resultado: 50 respostas de sucesso apontam para a mesma transação, existe um
único débito e todos recebem o `balance_after` observado na primeira execução.
Se a chave for reutilizada com outro payload, a resposta é `409`; idempotência
não significa aceitar conteúdo divergente.

## Fluxo 3 — crash depois do commit e antes do ACK

1. O consumer recebe uma mensagem e insere `(consumer_name, message_id)` na
   inbox.
2. Inbox, wallet, wager, ledger e outbox são confirmados na mesma transação.
3. O processo morre antes de executar `DeleteMessage` no SQS.
4. Após o visibility timeout, outro processo recebe a mesma mensagem com o
   mesmo `SQS_CONSUMER_NAME`.
5. A chave persistente da inbox já está processada; o consumer não reaplica a
   operação financeira e apenas confirma a mensagem.

Resultado: at-least-once no transporte e exactly-once nos efeitos locais para a
mesma identidade de consumer. O teste mata um processo Bun real nesse ponto e
reabre a conexão da aplicação antes da redelivery.

## Fluxo 4 — crash depois do commit e antes da publicação

1. A transação financeira não publica diretamente no SQS; ela grava uma linha
   na outbox antes do commit.
2. Um publisher reivindica a linha com lease e `FOR UPDATE SKIP LOCKED`.
3. Se ele morrer antes de publicar, o evento continua pendente no PostgreSQL.
4. Quando o lease expira, outro publisher reivindica e publica o envelope.
5. Se o primeiro chegou a publicar e morreu antes de marcar `published_at`, uma
   duplicata é possível e esperada. `eventId` é o identificador de deduplicação
   e consumidores devem ser idempotentes.

Resultado: nenhum evento confirmado é perdido. A garantia é at-least-once, não
uma promessa irreal de exactly-once distribuído.

## Perguntas que provavelmente aparecerão

### Por que lock pessimista?

Porque o ledger exige `balance_before` exato e wallets são a unidade natural de
contenção. O lock por wallet deixa a sequência fácil de auditar e não bloqueia
wallets diferentes. `lock_timeout`, versão e constraints impedem espera
infinita e acrescentam defesa em profundidade.

### Por que MikroORM?

Porque oferece transação, Unit of Work, lock pessimista e integração PostgreSQL,
mantendo entidades de persistência separadas do domínio. O caso de uso depende
de portas; trocar o ORM não altera aggregates nem regras financeiras.

### Por que outbox e inbox?

A outbox resolve o intervalo entre commit do banco e publicação no broker. A
inbox resolve o intervalo entre processamento e ACK. Elas protegem lados
diferentes do fluxo e ambas precisam de constraints persistentes.

### Por que não usar `number` para dinheiro?

Ponto flutuante binário não representa todos os decimais exatamente. `Money`
usa centavos inteiros, valida escala/moeda e só serializa strings com duas casas.

### O que mudaria em produção?

Keycloak ou Zitadel substituiria o adapter de identidade no-op; métricas das
réplicas seriam agregadas pelo Prometheus; LocalStack seria complementado por
testes periódicos na AWS; secrets sairiam do `.env`; e alertas cobririam DLQ,
outbox lag, divergência de reconciliação e conflitos anormais.

### Como a IA foi utilizada?

IA generativa foi utilizada como ferramenta de planejamento, implementação e
revisão dentro de um fluxo orientado a especificação. Claude Opus 5.5 apoiou a
orquestração e GPT-5.6 Sol a execução das etapas. Cada sugestão foi confrontada
com os requisitos do desafio, revisada por diff e validada por testes unitários,
de integração, concorrência e carga. As decisões técnicas, os commits, a
execução na VM e o aceite de cada fase permaneceram sob responsabilidade humana.
Nenhum modelo participa do runtime ou das garantias financeiras.

## Checklist do ensaio

- Explicar cada um dos quatro fluxos em até dois minutos, sem ler o texto.
- Sempre dizer qual é a fonte de verdade e onde ocorre o commit.
- Diferenciar rejeição de negócio de falha técnica transitória.
- Diferenciar idempotência local de exactly-once distribuído.
- Mostrar por que três instâncias preservam paralelismo entre wallets.
- Encerrar reconhecendo limitações reais, sem prometer garantias inexistentes.
