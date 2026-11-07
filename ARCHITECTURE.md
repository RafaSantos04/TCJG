# Arquitetura do TCJG

## Objetivo da fundação

A fundação permite evoluir as regras financeiras sem acoplá-las ao framework,
ao banco ou ao transporte. NestJS é usado para composição e entrada da
aplicação; não é o lugar onde as invariantes financeiras vivem.

## Fluxo de dependências

```text
HTTP / SQS
    |
    v
Presentation ---> Application ---> Domain
                         ^
                         |
                  Infrastructure
```

Dependências de código apontam para dentro:

1. `domain` não depende de nenhuma outra camada da aplicação.
2. `application` depende do domínio e declara portas para recursos externos.
3. `presentation` traduz HTTP ou mensagens e chama casos de uso.
4. `infrastructure` implementa portas de persistência e mensageria.
5. `AppModule` conecta as implementações às abstrações.

Essa direção mantém o domínio testável com classes TypeScript comuns.

## Responsabilidade das camadas

### Domain

Contém value objects, aggregates, entidades, serviços e erros de domínio. Não
importa NestJS, MikroORM, AWS SDK ou tipos HTTP.

### Application

Coordena casos de uso e transações. Declara interfaces, chamadas de portas,
para repositórios, relógio, geração de identificadores e publicação de eventos.
Não conhece controllers nem detalhes do MikroORM.

### Presentation

Recebe dados de HTTP ou SQS, valida o formato, chama um caso de uso e traduz o
resultado para o protocolo. Não implementa regra financeira.

### Infrastructure

Implementa acesso ao PostgreSQL, mapeamento do MikroORM, SQS e outros serviços.
Entidades de persistência e mappers ficam aqui, separadas dos aggregates.

## Decisões da Fase 1

### ESM e imports `.js`

O projeto usa `module` e `moduleResolution` como `NodeNext`. Imports relativos
terminam em `.js`, mesmo nos fontes `.ts`, porque esse será o nome do arquivo no
JavaScript compilado.

### TypeScript estrito

`strict` permanece ativo sem desabilitar `strictPropertyInitialization`. O
compilador ajuda a impedir estados parcialmente inicializados, especialmente
importante nos objetos do domínio.

### Bun e Vitest

Bun instala dependências, executa scripts e roda o artefato compilado de
produção. Vitest continua sendo o framework de testes definido pelo projeto;
`bun run test` apenas o orquestra. Essa distinção é intencional e documenta com
precisão qual ferramenta exerce cada papel.

### NodeAdapter

A aplicação usa `@nestjs/platform-node`, que executa Nest diretamente sobre
`node:http`. O teste E2E cria a aplicação com o mesmo adaptador para evitar uma
diferença silenciosa entre teste e produção.

### Configuração validada

`@nestjs/config` carrega o ambiente e Zod valida/coage os valores durante o
bootstrap. Uma configuração ausente ou inválida impede a aplicação de iniciar,
em vez de falhar somente durante uma requisição.

### MikroORM e PostgreSQL

O `DatabaseModule` encapsula a integração com o MikroORM. A aplicação usa
configuração assíncrona para receber os valores já validados pelo
`ConfigService`. Entidades de persistência serão criadas na infraestrutura e
convertidas para objetos do domínio por mappers.

O schema será alterado apenas por migrations versionadas e reversíveis. As
tabelas financeiras serão introduzidas na fase de persistência, quando suas
constraints puderem ser definidas junto às entidades.

### Docker Compose

O ambiente integrado contém API, PostgreSQL e LocalStack. Health checks e
`depends_on` evitam iniciar a API antes das dependências estarem prontas. Isso
melhora a experiência local, mas a aplicação ainda deverá tratar falhas
transitórias em produção.

O LocalStack inicia apenas o serviço SQS. Um container de inicialização separado
cria `wager-transactions.fifo`, `wager-transactions-dlq.fifo` e
`wallet-events.fifo`. A fila de entrada possui `RedrivePolicy` com
`maxReceiveCount=5`. A API só inicia depois que esse container termina com
sucesso.

A imagem está fixada em `localstack/localstack:4.14.0`. As imagens calendarizadas
de 2026 passaram a exigir autenticação e encerram com código 55 sem um token.
Como o desafio usa somente SQS local, manter a última versão comunitária evita
uma dependência externa de conta/licença e torna o setup reproduzível.

A publicação de portas usa o intervalo 3000–3002, permitindo validar três
réplicas com `docker compose up --scale api=3`. Isso prova que a aplicação não
depende de estado mantido em um único processo.

### Teste de persistência no Bun

O teste de integração inicia o Vitest pelo executável do Bun, confirma a presença
de `process.versions.bun` e conecta a um PostgreSQL real. Uma entidade decorada
pelo MikroORM é persistida e recarregada de uma tabela temporária criada dentro
de uma transação. A tabela usa `ON COMMIT DROP`, portanto o teste não modifica o
schema permanente nem depende de sincronização automática.

## Money Value Object

`Money` é um value object imutável e compartilhado pelos módulos de wallet,
ledger e wagering. O domínio o armazena como `bigint` em centavos; `number`,
`float` e arredondamentos binários não participam do caminho monetário.

A entrada pública aceita somente uma string não negativa no formato
`^(0|[1-9]\\d*)\\.\\d{2}$`. Assim, escala, zeros à esquerda, notação científica
e sinais são tratados como parte do contrato, não como algo a ser corrigido
silenciosamente. Valores negativos só podem nascer de operações internas como
`subtract` e `negate`.

A moeda segue `^[A-Z]{3}$`. O modelo é multi-moeda mesmo que o primeiro fluxo
use BRL. `add`, `subtract`, `isLessThan` e `equals` exigem moedas iguais e lançam
`CurrencyMismatchError` em caso de divergência. Optamos por erro também em
`equals` para tornar explícito um uso incorreto do domínio, em vez de ocultá-lo
atrás de um simples `false`.

`toJSON` é o contrato de serialização e sempre retorna duas casas decimais:

```json
{ "amount": "25.00", "currency": "BRL" }
```

## Wallet Aggregate e ledger de domínio

`Wallet` é o Aggregate Root responsável por saldo, moeda, versão e datas de
alteração. O construtor é privado: `open` cria uma wallet com saldo zero e
versão 1, enquanto `rehydrate` recompõe exatamente o estado confiável vindo da
persistência, sem reexecutar transições de negócio.

Saldo inicial positivo não é argumento de `open`. Na fase de aplicação, ele
será representado por uma transação interna `OPENING` e por um crédito na mesma
transação SQL. Dessa forma, nenhum saldo nasce sem uma explicação no ledger.

`credit` e `debit` aceitam apenas `Money` positivo e da moeda da wallet. Valor
zero ou negativo é rejeitado porque o contrato sempre retorna um lançamento e
o ledger não admite lançamentos sem efeito. Uma rejeição não altera saldo,
versão nem `updatedAt`. Débito que produziria saldo negativo lança
`InsufficientFundsError`.

Cada operação calcula `balanceBefore` e `balanceAfter`, cria e valida um
`WalletLedgerEntry` e somente depois aplica a mudança ao aggregate. Assim, uma
falha na criação do lançamento não deixa a wallet parcialmente alterada. Uma
operação válida incrementa `version` uma única vez e usa o instante recebido
como novo `updatedAt`.

`WalletLedgerEntry` contém apenas dados imutáveis: wallet, transação, direção,
valor, saldos anterior e posterior e data de criação. Sua factory rejeita valor
não positivo, saldos negativos, moedas divergentes e aritmética incompatível
com a direção. A persistência, constraints e proteção contra `UPDATE`/`DELETE`
serão adicionadas na fase de banco de dados.

## Convenções

- Arquivos TypeScript usam nomes em `kebab-case`.
- Classes e tipos usam `PascalCase`.
- Imports relativos ESM terminam em `.js`.
- Testes unitários ficam próximos ao código testado.
- Testes E2E ficam em `test/`.
- Controllers não acessam o ORM diretamente.
- Aggregates não recebem dependências do NestJS.
- Mudanças de schema exigem migration com `up` e `down`.

## Próximas fases

`Money` está concluído. A próxima implementação é o aggregate `Wallet`, que usa
o value object para proteger saldo, moeda e versão sem depender de PostgreSQL,
MikroORM ou NestJS.
